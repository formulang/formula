import type {
  BaseFunctionConfig,
  BatchEvaluationCall,
  FormulaExecutionContext,
  FunctionImplementation,
} from '@formulang/definitions';
import { makeError, makeOkUnknown } from '@formulang/definitions';

function normalizeBooleanLike(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return null;
}

export class IfImplementation implements FunctionImplementation {
  constructor(private readonly config: BaseFunctionConfig) {
    void config;
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }

  async evaluateMultiple(calls: BatchEvaluationCall[], _ctx: FormulaExecutionContext) {
    const outs = [];
    for (const call of calls) {
      const condProvider = call.args[0];
      const thenProvider = call.args[1];
      const elseProvider = call.args[2];

      const condOut = condProvider ? await condProvider.output() : null;
      const cond = normalizeBooleanLike(condOut?.value);
      if (cond === null) {
        outs.push(
          makeError('IF', {
            kind: 'runtime',
            code: 'TYPE',
            message: 'Expected boolean-like condition',
            signatureId: this.config.signatureId,
          }),
        );
        continue;
      }

      const chosen = cond ? thenProvider : elseProvider;
      const chosenOut = chosen ? await chosen.output() : null;
      outs.push(
        makeOkUnknown('IF', chosenOut?.value ?? null, { signatureId: this.config.signatureId }),
      );
    }
    return outs;
  }
}
