import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaRuntimeError,
  makeOkList,
  makeOkNull,
  withWarnings,
} from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { deepFlatten, isEmptyValue } from './helpers';

export class FlatImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(): number {
    return 0.0002;
  }

  protected evaluate(args: unknown[], ctx: FormulaExecutionContext) {
    const v = args[0];
    if (v == null) return makeOkNull('FLAT');
    if (!Array.isArray(v)) {
      if (!isEmptyValue(v)) {
        return withWarnings(makeOkNull('FLAT'), [{ code: 'TYPE', message: 'FLAT expects a list' }]);
      }
      return makeOkNull('FLAT');
    }
    const limits = ctx.limits;
    const flattened = deepFlatten(v, limits.maxWildcardOutputLength);
    if (flattened == null && Array.isArray(v)) {
      throw new FormulaRuntimeError(
        FormulaErrorCodes.LIST_TOO_LARGE,
        'Flattened list is too large',
        'security',
      );
    }
    return flattened == null ? makeOkNull('FLAT') : makeOkList('FLAT', flattened);
  }
}
