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
import {
  admittedValues,
  FormulaErrorCodes,
  literalCheckAt,
  makeFormulaError,
  stripNullability,
} from '@formulang/definitions';
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
import { chargeWork, workRecord, type WorkRecord } from './work-trace';

/**
 * Admitted values as one parse reads them (`AdmittedLists`): testing a literal against them is one
 * lookup, and only `values`, which a refusal reads to print them, reads every one. Each read is
 * charged to the work record of a parse a spec observes.
 */
export type AdmittedList = {
  /** Whether `value` is one of the admitted values. */
  readonly admits: (value: string) => boolean;
  /** How many distinct values the list holds. */
  readonly size: number;
  /** The values, in order. */
  readonly values: () => readonly string[];
};

/** The `AdmittedList` of `values`, read once into a set. */
function admittedList(values: readonly string[]): AdmittedList {
  chargeWork('admitted', values.length);
  const set = new Set(values);
  return {
    admits: (value) => {
      chargeWork('admitted', 1);
      return set.has(value);
    },
    size: set.size,
    values: () => {
      chargeWork('admitted', values.length);
      return values;
    },
  };
}

/** An overload that lists admitted values at a position, with the values it lists there. */
type Listing = { signatureId: string; list: AdmittedList };

/**
 * What a literal is checked against, and what its refusal says: the subject the message names, the
 * admitted values (none for a literal-only parameter that lists none), and, for a literal passed on
 * to a callable, the name of the function, every overload's own list and whether they all list the
 * same values. The message refusing a value is built on the first report of that value against
 * this target, and kept for every other report in the parse.
 */
export type LiteralTarget = {
  readonly subject: string;
  readonly admitted: AdmittedList | undefined;
  readonly among:
    | { readonly owner: string; readonly listings: readonly Listing[]; readonly alike: boolean }
    | undefined;
  readonly messages: Map<string, string>;
};

/**
 * The admitted values one parse reads, each read once, and the targets they make, each made once:
 * a parameter's list, on the first check against it (`list`, by the parameter, the `read` of
 * `literalCheckAt`); the target of a literal written at a parameter (`written`, by the parameter);
 * and the target of a literal passed on to a callable (`passed`), by the parameters the position
 * resolves to for the definitions of the callable's name, never by the position itself, so every
 * position a variadic parameter takes past the list shares one target. A check then costs one
 * lookup however long the lists are, and a refusal reads the values it prints.
 */
export type AdmittedLists = {
  readonly list: (param: FunctionParamDefinition) => AdmittedList | undefined;
  readonly written: (param: FunctionParamDefinition) => LiteralTarget;
  readonly passed: (
    candidates: readonly FunctionDefinition[],
    position: number,
  ) => LiteralTarget | undefined;
};

/** The admitted lists of one parse, empty until it reads one. */
export function admittedLists(): AdmittedLists {
  const lists = new Map<FunctionParamDefinition, AdmittedList | undefined>();
  const writtenTargets = new Map<FunctionParamDefinition, LiteralTarget>();
  const passedTargets = new Map<string, LiteralTarget>();
  const list = (param: FunctionParamDefinition): AdmittedList | undefined => {
    if (lists.has(param)) return lists.get(param);
    // `admittedValues` reads every value once to check that the list is a list of texts.
    const values = admittedValues(param);
    if (values !== undefined) chargeWork('admitted', values.length);
    const read = values === undefined ? undefined : admittedList(values);
    lists.set(param, read);
    return read;
  };
  const written = (param: FunctionParamDefinition): LiteralTarget => {
    let target = writtenTargets.get(param);
    if (target === undefined) {
      target = {
        subject: `Parameter '${param.name}'`,
        admitted: list(param),
        among: undefined,
        messages: new Map(),
      };
      writtenTargets.set(param, target);
    }
    return target;
  };
  const passed = (
    candidates: readonly FunctionDefinition[],
    position: number,
  ): LiteralTarget | undefined => {
    const checks: {
      def: FunctionDefinition;
      param: FunctionParamDefinition;
      list: AdmittedList;
    }[] = [];
    for (const def of candidates) {
      const check = literalCheckAt(def.params, position, list);
      if (check?.admitted !== undefined) {
        checks.push({ def, param: check.param, list: check.admitted });
      }
    }
    if (checks.length === 0) return undefined;
    const key = JSON.stringify(
      checks.map(({ def, param }) => [def.signatureId, def.params.indexOf(param)]),
    );
    let target = passedTargets.get(key);
    if (target === undefined) {
      target = passedTarget(checks);
      passedTargets.set(key, target);
    }
    return target;
  };
  return { list, written, passed };
}

