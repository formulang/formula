import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkBoolean, makeOkNull, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { assumedListLength, equalsUnknownType, isEmptyValue } from './helpers';

export class IncludesImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return 0.0002 + 0.00002 * assumedListLength(args[0]);
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const list = args[0];
    if (list == null) return makeOkNull('INCLUDES');
    if (!Array.isArray(list)) {
      if (!isEmptyValue(list)) {
        return withWarnings(makeOkNull('INCLUDES'), [
          {
            code: 'TYPE',
            message: 'INCLUDES expects the first argument to be a list',
            meta: { got: Array.isArray(list) ? 'array' : typeof list },
          },
        ]);
      }
      return makeOkNull('INCLUDES');
    }
    const value = args[1];

    let sawNull = false;
    for (const item of list) {
      const eq = equalsUnknownType(item, value);
      if (eq === true) return makeOkBoolean('INCLUDES', true);
      if (eq == null) sawNull = true;
    }
    return sawNull ? makeOkNull('INCLUDES') : makeOkBoolean('INCLUDES', false);
  }
}
