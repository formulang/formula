import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkNull, makeOkNumber, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asNumber, isEmptyValue } from './helpers';

export class PowImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const rawBase = args[0];
    const rawExponent = args[1];
    const base = asNumber(rawBase);
    const exponent = asNumber(rawExponent);

    if (base == null || exponent == null) {
      const warnings = [] as Array<{
        code: string;
        message: string;
        meta?: Record<string, unknown>;
      }>;
      if (!isEmptyValue(rawBase) && base == null)
        warnings.push({
          code: 'TYPE',
          message: 'POW expects numbers',
          meta: { arg: 'base' },
        });
      if (!isEmptyValue(rawExponent) && exponent == null)
        warnings.push({
          code: 'TYPE',
          message: 'POW expects numbers',
          meta: { arg: 'exponent' },
        });
      const out = makeOkNull('POW');
      return warnings.length > 0 ? withWarnings(out, warnings) : out;
    }

    const v = Math.pow(base, exponent);
    return Number.isFinite(v) ? makeOkNumber('POW', v) : makeOkNull('POW');
  }
}
