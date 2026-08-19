import type { BaseFunctionConfig, FormulaExecutionContext } from '@formulang/definitions';
import { makeOkBoolean, makeOkNull, withWarnings } from '@formulang/definitions';
import { AbstractEagerBatchImplementation } from './abstract-eager-batch-implementation';
import { asText, assumedListLength, assumedTextLength, isEmptyValue } from './helpers';

export class StartsWithImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return Math.min(0.005, 0.000001 * assumedTextLength(args[0]));
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const rawText = args[0];
    const rawNeedle = args[1];
    const text = asText(rawText);
    const needle = asText(rawNeedle);
    if (text == null || needle == null) {
      const warnings = [] as Array<{
        code: string;
        message: string;
        meta?: Record<string, unknown>;
      }>;
      if (!isEmptyValue(rawText) && text == null)
        warnings.push({ code: 'TYPE', message: 'STARTS_WITH expects text', meta: { arg: 'text' } });
      if (!isEmptyValue(rawNeedle) && needle == null)
        warnings.push({
          code: 'TYPE',
          message: 'STARTS_WITH expects text',
          meta: { arg: 'needle' },
        });
      const out = makeOkNull('STARTS_WITH');
      return warnings.length > 0 ? withWarnings(out, warnings) : out;
    }
    return makeOkBoolean('STARTS_WITH', text.startsWith(needle));
  }
}

export class StartsWithListImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    const tLen = assumedTextLength(args[0]);
    const listLen = assumedListLength(args[1]);
    return Math.min(0.01, 0.000001 * tLen * Math.max(1, listLen));
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const rawText = args[0];
    const text = asText(rawText);
    const prefixes = args[1];
    if (text == null) {
      if (!isEmptyValue(rawText)) {
        return withWarnings(makeOkNull('STARTS_WITH'), [
          { code: 'TYPE', message: 'STARTS_WITH expects text' },
        ]);
      }
      return makeOkNull('STARTS_WITH');
    }
    if (prefixes == null) return makeOkNull('STARTS_WITH');
    if (!Array.isArray(prefixes)) {
      if (!isEmptyValue(prefixes)) {
        return withWarnings(makeOkNull('STARTS_WITH'), [
          {
            code: 'TYPE',
            message: 'STARTS_WITH expects a list of prefixes as the second argument',
            meta: { got: Array.isArray(prefixes) ? 'array' : typeof prefixes },
          },
        ]);
      }
      return makeOkNull('STARTS_WITH');
    }
    for (const p of prefixes) {
      const pref = asText(p);
      if (pref == null) continue;
      if (text.startsWith(pref)) return makeOkBoolean('STARTS_WITH', true);
    }
    return makeOkBoolean('STARTS_WITH', false);
  }
}
