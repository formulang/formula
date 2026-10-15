import type { FormulaType } from '@formulang/definitions';
import { FormulaTypes, stripNullability } from '@formulang/definitions';
import { chargeWork } from './work-trace';

/**
 * One argument a higher-order function passes to the callable it names: its type, and the index
 * of the call argument it forwards unchanged. `forwards` is absent for a value the higher-order
 * function supplies at run time: a list item, a key, a property value, an accumulator.
 */
export type InvokedArgument = { type: FormulaType; forwards?: number };

/**
 * One argument a higher-order function passes to the function its callable parameter names, by
 * where the value comes from; every index is the position of an argument in the call.
 * - `item`: an item of the list the call passes at `of`.
 * - `argument`: the call's argument at `at`, passed on unchanged; nothing when the call omits it.
 * - `arguments`: every call argument from `from` on, each passed on unchanged.
 * - `value`: a value the function supplies when it runs, typed as the call's argument at `typeOf`,
 *   or of any type without it.
 */
export type InvokedSource =
  | { kind: 'item'; of: number }
  | { kind: 'argument'; at: number }
  | { kind: 'arguments'; from: number }
  | { kind: 'value'; typeOf?: number };

/** How a higher-order function invokes its callable: the arguments it passes, in order. */
export type CallableInvocation = readonly InvokedSource[];

function itemOf(listType: FormulaType | undefined): FormulaType {
  const base = stripNullability(listType ?? FormulaTypes.any(true));
  return base.kind === 'list' ? base.of : FormulaTypes.any(true);
}

/** The call argument at `index`, forwarded unchanged; nothing when the call omits it. */
function forwarded(argTypes: readonly FormulaType[], index: number): InvokedArgument[] {
  const type = argTypes[index];
  return type === undefined ? [] : [{ type, forwards: index }];
}

/** The call arguments from `index` on, each forwarded unchanged. */
function forwardedFrom(argTypes: readonly FormulaType[], index: number): InvokedArgument[] {
  return argTypes.slice(index).map((type, offset) => ({ type, forwards: index + offset }));
}

/** The arguments `invocation` passes to the callable of a call with these argument types. */
export function invokedArguments(
  invocation: CallableInvocation,
  argTypes: readonly FormulaType[],
): InvokedArgument[] {
  const invoked = invocation.flatMap((source): InvokedArgument[] => {
    switch (source.kind) {
      case 'item':
        return [{ type: itemOf(argTypes[source.of]) }];
      case 'argument':
        return forwarded(argTypes, source.at);
      case 'arguments':
        return forwardedFrom(argTypes, source.from);
      case 'value': {
        const type = source.typeOf === undefined ? undefined : argTypes[source.typeOf];
        return [{ type: type ?? FormulaTypes.any(true) }];
      }
    }
  });
  chargeWork('arguments', invoked.length);
  return invoked;
}

/**
 * Where each argument a callable receives comes from, along a chain of higher-order calls that
 * starts at a call written in the formula: an argument of that call (its index) or a value a
 * higher-order function supplies when it runs (`undefined`). `head` holds the first ones; the
 * written call's arguments from `from` up to `end` follow them. An `arguments` entry passes a
 * chain's tail on as that range instead of copying it, so the description of what a callable
 * receives stays as short as the table's entries, however many arguments the call holds.
 */
export type PassedSources = {
  readonly head: readonly (number | undefined)[];
  readonly from: number;
  readonly end: number;
};

/** What a call written in the formula with `count` arguments receives: each of them, in order. */
export function writtenArguments(count: number): PassedSources {
  return { head: [], from: 0, end: count };
}

/** How many arguments `sources` describes. */
export function sourceCount(sources: PassedSources): number {
  return sources.head.length + sources.end - sources.from;
}

/** Where argument `position` of `sources` comes from; `position` is below `sourceCount`. */
export function sourceAt(sources: PassedSources, position: number): number | undefined {
  return position < sources.head.length
    ? sources.head[position]
    : sources.from + position - sources.head.length;
}

/**
 * Where each argument `invocation` passes its callable comes from, for a higher-order function
 * that receives `sources`: what `invokedArguments` forwards, followed through `sources` (a spec
 * reconciles the two). An `arguments` entry is the last of its invocation, which a spec checks for
 * every entry, so the arguments it passes on stay one range.
 */
export function passedSources(
  invocation: CallableInvocation,
  sources: PassedSources,
): PassedSources {
  const count = sourceCount(sources);
  const head: (number | undefined)[] = [];
  for (const source of invocation) {
    switch (source.kind) {
      case 'item':
      case 'value':
        head.push(undefined);
        break;
      case 'argument':
        if (source.at < count) head.push(sourceAt(sources, source.at));
        break;
      case 'arguments': {
        const skipped = Math.max(0, source.from - sources.head.length);
        head.push(...sources.head.slice(source.from));
        return canonical(head, sources.from + skipped, sources.end);
      }
    }
  }
  return canonical(head, sources.end, sources.end);
}

