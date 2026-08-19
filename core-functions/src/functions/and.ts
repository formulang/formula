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

export class AndImplementation implements FunctionImplementation {
  constructor(private readonly config: BaseFunctionConfig) {
    void config;
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.0001 * args.length;
  }

  async evaluateMultiple(calls: BatchEvaluationCall[], _ctx: FormulaExecutionContext) {
    const outs = [];
    for (const call of calls) {
      if (call.args.length === 0) {
        outs.push(makeOkBoolean('AND', true, { signatureId: this.config.signatureId }));
        continue;
      }

      let out: ReturnType<typeof makeOkBoolean> | ReturnType<typeof makeError> | null = null;
      for (const provider of call.args) {
        const child = await provider.output();
        const v = normalizeBooleanLike(child.value);
        if (v === null) {
          out = makeError('AND', {
            kind: 'runtime',
            code: 'TYPE',
            message: 'Expected boolean-like value',
            signatureId: this.config.signatureId,
          });
          break;
        }
        if (v === false) {
          out = makeOkBoolean('AND', false, { signatureId: this.config.signatureId });
          break;
        }
      }

      outs.push(out ?? makeOkBoolean('AND', true, { signatureId: this.config.signatureId }));
    }
    return outs;
  }
}
