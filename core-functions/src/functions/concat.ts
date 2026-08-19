import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkNull, makeOkText, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asText, assumedTextLength, isEmptyValue } from './helpers';

export class ConcatImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    let total = 0;
    for (const a of args) total += assumedTextLength(a);
    return Math.min(0.01, 0.000002 * total);
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    let out = '';
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const t = asText(a);
      if (t == null) {
        if (!isEmptyValue(a)) {
          return withWarnings(makeOkNull('CONCAT'), [
            {
              code: 'TYPE',
              message: 'CONCAT expects text values',
              meta: { index: i, got: Array.isArray(a) ? 'array' : typeof a },
            },
          ]);
        }
        return makeOkNull('CONCAT');
      }
      out += t;
    }
    return makeOkText('CONCAT', out);
  }
}