/**
 * `head` and the written arguments from `from` up to `end`, described one way only: a written
 * argument at the end of `head` that the range would continue joins the range. Two descriptions of
 * the same arguments are then equal, and so are their walk states.
 */
function canonical(head: (number | undefined)[], from: number, end: number): PassedSources {
  let start = Math.min(from, end);
  while (head.length > 0 && head[head.length - 1] === start - 1) {
    head.pop();
    start--;
  }
  return { head, from: start, end };
}

/**
 * How the core higher-order functions invoke their callables, keyed by function name in upper
 * case, as 1.0.0 keyed this validation for EACH, FILTER, FILTER_PROPERTY and REDUCE. Every
 * definition whose name is one of these gets the entry: the core one, the core one re-registered
 * under another signature id (the documented way to change a function's behaviour), and a host's;
 * a definition under any other name invokes nothing the parser knows, so a copy of one of these
 * functions under a new name is a plain function, and so is a definition that answers to one of
 * these names only through its `aliases`, as on 1.0.0. The table is closed: a definition cannot add
 * to it. Specs reconcile it, both ways, with every core definition that has a callable parameter,
 * with the implementations of those functions (what each passes its callable when it runs, at every
 * count of arguments), with what the parser does (each function registered again under another
 * signature id parses alike, and a call's type follows its result rule or, without one, the type a
 * plain copy gets), with the enumerated-literal matrix and with the compatibility harness, and check
 * that every entry passes the callable fewer arguments than its call holds whenever it passes one
 * on.
 */
export const INVOCATIONS_BY_NAME: ReadonlyMap<string, CallableInvocation> = new Map<
  string,
  CallableInvocation
>([
  // EACH(target; operator; args...) calls operator(item; args...).
  [
    'EACH',
    [
      { kind: 'item', of: 0 },
      { kind: 'arguments', from: 2 },
    ],
  ],
  // FILTER(target; operator; operatorValue?) calls operator(item[; operatorValue]).
  [
    'FILTER',
    [
      { kind: 'item', of: 0 },
      { kind: 'argument', at: 2 },
    ],
  ],
  // FILTER_PROPERTY(target; property; operator; operatorValue?) calls
  // operator(item.property[; operatorValue]).
  ['FILTER_PROPERTY', [{ kind: 'value' }, { kind: 'argument', at: 3 }]],
  // REDUCE(initial; target; operator) calls operator(accumulator; item).
  [
    'REDUCE',
    [
      { kind: 'value', typeOf: 0 },
      { kind: 'item', of: 1 },
    ],
  ],
  // FILTER_BY(target; keys; operator; operatorValue?) calls operator(key[; operatorValue]), the key
  // taken from `keys` at the item's position.
  [
    'FILTER_BY',
    [
      { kind: 'item', of: 1 },
      { kind: 'argument', at: 3 },
    ],
  ],
]);

/**
 * How a call of a higher-order function is typed by name, as 1.0.0 typed it: `items`, a list of the
 * items of the list its first argument holds (the filters); `results`, a list of what its callable,
 * named by its second argument, returns for the arguments the table's entry passes it (EACH). A
 * function of the table without a rule here (REDUCE, FILTER_BY) is typed by its definition.
 */
export const RESULTS_BY_NAME: ReadonlyMap<string, 'items' | 'results'> = new Map<
  string,
  'items' | 'results'
>([
  ['EACH', 'results'],
  ['FILTER', 'items'],
  ['FILTER_PROPERTY', 'items'],
]);

/**
 * How the higher-order function `def` invokes its callable: the table's entry for its name;
 * undefined for any other function.
 */
export function invocationOf(def: { name: string }): CallableInvocation | undefined {
  return INVOCATIONS_BY_NAME.get(def.name.toUpperCase());
}

/**
 * The key of one state of the parser's walk through nested callables: the formula argument that
 * names the callable, the name of the function that invokes it, the definitions the name can
 * reference, and where each argument it receives comes from. Distinct states have distinct keys,
 * and a key is as long as the table's entries and the definitions make it: it grows with neither
 * the call written in the formula nor the chain of callables.
 */
export function walkStateKey(state: {
  named: number;
  host: string;
  candidates: readonly string[];
  sources: PassedSources;
}): string {
  return JSON.stringify([
    state.named,
    state.host,
    state.candidates,
    state.sources.head.map((source) => source ?? null),
    state.sources.from,
    state.sources.end,
  ]);
}
