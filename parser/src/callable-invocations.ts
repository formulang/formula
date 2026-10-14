import type { FormulaType, InvokedArgumentDeclaration } from '@formulang/definitions';
import { FormulaTypes, stripNullability } from '@formulang/definitions';

/**
 * One argument a higher-order function passes to the callable it names: its type, and the index
 * of the call argument it forwards unchanged. `forwards` is absent for a value the higher-order
 * function supplies at run time: a list item, a key, a property value, an accumulator.
 */
export type InvokedArgument = { type: FormulaType; forwards?: number };

/** How a higher-order function invokes its callable: the arguments it passes, in order. */
export type CallableInvocation = readonly InvokedArgumentDeclaration[];

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
 * How the core higher-order functions of 1.0.0 invoke their callables, keyed by function name in
 * upper case, as 1.0.0 keyed this validation: a definition under one of these names that declares
 * no invocation — every 1.0.0 definition, the core one re-registered under another signature id
 * (the documented way to change a function's behaviour), a host's — keeps the treatment 1.0.0
 * gave it. A definition that declares its invocation (`callableInvocation`), as every higher-order
 * function added since does, is checked by its declaration under any name. Specs reconcile the
 * table and the declarations with every core definition that has a callable parameter, both ways,
 * and register every entry as a declaration, which holds the table to the registration rule.
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
]);

/**
 * How the higher-order function `def` invokes its callable: the invocation it declares, or, for a
 * definition that declares none (`null` included), the one 1.0.0 gave its name; undefined for any
 * other function.
 */
export function invocationOf(def: {
  name: string;
  callableInvocation?: CallableInvocation;
}): CallableInvocation | undefined {
  return def.callableInvocation ?? INVOCATIONS_BY_NAME.get(def.name.toUpperCase());
}
