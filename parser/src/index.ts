import type {
  CallableReferenceKind,
  FormulaError,
  FormulaLimits,
  FormulaRegistry,
  FormulaRequirements,
  FormulaType,
  FunctionDefinition,
  FunctionParamDefinition,
  RuleNode,
  SourceSpan,
  TypedRule,
  VariableOnlyRegistry,
} from '@formulang/definitions';
import {
  BuiltinSignatureIds,
  emptyRequirements,
  formatType,
  FormulaErrorCodes,
  FormulaLimitError,
  FormulaTypes,
  isAssignable,
  makeFormulaError,
  resolveFormulaLimits,
  stripNullability,
} from '@formulang/definitions';
import {
  invocationOf,
  invokedArguments,
  RESULTS_BY_NAME,
  walkStateKey,
  type CallableInvocation,
} from './callable-invocations';
import { isDenylistedPropertyName } from './denylist';
import { assignStableNodeIds } from './node-id';
import { TokenStream } from './pratt';
import type { FormulaSyntax } from './syntax';
import { resolveFormulaSyntax } from './syntax';
import { tokenize } from './tokenizer';
import type { Token } from './tokens';

export { isDenylistedPropertyName } from './denylist';
export { DEFAULT_FORMULA_SYNTAX, resolveFormulaSyntax } from './syntax';
export type { FormulaSyntax } from './syntax';

export interface ParseFormulaOptions {
  registry: FormulaRegistry;
  limits?: Partial<FormulaLimits>;
  /** Syntax overrides (argument separator, decimal separator). */
  syntax?: Partial<FormulaSyntax>;
}

export interface ParseVariableReferenceOptions {
  registry: VariableOnlyRegistry;
  limits?: Partial<FormulaLimits>;
  /** Syntax overrides (argument separator, decimal separator). */
  syntax?: Partial<FormulaSyntax>;
}

export function parseFormula(source: string, options: ParseFormulaOptions): TypedRule {
  const limits = resolveFormulaLimits(options.limits);
  const syntax = resolveFormulaSyntax(options.syntax);
  const errors: TypedRule['errors'] = [];
  const requirements: FormulaRequirements = emptyRequirements();
  let nodeCount = 0;
  // Node id generation is also a convenient place to enforce an AST size limit.
  // This prevents extremely deep/large formulas from consuming excessive CPU/memory.
  const makeId = (kind: string, _span: { start: number; end: number }, _extra?: string): string => {
    nodeCount++;
    if (nodeCount > limits.maxAstNodes) {
      throw new FormulaLimitError(FormulaErrorCodes.TOO_MANY_AST_NODES, 'Formula is too complex');
    }
    // IDs are assigned in a separate post-parse traversal so they don't depend on
    // source character spans (which shift when inserting whitespace/edits earlier in the formula).
    // We still generate a placeholder to satisfy the AST shape during parsing.
    return `${kind}:${nodeCount}`;
  };

  let root: RuleNode = {
    id: 'literal:root',
    kind: 'literal',
    value: null,
    span: { start: 0, end: 0 },
  };
  try {
    if (syntax.argumentSeparator === syntax.decimalSeparator) {
      errors.push(
        makeFormulaError({
          kind: 'config',
          code: FormulaErrorCodes.INVALID_SYNTAX_CONFIG,
          message:
            'Invalid formula syntax: argumentSeparator and decimalSeparator must be different characters',
          span: { start: 0, end: Math.min(source.length, 1) },
        }),
      );
      return { root, returnType: FormulaTypes.any(true), static: false, requirements, errors };
    }
    if (source.length > limits.maxSourceLength) {
      errors.push(
        makeFormulaError({
          kind: 'security',
          code: FormulaErrorCodes.SOURCE_TOO_LONG,
          message: 'Formula source is too long',
          span: { start: 0, end: Math.min(source.length, 1) },
        }),
      );
      return { root, returnType: FormulaTypes.any(true), static: false, requirements, errors };
    }

    // Tokenize with explicit limits (token count, parentheses depth, string/identifier length).
    const tokens = tokenize(source, limits, syntax);
    const stream = new TokenStream(tokens);
    root = parseExpression(stream, source, syntax, options.registry, errors, ['root'], makeId);
    // Consume trailing tokens
    const trailing = stream.peek();
    if (trailing.kind !== 'eof') {
      errors.push(
        makeFormulaError({
          kind: 'parse',
          code: FormulaErrorCodes.UNEXPECTED_TOKEN,
          message: `Unexpected token: ${trailing.value ?? trailing.kind}`,
          span: { start: trailing.start, end: trailing.end },
        }),
      );
    }

    // Assign stable node IDs based on AST structure.
    assignStableNodeIds(root);
  } catch (e) {
    if (e instanceof FormulaLimitError) {
      errors.push(
        makeFormulaError({
          kind: e.kind,
          code: e.code,
          message: e.message,
          span: { start: 0, end: Math.min(source.length, 1) },
        }),
      );
    } else {
      errors.push(
        makeFormulaError({
          kind: 'parse',
          code: FormulaErrorCodes.PARSER_CRASH,
          message: e instanceof Error ? e.message : 'Parser error',
          span: { start: 0, end: Math.min(source.length, 1) },
        }),
      );
    }
  }

  const returnType = bindTypesAndRequirements(root, options.registry, requirements, errors);

  // Requirements: variablesRead is based on full accessor paths, not just root variables.
  // NOTE: we compute this separately so property/wildcard chains can be collapsed into
  // a single read path like `value.items.*.id`.
  requirements.variablesRead = collectVariablesReadPaths(root);
  requirements.functionsUsed = uniqStable(requirements.functionsUsed);
  requirements.externalData = uniqExternalData(requirements.externalData);

  const isStatic = computeIsStatic(root, options.registry);

  return { root, returnType, static: isStatic, requirements, errors };
}

/**
 * Parse a *variable reference only* (identifier with optional property/wildcard chain).
 *
 * Examples:
 * - value
 * - value.name
 * - list.*.name
 *
 * This intentionally does NOT parse operators, literals, function calls, or grouping.
 * It reuses the exact same variable + accessor-chain parsing logic as `parseFormula`.
 */
export function parseVariableReference(
  source: string,
  options: ParseVariableReferenceOptions,
): TypedRule {
  const limits = resolveFormulaLimits(options.limits);
  const syntax = resolveFormulaSyntax(options.syntax);
  const errors: TypedRule['errors'] = [];
  const requirements: FormulaRequirements = emptyRequirements();
  let nodeCount = 0;
  const makeId = (kind: string, _span: { start: number; end: number }, _extra?: string): string => {
    nodeCount++;
    if (nodeCount > limits.maxAstNodes) {
      throw new FormulaLimitError(FormulaErrorCodes.TOO_MANY_AST_NODES, 'Formula is too complex');
    }
    return `${kind}:${nodeCount}`;
  };

  let root: RuleNode = {
    id: 'literal:root',
    kind: 'literal',
    value: null,
    span: { start: 0, end: 0 },
  };

  try {
    if (syntax.argumentSeparator === syntax.decimalSeparator) {
      errors.push(
        makeFormulaError({
          kind: 'config',
          code: FormulaErrorCodes.INVALID_SYNTAX_CONFIG,
          message:
            'Invalid formula syntax: argumentSeparator and decimalSeparator must be different characters',
          span: { start: 0, end: Math.min(source.length, 1) },
        }),
      );
      return { root, returnType: FormulaTypes.any(true), static: false, requirements, errors };
    }
    if (source.length > limits.maxSourceLength) {
      errors.push(
        makeFormulaError({
          kind: 'security',
          code: FormulaErrorCodes.SOURCE_TOO_LONG,
          message: 'Formula source is too long',
          span: { start: 0, end: Math.min(source.length, 1) },
        }),
      );
      return { root, returnType: FormulaTypes.any(true), static: false, requirements, errors };
    }

    const tokens = tokenize(source, limits, syntax);
    const stream = new TokenStream(tokens);

    root = parseVariableOnly(stream, source, errors, makeId);

    const trailing = stream.peek();
    if (trailing.kind !== 'eof') {
      errors.push(
        makeFormulaError({
          kind: 'parse',
          code: FormulaErrorCodes.UNEXPECTED_TOKEN,
          message: `Unexpected token: ${trailing.value ?? trailing.kind}`,
          span: { start: trailing.start, end: trailing.end },
        }),
      );
    }

    assignStableNodeIds(root);
  } catch (e) {
    if (e instanceof FormulaLimitError) {
      errors.push(
        makeFormulaError({
          kind: e.kind,
          code: e.code,
          message: e.message,
          span: { start: 0, end: Math.min(source.length, 1) },
        }),
      );
    } else {
      errors.push(
        makeFormulaError({
          kind: 'parse',
          code: FormulaErrorCodes.PARSER_CRASH,
          message: e instanceof Error ? e.message : 'Parser error',
          span: { start: 0, end: Math.min(source.length, 1) },
        }),
      );
    }
  }

  const returnType = bindTypesAndRequirements(root, options.registry, requirements, errors);
  requirements.variablesRead = collectVariablesReadPaths(root);
  requirements.functionsUsed = uniqStable(requirements.functionsUsed);
  requirements.externalData = uniqExternalData(requirements.externalData);
  const isStatic = computeIsStatic(root, options.registry);

  return { root, returnType, static: isStatic, requirements, errors };
}

