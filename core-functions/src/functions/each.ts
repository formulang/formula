import type {
  BaseFunctionConfig,
  BatchEvaluationCall,
  FormulaExecutionContext,
  FormulaValueProvider,
  FunctionImplementation,
} from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaRuntimeError,
  makeOkList,
  makeOkNull,
  makeOkUnknown,
} from '@formulang/definitions';
import { assumedListLength } from './helpers';

function constProvider(value: unknown): FormulaValueProvider {
  const out = makeOkUnknown('const', value);
  return {
    output: async () => out,
    value: async () => value ?? null,
  };
}

export class EachImplementation implements FunctionImplementation {
  constructor(private readonly config: BaseFunctionConfig) {
    void config;
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.0004 + 0.00005 * assumedListLength(args[0]);
  }

  async evaluateMultiple(calls: BatchEvaluationCall[], ctx: FormulaExecutionContext) {
    const outs = [];
    for (const call of calls) {
      const target = (await call.args[0]?.output())?.value;
      const opName = (await call.args[1]?.output())?.value;

      if (target == null) {
        outs.push(makeOkNull('EACH', { signatureId: this.config.signatureId }));
        continue;
      }
      if (!Array.isArray(target) || typeof opName !== 'string') {
        outs.push(makeOkNull('EACH', { signatureId: this.config.signatureId }));
        continue;
      }

      if (target.length > ctx.limits.maxListLength) {
        throw new FormulaRuntimeError(
          FormulaErrorCodes.LIST_TOO_LARGE,
          'List is too large',
          'security',
        );
      }

      // Evaluate the extra args once and reuse as constants for each item call.
      const restOutputs = await Promise.all(call.args.slice(2).map((p) => p.output()));
      const restConstProviders = restOutputs.map((o) => constProvider(o.value));

      let chosenSignatureId: string | undefined;
      const op = ctx.registry.getOperator(opName);
      if (op) {
        chosenSignatureId = op.functionSignatureId;
      } else {
        const candidates = ctx.registry.listFunctionsByName(opName);
        if (candidates.length === 0) {
          outs.push(makeOkNull('EACH', { signatureId: this.config.signatureId }));
          continue;
        }
        const withImpl = candidates.find((c) => ctx.resolver.get(c.signatureId) != null);
        chosenSignatureId = (withImpl ?? candidates[0]).signatureId;
      }

      const chosenImpl = chosenSignatureId ? ctx.resolver.get(chosenSignatureId) : undefined;
      if (!chosenImpl) {
        outs.push(makeOkNull('EACH', { signatureId: this.config.signatureId }));
        continue;
      }

      const itemCalls: BatchEvaluationCall[] = target.map((item, idx) => {
        ctx.budget.consume(1);
        return {
          args: [constProvider(item), ...restConstProviders],
          callId: `${idx}`,
        };
      });

      const itemOuts = await chosenImpl.evaluateMultiple(itemCalls, ctx);
      const values = itemOuts.map((o) => o.value ?? null);
      outs.push(makeOkList('EACH', values, { signatureId: this.config.signatureId }));
    }
    return outs;
  }
}
