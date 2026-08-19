import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkNull, makeOkNumber, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asText, assumedListLength, assumedTextLength, isEmptyValue } from './helpers';

export class LenTextImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return Math.min(0.001, 0.000001 * assumedTextLength(args[0]));
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    const t = asText(raw);
    if (t == null) {
      if (!isEmptyValue(raw)) {
        return withWarnings(makeOkNull('LEN'), [{ code: 'TYPE', message: 'LEN expects text' }]);
      }
      return makeOkNull('LEN');
    }
    return makeOkNumber('LEN', t.length);
  }
}

export class LenListImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return Math.min(0.001, 0.000002 * assumedListLength(args[0]));
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const v = args[0];
    if (v == null) return makeOkNull('LEN');
    if (!Array.isArray(v)) {
      if (!isEmptyValue(v)) {
        return withWarnings(makeOkNull('LEN'), [{ code: 'TYPE', message: 'LEN expects a list' }]);
      }
      return makeOkNull('LEN');
    }
    return makeOkNumber('LEN', v.length);
  }
}