type RegistryLike = FormulaRegistry | VariableOnlyRegistry;

function isFormulaRegistry(registry: RegistryLike): registry is FormulaRegistry {
  return (
    typeof (registry as any).getFunction === 'function' &&
    typeof (registry as any).listFunctionsByName === 'function' &&
    typeof (registry as any).getOperator === 'function' &&
    typeof (registry as any).listFunctions === 'function' &&
    typeof (registry as any).listOperators === 'function'
  );
}

const FUNCTION_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
// Variables and properties must be lower_snake_case.
// - lower-case letters only
// - digits allowed, but each segment must start with a letter
// - no leading/trailing underscores, and no double underscores
const VARIABLE_NAME_RE = /^[a-z][a-z0-9]*(?:_[a-z][a-z0-9]*)*$/;

function tokenText(tok: Token, source: string): string {
  return source.slice(tok.start, tok.end);
}

function isBooleanLikeType(type: FormulaType): boolean {
  const base = stripNullability(type);
  if (
    base.kind === 'any' ||
    base.kind === 'template' ||
    base.kind === 'boolean' ||
    base.kind === 'text'
  ) {
    return true;
  }
  if (base.kind === 'union') {
    return base.of.every(isBooleanLikeType);
  }
  return false;
}

function parseExpression(
  stream: TokenStream,
  source: string,
  syntax: FormulaSyntax,
  registry: FormulaRegistry,
  errors: TypedRule['errors'],
  path: Array<string | number>,
  makeId: (kind: string, span: { start: number; end: number }, extra?: string) => string,
): RuleNode {
  return parseBinary(stream, source, syntax, registry, errors, 0, path, makeId);
}

function parseBinary(
  stream: TokenStream,
  source: string,
  syntax: FormulaSyntax,
  registry: FormulaRegistry,
  errors: TypedRule['errors'],
  minPrec: number,
  path: Array<string | number>,
  makeId: (kind: string, span: { start: number; end: number }, extra?: string) => string,
): RuleNode {
  let left = parsePostfix(stream, source, syntax, registry, errors, [...path, 0], makeId);

  let binIndex = 0;

  while (true) {
    const tok = stream.peek();
    if (tok.kind !== 'operator' || !tok.value) break;
    const op = registry.getOperator(tok.value);
    if (!op) break;
    if (op.precedence < minPrec) break;
    stream.next();

    binIndex++;

    const nextMin = op.associativity === 'left' ? op.precedence + 1 : op.precedence;
    const right = parseBinary(
      stream,
      source,
      syntax,
      registry,
      errors,
      nextMin,
      [...path, 'bin', binIndex, 1],
      makeId,
    );

    const fn = registry.getFunction(op.functionSignatureId);
    const nodeSpan = { start: left.span?.start ?? tok.start, end: right.span?.end ?? tok.end };
    left = {
      id: makeId('call', nodeSpan, op.functionSignatureId),
      kind: 'call',
      name: fn?.name ?? op.functionSignatureId,
      signatureId: op.functionSignatureId,
      args: [left, right],
      span: nodeSpan,
    };
  }

  return left;
}

function parsePostfix(
  stream: TokenStream,
  source: string,
  syntax: FormulaSyntax,
  registry: FormulaRegistry,
  errors: TypedRule['errors'],
  path: Array<string | number>,
  makeId: (kind: string, span: { start: number; end: number }, extra?: string) => string,
): RuleNode {
  const expr = parsePrimary(stream, source, syntax, registry, errors, path, makeId);
  return parseAccessorChain(stream, source, errors, expr, makeId);
}

function parseAccessorChain(
  stream: TokenStream,
  source: string,
  errors: TypedRule['errors'],
  baseExpr: RuleNode,
  makeId: (kind: string, span: { start: number; end: number }, extra?: string) => string,
): RuleNode {
  let expr = baseExpr;
  while (stream.peek().kind === 'member_access') {
    const dot = stream.next();
    const next = stream.peek();

    // Wildcard: . * . prop
    if (
      next.kind === 'operator' &&
      next.value === '*' &&
      stream.peekN(1).kind === 'member_access'
    ) {
      stream.next();
      stream.next();
      const propTok = stream.peek();
      if (propTok.kind !== 'identifier' || !propTok.value) {
        errors.push(
          makeFormulaError({
            kind: 'parse',
            code: FormulaErrorCodes.EXPECTED_PROPERTY,
            message: 'Expected property name after wildcard',
            span: { start: propTok.start, end: propTok.end },
          }),
        );
        break;
      }
      stream.next();
      const propName = propTok.value;
      if (!VARIABLE_NAME_RE.test(propName)) {
        errors.push(
          makeFormulaError({
            kind: 'parse',
            code: FormulaErrorCodes.INVALID_PROPERTY_NAME,
            message: `Invalid property name: ${propName} (expected lower_snake_case)`,
            span: { start: propTok.start, end: propTok.end },
          }),
        );
      }
      if (isDenylistedPropertyName(propName)) {
        errors.push(
          makeFormulaError({
            kind: 'security',
            code: FormulaErrorCodes.DENYLISTED_PROPERTY,
            message: `Property name is not allowed: ${propName}`,
            span: { start: propTok.start, end: propTok.end },
          }),
        );
      }
      expr = {
        id: makeId(
          'wildcard',
          { start: expr.span?.start ?? dot.start, end: propTok.end },
          propName,
        ),
        kind: 'wildcard',
        object: expr,
        property: propName,
        span: { start: expr.span?.start ?? dot.start, end: propTok.end },
      };
      continue;
    }

    // Property access
    if (next.kind !== 'identifier' || !next.value) {
      errors.push(
        makeFormulaError({
          kind: 'parse',
          code: FormulaErrorCodes.EXPECTED_PROPERTY,
          message: `Expected property name after '.' but got ${tokenText(next, source)}`,
          span: { start: next.start, end: next.end },
        }),
      );
      break;
    }

    stream.next();
    const propName = next.value;
    if (!VARIABLE_NAME_RE.test(propName)) {
      errors.push(
        makeFormulaError({
          kind: 'parse',
          code: FormulaErrorCodes.INVALID_PROPERTY_NAME,
          message: `Invalid property name: ${propName} (expected lower_snake_case)`,
          span: { start: next.start, end: next.end },
        }),
      );
    }
    if (isDenylistedPropertyName(propName)) {
      errors.push(
        makeFormulaError({
          kind: 'security',
          code: FormulaErrorCodes.DENYLISTED_PROPERTY,
          message: `Property name is not allowed: ${propName}`,
          span: { start: next.start, end: next.end },
        }),
      );
    }
    expr = {
      id: makeId('property', { start: expr.span?.start ?? dot.start, end: next.end }, propName),
      kind: 'property',
      object: expr,
      property: propName,
      span: { start: expr.span?.start ?? dot.start, end: next.end },
    };
  }

  return expr;
}

