import type { FormulaType } from '@formulang/definitions';
import { FormulaTypes, stripNullability } from '@formulang/definitions';

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
  return invocation.flatMap((source): InvokedArgument[] => {
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
}

/**
 * How the core higher-order functions invoke their callables, keyed by function name in upper
 * case, as 1.0.0 keyed this validation for EACH, FILTER, FILTER_PROPERTY and REDUCE. Every
 * definition under one of these names gets the entry: the core one, the core one re-registered
 * under another signature id (the documented way to change a function's behaviour), and a host's;
 * a definition under any other name invokes nothing the parser knows, so a copy of one of these
 * functions under a new name is a plain function. The table is closed: a definition cannot add to
 * it. Specs reconcile it, both ways, with every core definition that has a callable parameter,
 * and check that every entry passes the callable fewer arguments than its call holds whenever it
 * passes one on, which ends the parser's walk through nested callables.
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
 * How the higher-order function `def` invokes its callable: the table's entry for its name;
 * undefined for any other function.
 */
export function invocationOf(def: { name: string }): CallableInvocation | undefined {
  return INVOCATIONS_BY_NAME.get(def.name.toUpperCase());
}

/**
 * The key of one state of the parser's walk through nested callables: the formula argument that
 * names the callable, the name of the function that invokes it, the definitions the name can
 * reference, and the formula argument each position receives (`undefined` for a value the
 * function supplies). Distinct states have distinct keys, the number of positions included.
 */
export function walkStateKey(state: {
  named: number;
  host: string;
  candidates: readonly string[];
  sources: readonly (number | undefined)[];
}): string {
  return JSON.stringify([
    state.named,
    state.host,
    state.candidates,
    state.sources.map((source) => source ?? null),
  ]);
}
