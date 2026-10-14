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

/** Resolves the named callable as `FILTER` does: an operator token first, then a function name. */
function resolveCallable(
  ctx: FormulaExecutionContext,
  name: string,
  withOperatorValue: boolean,
): FunctionImplementation | undefined {
  const operator = ctx.registry.getOperator(name);
  if (operator) return ctx.resolver.get(operator.functionSignatureId);
  const candidates = ctx.registry.listFunctionsByName(name);
  if (candidates.length === 0) return undefined;
  const byArity =
    (withOperatorValue
      ? candidates.find((c) => c.params.length >= 2 || c.params[c.params.length - 1]?.variadic)
      : candidates.find((c) => c.params.length >= 1)) ?? candidates[0];
  const withImplementation = candidates.find((c) => ctx.resolver.get(c.signatureId) != null);
  return ctx.resolver.get((withImplementation ?? byArity).signatureId);
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

      const chosenImpl = resolveCallable(ctx, opName, opValue !== undefined);
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
