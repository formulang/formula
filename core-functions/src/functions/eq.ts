import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkBoolean, makeOkNull } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { equalsUnknownType } from './helpers';

export class EqImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const v = equalsUnknownType(args[0], args[1]);
    return v == null ? makeOkNull('EQ') : makeOkBoolean('EQ', v);
  }
}