function parseVariableIdentifier(
  tok: Token,
  errors: TypedRule['errors'],
  makeId: (kind: string, span: { start: number; end: number }, extra?: string) => string,
): RuleNode {
  const ident = tok.value ?? '';
  if (!VARIABLE_NAME_RE.test(ident)) {
    errors.push(
      makeFormulaError({
        kind: 'parse',
        code: FormulaErrorCodes.INVALID_VARIABLE_NAME,
        message: `Invalid variable name: ${ident} (expected lower_snake_case)`,
        span: { start: tok.start, end: tok.end },
      }),
    );
  }

  return {
    id: makeId('variable', { start: tok.start, end: tok.end }, ident),
    kind: 'variable',
    name: ident,
    span: { start: tok.start, end: tok.end },
  };
}

function parseVariableOnly(
  stream: TokenStream,
  source: string,
  errors: TypedRule['errors'],
  makeId: (kind: string, span: { start: number; end: number }, extra?: string) => string,
): RuleNode {
  const tok = stream.peek();
  if (tok.kind !== 'identifier' || !tok.value) {
    // Unknown / unexpected
    stream.next();
    errors.push(
      makeFormulaError({
        kind: 'parse',
        code: FormulaErrorCodes.UNEXPECTED_TOKEN,
        message: `Unexpected token: ${tokenText(tok, source)}`,
        span: { start: tok.start, end: tok.end },
      }),
    );
    return {
      id: makeId('literal', { start: tok.start, end: tok.end }),
      kind: 'literal',
      value: null,
      span: { start: tok.start, end: tok.end },
    };
  }

  stream.next();
  const base = parseVariableIdentifier(tok, errors, makeId);
  return parseAccessorChain(stream, source, errors, base, makeId);
}

function parsePrimary(
  stream: TokenStream,
  source: string,
  syntax: FormulaSyntax,
  registry: FormulaRegistry,
  errors: TypedRule['errors'],
  path: Array<string | number>,
  makeId: (kind: string, span: { start: number; end: number }, extra?: string) => string,
): RuleNode {
  const tok = stream.peek();

  if (tok.kind === 'number' && tok.value !== undefined) {
    stream.next();
    const n = Number(tok.value);
    return {
      id: makeId('literal', { start: tok.start, end: tok.end }),
      kind: 'literal',
      value: Number.isFinite(n) ? n : null,
      span: { start: tok.start, end: tok.end },
    };
  }
  if (tok.kind === 'string') {
    stream.next();
    return {
      id: makeId('literal', { start: tok.start, end: tok.end }),
      kind: 'literal',
      value: tok.value ?? '',
      span: { start: tok.start, end: tok.end },
    };
  }
  if (tok.kind === 'identifier' && tok.value) {
    stream.next();
    const ident = tok.value;
    const upper = ident.toUpperCase();
    if (upper === 'TRUE' || upper === 'FALSE') {
      return {
        id: makeId('literal', { start: tok.start, end: tok.end }),
        kind: 'literal',
        value: upper === 'TRUE',
        span: { start: tok.start, end: tok.end },
      };
    }

    if (stream.peek().kind === 'lparen') {
      if (!FUNCTION_NAME_RE.test(ident)) {
        errors.push(
          makeFormulaError({
            kind: 'parse',
            code: FormulaErrorCodes.INVALID_FUNCTION_NAME,
            message: `Invalid function name: ${ident} (expected UPPER_SNAKE_CASE)`,
            span: { start: tok.start, end: tok.end },
          }),
        );
      }
      const lparen = stream.next();
      const args: RuleNode[] = [];
      if (stream.peek().kind !== 'rparen') {
        let argIndex = 0;
        while (true) {
          args.push(
            parseExpression(
              stream,
              source,
              syntax,
              registry,
              errors,
              [...path, 'args', argIndex],
              makeId,
            ),
          );
          argIndex++;
          if (stream.match('arg_separator')) continue;
          const next = stream.peek();
          const wrongSeparator = syntax.argumentSeparator === ';' ? ',' : ';';
          if (next.kind === 'operator' && next.value === wrongSeparator) {
            const bad = stream.next();
            errors.push(
              makeFormulaError({
                kind: 'parse',
                code: FormulaErrorCodes.UNEXPECTED_TOKEN,
                message: `Use '${syntax.argumentSeparator}' to separate function arguments.`,
                span: { start: bad.start, end: bad.end },
              }),
            );
            continue;
          }
          break;
        }
      }
      const rparen = stream.match('rparen');
      if (!rparen) {
        errors.push(
          makeFormulaError({
            kind: 'parse',
            code: FormulaErrorCodes.EXPECTED_RPAREN,
            message: "Expected ')',",
            span: { start: lparen.start, end: lparen.end },
          }),
        );
      }
      const callSpan = { start: tok.start, end: (rparen ?? lparen).end };
      return {
        id: makeId('call', callSpan, ident.toUpperCase()),
        kind: 'call',
        name: ident,
        args,
        span: callSpan,
      };
    }

    return parseVariableIdentifier(tok, errors, makeId);
  }

  if (tok.kind === 'lparen') {
    const l = stream.next();
    const expr = parseExpression(
      stream,
      source,
      syntax,
      registry,
      errors,
      [...path, 'group'],
      makeId,
    );
    const r = stream.match('rparen');
    if (!r) {
      errors.push(
        makeFormulaError({
          kind: 'parse',
          code: FormulaErrorCodes.EXPECTED_RPAREN,
          message: "Expected ')',",
          span: { start: l.start, end: l.end },
        }),
      );
    }
    return { ...expr, span: { start: l.start, end: (r ?? expr.span ?? { end: l.end }).end } };
  }

  // Unknown / unexpected
  stream.next();
  errors.push(
    makeFormulaError({
      kind: 'parse',
      code: FormulaErrorCodes.UNEXPECTED_TOKEN,
      message: `Unexpected token: ${tokenText(tok, source)}`,
      span: { start: tok.start, end: tok.end },
    }),
  );
  return {
    id: makeId('literal', { start: tok.start, end: tok.end }),
    kind: 'literal',
    value: null,
    span: { start: tok.start, end: tok.end },
  };
}

