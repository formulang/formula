import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkNull, makeOkNumber, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asNumber, assumedListLength, isEmptyValue } from './helpers';

export class MaxImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.00005 * assumedListLength(args[0]);
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const v = args[0];
    if (v == null) return makeOkNull('MAX');
    if (!Array.isArray(v)) {
      if (!isEmptyValue(v)) {
        return withWarnings(makeOkNull('MAX'), [
          {
            code: 'TYPE',
            message: 'MAX expects a list of numbers',
            meta: { got: Array.isArray(v) ? 'array' : typeof v },
          },
        ]);
      }
      return makeOkNull('MAX');
    }

    let out: number | null = null;
    let count = 0;
    for (const item of v) {
      if (item == null) continue;
      const n = asNumber(item);
      if (n == null) {
        return withWarnings(makeOkNull('MAX'), [
          {
            code: 'TYPE',
            message: 'MAX expects a list of numbers',
            meta: { itemType: Array.isArray(item) ? 'array' : typeof item },
          },
        ]);
      }
      out = out == null ? n : Math.max(out, n);
      count++;
    }

    if (count === 0 || out == null) {
      return withWarnings(makeOkNull('MAX'), [
        { code: 'EMPTY', message: 'MAX was called with an empty list' },
      ]);
    }

    return Number.isFinite(out) ? makeOkNumber('MAX', out) : makeOkNull('MAX');
  }
}
