import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkNull, makeOkNumber, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asNumber, isEmptyValue } from './helpers';

export class RangeScoreImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const rawValue = args[0];
    const rawBadMin = args[1];
    const rawWarnMin = args[2];
    const rawWarnMax = args[3];
    const rawBadMax = args[4];

    const value = asNumber(rawValue);
    const badMin = asNumber(rawBadMin);
    const warnMin = asNumber(rawWarnMin);
    const warnMax = asNumber(rawWarnMax);
    const badMax = asNumber(rawBadMax);

    if (value == null || badMin == null || warnMin == null || warnMax == null || badMax == null) {
      const warnings = [] as Array<{
        code: string;
        message: string;
        meta?: Record<string, unknown>;
      }>;
      if (!isEmptyValue(rawValue) && value == null)
        warnings.push({
          code: 'TYPE',
          message: 'RANGE_SCORE expects numbers',
          meta: { arg: 'value' },
        });
      if (!isEmptyValue(rawBadMin) && badMin == null)
        warnings.push({
          code: 'TYPE',
          message: 'RANGE_SCORE expects numbers',
          meta: { arg: 'bad_min' },
        });
      if (!isEmptyValue(rawWarnMin) && warnMin == null)
        warnings.push({
          code: 'TYPE',
          message: 'RANGE_SCORE expects numbers',
          meta: { arg: 'warn_min' },
        });
      if (!isEmptyValue(rawWarnMax) && warnMax == null)
        warnings.push({
          code: 'TYPE',
          message: 'RANGE_SCORE expects numbers',
          meta: { arg: 'warn_max' },
        });
      if (!isEmptyValue(rawBadMax) && badMax == null)
        warnings.push({
          code: 'TYPE',
          message: 'RANGE_SCORE expects numbers',
          meta: { arg: 'bad_max' },
        });
      const out = makeOkNull('RANGE_SCORE');
      return warnings.length > 0 ? withWarnings(out, warnings) : out;
    }

    if (!(badMin <= warnMin && warnMin <= warnMax && warnMax <= badMax)) {
      return withWarnings(makeOkNull('RANGE_SCORE'), [
        {
          code: 'RANGE',
          message: 'RANGE_SCORE requires bad_min <= warn_min <= warn_max <= bad_max',
        },
      ]);
    }
    if (badMin === warnMin && warnMax === badMax) {
      return makeOkNumber('RANGE_SCORE', value >= warnMin && value <= warnMax ? 1 : 0);
    }
    if (value <= badMin) return makeOkNumber('RANGE_SCORE', 0);
    if (value >= badMax) return makeOkNumber('RANGE_SCORE', 0);
    if (value >= warnMin && value <= warnMax) return makeOkNumber('RANGE_SCORE', 1);
    if (value < warnMin) {
      const denom = warnMin - badMin;
      if (denom === 0) return makeOkNumber('RANGE_SCORE', 0);
      const out = (value - badMin) / denom;
      return Number.isFinite(out) ? makeOkNumber('RANGE_SCORE', out) : makeOkNull('RANGE_SCORE');
    }
    if (value > warnMax) {
      const denom = badMax - warnMax;
      if (denom === 0) return makeOkNumber('RANGE_SCORE', 0);
      const out = (badMax - value) / denom;
      return Number.isFinite(out) ? makeOkNumber('RANGE_SCORE', out) : makeOkNull('RANGE_SCORE');
    }
    return makeOkNull('RANGE_SCORE');
  }
}
