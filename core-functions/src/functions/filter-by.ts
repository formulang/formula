import type {
  BaseFunctionConfig,
  BatchEvaluationCall,
  FormulaExecutionContext,
  FormulaNodeOutput,
  FormulaType,
  FormulaValueProvider,
  FunctionDefinition,
  FunctionImplementation,
} from '@formulang/definitions';
import {
  FormulaTypes,
  isAssignable,
  makeOkList,
  makeOkNull,
  makeOkUnknown,
  stripNullability,
  withWarnings,
} from '@formulang/definitions';
import { listTooLarge } from './argument-readers';

function constProvider(value: unknown): FormulaValueProvider {
  const out = makeOkUnknown('const', value);
  return {
    output: async () => out,
    value: async () => value ?? null,
  };
}

/** The type the parser binds for a value of this kind; a list's items are not inspected. */
function typeOfValue(value: unknown): FormulaType {
  if (typeof value === 'string') return FormulaTypes.text();
  if (typeof value === 'number') return FormulaTypes.number();
  if (typeof value === 'boolean') return FormulaTypes.boolean();
  if (Array.isArray(value)) return FormulaTypes.list(FormulaTypes.any(true));
  if (typeof value === 'object' && value !== null) {
    // The library's date and time values carry their object type's clarifier.
    const kind = Object.prototype.hasOwnProperty.call(value, '__formula_object_kind')
      ? (value as Record<string, unknown>).__formula_object_kind
      : undefined;
    return FormulaTypes.object(typeof kind === 'string' ? kind : '');
  }
  return FormulaTypes.any(true);
}

/** The type every non-null value has, when they share one; `any` otherwise. */
function typeOfValues(values: readonly unknown[]): FormulaType {
  let shared: FormulaType | null = null;
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const type = typeOfValue(value);
    if (shared === null) shared = type;
    else if (!isAssignable(type, shared) || !isAssignable(shared, type)) {
      return FormulaTypes.any(true);
    }
  }
  return shared ?? FormulaTypes.any(true);
}

/** Whether `def` takes arguments of these types, by the rule the parser chooses an overload by. */
function takes(def: FunctionDefinition, argTypes: readonly FormulaType[], typed: boolean): boolean {
  const required = def.params.filter((param) => param.optional !== true).length;
  if (argTypes.length < required) return false;
  const last = def.params[def.params.length - 1];
  if (last?.variadic !== true && argTypes.length > def.params.length) return false;
  if (!typed) return true;
  return argTypes.every((argType, index) => {
    const param = def.params[Math.min(index, def.params.length - 1)];
    if (param === undefined) return false;
    return (
      param.type.kind === 'any' ||
      isAssignable(stripNullability(argType), stripNullability(param.type))
    );
  });
}

/**
 * The implementation of the overload the parser checks for the types of the keys and the operator
 * value: of the definitions the name can reference (the operator's, then the functions of that
 * name), the first whose parameters take those types. Where no definition takes them (the parser
 * saw an `any` there), the first whose arity fits, which is the one the parser then checks.
 */
function resolveCallable(
  ctx: FormulaExecutionContext,
  name: string,
  keys: readonly unknown[],
  operatorValue: { value: unknown } | undefined,
): FunctionImplementation | undefined {
  const candidates: FunctionDefinition[] = [];
  const operator = ctx.registry.getOperator(name);
  const operatorDef = operator ? ctx.registry.getFunction(operator.functionSignatureId) : undefined;
  if (operatorDef) candidates.push(operatorDef);
  candidates.push(...ctx.registry.listFunctionsByName(name));
  const argTypes = [typeOfValues(keys)];
  if (operatorValue !== undefined) argTypes.push(typeOfValues([operatorValue.value]));
  const chosen =
    candidates.find((def) => takes(def, argTypes, true)) ??
    candidates.find((def) => takes(def, argTypes, false));
  return chosen === undefined ? undefined : ctx.resolver.get(chosen.signatureId);
}

/**
 * `FILTER_BY(list, keys, operator, operatorValue?)`: keeps the items of `list` whose key at the
 * same position in `keys` satisfies `operator(key)` or `operator(key, operatorValue)`.
 */
export class FilterByImplementation implements FunctionImplementation {
  constructor(private readonly config: BaseFunctionConfig) {
    void config;
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.0003 + 0.00005 * (Array.isArray(args[0]) ? args[0].length : 10);
  }

  async evaluateMultiple(
    calls: BatchEvaluationCall[],
    ctx: FormulaExecutionContext,
  ): Promise<FormulaNodeOutput[]> {
    const meta = { signatureId: this.config.signatureId };
    const outs: FormulaNodeOutput[] = [];
    for (const call of calls) {
      const target = (await call.args[0]?.output())?.value;
      const keys = (await call.args[1]?.output())?.value;
      const opName = (await call.args[2]?.output())?.value;
      const hasOpValue = call.args.length >= 4;
      const opValue = hasOpValue ? (await call.args[3]?.output())?.value : undefined;

      if (target == null || keys == null) {
        outs.push(makeOkNull('FILTER_BY', meta));
        continue;
      }
      if (!Array.isArray(target) || !Array.isArray(keys) || typeof opName !== 'string') {
        outs.push(
          withWarnings(makeOkNull('FILTER_BY', meta), [
            { code: 'TYPE', message: 'FILTER_BY expects (list, keys, operator)' },
          ]),
        );
        continue;
      }
      if (target.length > ctx.limits.maxListLength || keys.length > ctx.limits.maxListLength) {
        throw listTooLarge();
      }
      if (target.length !== keys.length) {
        outs.push(
          withWarnings(makeOkNull('FILTER_BY', meta), [
            { code: 'TYPE', message: 'FILTER_BY expects as many keys as list items' },
          ]),
        );
        continue;
      }

      const chosenImpl = resolveCallable(
        ctx,
        opName,
        keys,
        hasOpValue ? { value: opValue } : undefined,
      );
      if (!chosenImpl) {
        outs.push(makeOkNull('FILTER_BY', meta));
        continue;
      }

      const opValueProvider = opValue !== undefined ? constProvider(opValue) : undefined;
      const predicateCalls: BatchEvaluationCall[] = keys.map((key, idx) => {
        ctx.budget.consume(1);
        return {
          args: opValueProvider ? [constProvider(key), opValueProvider] : [constProvider(key)],
          callId: `${idx}`,
        };
      });
      const predicateOuts = await chosenImpl.evaluateMultiple(predicateCalls, ctx);
      const kept = target.filter((_item, i) => predicateOuts[i]?.value === true);
      outs.push(makeOkList('FILTER_BY', kept, meta));
    }
    return outs;
  }
}
