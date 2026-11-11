import type { FormulaType } from './types';

export function isNullable(t: FormulaType): boolean {
  return t.nullable === true || t.kind === 'null';
}

export function stripNullability(t: FormulaType): FormulaType {
  if (t.kind === 'null') return t;
  if (!t.nullable) return t;
  return { ...t, nullable: false };
}

export function sameTypeKind(a: FormulaType, b: FormulaType): boolean {
  return a.kind === b.kind;
}

/**
 * Whether an argument of type `argument` passes the parser's type check of a bound parameter of
 * type `param`: anything fits `any` or a template; otherwise the types must be assignable,
 * nullability aside.
 *
 * @experimental May change in a minor release.
 */
export function argumentFits(argument: FormulaType, param: FormulaType): boolean {
  const target = stripNullability(param);
  if (target.kind === 'any' || target.kind === 'template') return true;
  return isAssignable(stripNullability(argument), target);
}

/**
 * Whether an argument of type `argument` lets the parser choose an overload with a parameter of
 * type `param`: anything selects `any`; otherwise the types must be assignable, nullability aside,
 * a template's constraint included.
 *
 * @experimental May change in a minor release.
 */
export function argumentSelects(argument: FormulaType, param: FormulaType): boolean {
  if (param.kind === 'any') return true;
  return isAssignable(stripNullability(argument), stripNullability(param));
}

export function isAssignable(from: FormulaType, to: FormulaType): boolean {
  // Callable reference handling.
  // Callable references are represented as strings at runtime, but carry semantic meaning.
  // Treat TEXT as assignable to CALLABLE for signature validation and overload selection.
  if (to.kind === 'callable') {
    if (from.kind === 'any' || from.kind === 'template') return true;
    if (from.kind === 'callable') {
      // Reference kind compatibility.
      if (from.reference !== to.reference && to.reference !== 'function_or_operator') return false;

      // Arity constraints: `from` must be within `to`'s allowed range.
      if (to.minArity !== undefined) {
        const fromMin = from.minArity ?? 0;
        if (fromMin < to.minArity) return false;
      }
      if (to.maxArity !== undefined) {
        const fromMax = from.maxArity ?? Number.POSITIVE_INFINITY;
        if (fromMax > to.maxArity) return false;
      }

      // Signature constraints: when `to` declares param/return types, `from` must declare
      // compatible ones too.
      if (to.paramTypes) {
        if (!from.paramTypes) return false;
        if (from.paramTypes.length < to.paramTypes.length) return false;
        for (let i = 0; i < to.paramTypes.length; i++) {
          if (!isAssignable(from.paramTypes[i], to.paramTypes[i])) return false;
        }
      }
      if (to.returnType) {
        if (!from.returnType) return false;
        if (!isAssignable(from.returnType, to.returnType)) return false;
      }

      return true;
    }
    return from.kind === 'text';
  }
  if (from.kind === 'callable') {
    // Callable values are strings at runtime.
    if (to.kind === 'any' || to.kind === 'template') return true;
    return to.kind === 'text';
  }

  // Template (type-variable) handling.
  // A template type is treated as a placeholder that can be bound at call sites.
  // For registry-level checks we treat it as broadly assignable, optionally
  // respecting constraints when provided.
  if (to.kind === 'template') {
    if (to.constraint) return isAssignable(from, to.constraint);
    return true;
  }
  if (from.kind === 'template') {
    if (from.constraint) return isAssignable(from.constraint, to);
    return true;
  }

  // Union handling (conservative):
  // - A union is assignable to T only if every member is assignable to T.
  // - X is assignable to a union if it is assignable to at least one member.
  if (to.kind === 'union') {
    // Union-to-union: every member of `from` must be assignable to some member of `to`.
    if (from.kind === 'union') {
      return from.of.every((f) => to.of.some((t) => isAssignable(f, t)));
    }
    return to.of.some((t) => isAssignable(from, t));
  }
  if (from.kind === 'union') {
    return from.of.every((t) => isAssignable(t, to));
  }

  if (to.kind === 'any') return true;
  if (from.kind === 'any') return true;
  if (from.kind === 'null') return isNullable(to);
  if (to.kind === 'null') return false;

  if (from.kind !== to.kind) return false;

  if (to.kind === 'list' && from.kind === 'list') {
    return isAssignable(from.of, to.of);
  }
  if (to.kind === 'object' && from.kind === 'object') {
    if (to.clarifier && from.clarifier && to.clarifier !== from.clarifier) return false;
    return true;
  }

  return true;
}

export function formatType(t: FormulaType): string {
  const nullable = t.nullable ? '?' : '';
  if (t.kind === 'list') return `List<${formatType(t.of)}>${nullable}`;
  if (t.kind === 'object') return `Object${t.clarifier ? `(${t.clarifier})` : ''}${nullable}`;
  if (t.kind === 'template') return `${t.name}${nullable}`;
  if (t.kind === 'callable') {
    const label =
      t.reference === 'function'
        ? 'Function'
        : t.reference === 'operator'
          ? 'Operator'
          : 'FunctionOrOperator';

    if (t.paramTypes || t.returnType) {
      const params = (t.paramTypes ?? []).map(formatType).join(', ');
      const ret = t.returnType ? formatType(t.returnType) : 'any';
      return `${label}(${params}) -> ${ret}${nullable}`;
    }

    return `${label}${nullable}`;
  }
  if (t.kind === 'union') {
    const inner = t.of.map((x) => formatType(stripNullability(x))).join(' | ');
    return `(${inner})${nullable}`;
  }
  return `${t.kind}${nullable}`;
}