function bindTypesAndRequirements(
  node: RuleNode,
  registry: RegistryLike,
  requirements: FormulaRequirements,
  errors: TypedRule['errors'],
): FormulaType {
  switch (node.kind) {
    case 'literal': {
      const v = node.value;
      if (v === null || v === undefined) {
        node.type = FormulaTypes.null();
        return node.type;
      }
      if (typeof v === 'number') {
        node.type = FormulaTypes.number(false);
        node.predictableValue = v;
        return node.type;
      }
      if (typeof v === 'string') {
        node.type = FormulaTypes.text(false);
        node.predictableValue = v;
        return node.type;
      }
      if (typeof v === 'boolean') {
        node.type = FormulaTypes.boolean(false);
        node.predictableValue = v;
        return node.type;
      }
      node.type = FormulaTypes.any(true);
      return node.type;
    }
    case 'variable': {
      const v = registry.getVariable(node.name);
      if (!v) {
        errors.push(
          makeFormulaError({
            kind: 'type',
            code: FormulaErrorCodes.UNKNOWN_VARIABLE,
            message: `Unknown variable: ${node.name}`,
            span: node.span,
          }),
        );
        node.type = FormulaTypes.any(true);
        return node.type;
      }
      node.type = v.type;
      return node.type;
    }
    case 'property': {
      const objType = bindTypesAndRequirements(node.object, registry, requirements, errors);
      const base = stripNullability(objType);
      let out: FormulaType = FormulaTypes.any(true);

      if (
        base.kind !== 'object' &&
        base.kind !== 'any' &&
        base.kind !== 'template' &&
        base.kind !== 'null'
      ) {
        errors.push(
          makeFormulaError({
            kind: 'type',
            code: FormulaErrorCodes.PROPERTY_TARGET_NOT_OBJECT,
            message: `Property access requires object target, got ${formatType(objType)}`,
            span: node.span,
          }),
        );
      }
      if (!isDenylistedPropertyName(node.property)) {
        if (base.kind === 'object') {
          if (!base.properties || !(node.property in base.properties)) {
            errors.push(
              makeFormulaError({
                kind: 'security',
                code: FormulaErrorCodes.PROPERTY_NOT_ALLOWLISTED,
                message: `Property not allowed by type: ${node.property}`,
                span: node.span,
              }),
            );
          } else {
            out = base.properties[node.property];
          }
        }
        if (base.kind === 'any' || base.kind === 'template') {
          errors.push(
            makeFormulaError({
              kind: 'security',
              code: FormulaErrorCodes.PROPERTY_NOT_ALLOWLISTED,
              message: `Property access requires allow-listed object type: ${node.property}`,
              span: node.span,
            }),
          );
        }
      }
      if (objType.nullable) {
        out = { ...out, nullable: true };
      }
      node.type = out;

      // Predictable value propagation when we can safely compute it.
      if (node.object.predictableValue !== undefined) {
        const v = node.object.predictableValue as any;
        if (v && typeof v === 'object' && !Array.isArray(v) && node.property in v) {
          node.predictableValue = v[node.property];
        }
      }
      return out;
    }
    case 'wildcard': {
      const objType = bindTypesAndRequirements(node.object, registry, requirements, errors);
      const base = stripNullability(objType);
      if (base.kind !== 'list' && base.kind !== 'template') {
        errors.push(
          makeFormulaError({
            kind: 'type',
            code: FormulaErrorCodes.WILDCARD_TARGET_NOT_LIST,
            message: `Wildcard requires list target, got ${formatType(objType)}`,
            span: node.span,
          }),
        );
        node.type = FormulaTypes.list(FormulaTypes.any(true), true);
        return node.type;
      }

      // Template targets behave like unknown lists for security/type purposes.
      if (base.kind === 'template') {
        node.type = FormulaTypes.list(FormulaTypes.any(true), true);
        return node.type;
      }

      let elementType: FormulaType = FormulaTypes.any(true);
      const elem = stripNullability(base.of);
      if (!isDenylistedPropertyName(node.property)) {
        if (elem.kind === 'object') {
          if (!elem.properties || !(node.property in elem.properties)) {
            errors.push(
              makeFormulaError({
                kind: 'security',
                code: FormulaErrorCodes.PROPERTY_NOT_ALLOWLISTED,
                message: `Property not allowed by element type: ${node.property}`,
                span: node.span,
              }),
            );
          } else {
            elementType = elem.properties[node.property];
          }
        }
        if (elem.kind === 'any' || elem.kind === 'template') {
          errors.push(
            makeFormulaError({
              kind: 'security',
              code: FormulaErrorCodes.PROPERTY_NOT_ALLOWLISTED,
              message: `Wildcard property access requires allow-listed object element type: ${node.property}`,
              span: node.span,
            }),
          );
        }
      }
      const out = FormulaTypes.list(elementType, objType.nullable === true);
      node.type = out;
      return out;
    }
    case 'call': {
      if (!isFormulaRegistry(registry)) {
        errors.push(
          makeFormulaError({
            kind: 'type',
            code: FormulaErrorCodes.UNKNOWN_FUNCTION,
            message: `Unknown function: ${node.name}`,
            span: node.span,
          }),
        );
        node.type = FormulaTypes.any(true);
        return node.type;
      }
      const argTypes = node.args.map((a) =>
        bindTypesAndRequirements(a, registry, requirements, errors),
      );
      // If already bound (operator call), just use signature
      let def = node.signatureId ? registry.getFunction(node.signatureId) : undefined;
      if (!def) {
        const candidates = registry.listFunctionsByName(node.name);
        def = chooseOverload(candidates, argTypes);
        if (def) node.signatureId = def.signatureId;

        // If there is exactly one candidate, bind it even if the arguments don't match.
        // This enables precise per-parameter type errors for non-overloaded functions.
        if (!def && candidates.length === 1) {
          def = candidates[0];
          node.signatureId = def.signatureId;
        }

        // If the function name exists but no overload matches, surface a type error.
        if (!def && candidates.length > 0) {
          errors.push(
            makeFormulaError({
              kind: 'type',
              code: FormulaErrorCodes.NO_MATCHING_OVERLOAD,
              message: `No matching overload for ${node.name}(${argTypes.map(formatType).join(', ')})`,
              span: node.span,
            }),
          );
        }
      }

      // Predictable value propagation for known constant functions.
      // EMPTY()/BLANK() is defined to always return null.
      if (def && def.signatureId === BuiltinSignatureIds.EMPTY && node.args.length === 0) {
        node.predictableValue = null;
      }

      if (!def) {
        // Distinguish truly unknown functions from known functions with bad argument types.
        // If NO_MATCHING_OVERLOAD was already reported, don't also report UNKNOWN_FUNCTION.
        const alreadyReported = errors.some(
          (e) =>
            e.span?.start === node.span?.start && e.code === FormulaErrorCodes.NO_MATCHING_OVERLOAD,
        );
        if (!alreadyReported) {
          errors.push(
            makeFormulaError({
              kind: 'type',
              code: FormulaErrorCodes.UNKNOWN_FUNCTION,
              message: `Unknown function: ${node.name}`,
              span: node.span,
            }),
          );
        }
        node.type = FormulaTypes.any(true);
        return node.type;
      }

      // Validate argument types against the resolved signature.
      // NOTE: This is intentionally conservative about nullability: we validate the base kinds
      // (after stripNullability), and we only error on null when it is the literal/null kind.
      const params = def.params;
      const lastParam = params[params.length - 1];
      const variadic = lastParam?.variadic === true;
      for (let i = 0; i < node.args.length; i++) {
        const param = i < params.length ? params[i] : variadic ? lastParam : undefined;
        if (!param) continue;

        const argType = argTypes[i] ?? FormulaTypes.any(true);
        const argNoNull = stripNullability(argType);
        const paramNoNull = stripNullability(param.type);

        // Skip validation for Any/template parameters.
        if (paramNoNull.kind === 'any' || paramNoNull.kind === 'template') continue;

        if (!isAssignable(argNoNull, paramNoNull)) {
          // Prefer the more specific NULL_NOT_ALLOWED code when the arg is literally null.
          const code =
            argNoNull.kind === 'null' && param.type.nullable !== true
              ? FormulaErrorCodes.NULL_NOT_ALLOWED
              : FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH;
          const message =
            code === FormulaErrorCodes.NULL_NOT_ALLOWED
              ? `Parameter '${param.name}' does not accept null`
              : `Parameter '${param.name}' expected ${formatType(param.type)} but got ${formatType(argType)}`;

          errors.push(
            makeFormulaError({
              kind: 'type',
              code,
              message,
              span: node.args[i]?.span ?? node.span,
              path: ['call', def.signatureId, 'arg', String(i)],
            }),
          );
        }
      }

      const baseReturnType = instantiateGenericReturnType(def, argTypes);

      // Literal-only validation (e.g., FILTER(list, "STARTS_WITH", ...)) at each parameter's own
      // position. The extra arguments a variadic literal-only parameter takes are validated only
      // when it lists its admitted values; without that list it keeps 1.0.0 behaviour, where only
      // the first argument it takes was checked.
      for (let i = 0; i < Math.max(def.params.length, node.args.length); i++) {
        const p = paramAt(def.params, i);
        if (!p || p.literalOnly !== true) continue;
        if (i >= def.params.length && admittedValues(p) === undefined) continue;
        const arg = node.args[i];
        // Optional literal-only parameters may be omitted.
        if (!arg && p.optional === true) continue;
        const literal = readLiteralArgument(p, arg, {
          subject: `Parameter '${p.name}'`,
          span: arg?.span ?? node.span,
          path: ['call', def.signatureId, 'arg', String(i)],
        });
        if (!literal.ok) {
          errors.push(literal.error);
          continue;
        }
        const ref = literal.value;

        const paramBase = stripNullability(p.type);
        if (paramBase.kind === 'callable') {
          if (!referenceExists(registry, paramBase.reference, ref)) {
            errors.push(
              makeFormulaError({
                kind: 'type',
                code: FormulaErrorCodes.UNKNOWN_FUNCTION_REFERENCE,
                message: `Unknown function/operator reference: ${ref}`,
                span: literal.span,
              }),
            );
            continue;
          }

          // Strict callable validation for the higher-order functions whose invocation the parser
          // knows (`invocationOf`: the table's entry for the definition's name):
          // arity, overload, return type, and the referenced function's literal-only rules for
          // every argument the invocation passes it.
          const outerBindings = inferGenericBindingsForCall(def, argTypes);
          const expectedCallable = substituteTemplates(paramBase, outerBindings);
          const invocation = invocationOf(def);
          const invoked = invocation === undefined ? null : invokedArguments(invocation, argTypes);

          if (invoked) {
            const invokedArgTypes = invoked.map((invokedArg) => invokedArg.type);
            if (
              expectedCallable.kind === 'callable' &&
              expectedCallable.minArity !== undefined &&
              invokedArgTypes.length < expectedCallable.minArity
            ) {
              errors.push(
                makeFormulaError({
                  kind: 'type',
                  code: FormulaErrorCodes.NO_MATCHING_OVERLOAD,
                  message: `Callable '${ref}' must accept at least ${expectedCallable.minArity} arguments`,
                  span: literal.span,
                }),
              );
            }
            if (
              expectedCallable.kind === 'callable' &&
              expectedCallable.maxArity !== undefined &&
              invokedArgTypes.length > expectedCallable.maxArity
            ) {
              errors.push(
                makeFormulaError({
                  kind: 'type',
                  code: FormulaErrorCodes.NO_MATCHING_OVERLOAD,
                  message: `Callable '${ref}' must accept no more than ${expectedCallable.maxArity} arguments`,
                  span: literal.span,
                }),
              );
            }

            const candidates = callableCandidates(registry, paramBase.reference, ref);
            const chosen =
              candidates.length > 0
                ? chooseOverload(
                    candidates.map((c) => ({ ...c, params: c.params, returnType: c.returnType })),
                    invokedArgTypes,
                  )
                : null;

            if (!chosen) {
              errors.push(
                makeFormulaError({
                  kind: 'type',
                  code: FormulaErrorCodes.NO_MATCHING_OVERLOAD,
                  message: `No matching overload for callable reference: ${ref}`,
                  span: literal.span,
                }),
              );
            } else {
              checkPassedArguments(registry, errors, new Set(), {
                call: { signatureId: def.signatureId, args: node.args },
                host: def,
                candidates,
                passed: invoked.map((invokedArg) => ({
                  type: invokedArg.type,
                  source: invokedArg.forwards,
                })),
                named: { index: i, span: literal.span },
              });

              if (expectedCallable.kind === 'callable' && expectedCallable.returnType) {
                const expectedReturn = expectedCallable.returnType;
                const chosenReturn = chosen.returnType ?? FormulaTypes.any(true);

                if (expectedReturn.kind === 'template') {
                  // Bind unbound template return (e.g., EACH<T,R> binds R from the referenced callable).
                  const existing = outerBindings.get(expectedReturn.name);
                  if (!existing) {
                    outerBindings.set(expectedReturn.name, stripNullability(chosenReturn));
                  }
                } else {
                  const okReturn = isAssignable(
                    stripNullability(chosenReturn),
                    stripNullability(expectedReturn),
                  );
                  if (!okReturn) {
                    errors.push(
                      makeFormulaError({
                        kind: 'type',
                        code: FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH,
                        message: `Callable '${ref}' must return ${formatType(expectedReturn)} but returns ${formatType(chosenReturn)}`,
                        span: literal.span,
                      }),
                    );
                  }
                }
              }
            }
          }
        }

        if (p.reference === 'function' && !referenceExists(registry, p.reference, ref)) {
          errors.push(
            makeFormulaError({
              kind: 'type',
              code: FormulaErrorCodes.UNKNOWN_FUNCTION_REFERENCE,
              message: `Unknown function reference: ${ref}`,
              span: literal.span,
            }),
          );
        }
        if (p.reference === 'operator' && !referenceExists(registry, p.reference, ref)) {
          errors.push(
            makeFormulaError({
              kind: 'type',
              code: FormulaErrorCodes.UNKNOWN_FUNCTION_REFERENCE,
              message: `Unknown operator reference: ${ref}`,
              span: literal.span,
            }),
          );
        }
        if (
          p.reference === 'function_or_operator' &&
          !referenceExists(registry, p.reference, ref)
        ) {
          errors.push(
            makeFormulaError({
              kind: 'type',
              code: FormulaErrorCodes.UNKNOWN_FUNCTION_REFERENCE,
              message: `Unknown function/operator reference: ${ref}`,
              span: literal.span,
            }),
          );
        }
      }

      // Result types refined by name, as 1.0.0 refines them; the higher-order functions' rules and
      // what their callables receive come from the invocation table.
      const resultRule = RESULTS_BY_NAME.get(def.name.toUpperCase());
      const tableEntry = invocationOf(def);

      // Special-case: LIST() should be type-consistent (spec: values must have same type).
      // We infer element type from the first concrete (non-null, non-any) argument.
      if (def.name.toUpperCase() === 'LIST') {
        let base: FormulaType | null = null;
        let elementNullable = false;
        for (const at of argTypes) {
          if (at.kind === 'null' || at.nullable === true) elementNullable = true;
          const stripped = stripNullability(at);
          if (stripped.kind === 'null' || stripped.kind === 'any' || stripped.kind === 'template')
            continue;
          if (!base) {
            base = stripped;
            continue;
          }
          // Require same type (no loose assignability here) for LIST items.
          const same = isAssignable(stripped, base) && isAssignable(base, stripped);
          if (!same) {
            errors.push(
              makeFormulaError({
                kind: 'type',
                code: FormulaErrorCodes.ARGUMENT_TYPES_MUST_HAVE_SAME_TYPE,
                message: `LIST(...) items must have the same type; got ${formatType(base)} and ${formatType(stripped)}`,
                span: node.span,
              }),
            );
            // Keep binding going, but don't try to infer a tighter return type.
            base = null;
            break;
          }
        }

        if (base) {
          node.type = FormulaTypes.list({ ...base, nullable: elementNullable }, false);
        } else {
          node.type = def.returnType;
        }
      } else if (resultRule === 'items') {
        const targetType = argTypes[0];
        const stripped = stripNullability(targetType);
        if (stripped.kind === 'list') {
          node.type = FormulaTypes.list(stripped.of, def.returnType.nullable === true);
        } else {
          node.type = def.returnType;
        }
      } else if (resultRule === 'results' && tableEntry !== undefined) {
        const targetType = argTypes[0];
        const opArg = node.args[1];

        const stripped = stripNullability(targetType);
        if (
          stripped.kind === 'list' &&
          opArg?.predictableValue !== undefined &&
          typeof opArg.predictableValue === 'string'
        ) {
          const opName = opArg.predictableValue;
          let chosenOp: any | null = null;
          const operator = registry.getOperator(opName);
          if (operator) {
            chosenOp = registry.getFunction(operator.functionSignatureId) ?? null;
          } else {
            const candidates = registry.listFunctionsByName(opName);
            if (candidates.length > 0) {
              // What the table's entry passes the callable: for EACH, the item and every argument
              // after the callable.
              const opArgTypes = invokedArguments(tableEntry, argTypes).map(
                (invoked) => invoked.type,
              );
              chosenOp =
                chooseOverload(
                  candidates.map((c) => ({ ...c, params: c.params, returnType: c.returnType })),
                  opArgTypes,
                ) ?? candidates[0];
            }
          }

          if (chosenOp) {
            node.type = FormulaTypes.list(
              chosenOp.returnType ?? FormulaTypes.any(true),
              def.returnType.nullable === true,
            );
          } else {
            node.type = def.returnType;
          }
        } else {
          node.type = baseReturnType;
        }
      } else if (def.name.toUpperCase() === 'IF') {
        const condType = argTypes[0] ?? FormulaTypes.any(true);
        const condOk = isBooleanLikeType(condType);
        if (!condOk) {
          errors.push(
            makeFormulaError({
              kind: 'type',
              code: FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH,
              message: `IF(...) condition must be boolean-like (BOOLEAN or TEXT), got ${formatType(condType)}`,
              span: node.args[0]?.span ?? node.span,
              path: ['call', def.signatureId, 'cond'],
            }),
          );
        }

        const thenType = argTypes[1] ?? FormulaTypes.any(true);
        const elseType = argTypes[2] ?? FormulaTypes.any(true);

        const thenBase = stripNullability(thenType);
        const elseBase = stripNullability(elseType);

        const thenIsNull = thenBase.kind === 'null';
        const elseIsNull = elseBase.kind === 'null';
        const thenIsAny = thenBase.kind === 'any' || thenBase.kind === 'template';
        const elseIsAny = elseBase.kind === 'any' || elseBase.kind === 'template';

        // Allow NULL as a branch value, treating it as a nullable version of the other branch.
        // Only enforce strict type consistency when both branches are concrete (not NULL, not Any).
        if (!thenIsNull && !elseIsNull && !thenIsAny && !elseIsAny) {
          const same = isAssignable(thenBase, elseBase) && isAssignable(elseBase, thenBase);
          if (!same) {
            errors.push(
              makeFormulaError({
                kind: 'type',
                code: FormulaErrorCodes.ARGUMENT_TYPES_MUST_HAVE_SAME_TYPE,
                message: `IF(...) then/else branches must have the same type; got ${formatType(thenType)} and ${formatType(elseType)}`,
                span: node.span,
              }),
            );
            node.type = def.returnType;
            requirements.functionsUsed.push(def.signatureId);
            return node.type;
          }
        }

        const outNullable =
          thenType.nullable === true || elseType.nullable === true || thenIsNull || elseIsNull;

        // Infer output type from a concrete branch when possible.
        let base: FormulaType | null = null;
        if (!thenIsNull && !thenIsAny) base = thenBase;
        else if (!elseIsNull && !elseIsAny) base = elseBase;

        if (thenIsNull && elseIsNull) {
          node.type = FormulaTypes.null();
        } else if (base) {
          node.type = { ...base, nullable: outNullable };
        } else {
          // If we can't infer anything concrete (Any/NULL only), preserve nullability precision.
          node.type = FormulaTypes.any(outNullable);
        }
      } else {
        node.type = baseReturnType;
      }

      requirements.functionsUsed.push(def.signatureId);
      return node.type;
    }
  }
}

