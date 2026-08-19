import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkNull, makeOkNumber, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asNumber, assumedListLength, isEmptyValue } from './helpers';

export class SumImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.00005 * assumedListLength(args[0]);
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const v = args[0];
    if (v == null) return makeOkNull('SUM');
    if (!Array.isArray(v)) {
      if (!isEmptyValue(v)) {
        return withWarnings(makeOkNull('SUM'), [
          {
            code: 'TYPE',
            message: 'SUM expects a list of numbers',
            meta: { got: Array.isArray(v) ? 'array' : typeof v },
          },
        ]);
      }
      return makeOkNull('SUM');
    }

    let sum = 0;
    let count = 0;
    for (const item of v) {
      if (item == null) continue;
      const n = asNumber(item);
      if (n == null) {
        return withWarnings(makeOkNull('SUM'), [
          {
            code: 'TYPE',
            message: 'SUM expects a list of numbers',
            meta: { itemType: Array.isArray(item) ? 'array' : typeof item },
          },
        ]);
      }
      sum += n;
      count++;
    }

    if (count === 0) {
      return withWarnings(makeOkNull('SUM'), [
        { code: 'EMPTY', message: 'SUM was called with an empty list' },
      ]);
    }

    return Number.isFinite(sum) ? makeOkNumber('SUM', sum) : makeOkNull('SUM');
  }
}
