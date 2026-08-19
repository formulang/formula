import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkBoolean, makeOkNull, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { coerceComparisonPair } from './helpers';

export class GteImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const [rawA, rawB] = args;
    const [a, b] = coerceComparisonPair(rawA, rawB);
    if (a == null || b == null) return makeOkNull('GTE');
    if (typeof a === 'number' && typeof b === 'number') return makeOkBoolean('GTE', a >= b);
    if (typeof a === 'string' && typeof b === 'string') return makeOkBoolean('GTE', a >= b);
    return withWarnings(makeOkNull('GTE'), [
      {
        code: 'TYPE',
        message: 'GTE expects two comparable values (both numbers or both text)',
      },
    ]);
  }
}
