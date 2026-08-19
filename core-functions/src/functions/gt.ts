import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkBoolean, makeOkNull, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { coerceComparisonPair } from './helpers';

export class GtImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const [rawA, rawB] = args;
    const [a, b] = coerceComparisonPair(rawA, rawB);
    if (a == null || b == null) return makeOkNull('GT');
    if (typeof a === 'number' && typeof b === 'number') return makeOkBoolean('GT', a > b);
    if (typeof a === 'string' && typeof b === 'string') return makeOkBoolean('GT', a > b);
    return withWarnings(makeOkNull('GT'), [
      {
        code: 'TYPE',
        message: 'GT expects two comparable values (both numbers or both text)',
      },
    ]);
  }
}
