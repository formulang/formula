import type { CountedText } from './work-count';

/**
 * Calls `found` with the start of each occurrence of `needle` in `text`, left to right and
 * overlapping occurrences included, until `found` returns true; returns whether it did. An empty
 * needle occurs nowhere.
 *
 * Knuth-Morris-Pratt matching reads each code unit of `text` once and compares it with code units
 * of `needle`, each read for its comparison: at most `2 * text.length` comparisons, and
 * `2 * needle.length` to prepare, whatever they hold. Restarting `indexOf` after each occurrence
 * instead re-reads up to `needle.length` characters per occurrence, which is quadratic on a
 * periodic text such as a long run of one letter. Both texts are read through their counts, one
 * step a code unit.
 */
export function someOccurrence(
  text: CountedText,
  needle: CountedText,
  found: (start: number) => boolean,
): boolean {
  const length = needle.length;
  if (length === 0 || length > text.length) return false;
  // border[i]: the length of the longest proper prefix of needle[0..i] that also ends it.
  const border = new Int32Array(length);
  for (let i = 1, k = 0; i < length; i++) {
    const unit = needle.code(i);
    let probe = needle.code(k);
    while (k > 0 && unit !== probe) {
      k = border[k - 1];
      probe = needle.code(k);
    }
    if (unit === probe) k += 1;
    border[i] = k;
  }
  for (let i = 0, matched = 0; i < text.length; i++) {
    const unit = text.code(i);
    let probe = needle.code(matched);
    while (matched > 0 && unit !== probe) {
      matched = border[matched - 1];
      probe = needle.code(matched);
    }
    if (unit === probe) matched += 1;
    if (matched === length) {
      if (found(i - length + 1)) return true;
      matched = border[length - 1];
    }
  }
  return false;
}
