import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkNull, makeOkNumber, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { isEmptyValue } from './helpers';

export class CountListImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.0001;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const v = args[0];
    if (v == null) return makeOkNull('COUNT');
    // If a downstream function already applied the COUNT cast, accept it.
    if (typeof v === 'number') {
      return Number.isFinite(v)
        ? makeOkNumber('COUNT', v)
        : withWarnings(makeOkNull('COUNT'), [
            { code: 'TYPE', message: 'COUNT received a non-finite number' },
          ]);
    }
    if (!Array.isArray(v)) {
      if (!isEmptyValue(v)) {
        return withWarnings(makeOkNull('COUNT'), [
          { code: 'TYPE', message: 'COUNT expects a list' },
        ]);
      }
      return makeOkNull('COUNT');
    }
    let n = 0;
    for (const item of v) if (!isEmptyValue(item)) n++;
    return makeOkNumber('COUNT', n);
  }
}

export class CountValuesImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.00002 * args.length;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    let n = 0;
    for (const v of args) if (!isEmptyValue(v)) n++;
    return makeOkNumber('COUNT', n);
  }
}