/**
 * The target of a literal passed on to a callable whose definitions list admitted values at the
 * parameters in `checks`, in the order of the definitions: the values EVERY one of them lists,
 * because the core higher-order functions invoke the first definition of the name that has an
 * implementation, which the parser cannot know; whichever definition runs then either lists the
 * literal or lists nothing at that position. The subject is the first listing's parameter. The
 * listings list the same values exactly when each lists no more distinct values than they list in
 * common, so `alike` compares them as sets.
 */
function passedTarget(
  checks: readonly {
    def: FunctionDefinition;
    param: FunctionParamDefinition;
    list: AdmittedList;
  }[],
): LiteralTarget {
  const listings = checks.map(({ def, list }) => ({ signatureId: def.signatureId, list }));
  const [first] = checks;
  const [head, ...rest] = listings;
  if (first === undefined || head === undefined) throw new Error('a target needs a listing');
  const admitted =
    rest.length === 0
      ? head.list
      : admittedList(
          head.list.values().filter((value) => rest.every((listing) => listing.list.admits(value))),
        );
  const alike = listings.every((listing) => listing.list.size === admitted.size);
  return {
    subject: `Parameter '${first.param.name}' of ${first.def.name}`,
    admitted,
    among: { owner: first.def.name, listings, alike },
    messages: new Map(),
  };
}

/**
 * The refusal of `value`, a literal `target` does not admit, built on its first use and kept on the
 * target. With overloads that list different values, the admitted values are the ones every
 * overload lists, and the message names the overloads that do not list the literal. It reads the
 * values it prints, and one lookup per overload.
 */
function refusalMessage(target: LiteralTarget, value: string): string {
  const known = target.messages.get(value);
  if (known !== undefined) return known;
  const admitted = target.admitted;
  const quoted = (admitted?.values() ?? []).map((v) => JSON.stringify(v)).join(', ');
  const got = JSON.stringify(value);
  const among = target.among;
  let message: string;
  if (among === undefined || among.alike) {
    message = `${target.subject} must be one of ${quoted}; got ${got}`;
  } else {
    const missing = among.listings
      .filter((listing) => !listing.list.admits(value))
      .map((listing) => listing.signatureId);
    const verb = missing.length === 1 ? 'does' : 'do';
    const expected =
      admitted !== undefined && admitted.size > 0
        ? `one of ${quoted}, the values every overload of ${among.owner} lists here`
        : `one of the values every overload of ${among.owner} lists here, and they list none in common`;
    message = `${target.subject} must be ${expected}; got ${got}, which ${missing.join(', ')} ${verb} not list`;
  }
  target.messages.set(value, message);
  return message;
}

/**
 * A literal its target does not admit, with what its report needs: the message is built when the
 * refusal is reported (`refusalError`).
 */
export type Refusal = {
  readonly target: LiteralTarget;
  readonly value: string;
  readonly span: SourceSpan | undefined;
  readonly path: string[];
};

/** The error reporting `refusal`, its message from the target. */
export function refusalError(refusal: Refusal): FormulaError {
  return makeFormulaError({
    kind: 'type',
    code: FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
    message: refusalMessage(refusal.target, refusal.value),
    span: refusal.span,
    path: refusal.path,
  });
}

type LiteralArgument =
  | { kind: 'literal'; value: string; span: SourceSpan | undefined }
  | { kind: 'not a literal'; error: FormulaError }
  | { kind: 'refused'; refusal: Refusal };

