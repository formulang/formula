import type {
  FunctionDefinition,
  MutableFormulaRegistry,
  OperatorDefinition,
  VariableDefinition,
} from './registry';
import { isAssignable, stripNullability } from './type-utils';
import type { FormulaType } from './types';

export class InMemoryFormulaRegistry implements MutableFormulaRegistry {
  /**
   * In-memory registry implementation.
   *
   * This is used by the parser/compiler to resolve functions/operators/variables.
   * It also performs a conservative ambiguity check for overloads.
   */
  private readonly functionsBySignatureId = new Map<string, FunctionDefinition>();
  private readonly functionsByName = new Map<string, FunctionDefinition[]>();
  private readonly operatorsByToken = new Map<string, OperatorDefinition>();
  private readonly variablesByName = new Map<string, VariableDefinition>();
  private readonly castsByKey = new Map<
    string,
    { signatureId: string; from: FormulaType; to: FormulaType }
  >();

  registerFunction(def: FunctionDefinition): void {
    // Basic versioning rule: signature ids must be stable and versioned.
    // Convention: NAME/vN (e.g. FILTER/v1). This keeps requirements + caching stable across future changes.
    if (!/^[A-Z0-9_]+\/v\d+$/.test(def.signatureId)) {
      throw new Error(`Invalid function signatureId (expected NAME/vN): ${def.signatureId}`);
    }

    // Prevent accidental signature collisions.
    // This applies to legacy definitions too: signature ids are the persistence anchor.
    if (this.functionsBySignatureId.has(def.signatureId)) {
      throw new Error(`Function already registered: ${def.signatureId}`);
    }

    // Legacy definitions are retired from authoring: they never enter the name index or
    // the cast map, and they are skipped by the ambiguity checks (ambiguity is a
    // resolution concern and legacy definitions are not resolvable by name/cast).
    // They stay resolvable by signature id so persisted rules keep evaluating.
    const legacy = def.legacy === true;

    const nameKeys = [...new Set([def.name, ...(def.aliases ?? [])].map((n) => n.toUpperCase()))];
    if (!legacy) {
      for (const key of nameKeys) {
        const existing = this.functionsByName.get(key) ?? [];
        for (const other of existing) {
          // If two overloads accept the exact same argument shapes, resolution becomes
          // non-deterministic. Catch this at registration time.
          if (isAmbiguousOverload(other, def)) {
            throw new Error(
              `Ambiguous overload for ${key}: ${other.signatureId} vs ${def.signatureId}`,
            );
          }
        }
      }
    }

    this.functionsBySignatureId.set(def.signatureId, def);
    if (legacy) return;
    for (const key of nameKeys) {
      const existing = this.functionsByName.get(key) ?? [];
      this.functionsByName.set(key, [...existing, def]);
    }

    // Explicit cast map ambiguity detection.
    for (const cast of def.casts ?? []) {
      const fromKey = typeKey(stripNullability(cast.from));
      const toKey = typeKey(stripNullability(cast.to));
      const key = `${fromKey}=>${toKey}`;
      const inverseKey = `${toKey}=>${fromKey}`;
      const existing = this.castsByKey.get(key);
      if (existing) {
        throw new Error(
          `Ambiguous cast ${key}: ${existing.signatureId} vs ${def.signatureId} (functions must declare unique casts)`,
        );
      }

      // Avoid counter-cast ambiguity. If there is already a cast in the
      // inverse direction, reject it to keep casting behavior strictly one-way.
      const inverse = this.castsByKey.get(inverseKey);
      if (inverse) {
        throw new Error(
          `Ambiguous counter-cast ${inverseKey}: ${inverse.signatureId} vs ${def.signatureId} (counter-casts are not allowed)`,
        );
      }
      this.castsByKey.set(key, { signatureId: def.signatureId, from: cast.from, to: cast.to });
    }
  }

