import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkNull, makeOkNumber, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asNumber, assumedListLength, isEmptyValue } from './helpers';

export class MedianImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    // Sorting dominates; keep conservative but small.
    const n = assumedListLength(args[0]);
    return 0.00001 * n * Math.max(1, Math.log2(Math.max(2, n)));
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const v = args[0];
    if (v == null) return makeOkNull('MEDIAN');
    if (!Array.isArray(v)) {
      if (!isEmptyValue(v)) {
        return withWarnings(makeOkNull('MEDIAN'), [
          {
            code: 'TYPE',
            message: 'MEDIAN expects a list of numbers',
            meta: { got: Array.isArray(v) ? 'array' : typeof v },
          },
        ]);
      }
      return makeOkNull('MEDIAN');
    }

    const nums: number[] = [];
    for (const item of v) {
      if (item == null) continue;
      const n = asNumber(item);
      if (n == null) {
        return withWarnings(makeOkNull('MEDIAN'), [
          {
            code: 'TYPE',
            message: 'MEDIAN expects a list of numbers',
            meta: { itemType: Array.isArray(item) ? 'array' : typeof item },
          },
        ]);
      }
      nums.push(n);
    }

    if (nums.length === 0) {
      return withWarnings(makeOkNull('MEDIAN'), [
        { code: 'EMPTY', message: 'MEDIAN was called with an empty list' },
      ]);
    }

    nums.sort((a, b) => a - b);
    const mid = Math.floor(nums.length / 2);
    const out = nums.length % 2 === 1 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;

    return Number.isFinite(out) ? makeOkNumber('MEDIAN', out) : makeOkNull('MEDIAN');
  }
}
