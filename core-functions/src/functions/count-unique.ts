import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkNumber } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { isEmptyValue, toComparableKey } from './helpers';

export class CountUniqueImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.00005 * args.length;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const seen = new Set<unknown>();
    for (const v of args) {
      if (isEmptyValue(v)) continue;
      seen.add(toComparableKey(v));
    }
    return makeOkNumber('COUNT_UNIQUE', seen.size);
  }
}
