import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkBoolean, makeOkNull, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asText, isEmptyValue } from './helpers';

export class EndsWithImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    const t = typeof args[0] === 'string' ? args[0] : '';
    return Math.min(0.005, 0.000001 * t.length);
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const rawT = args[0];
    const rawN = args[1];
    const t = asText(rawT);
    const n = asText(rawN);
    if (t == null || n == null) {
      const warnings = [] as Array<{
        code: string;
        message: string;
        meta?: Record<string, unknown>;
      }>;
      if (!isEmptyValue(rawT) && t == null)
        warnings.push({ code: 'TYPE', message: 'ENDS_WITH expects text', meta: { arg: 'text' } });
      if (!isEmptyValue(rawN) && n == null)
        warnings.push({ code: 'TYPE', message: 'ENDS_WITH expects text', meta: { arg: 'needle' } });
      const out = makeOkNull('ENDS_WITH');
      return warnings.length > 0 ? withWarnings(out, warnings) : out;
    }
    return makeOkBoolean('ENDS_WITH', t.endsWith(n));
  }
}