/**
 * The values a literal-only parameter admits: its `literalValues`, a list of texts; undefined where
 * it lists none. Registration refuses any other value, but a registry that is not an
 * `InMemoryFormulaRegistry` may hand the parser a definition as written: `null` there lists nothing,
 * as on the other optional fields, and so does a value that is not a list of texts, which the
 * parser reads rather than throws on (the function refuses, when it runs, a mode it does not list).
 */
function admittedValues(param: FunctionParamDefinition): readonly string[] | undefined {
  const values: unknown = param.literalValues;
  if (!Array.isArray(values)) return undefined;
  for (let index = 0; index < values.length; index++) {
    if (typeof values[index] !== 'string') return undefined;
  }
  return values as string[];
}

/** The parameter that takes argument `index`; a variadic last parameter takes every extra one. */
function paramAt(
  params: readonly FunctionParamDefinition[],
  index: number,
): FunctionParamDefinition | undefined {
  if (index < params.length) return params[index];
  const last = params[params.length - 1];
  return last?.variadic === true ? last : undefined;
}

type LiteralArgument =
  { ok: true; value: string; span: SourceSpan | undefined } | { ok: false; error: FormulaError };

/**
 * The refusal of a literal that is not among `admitted`. With overloads that list different
 * values, `admitted` holds the values every one of them lists, and the message names the overloads
 * that do not list the literal.
 */
