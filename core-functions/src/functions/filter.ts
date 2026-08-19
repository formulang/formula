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

function constProvider(value: unknown): FormulaValueProvider {
  const out = makeOkUnknown('const', value);
  return {
    output: async () => out,
    value: async () => value ?? null,
  };
}

export class FilterImplementation implements FunctionImplementation {
  constructor(private readonly config: BaseFunctionConfig) {
    void config;
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.0003 + 0.00005 * (Array.isArray(args[0]) ? args[0].length : 10);
  }

  async evaluateMultiple(calls: BatchEvaluationCall[], ctx: FormulaExecutionContext) {
    const outs = [];
    for (const call of calls) {
      const target = (await call.args[0]?.output())?.value;
      const opName = (await call.args[1]?.output())?.value;
      const hasOpValue = call.args.length >= 3;
      const opValue = hasOpValue ? (await call.args[2]?.output())?.value : undefined;

      if (target == null) {
        outs.push(makeOkNull('FILTER', { signatureId: this.config.signatureId }));
        continue;
      }
      if (!Array.isArray(target) || typeof opName !== 'string') {
        outs.push(makeOkNull('FILTER', { signatureId: this.config.signatureId }));
        continue;
      }

      if (target.length > ctx.limits.maxListLength) {
        throw new FormulaRuntimeError(
          FormulaErrorCodes.LIST_TOO_LARGE,
          'List is too large',
          'security',
        );
      }

      let chosenSignatureId: string | undefined;
      const op = ctx.registry.getOperator(opName);
      if (op) {
        chosenSignatureId = op.functionSignatureId;
      } else {
        const candidates = ctx.registry.listFunctionsByName(opName);
        if (candidates.length === 0) {
          outs.push(makeOkNull('FILTER', { signatureId: this.config.signatureId }));
          continue;
        }
        const chosenDef =
          (opValue !== undefined
            ? candidates.find(
                (c) => c.params.length >= 2 || c.params[c.params.length - 1]?.variadic,
              )
            : candidates.find((c) => c.params.length >= 1)) ?? candidates[0];
        const withImpl = candidates.find((c) => ctx.resolver.get(c.signatureId) != null);
        chosenSignatureId = (withImpl ?? chosenDef).signatureId;
      }

      const chosenImpl = chosenSignatureId ? ctx.resolver.get(chosenSignatureId) : undefined;
      if (!chosenImpl) {
        outs.push(makeOkNull('FILTER', { signatureId: this.config.signatureId }));
        continue;
      }

      const opValueProvider = opValue !== undefined ? constProvider(opValue) : undefined;
      const predicateCalls: BatchEvaluationCall[] = target.map((item, idx) => {
        ctx.budget.consume(1);
        return {
          args: opValueProvider ? [constProvider(item), opValueProvider] : [constProvider(item)],
          callId: `${idx}`,
        };
      });

      const predicateOuts = await chosenImpl.evaluateMultiple(predicateCalls, ctx);
      const out: unknown[] = [];
      for (let i = 0; i < target.length; i++) {
        if (predicateOuts[i]?.value === true) out.push(target[i]);
      }
      outs.push(makeOkList('FILTER', out, { signatureId: this.config.signatureId }));
    }
    return outs;
  }
}
