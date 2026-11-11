import type { FormulaLimits, FormulaNodeOutput } from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaRuntimeError,
  makeOkNull,
  withWarnings,
} from '@formulang/definitions';

// The argument rules of the core text functions, restated here because core-functions keeps its
// helpers internal.

function typeWarning(fn: string, message: string): FormulaNodeOutput {
  return withWarnings(makeOkNull(fn), [{ code: 'TYPE', message }]);
}

/**
 * Reads a text argument: `null` answers null, and any value that is not text, the empty list
 * included, null with `TYPE`. The empty text is a text.
 */
export function readText(fn: string, raw: unknown): string | FormulaNodeOutput {
  if (typeof raw === 'string') return raw;
  return raw == null ? makeOkNull(fn) : typeWarning(fn, `${fn} expects text`);
}

/**
 * Reads a required mode: one of `modes`, or the call answers `null` with a `TYPE` warning. The
 * parser refuses another literal written in the formula; this refuses the value wherever it comes
 * from, such as an argument a host's higher-order function passes on.
 */
export function readRequiredMode<M extends string>(
  fn: string,
  param: string,
  raw: unknown,
  modes: readonly M[],
): M | FormulaNodeOutput {
  if (typeof raw === 'string' && (modes as readonly string[]).includes(raw)) return raw as M;
  const admitted = modes.map((mode) => JSON.stringify(mode)).join(', ');
  return typeWarning(fn, `${fn} ${param} must be one of ${admitted}`);
}

/** Collects items, raising `LIST_TOO_LARGE` as soon as there are more than the output limit. */
export function boundedItems(items: Iterable<string>, limits: FormulaLimits): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (out.length === limits.maxWildcardOutputLength) {
      throw new FormulaRuntimeError(
        FormulaErrorCodes.LIST_TOO_LARGE,
        'List is too large',
        'security',
      );
    }
    out.push(item);
  }
  return out;
}

/** The length the core functions assume for a text that is not there yet (a cost placeholder). */
const ASSUMED_TEXT_LENGTH = 50;

/**
 * Estimated seconds per code unit to read markup: about twice the slowest measured case, markdown
 * of many short lines or of unmatched emphasis runs at some 160 ns per code unit (Node 22, inputs
 * of 0.1 to 4 million code units). Three times the core text functions' one pass, as each reader
 * makes several passes and builds blocks.
 */
export const MARKUP_READ_COST = 0.0000003;

/**
 * The cost estimate of reading `markup`: proportional to its length and not capped, so a call
 * whose markup is too long for `maxFunctionCostUnits` is refused with
 * `FUNCTION_COST_LIMIT_EXCEEDED` before it runs.
 */
export function markupCost(markup: unknown): number {
  const length = typeof markup === 'string' ? markup.length : ASSUMED_TEXT_LENGTH;
  return 0.00001 + MARKUP_READ_COST * length;
}