function notAdmittedMessage(
  subject: string,
  owner: string,
  admitted: readonly string[],
  value: string,
  listings: readonly Listing[],
): string {
  const quoted = admitted.map((v) => JSON.stringify(v)).join(', ');
  const got = JSON.stringify(value);
  const first = listings[0]?.values ?? [];
  const alike = listings.every(
    (listing) =>
      listing.values.length === first.length && listing.values.every((v) => first.includes(v)),
  );
  if (alike) return `${subject} must be one of ${quoted}; got ${got}`;
  const missing = listings
    .filter((listing) => !listing.values.includes(value))
    .map((listing) => listing.signatureId);
  const verb = missing.length === 1 ? 'does' : 'do';
  const expected =
    admitted.length > 0
      ? `one of ${quoted}, the values every overload of ${owner} lists here`
      : `one of the values every overload of ${owner} lists here, and they list none in common`;
  return `${subject} must be ${expected}; got ${got}, which ${missing.join(', ')} ${verb} not list`;
}

/**
 * Reads the argument a literal-only parameter takes: a string literal written in the formula and,
 * when the parameter lists `literalValues`, one of them. `suppliedBy` names the higher-order
 * function that passes the parameter a value at run time instead, which no literal can be.
 * `listings` are the lists of the overloads the admitted values come from, for the message.
 */
function readLiteralArgument(
  param: FunctionParamDefinition,
  arg: RuleNode | undefined,
  at: {
    subject: string;
    span: SourceSpan | undefined;
    path: string[];
    suppliedBy?: string;
    owner?: string;
    listings?: readonly Listing[];
  },
): LiteralArgument {
  if (!arg || arg.kind !== 'literal' || typeof arg.predictableValue !== 'string') {
    const supplied =
      at.suppliedBy === undefined ? '' : `; ${at.suppliedBy} passes it a value at run time`;
    return {
      ok: false,
      error: makeFormulaError({
        kind: 'type',
        code: FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
        message: `${at.subject} must be a string literal${supplied}`,
        span: at.span,
      }),
    };
  }
  const value = arg.predictableValue;
  // Enumerated literals: the parameter names the only values it admits.
  const admitted = admittedValues(param);
  if (admitted !== undefined && !admitted.includes(value)) {
    const listings = at.listings ?? [{ signatureId: '', values: admitted }];
    return {
      ok: false,
      error: makeFormulaError({
        kind: 'type',
        code: FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
        message: notAdmittedMessage(at.subject, at.owner ?? '', admitted, value, listings),
        span: arg.span,
        path: at.path,
      }),
    };
  }
  return { ok: true, value, span: arg.span };
}