  registerOperator(def: OperatorDefinition): void {
    if (!/^[A-Z0-9_]+\/v\d+$/.test(def.functionSignatureId)) {
      throw new Error(
        `Invalid operator functionSignatureId (expected NAME/vN): ${def.functionSignatureId}`,
      );
    }
    if (this.operatorsByToken.has(def.token)) {
      throw new Error(`Operator already registered: ${def.token}`);
    }

    const fn = this.getFunction(def.functionSignatureId);
    const filled: OperatorDefinition = {
      ...def,
      implicitCastsAllowed:
        def.implicitCastsAllowed ?? ['=', '<>', '>', '>=', '<', '<='].includes(def.token),
      inputTypes: def.inputTypes ?? (fn ? fn.params.map((p) => p.type) : undefined),
      outputType: def.outputType ?? (fn ? fn.returnType : undefined),
    };
    this.operatorsByToken.set(def.token, filled);
  }

  retireFunction(signatureId: string): void {
    const def = this.functionsBySignatureId.get(signatureId);
    if (!def) {
      throw new Error(`Function not registered: ${signatureId}`);
    }
    // Idempotent: retiring an already-legacy definition is a no-op.
    if (def.legacy === true) return;

    // Definitions are stored by caller reference, so replace the stored entry with a
    // legacy-marked copy instead of mutating an object the caller may share/reuse.
    this.functionsBySignatureId.set(signatureId, { ...def, legacy: true });

    const nameKeys = [...new Set([def.name, ...(def.aliases ?? [])].map((n) => n.toUpperCase()))];
    for (const key of nameKeys) {
      const remaining = (this.functionsByName.get(key) ?? []).filter(
        (other) => other.signatureId !== signatureId,
      );
      if (remaining.length > 0) this.functionsByName.set(key, remaining);
      else this.functionsByName.delete(key);
    }

    // Release cast slots owned by the retired definition so a successor can redeclare them.
    for (const [key, cast] of this.castsByKey) {
      if (cast.signatureId === signatureId) this.castsByKey.delete(key);
    }
  }

  registerVariable(def: VariableDefinition): void {
    const key = def.name;
    if (this.variablesByName.has(key)) {
      throw new Error(`Variable already registered: ${key}`);
    }
    const description = def.description?.trim();
    this.variablesByName.set(key, {
      ...def,
      description: description && description.length > 0 ? description : `The ${def.name} value.`,
    });
  }

  getFunction(signatureId: string): FunctionDefinition | undefined {
    return this.functionsBySignatureId.get(signatureId);
  }

  listFunctionsByName(name: string): FunctionDefinition[] {
    return this.functionsByName.get(name.toUpperCase()) ?? [];
  }

  getOperator(token: string): OperatorDefinition | undefined {
    return this.operatorsByToken.get(token);
  }

  getVariable(name: string): VariableDefinition | undefined {
    return this.variablesByName.get(name);
  }

  listFunctions(): FunctionDefinition[] {
    // Authoring/editor surface: legacy definitions are excluded (resolve them via getFunction).
    return [...this.functionsBySignatureId.values()].filter((def) => def.legacy !== true);
  }

  listOperators(): OperatorDefinition[] {
    return [...this.operatorsByToken.values()];
  }

  listVariables(): VariableDefinition[] {
    return [...this.variablesByName.values()];
  }
}

function typeKey(t: FormulaType): string {
  // Stable-ish runtime key for ambiguity checks. This is not meant for user-facing display.
  const base: any = stripNullability(t);
  if (base.kind === 'object') return `object:${base.clarifier ?? ''}`;
  if (base.kind === 'list') return `list<${typeKey(base.of)}>`;
  if (base.kind === 'template') return `template:${base.name}`;
  if (base.kind === 'callable') return `callable:${base.reference}`;
  if (base.kind === 'union')
    return `union<${base.of.map((x: FormulaType) => typeKey(x)).join('|')}>`;
  return String(base.kind);
}