/**
 * Reads the argument a literal-only parameter takes: a string literal written in the formula and,
 * when `target` lists admitted values, one of them. `suppliedBy` names the higher-order function
 * that passes the parameter a value at run time instead, which no literal can be. A literal the
 * target does not admit comes back as a refusal, whose message its report builds.
 */
export function readLiteralArgument(
  arg: RuleNode | undefined,
  target: LiteralTarget,
  at: { span: SourceSpan | undefined; path: string[]; suppliedBy?: string },
): LiteralArgument {
  if (!arg || arg.kind !== 'literal' || typeof arg.predictableValue !== 'string') {
    const supplied =
      at.suppliedBy === undefined ? '' : `; ${at.suppliedBy} passes it a value at run time`;
    return {
      kind: 'not a literal',
      error: makeFormulaError({
        kind: 'type',
        code: FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
        message: `${target.subject} must be a string literal${supplied}`,
        span: at.span,
      }),
    };
  }
  const value = arg.predictableValue;
  // Enumerated literals: the parameter names the only values it admits.
  if (target.admitted !== undefined && !target.admitted.admits(value)) {
    return { kind: 'refused', refusal: { target, value, span: arg.span, path: at.path } };
  }
  return { kind: 'literal', value, span: arg.span };
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

/**
 * Argument positions the walk may visit for each argument of the call written in the formula: a
 * call of n arguments may visit `WALK_STEPS_PER_ARGUMENT` × (n + 1) positions.
 */
export const WALK_STEPS_PER_ARGUMENT = 16;

/**
 * The walk through the callables that one call written in the formula names, by string literals,
 * to higher-order functions whose invocation the parser knows. Every callable parameter of the call
 * is seeded into one breadth-first queue (`seedCallable`) before the walk runs (`runWalk`), so the
 * walk visits every state of one level, across all of them, before any state of the next. It holds
 * the states it has queued, the diagnostics it has reported, and the steps it has taken, one per
 * argument position it visits, of the `limit` it may take: `WALK_STEPS_PER_ARGUMENT` × (n + 1) for
 * a call of n arguments, so the positions it visits are linear in the size of the formula however
 * the registry's definitions nest, and a check at one of them is a lookup in admitted values the
 * parse reads once (`AdmittedLists`). At the limit the walk stops following: it never throws and
 * never refuses a formula for its cost. Every level shallower than the one it stopped in has been
 * checked; a mode it leaves reaches the function when the call runs.
 */
export type CallWalk = {
  readonly registry: FormulaRegistry;
  readonly errors: FormulaError[];
  /** The admitted values the parse reads, each list once. */
  readonly lists: AdmittedLists;
  /** The call written in the formula: every source indexes its arguments. */
  readonly call: { signatureId: string; args: readonly RuleNode[]; span?: SourceSpan };
  readonly walked: Set<string>;
  readonly reported: Set<string>;
  /** The refusals reported, by target, value and the start of the literal refused. */
  readonly refused: Map<LiteralTarget, Map<string, Set<number | undefined>>>;
  /** The states to visit, in breadth-first order. */
  readonly queue: WalkState[];
  steps: number;
  readonly limit: number;
  /**
   * The record of the parse a spec observes (`observeWork`), which the walk feeds its queue and
   * visits, and the walk's number there; undefined for every other parse, which records nothing.
   */
  readonly record: WorkRecord | undefined;
  readonly id: number;
};

/**
 * A walk for `call`, a call written in the formula, that reports into `errors` and reads admitted
 * values through `lists`, the parse's.
 */
export function callWalk(
  registry: FormulaRegistry,
  errors: FormulaError[],
  lists: AdmittedLists,
  call: { signatureId: string; args: readonly RuleNode[]; span?: SourceSpan },
): CallWalk {
  const record = workRecord();
  const id = record === undefined ? 0 : record.walks++;
  const limit = WALK_STEPS_PER_ARGUMENT * (call.args.length + 1);
  record?.events.push({
    kind: 'walk',
    walk: id,
    signatureId: call.signatureId,
    start: call.span?.start,
    args: call.args.length,
    limit,
  });
  return {
    registry,
    errors,
    lists,
    call,
    walked: new Set(),
    reported: new Set(),
    refused: new Map(),
    queue: [],
    steps: 0,
    limit,
    record,
    id,
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
  /** How many callables lie between this one and the call written in the formula. */
  depth: number;
};

/**
 * Seeds the walk with the callable that argument `index` of the call written in the formula names
 * (`name`, a reference of kind `reference`) to the higher-order function `host`, at depth 0. A host
 * whose invocation the parser does not know seeds nothing.
 */
export function seedCallable(
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
  enqueue(walk, {
    host: at.host,
    candidates: callableCandidates(walk.registry, at.reference, at.name),
    sources: passedSources(invocation, writtenArguments(walk.call.args.length)),
    named: { index: at.index, span: at.span },
    depth: 0,
  });
}

/**
 * Holds what each seeded higher-order function passes its callable to the callable's
 * enumerated-literal rule (`passedTarget`): an argument reaching a parameter that lists
 * admitted `literalValues` must be a string literal naming a value every definition of the name
 * lists there. A literal that names a callable in turn, at an argument a definition invokes as a
 * callable (`visit`), is followed into the invocation that callable makes, for every definition of
 * the name, so the rule holds at any depth of higher-order calls whose callables are written as
 * string literals, as far as the walk's limit reaches. A name passed on is resolved when the call
 * runs, so one the registry does not know is no error here. Each exit below states why it lets no
 * literal reach a parameter that lists admitted values unchecked, or what happens to it instead.
 *
 * The walk takes the queue in order, so it visits the states breadth first, and each state once:
 * overloads that follow the same callable along several reference kinds check it once.
 */
export function runWalk(walk: CallWalk): void {
  for (let next = 0; next < walk.queue.length; next++) {
    const state = walk.queue[next] as WalkState;
    const end = positionsToVisit(walk, state);
    const key = walk.record === undefined ? '' : stateKey(state);
    for (let position = 0; position < end; position++) {
      // Exit: the limit is reached, so the walk stops following. Every argument it has not
      // checked reaches its function when the call runs (docs/language.md, When a mode is
      // checked, says what the formula then answers).
      if (walk.steps >= walk.limit) return;
      walk.steps++;
      walk.record?.events.push({
        kind: 'visited',
        walk: walk.id,
        depth: state.depth,
        state: key,
        position,
        positions: end,
      });
      for (const follow of visit(walk, state, position)) enqueue(walk, follow);
    }
  }
}

/** The key of `state` in the walk: what it checks and what it follows depend on nothing else. */
function stateKey(state: WalkState): string {
  return walkStateKey({
    named: state.named.index,
    host: state.host.name,
    candidates: state.candidates.map((def) => def.signatureId),
    sources: state.sources,
  });
}

/**
 * Queues `state` unless the walk has queued it before: the same candidates, named by the same
 * formula argument and invoked by a function of the same name (which the refusals name), with the
 * same formula argument or a supplied value at each position, so every check it would make is
 * made.
 */
function enqueue(walk: CallWalk, state: WalkState): void {
  const key = stateKey(state);
  if (walk.walked.has(key)) return;
  walk.walked.add(key);
  walk.queue.push(state);
  walk.record?.events.push({
    kind: 'queued',
    walk: walk.id,
    depth: state.depth,
    state: key,
    positions: positionsToVisit(walk, state),
  });
}

/**
 * How many of a state's positions the walk visits: every one up to the longest parameter list
 * among the candidates. Past it every candidate takes its variadic last parameter or nothing, the
 * same at every position, and a literal is checked there, and a callable followed there (`visit`),
 * only where `literalCheckAt` answers that parameter: a variadic literal-only parameter that lists
 * admitted values. Those positions are visited, all of them, where some candidate has one, and
 * none of them otherwise.
 */
function positionsToVisit(walk: CallWalk, state: WalkState): number {
  const count = sourceCount(state.sources);
  const widest = state.candidates.reduce((most, def) => Math.max(most, def.params.length), 0);
  if (count <= widest) return count;
  const checked = state.candidates.some(
    (def) => literalCheckAt(def.params, widest, walk.lists.list) !== undefined,
  );
  return checked ? count : widest;
}

/**
 * Checks the argument at `position` of a state against the candidates' enumerated-literal rule,
 * and answers the states it leads to: the callables a string literal there names to a definition
 * that invokes it.
 */
function visit(walk: CallWalk, state: WalkState, position: number): WalkState[] {
  const source = sourceAt(state.sources, position);
  const arg = source === undefined ? undefined : walk.call.args[source];
  const target = walk.lists.passed(state.candidates, position);
  if (target !== undefined) {
    const literal = readLiteralArgument(arg, target, {
      span: arg?.span ?? state.named.span,
      path: ['call', walk.call.signatureId, 'arg', String(source ?? state.named.index)],
      suppliedBy: source === undefined ? state.host.name : undefined,
    });
    // Exit: the argument is refused, so the formula does not compile and nothing it would pass on
    // is ever invoked.
    if (literal.kind === 'not a literal') {
      report(walk, literal.error);
      return [];
    }
    if (literal.kind === 'refused') {
      reportRefusal(walk, literal.refusal);
      return [];
    }
  }
  // Exit: a value the higher-order function supplies when the call runs (an item, a key, a
  // property value, an accumulator) names no callable written in the formula, and one reaching a
  // parameter that lists admitted values was refused above.
  if (source === undefined) return [];
  // Exit: the rule follows a callable where a string literal names it. One named by a value or an
  // expression is resolved when the call runs, and the mode it receives reaches its function then.
  if (arg === undefined || arg.kind !== 'literal' || typeof arg.predictableValue !== 'string') {
    return [];
  }
  const follows: WalkState[] = [];
  const followed = new Map<CallableInvocation, Set<string>>();
  for (const def of state.candidates) {
    // Skipped: this definition does not invoke the literal as a callable in a way the parser
    // knows: its name is not in the table, it takes a plain value at this position, or a call of
    // it written in the formula checks no literal there (`literalCheckAt`): a callable parameter
    // that is not literal-only, or an argument past the first of a variadic callable parameter
    // that lists no admitted values. The walk follows exactly the callables a written call checks;
    // one it skips is resolved when the call runs, with the mode it receives.
    const check = literalCheckAt(def.params, position, walk.lists.list);
    const invocation = invocationOf(def);
    if (check === undefined || invocation === undefined) continue;
    const target = stripNullability(check.param.type);
    if (target.kind !== 'callable') continue;
    // Skipped: an invocation already followed with this reference kind reaches the same callables.
    const kinds = followed.get(invocation) ?? new Set<string>();
    if (kinds.has(target.reference)) continue;
    followed.set(invocation, kinds.add(target.reference));
    follows.push({
      host: def,
      candidates: callableCandidates(walk.registry, target.reference, arg.predictableValue),
      sources: passedSources(invocation, state.sources),
      named: { index: source, span: arg.span },
      depth: state.depth + 1,
    });
  }
  return follows;
}

/**
 * Reports `refusal` unless the walk has reported the same target refusing the same value at the
 * same literal, which every state that passes that literal on to that target reaches: the states
 * share one report, decided before its message is built, and the message is the target's, built
 * on the first report of the value anywhere in the parse.
 */
function reportRefusal(walk: CallWalk, refusal: Refusal): void {
  let values = walk.refused.get(refusal.target);
  if (values === undefined) {
    values = new Map();
    walk.refused.set(refusal.target, values);
  }
  let starts = values.get(refusal.value);
  if (starts === undefined) {
    starts = new Set();
    values.set(refusal.value, starts);
  }
  if (starts.has(refusal.span?.start)) return;
  starts.add(refusal.span?.start);
  report(walk, refusalError(refusal));
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
