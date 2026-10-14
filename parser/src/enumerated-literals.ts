/**
 * The enumerated-literal rule: a literal-only argument written in the formula, or passed on by a
 * higher-order function whose invocation the parser knows, must be a string literal, and one the
 * parameter lists when it lists admitted values; a literal that names a callable in turn is
 * followed into the invocation that callable makes.
 */
import type {
  CallableReferenceKind,
  FormulaError,
  FormulaRegistry,
  FunctionDefinition,
  FunctionParamDefinition,
  RuleNode,
  SourceSpan,
} from '@formulang/definitions';
import { FormulaErrorCodes, makeFormulaError, stripNullability } from '@formulang/definitions';
import {
  invocationOf,
  passedSources,
  sourceAt,
  sourceCount,
  walkStateKey,
  writtenArguments,
  type CallableInvocation,
  type PassedSources,
} from './callable-invocations';

/**
 * The values a literal-only parameter admits: its `literalValues`, a list of texts; undefined where
 * it lists none. Registration refuses any other value, but a registry that is not an
 * `InMemoryFormulaRegistry` may hand the parser a definition as written: `null` there lists nothing,
 * as on the other optional fields, and so does a value that is not a list of texts, which the
 * parser reads rather than throws on (the function refuses, when it runs, a mode it does not list).
 */
export function admittedValues(param: FunctionParamDefinition): readonly string[] | undefined {
  const values: unknown = param.literalValues;
  if (!Array.isArray(values)) return undefined;
  for (let index = 0; index < values.length; index++) {
    if (typeof values[index] !== 'string') return undefined;
  }
  return values as string[];
}

