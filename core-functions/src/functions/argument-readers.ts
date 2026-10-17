import type { FormulaLimits, FormulaNodeOutput, FormulaWarning } from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaRuntimeError,
  makeOkNull,
  withWarnings,
} from '@formulang/definitions';
import { assumedTextLength } from './helpers';

/** Whether `value` is one of the literal `values`. */
export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function nullWithWarning(fn: string, warning: FormulaWarning): FormulaNodeOutput {
  return withWarnings(makeOkNull(fn), [warning]);
}

export function typeWarning(fn: string, message: string): FormulaNodeOutput {
  return nullWithWarning(fn, { code: 'TYPE', message });
}

export function listTooLarge(): FormulaRuntimeError {
  return new FormulaRuntimeError(FormulaErrorCodes.LIST_TOO_LARGE, 'List is too large', 'security');
}

function modeRefusal(fn: string, param: string, modes: readonly string[]): FormulaNodeOutput {
  const admitted = modes.map((mode) => JSON.stringify(mode)).join(', ');
  return typeWarning(fn, `${fn} ${param} must be one of ${admitted}`);
}

/**
 * Reads an optional mode: absent or `null` selects the first (default) mode, and any other value
 * must be one of `modes`, the empty text included, or the call answers `null` with a `TYPE`
 * warning. The parser refuses such a literal written in the formula already; this refuses the value
 * wherever it comes from, such as an argument a host's higher-order function passes on.
 */
export function readOptionalMode<M extends string>(
  fn: string,
  param: string,
  raw: unknown,
  modes: readonly M[],
): M | FormulaNodeOutput {
  if (raw === undefined || raw === null) return modes[0];
  return isOneOf(modes, raw) ? raw : modeRefusal(fn, param, modes);
}

/** Reads a required mode: one of `modes`, or the call answers `null` with a `TYPE` warning. */
export function readRequiredMode<M extends string>(
  fn: string,
  param: string,
  raw: unknown,
  modes: readonly M[],
): M | FormulaNodeOutput {
  return isOneOf(modes, raw) ? raw : modeRefusal(fn, param, modes);
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
 * Reads a list of texts that is not `null`, bounded by `maxListLength`: any other value, the
 * empty text included, answers null with `TYPE`. Entries that are `null` or the empty text are
 * dropped; an entry of another type, the empty list included, answers null with `TYPE`.
 */
export function readTextList(
  fn: string,
  param: string,
  raw: unknown,
  limits: FormulaLimits,
): string[] | FormulaNodeOutput {
  if (!Array.isArray(raw)) return typeWarning(fn, `${fn} ${param} must be a list of text`);
  if (raw.length > limits.maxListLength) throw listTooLarge();
  const texts: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.length > 0) texts.push(item);
    } else if (item != null) {
      return typeWarning(fn, `${fn} ${param} must be a list of text`);
    }
  }
  return texts;
}

/** Bounds a list result by `maxWildcardOutputLength`, as `FLAT` does. */
export function boundedListResult<T>(items: T[], limits: FormulaLimits): T[] {
  if (items.length > limits.maxWildcardOutputLength) throw listTooLarge();
  return items;
}

/** A cost estimate proportional to the length of a text argument, capped at 50 ms. */
export function textCost(text: unknown, factor = 1): number {
  return Math.min(0.05, 0.00001 + 0.000001 * assumedTextLength(text) * factor);
}
