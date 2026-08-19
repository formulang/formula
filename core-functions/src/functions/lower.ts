import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkNull, makeOkText, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asText, assumedTextLength, isEmptyValue } from './helpers';

export class LowerImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return Math.min(0.002, 0.000001 * assumedTextLength(args[0]));
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    const t = asText(raw);
    if (t == null) {
      if (!isEmptyValue(raw)) {
        return withWarnings(makeOkNull('LOWER'), [{ code: 'TYPE', message: 'LOWER expects text' }]);
      }
      return makeOkNull('LOWER');
    }
    return makeOkText('LOWER', t.toLowerCase());
  }
}
