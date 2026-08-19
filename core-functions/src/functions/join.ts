import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkNull, makeOkText, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asText, assumedListLength, assumedTextLength, isEmptyValue } from './helpers';

export class JoinImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    const valuesCost = 0.000002 * assumedListLength(args[0]) * assumedTextLength(args[1]);
    return Math.min(0.01, Math.max(0.00001, valuesCost));
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const rawValues = args[0];
    const rawSeparator = args[1];
    const separator = asText(rawSeparator);

    if (!Array.isArray(rawValues)) {
      if (!isEmptyValue(rawValues)) {
        return withWarnings(makeOkNull('JOIN'), [
          {
            code: 'TYPE',
            message: 'JOIN expects a list of text values as the first argument',
            meta: { got: Array.isArray(rawValues) ? 'array' : typeof rawValues },
          },
        ]);
      }
      return makeOkNull('JOIN');
    }

    if (separator == null) {
      if (!isEmptyValue(rawSeparator)) {
        return withWarnings(makeOkNull('JOIN'), [
          {
            code: 'TYPE',
            message: 'JOIN expects text as the second argument',
            meta: { got: Array.isArray(rawSeparator) ? 'array' : typeof rawSeparator },
          },
        ]);
      }
      return makeOkNull('JOIN');
    }

    const parts: string[] = [];
    for (let i = 0; i < rawValues.length; i++) {
      const value = rawValues[i];
      const part = asText(value);
      if (part == null) {
        if (!isEmptyValue(value)) {
          return withWarnings(makeOkNull('JOIN'), [
            {
              code: 'TYPE',
              message: 'JOIN expects text values in the list',
              meta: { index: i, got: Array.isArray(value) ? 'array' : typeof value },
            },
          ]);
        }
        return makeOkNull('JOIN');
      }
      parts.push(part);
    }

    return makeOkText('JOIN', parts.join(separator));
  }
}