/** Whether `name` is a registered function or operator of the kind a reference admits. */
function referenceExists(
  registry: FormulaRegistry,
  kind: CallableReferenceKind,
  name: string,
): boolean {
  const isFunction = (): boolean => registry.listFunctionsByName(name).length > 0;
  const isOperator = (): boolean => !!registry.getOperator(name);
  if (kind === 'function') return isFunction();
  if (kind === 'operator') return isOperator();
  return isFunction() || isOperator();
}

/**
 * The definitions a callable reference can name: the function behind an operator token when the
 * reference admits operators, then the functions of that name when it admits functions.
 */
function callableCandidates(
  registry: FormulaRegistry,
  kind: CallableReferenceKind,
  name: string,
): FunctionDefinition[] {
  const candidates: FunctionDefinition[] = [];
  const operator = registry.getOperator(name);
  if (operator && (kind === 'operator' || kind === 'function_or_operator')) {
    const operatorDef = registry.getFunction(operator.functionSignatureId);
    if (operatorDef) candidates.push(operatorDef);
  }
  if (kind === 'function' || kind === 'function_or_operator') {
    candidates.push(...registry.listFunctionsByName(name));
  }
  return candidates;
}

/** An overload that lists admitted values at a position, with the values it lists there. */
type Listing = { signatureId: string; values: readonly string[] };

/**
 * The admitted values that bind a literal passed on to argument `position` of a callable: the
 * values EVERY definition the callable's name can reference lists there, because the core
 * higher-order functions invoke the first definition of the name that has an implementation, which
 * the parser cannot know. Whichever definition runs then either lists the literal or lists nothing
 * at that position. Answers the parameter to read the argument against (its `literalValues` the
 * intersection), the name of the function, and every overload's own list for the refusal message;
 * undefined when no definition lists admitted values there, as a literal-only parameter without
 * them keeps 1.0.0 behaviour.
 */
function enumeratedTarget(
  candidates: readonly FunctionDefinition[],
  position: number,
): { param: FunctionParamDefinition; owner: string; listings: Listing[] } | undefined {
  let first: { param: FunctionParamDefinition; owner: string } | undefined;
  const listings: Listing[] = [];
  for (const candidate of candidates) {
    const param = paramAt(candidate.params, position);
    const values = param === undefined ? undefined : admittedValues(param);
    if (param === undefined || values === undefined) continue;
    first ??= { param, owner: candidate.name };
    listings.push({ signatureId: candidate.signatureId, values });
  }
  if (first === undefined) return undefined;
  const admitted = admittedValues(first.param)?.filter((value) =>
    listings.every((listing) => listing.values.includes(value)),
  );
  return { param: { ...first.param, literalValues: admitted }, owner: first.owner, listings };
}

/**
 * Reports `error` unless the same diagnostic (code, message and span) is already reported: the
 * walk can reach one argument along several definitions of the same name.
 */
function reportOnce(errors: FormulaError[], error: FormulaError): void {
  const reported = errors.some(
    (other) =>
      other.code === error.code &&
      other.message === error.message &&
      other.span?.start === error.span?.start &&
      other.span?.end === error.span?.end,
  );
  if (!reported) errors.push(error);
}

/**
 * An argument a higher-order function passes to its callable: its type, and the index of the
 * formula argument it passes on unchanged. `source` is undefined for a value the higher-order
 * function supplies at run time: a list item, a key, a property value, an accumulator.
 */
type PassedArgument = { type: FormulaType; source: number | undefined };

/**
 * Holds the arguments a higher-order function whose invocation the parser knows passes to the
 * callable it names to the callable's enumerated-literal rule (`enumeratedTarget`): an argument
 * reaching a parameter that lists admitted `literalValues` must be a string literal naming a value
 * every definition of the name lists there. A literal that names a callable in turn is followed
 * into the invocation that callable makes, for every definition of the name, so the rule holds at
 * any depth of higher-order calls whose callables are written as string literals. A name passed on
 * is resolved when the call runs, so one the registry does not know is no error here. Each exit
 * below states why it lets no literal reach a parameter that lists admitted values unchecked.
 *
 * The walk ends: an invocation of the closed table passes the callable fewer arguments than its
 * call holds whenever it passes one on (a spec checks every entry), so the arguments a followed
 * callable receives shrink at every level. `walked` holds the states this walk has checked, for
 * the call written in the formula, so that overloads following the same callable along several
 * reference kinds check each state once.
 */
function checkPassedArguments(
  registry: FormulaRegistry,
  errors: FormulaError[],
  walked: Set<string>,
  at: {
    /** The call written in the formula: every `source` indexes its arguments. */
    call: { signatureId: string; args: readonly RuleNode[] };
    /** The higher-order function that invokes the callable. */
    host: FunctionDefinition;
    /**
     * Every definition the callable's name can reference; the higher-order function may invoke any
     * of them when the call runs: the core higher-order functions take the function behind an
     * operator token, otherwise the first definition that has an implementation.
     */
    candidates: readonly FunctionDefinition[];
    passed: readonly PassedArgument[];
    /** The formula argument that names the callable. */
    named: { index: number; span: SourceSpan | undefined };
  },
): void {
  // Exit: the walk has been here: the same candidates, named by the same formula argument and
  // invoked by a function of the same name (which the refusals name), with the same formula
  // argument or a supplied value at each position. The types the arguments carry decide no check
  // and no follow, so every check from here is made.
  const state = walkStateKey({
    named: at.named.index,
    host: at.host.name,
    candidates: at.candidates.map((def) => def.signatureId),
    sources: at.passed.map((passed) => passed.source),
  });
  if (walked.has(state)) return;
  walked.add(state);
  at.passed.forEach((passed, position) => {
    const arg = passed.source === undefined ? undefined : at.call.args[passed.source];
    const enumerated = enumeratedTarget(at.candidates, position);
    if (enumerated !== undefined) {
      const literal = readLiteralArgument(enumerated.param, arg, {
        subject: `Parameter '${enumerated.param.name}' of ${enumerated.owner}`,
        span: arg?.span ?? at.named.span,
        path: ['call', at.call.signatureId, 'arg', String(passed.source ?? at.named.index)],
        suppliedBy: passed.source === undefined ? at.host.name : undefined,
        owner: enumerated.owner,
        listings: enumerated.listings,
      });
      if (!literal.ok) {
        reportOnce(errors, literal.error);
        // Exit: the argument is refused, so the formula does not compile and nothing it would
        // pass on is ever invoked.
        return;
      }
    }
    // Exit: a value the higher-order function supplies when the call runs (an item, a key, a
    // property value, an accumulator) names no callable written in the formula, and one reaching
    // a parameter that lists admitted values was refused above.
    if (passed.source === undefined) return;
    // Exit: the rule follows a callable where a string literal names it; every function still
    // refuses, when it runs, a mode it does not list.
    if (arg === undefined || arg.kind !== 'literal' || typeof arg.predictableValue !== 'string') {
      return;
    }
    const followed = new Map<CallableInvocation, Set<string>>();
    for (const def of at.candidates) {
      const target = paramAt(def.params, position);
      const targetBase = target === undefined ? undefined : stripNullability(target.type);
      const invocation = invocationOf(def);
      // Skipped: this definition does not invoke the literal as a callable in a way the parser
      // knows. It takes no argument at this position, takes a plain value there, or has a name
      // the table does not hold; the function it calls refuses, when it runs, a mode it does not
      // list.
      if (targetBase?.kind !== 'callable' || invocation === undefined) continue;
      // Skipped: an invocation already followed with this reference kind reaches the same
      // callables.
      const kinds = followed.get(invocation) ?? new Set<string>();
      if (kinds.has(targetBase.reference)) continue;
      followed.set(invocation, kinds.add(targetBase.reference));
      const invoked = invokedArguments(
        invocation,
        at.passed.map((p) => p.type),
      );
      const candidates = callableCandidates(registry, targetBase.reference, arg.predictableValue);
      checkPassedArguments(registry, errors, walked, {
        call: at.call,
        host: def,
        candidates,
        passed: invoked.map((invokedArg) => ({
          type: invokedArg.type,
          source:
            invokedArg.forwards === undefined ? undefined : at.passed[invokedArg.forwards]?.source,
        })),
        named: { index: passed.source, span: arg.span },
      });
    }
  });
}

