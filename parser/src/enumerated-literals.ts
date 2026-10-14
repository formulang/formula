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
  FormulaType,
  FunctionDefinition,
  FunctionParamDefinition,
  RuleNode,
  SourceSpan,
} from '@formulang/definitions';
import { FormulaErrorCodes, makeFormulaError, stripNullability } from '@formulang/definitions';
import {
  invocationOf,
  invokedArguments,
  walkStateKey,
  type CallableInvocation,
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
export function checkPassedArguments(
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
