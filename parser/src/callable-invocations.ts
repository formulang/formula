import type { FormulaType } from '@formulang/definitions';
import { FormulaTypes, stripNullability } from '@formulang/definitions';

/**
 * One argument a higher-order function passes to the callable it names: its type, and the index
 * of the call argument it forwards unchanged. `forwards` is absent for a value the higher-order
 * function supplies at run time: a list item, a key, a property value, an accumulator.
 */
export type InvokedArgument = { type: FormulaType; forwards?: number };

/** The arguments a higher-order call passes to its callable, from the call's argument types. */
export type CallableInvocation = (argTypes: readonly FormulaType[]) => InvokedArgument[];

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

/**
 * How each core higher-order function invokes its callable, keyed by function name in upper case,
 * as 1.0.0 keyed this validation: a definition re-registered under another signature id with the
 * same name — the documented way to change a function's behaviour — keeps it. The parser derives a
 * callable's invoked arguments from this table alone and applies the referenced function's
 * parameter rules to every one of them; a spec reconciles the table with the names of every core
 * definition that has a callable parameter, both ways.
 */
export const CALLABLE_INVOCATIONS: ReadonlyMap<string, CallableInvocation> = new Map<
  string,
  CallableInvocation
>([
  // EACH(target; operator; args...) calls operator(item; args...).
  ['EACH', (argTypes) => [{ type: itemOf(argTypes[0]) }, ...forwardedFrom(argTypes, 2)]],
  // FILTER(target; operator; operatorValue?) calls operator(item[; operatorValue]).
  ['FILTER', (argTypes) => [{ type: itemOf(argTypes[0]) }, ...forwarded(argTypes, 2)]],
  // FILTER_PROPERTY(target; property; operator; operatorValue?) calls
  // operator(item.property[; operatorValue]).
  ['FILTER_PROPERTY', (argTypes) => [{ type: FormulaTypes.any(true) }, ...forwarded(argTypes, 3)]],
  // FILTER_BY(target; keys; operator; operatorValue?) calls operator(key[; operatorValue]).
  ['FILTER_BY', (argTypes) => [{ type: itemOf(argTypes[1]) }, ...forwarded(argTypes, 3)]],
  // REDUCE(initial; target; operator) calls operator(accumulator; item).
  [
    'REDUCE',
    (argTypes) => [{ type: argTypes[0] ?? FormulaTypes.any(true) }, { type: itemOf(argTypes[1]) }],
  ],
]);

/** How the higher-order function `def` names invokes its callable; undefined for any other. */
export function invocationOf(def: { name: string }): CallableInvocation | undefined {
  return CALLABLE_INVOCATIONS.get(def.name.toUpperCase());
}