function isAmbiguousOverload(a: FunctionDefinition, b: FunctionDefinition): boolean {
  // Treat overloads as ambiguous if there exists an arity where both overloads
  // accept the call and each positional argument type is mutually assignable.
  // This catches the common "variadic vs non-variadic" ambiguity while keeping
  // the analysis bounded (important for registration-time costs).

  const aParams = a.params;
  const bParams = b.params;

  const aVariadic = aParams[aParams.length - 1]?.variadic === true;
  const bVariadic = bParams[bParams.length - 1]?.variadic === true;

  const requiredCount = (params: FunctionDefinition['params']) =>
    params.filter((p) => !p.optional).length;

  const acceptsArity = (def: FunctionDefinition, arity: number): boolean => {
    const req = requiredCount(def.params);
    if (arity < req) return false;
    const last = def.params[def.params.length - 1];
    const variadic = last?.variadic === true;
    if (!variadic && arity > def.params.length) return false;
    return true;
  };

  const paramAt = (def: FunctionDefinition, index: number): FormulaType | null => {
    const params = def.params;
    if (params.length === 0) return null;
    const last = params[params.length - 1];
    const variadic = last?.variadic === true;
    const p = index < params.length ? params[index] : variadic ? last : undefined;
    return p?.type ?? null;
  };

  const isMoreSpecificType = (lhs: FormulaType, rhs: FormulaType): boolean => {
    const l = stripNullability(lhs);
    const r = stripNullability(rhs);

    // Union types are treated as neither strictly more specific nor less specific
    // for overload ambiguity purposes (keep the analysis conservative).
    if (l.kind === 'union' || r.kind === 'union') return false;

    // Any is always the least specific.
    if (r.kind === 'any' && l.kind !== 'any') return true;
    if (l.kind === 'any') return false;

    // Template types are treated as broadly-assignable placeholders, similar to Any.
    if (r.kind === 'template' && l.kind !== 'template') return true;
    if (l.kind === 'template') return false;

    // Callable is a semantic subtype of text.
    if (l.kind === 'callable' && r.kind === 'text') return true;
    if (l.kind === 'text' && r.kind === 'callable') return false;

    if (l.kind !== r.kind) return false;
    if (l.kind === 'list' && r.kind === 'list') return isMoreSpecificType(l.of, r.of);
    if (l.kind === 'object' && r.kind === 'object') {
      // Clarified object types are more specific than unclarified.
      if (!r.clarifier && !!l.clarifier) return true;
      return false;
    }
    return false;
  };

  // Bounded arity scanning. For non-variadic overload sets we can scan the full
  // feasible range; for variadic, scan a small window that covers practical ambiguities.
  const minArity = Math.min(requiredCount(aParams), requiredCount(bParams));
  const maxNonVariadicArity = Math.max(aParams.length, bParams.length);
  const maxArity =
    aVariadic || bVariadic ? Math.min(maxNonVariadicArity + 3, 8) : maxNonVariadicArity;

  for (let arity = minArity; arity <= maxArity; arity++) {
    if (!acceptsArity(a, arity) || !acceptsArity(b, arity)) continue;

    let mutuallyAssignable = true;
    let aBetter = 0;
    let bBetter = 0;
    for (let i = 0; i < arity; i++) {
      const at = paramAt(a, i);
      const bt = paramAt(b, i);
      if (!at || !bt) {
        mutuallyAssignable = false;
        break;
      }
      const atNoNull = stripNullability(at);
      const btNoNull = stripNullability(bt);
      if (!isAssignable(atNoNull, btNoNull) || !isAssignable(btNoNull, atNoNull)) {
        mutuallyAssignable = false;
        break;
      }

      if (isMoreSpecificType(at, bt)) aBetter++;
      if (isMoreSpecificType(bt, at)) bBetter++;
    }

    // If both accept an arity and neither dominates the other, resolution would
    // depend on registration order (non-deterministic). Treat as ambiguous.
    if (mutuallyAssignable) {
      const hasStrictWinner = (aBetter > 0 && bBetter === 0) || (bBetter > 0 && aBetter === 0);
      if (!hasStrictWinner) return true;
    }
  }

  return false;
}

export function createRegistry(): MutableFormulaRegistry {
  /** Convenience factory for callers that don't need custom registry impls. */
  return new InMemoryFormulaRegistry();
}
