import type {
  BaseFunctionConfig,
  BatchEvaluationCall,
  FormulaExecutionContext,
  FormulaNodeOutput,
  FormulaValueProvider,
  FunctionImplementation,
} from '@formulang/definitions';
import { makeOkList, makeOkNull, makeOkUnknown, withWarnings } from '@formulang/definitions';
import { listTooLarge } from './argument-readers';

function constProvider(value: unknown): FormulaValueProvider {
  const out = makeOkUnknown('const', value);
  return {
    output: async () => out,
    value: async () => value ?? null,
  };
}

/**
 * The implementation `FILTER_BY` calls, found as `FILTER` finds its operator's: the function behind
 * an operator token, otherwise the first function of that name that has an implementation. That
 * need not be the overload the parser checked for the types of the keys and of the operator value,
 * which is why the parser checks a literal the call passes on against every overload of the name.
 */
function resolveCallable(
  ctx: FormulaExecutionContext,
  name: string,
): FunctionImplementation | undefined {
  const operator = ctx.registry.getOperator(name);
  if (operator) return ctx.resolver.get(operator.functionSignatureId);
  for (const def of ctx.registry.listFunctionsByName(name)) {
    const implementation = ctx.resolver.get(def.signatureId);
    if (implementation) return implementation;
  }
  return undefined;
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

      // The arguments in order, each in full: null, then the type, then the bound.
      const typeRefusal = withWarnings(makeOkNull('FILTER_BY', meta), [
        { code: 'TYPE', message: 'FILTER_BY expects (list, keys, operator)' },
      ]);
      if (target == null) {
        outs.push(makeOkNull('FILTER_BY', meta));
        continue;
      }
      if (!Array.isArray(target)) {
        outs.push(typeRefusal);
        continue;
      }
      if (target.length > ctx.limits.maxListLength) throw listTooLarge();
      if (keys == null) {
        outs.push(makeOkNull('FILTER_BY', meta));
        continue;
      }
      if (!Array.isArray(keys)) {
        outs.push(typeRefusal);
        continue;
      }
      if (keys.length > ctx.limits.maxListLength) throw listTooLarge();
      if (typeof opName !== 'string') {
        outs.push(typeRefusal);
        continue;
      }
      if (target.length !== keys.length) {
        outs.push(
          withWarnings(makeOkNull('FILTER_BY', meta), [
            { code: 'TYPE', message: 'FILTER_BY expects as many keys as list items' },
          ]),
        );
        continue;
      }

      const chosenImpl = resolveCallable(ctx, opName);
      if (!chosenImpl) {
        outs.push(
          withWarnings(makeOkNull('FILTER_BY', meta), [
            {
              code: 'TYPE',
              message: `FILTER_BY found no implementation of ${JSON.stringify(opName)}`,
            },
          ]),
        );
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
