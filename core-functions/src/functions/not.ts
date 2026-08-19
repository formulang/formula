import type {
  BaseFunctionConfig,
  BatchEvaluationCall,
  FormulaExecutionContext,
  FunctionImplementation,
} from '@formulang/definitions';
import { makeError, makeOkBoolean } from '@formulang/definitions';

function normalizeBooleanLike(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return null;
}

export class NotImplementation implements FunctionImplementation {
  constructor(private readonly config: BaseFunctionConfig) {
    void config;
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }

  async evaluateMultiple(calls: BatchEvaluationCall[], _ctx: FormulaExecutionContext) {
    const outs = [];
    for (const call of calls) {
      const first = call.args[0];
      const child = first ? await first.output() : null;
      const v = normalizeBooleanLike(child?.value);
      if (v === null) {
        outs.push(
          makeError('NOT', {
            kind: 'runtime',
            code: 'TYPE',
            message: 'Expected boolean-like value',
            signatureId: this.config.signatureId,
          }),
        );
        continue;
      }
      outs.push(makeOkBoolean('NOT', !v, { signatureId: this.config.signatureId }));
    }
    return outs;
  }
}
