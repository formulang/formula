import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkBoolean } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { isEmptyValue } from './helpers';

export class IsEmptyImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.00001;
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    return makeOkBoolean('IS_EMPTY', isEmptyValue(args[0]));
  }
}