function instantiateGenericReturnType(
  def: FunctionDefinition,
  argTypes: FormulaType[],
): FormulaType {
  if (!def.templates || def.templates.length === 0) return def.returnType;

  const bindings = inferGenericBindingsForCall(def, argTypes);
  return substituteTemplates(def.returnType, bindings);
}

function inferGenericBindingsForCall(
  def: FunctionDefinition,
  argTypes: FormulaType[],
): Map<string, FormulaType> {
  const bindings = new Map<string, FormulaType>();
  if (!def.templates || def.templates.length === 0) return bindings;

  const params = def.params;
  const lastParam = params[params.length - 1];
  const variadic = lastParam?.variadic === true;

  const paramAt = (index: number): FormulaType | null => {
    if (params.length === 0) return null;
    const p = index < params.length ? params[index] : variadic ? lastParam : undefined;
    return p?.type ?? null;
  };

  for (let i = 0; i < argTypes.length; i++) {
    const p = paramAt(i);
    if (!p) continue;
    inferTemplateBindings(
      stripNullability(p),
      stripNullability(argTypes[i] ?? FormulaTypes.any(true)),
      bindings,
    );
  }

  return bindings;
}

function inferTemplateBindings(
  pattern: FormulaType,
  actual: FormulaType,
  bindings: Map<string, FormulaType>,
): void {
  if (pattern.kind === 'template') {
    // Respect constraints when present.
    const constrainedActual = pattern.constraint ? actual : actual;
    if (constrainedActual.kind === 'any' || constrainedActual.kind === 'null') return;

    const existing = bindings.get(pattern.name);
    if (!existing) {
      bindings.set(pattern.name, constrainedActual);
      return;
    }

    // Prefer a concrete type over Any/Template placeholders.
    if (existing.kind === 'any' || existing.kind === 'template') {
      bindings.set(pattern.name, constrainedActual);
      return;
    }
    // If we see an incompatible binding, fall back to Any.
    const same =
      isAssignable(existing, constrainedActual) && isAssignable(constrainedActual, existing);
    if (!same) {
      bindings.set(pattern.name, FormulaTypes.any(true));
    }
    return;
  }

  if (pattern.kind === 'list' && actual.kind === 'list') {
    inferTemplateBindings(stripNullability(pattern.of), stripNullability(actual.of), bindings);
    return;
  }

  if (pattern.kind === 'union') {
    // Best-effort: try to bind against the first member that matches.
    const match = pattern.of.find((m) => isAssignable(actual, m) || isAssignable(m, actual));
    if (match) inferTemplateBindings(stripNullability(match), actual, bindings);
    return;
  }
}

function substituteTemplates(t: FormulaType, bindings: Map<string, FormulaType>): FormulaType {
  if (t.kind === 'template') {
    const bound = bindings.get(t.name);
    if (!bound) return t;
    return {
      ...bound,
      nullable: t.nullable === true || bound.nullable === true,
      description: bound.description,
    };
  }
  if (t.kind === 'list') {
    return { ...t, of: substituteTemplates(t.of, bindings) };
  }
  if (t.kind === 'union') {
    return { ...t, of: t.of.map((x) => substituteTemplates(x, bindings)) };
  }
  if (t.kind === 'callable') {
    return {
      ...t,
      paramTypes: t.paramTypes?.map((x) => substituteTemplates(x, bindings)),
      returnType: t.returnType ? substituteTemplates(t.returnType, bindings) : undefined,
    };
  }
  if (t.kind === 'object') {
    const props = t.properties
      ? Object.fromEntries(
          Object.entries(t.properties).map(([k, v]) => [k, substituteTemplates(v, bindings)]),
        )
      : undefined;
    return { ...t, properties: props };
  }
  return t;
}

function chooseOverload(
  candidates: Array<
    {
      params: Array<{ type: FormulaType; optional?: boolean; variadic?: boolean }>;
      returnType: FormulaType;
    } & any
  >,
  argTypes: FormulaType[],
) {
  for (const def of candidates) {
    const requiredCount = def.params.filter((p: any) => !p.optional).length;
    if (argTypes.length < requiredCount) continue;

    const last = def.params[def.params.length - 1];
    const isVariadic = last?.variadic === true;
    if (!isVariadic && argTypes.length > def.params.length) continue;
    let ok = true;
    for (let i = 0; i < argTypes.length; i++) {
      const arg = argTypes[i];
      const param = def.params[Math.min(i, def.params.length - 1)];
      if (!param) {
        ok = false;
        break;
      }
      if (i >= def.params.length && param.variadic !== true) {
        ok = false;
        break;
      }
      // Null overlap rule: allow nullable arg even if param isn't nullable.
      const argNoNull = stripNullability(arg);
      const paramNoNull = stripNullability(param.type);
      if (!isAssignable(argNoNull, paramNoNull) && param.type.kind !== 'any') {
        ok = false;
        break;
      }
    }
    if (ok) return def;
  }
  return null;
}

function computeIsStatic(node: RuleNode, registry: RegistryLike): boolean {
  if (node.kind === 'literal') return true;
  if (node.kind === 'variable') return false;
  if (node.kind === 'property' || node.kind === 'wildcard') {
    // Accessors are only static if they can be fully predicted.
    return computeIsStatic(node.object, registry) && node.predictableValue !== undefined;
  }
  if (node.kind === 'call') {
    if (!isFormulaRegistry(registry)) return false;
    if (!node.signatureId) return false;
    const def = registry.getFunction(node.signatureId);
    if (!def) return false;
    if (def.purity !== 'pure') return false;
    return node.args.every((a) => computeIsStatic(a, registry));
  }
  return false;
}

function uniqStable<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function uniqExternalData(
  items: Array<{ kind: string; value: unknown }>,
): Array<{ kind: string; value: unknown }> {
  const seen = new Set<string>();
  const out: Array<{ kind: string; value: unknown }> = [];
  for (const item of items) {
    let key = item.kind + ':';
    try {
      key += JSON.stringify(item.value);
    } catch {
      key += String(item.value);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function getAccessorBasePaths(node: RuleNode): string[] | null {
  if (node.kind === 'variable') return [node.name];
  if (node.kind === 'property') {
    const base = getAccessorBasePaths(node.object);
    if (!base) return null;
    return base.map((p) => `${p}.${node.property}`);
  }
  if (node.kind === 'wildcard') {
    const base = getAccessorBasePaths(node.object);
    if (!base) return null;
    return base.map((p) => `${p}.*.${node.property}`);
  }
  return null;
}

function collectVariablesReadPaths(node: RuleNode): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const visit = (n: RuleNode) => {
    if (n.kind === 'variable') {
      if (!seen.has(n.name)) {
        seen.add(n.name);
        out.push(n.name);
      }
      return;
    }

    if (n.kind === 'property' || n.kind === 'wildcard') {
      const path = getAccessorBasePaths(n);
      if (path) {
        for (const p of path) {
          if (seen.has(p)) continue;
          seen.add(p);
          out.push(p);
        }
        return;
      }
      // Dynamic access (e.g. CALL(...).prop) still needs to traverse inner expression.
      visit(n.object);
      return;
    }

    if (n.kind === 'call') {
      for (const a of n.args) visit(a);
      return;
    }
  };

  visit(node);
  return out;
}
