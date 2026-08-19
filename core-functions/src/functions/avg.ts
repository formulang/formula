import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkNull, makeOkNumber, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asNumber, assumedListLength, isEmptyValue } from './helpers';

export class AvgImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.00005 * assumedListLength(args[0]);
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const v = args[0];
    if (v == null) return makeOkNull('AVG');
    if (!Array.isArray(v)) {
      if (!isEmptyValue(v)) {
        return withWarnings(makeOkNull('AVG'), [
          {
            code: 'TYPE',
            message: 'AVG expects a list of numbers',
            meta: { got: Array.isArray(v) ? 'array' : typeof v },
          },
        ]);
      }
      return makeOkNull('AVG');
    }
    let sum = 0;
    let count = 0;
    for (const item of v) {
      if (item == null) continue;
      const n = asNumber(item);
      if (n == null) {
        return withWarnings(makeOkNull('AVG'), [
          {
            code: 'TYPE',
            message: 'AVG expects a list of numbers',
            meta: { itemType: Array.isArray(item) ? 'array' : typeof item },
          },
        ]);
      }
      sum += n;
      count++;
    }
    if (count === 0) {
      return withWarnings(makeOkNull('AVG'), [
        { code: 'EMPTY', message: 'AVG was called with an empty list' },
      ]);
    }
    const out = sum / count;
    return Number.isFinite(out) ? makeOkNumber('AVG', out) : makeOkNull('AVG');
  }
}