/** The parameter that takes argument `index`; a variadic last parameter takes every extra one. */
export function paramAt(
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
export function readLiteralArgument(
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
export function referenceExists(
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
export function callableCandidates(
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

/** Argument positions the walk may visit per argument of the call written in the formula. */
export const WALK_STEPS_PER_ARGUMENT = 16;

/**
 * The walk through the callables that one call written in the formula names, by string literals,
 * to higher-order functions whose invocation the parser knows: the states it has checked, the
 * diagnostics it has reported, and the steps it has taken, one per argument position it visits, of
 * the `limit` it may take, `WALK_STEPS_PER_ARGUMENT` per argument of the call. Its work is linear in
 * the size of the formula however the registry's definitions nest. At the limit the walk stops
 * following: it never throws and never refuses a formula for its cost, and every argument it has
 * not checked is checked by the function that receives it, when the call runs.
 */
export type CallWalk = {
  readonly registry: FormulaRegistry;
  readonly errors: FormulaError[];
  /** The call written in the formula: every source indexes its arguments. */
  readonly call: { signatureId: string; args: readonly RuleNode[] };
  readonly walked: Set<string>;
  readonly reported: Set<string>;
  steps: number;
  readonly limit: number;
};

/** A walk for `call`, a call written in the formula, that reports into `errors`. */
export function callWalk(
  registry: FormulaRegistry,
  errors: FormulaError[],
  call: { signatureId: string; args: readonly RuleNode[] },
): CallWalk {
  return {
    registry,
    errors,
    call,
    walked: new Set(),
    reported: new Set(),
    steps: 0,
    limit: WALK_STEPS_PER_ARGUMENT * (call.args.length + 1),
  };
}

/** A callable named by a string literal, as a higher-order function invokes it. */
type WalkState = {
  /** The higher-order function that invokes the callable. */
  host: FunctionDefinition;
  /**
   * Every definition the callable's name can reference; the higher-order function may invoke any
   * of them when the call runs: the core higher-order functions take the function behind an
   * operator token, otherwise the first definition that has an implementation.
   */
  candidates: readonly FunctionDefinition[];
  /** Where each argument the callable receives comes from. */
  sources: PassedSources;
  /** The formula argument that names the callable. */
  named: { index: number; span: SourceSpan | undefined };
};

/**
 * Holds what the higher-order function `host` passes the callable that argument `index` of the call
 * written in the formula names (`name`, a reference of kind `reference`) to the callable's
 * enumerated-literal rule (`enumeratedTarget`): an argument reaching a parameter that lists
 * admitted `literalValues` must be a string literal naming a value every definition of the name
 * lists there. A literal that names a callable in turn, at a callable parameter of a definition's
 * own list, is followed into the invocation that callable makes, for every definition of the name,
 * so the rule holds at any depth of higher-order calls whose callables are written as string
 * literals, as far as the walk's limit reaches. A name passed on is resolved when the call runs, so
 * one the registry does not know is no error here. Each exit below states why it lets no literal
 * reach a parameter that lists admitted values unchecked, or what checks it instead.
 *
 * The walk is iterative and breadth first: every state of one level of callables before any of the
 * next, so where the limit stops it, every level above has been checked. Each state is visited
 * once, so overloads that follow the same callable along several reference kinds check it once.
 */
export function walkCallable(
  walk: CallWalk,
  at: {
    host: FunctionDefinition;
    reference: CallableReferenceKind;
    name: string;
    index: number;
    span: SourceSpan | undefined;
  },
): void {
  const invocation = invocationOf(at.host);
  if (invocation === undefined) return;
  const queue: WalkState[] = [];
  enqueue(walk, queue, {
    host: at.host,
    candidates: callableCandidates(walk.registry, at.reference, at.name),
    sources: passedSources(invocation, writtenArguments(walk.call.args.length)),
    named: { index: at.index, span: at.span },
  });
  for (let next = 0; next < queue.length; next++) {
    const state = queue[next] as WalkState;
    const end = positionsToVisit(state);
    for (let position = 0; position < end; position++) {
      // Exit: the limit is reached, so the walk stops following. Every argument it has not
      // checked reaches a function when the call runs, and the function refuses a mode it does not
      // list.
      if (walk.steps >= walk.limit) return;
      walk.steps++;
      for (const follow of visit(walk, state, position)) enqueue(walk, queue, follow);
    }
  }
}

/**
 * Queues `state` unless the walk has queued it before: the same candidates, named by the same
 * formula argument and invoked by a function of the same name (which the refusals name), with the
 * same formula argument or a supplied value at each position, so every check it would make is
 * made.
 */
function enqueue(walk: CallWalk, queue: WalkState[], state: WalkState): void {
  const key = walkStateKey({
    named: state.named.index,
    host: state.host.name,
    candidates: state.candidates.map((def) => def.signatureId),
    sources: state.sources,
  });
  if (walk.walked.has(key)) return;
  walk.walked.add(key);
  queue.push(state);
}

/**
 * How many of a state's positions the walk visits: every one up to the longest parameter list
 * among the candidates. Past it every candidate takes its variadic last parameter or nothing, the
 * same at every position, and no definition invokes a callable there (`visit`), so those positions
 * are visited only where that parameter lists admitted values.
 */
function positionsToVisit(state: WalkState): number {
  const count = sourceCount(state.sources);
  const widest = state.candidates.reduce((most, def) => Math.max(most, def.params.length), 0);
  if (count <= widest) return count;
  return enumeratedTarget(state.candidates, widest) === undefined ? widest : count;
}

/**
 * Checks the argument at `position` of a state against the candidates' enumerated-literal rule,
 * and answers the states it leads to: the callables a string literal there names to a definition
 * that invokes it.
 */
function visit(walk: CallWalk, state: WalkState, position: number): WalkState[] {
  const source = sourceAt(state.sources, position);
  const arg = source === undefined ? undefined : walk.call.args[source];
  const enumerated = enumeratedTarget(state.candidates, position);
  if (enumerated !== undefined) {
    const literal = readLiteralArgument(enumerated.param, arg, {
      subject: `Parameter '${enumerated.param.name}' of ${enumerated.owner}`,
      span: arg?.span ?? state.named.span,
      path: ['call', walk.call.signatureId, 'arg', String(source ?? state.named.index)],
      suppliedBy: source === undefined ? state.host.name : undefined,
      owner: enumerated.owner,
      listings: enumerated.listings,
    });
    if (!literal.ok) {
      report(walk, literal.error);
      // Exit: the argument is refused, so the formula does not compile and nothing it would pass
      // on is ever invoked.
      return [];
    }
  }
  // Exit: a value the higher-order function supplies when the call runs (an item, a key, a
  // property value, an accumulator) names no callable written in the formula, and one reaching a
  // parameter that lists admitted values was refused above.
  if (source === undefined) return [];
  // Exit: the rule follows a callable where a string literal names it. One named by a value or an
  // expression is resolved when the call runs, and the function it calls refuses, when it runs, a
  // mode it does not list.
  if (arg === undefined || arg.kind !== 'literal' || typeof arg.predictableValue !== 'string') {
    return [];
  }
  const follows: WalkState[] = [];
  const followed = new Map<CallableInvocation, Set<string>>();
  for (const def of state.candidates) {
    // Skipped: this definition does not invoke the literal as a callable in a way the parser
    // knows: its name is not in the table, it takes a plain value at this position, or the
    // position is past its own parameter list. Of the arguments a variadic callable parameter
    // takes, only the first is followed, as only the first is checked where the call is written
    // (as in 1.0.0). The function a skipped callable calls refuses, when it runs, a mode it does
    // not list.
    const param = position < def.params.length ? def.params[position] : undefined;
    const target = param === undefined ? undefined : stripNullability(param.type);
    const invocation = invocationOf(def);
    if (target?.kind !== 'callable' || invocation === undefined) continue;
    // Skipped: an invocation already followed with this reference kind reaches the same callables.
    const kinds = followed.get(invocation) ?? new Set<string>();
    if (kinds.has(target.reference)) continue;
    followed.set(invocation, kinds.add(target.reference));
    follows.push({
      host: def,
      candidates: callableCandidates(walk.registry, target.reference, arg.predictableValue),
      sources: passedSources(invocation, state.sources),
      named: { index: source, span: arg.span },
    });
  }
  return follows;
}

/**
 * Reports `error` unless the walk has reported the same diagnostic (code, message and span): it
 * can reach one argument along several definitions of the same name.
 */
function report(walk: CallWalk, error: FormulaError): void {
  const key = JSON.stringify([
    error.code,
    error.message,
    error.span?.start ?? null,
    error.span?.end ?? null,
  ]);
  if (walk.reported.has(key)) return;
  walk.reported.add(key);
  walk.errors.push(error);
}
