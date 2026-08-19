import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkNull, makeOkNumber, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asNumber, isEmptyValue } from './helpers';

export class MulImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const rawA = args[0];
    const rawB = args[1];
    const a = asNumber(rawA);
    const b = asNumber(rawB);
    if (a == null || b == null) {
      const warnings = [] as Array<{
        code: string;
        message: string;
        meta?: Record<string, unknown>;
      }>;
      if (!isEmptyValue(rawA) && a == null)
        warnings.push({ code: 'TYPE', message: 'MUL expects numbers', meta: { arg: 'a' } });
      if (!isEmptyValue(rawB) && b == null)
        warnings.push({ code: 'TYPE', message: 'MUL expects numbers', meta: { arg: 'b' } });
      const out = makeOkNull('MUL');
      return warnings.length > 0 ? withWarnings(out, warnings) : out;
    }
    const v = a * b;
    return Number.isFinite(v) ? makeOkNumber('MUL', v) : makeOkNull('MUL');
  }
}
