import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkList, makeOkNull, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { isEmptyValue } from './helpers';

export class ListImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.00005 * args.length;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    let seenType: string | null = null;
    for (const v of args) {
      if (isEmptyValue(v)) continue;
      const t = Array.isArray(v) ? 'array' : typeof v;
      if (!seenType) {
        seenType = t;
        continue;
      }
      if (t !== seenType) {
        return withWarnings(makeOkNull('LIST'), [
          {
            code: 'LIST_MIXED_TYPES',
            message: 'LIST requires all non-empty values to have the same type',
            meta: { expectedType: seenType, foundType: t },
          },
        ]);
      }
    }
    return makeOkList('LIST', args);
  }
}
