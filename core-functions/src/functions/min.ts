import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkNull, makeOkNumber, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asNumber, assumedListLength, isEmptyValue } from './helpers';

export class MinImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.00005 * assumedListLength(args[0]);
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const v = args[0];
    if (v == null) return makeOkNull('MIN');
    if (!Array.isArray(v)) {
      if (!isEmptyValue(v)) {
        return withWarnings(makeOkNull('MIN'), [
          {
            code: 'TYPE',
            message: 'MIN expects a list of numbers',
            meta: { got: Array.isArray(v) ? 'array' : typeof v },
          },
        ]);
      }
      return makeOkNull('MIN');
    }

    let out: number | null = null;
    let count = 0;
    for (const item of v) {
      if (item == null) continue;
      const n = asNumber(item);
      if (n == null) {
        return withWarnings(makeOkNull('MIN'), [
          {
            code: 'TYPE',
            message: 'MIN expects a list of numbers',
            meta: { itemType: Array.isArray(item) ? 'array' : typeof item },
          },
        ]);
      }
      out = out == null ? n : Math.min(out, n);
      count++;
    }

    if (count === 0 || out == null) {
      return withWarnings(makeOkNull('MIN'), [
        { code: 'EMPTY', message: 'MIN was called with an empty list' },
      ]);
    }

    return Number.isFinite(out) ? makeOkNumber('MIN', out) : makeOkNull('MIN');
  }
}
