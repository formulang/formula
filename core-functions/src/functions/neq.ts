import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkBoolean, makeOkNull } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { equalsUnknownType } from './helpers';

export class NeqImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const eq = equalsUnknownType(args[0], args[1]);
    return eq == null ? makeOkNull('NEQ') : makeOkBoolean('NEQ', !eq);
  }
}
