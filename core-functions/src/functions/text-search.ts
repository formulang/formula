/**
 * Calls `found` with the start of each occurrence of `needle` in `text`, left to right and
 * overlapping occurrences included, until `found` returns true; returns whether it did. An empty
 * needle occurs nowhere.
 *
 * Knuth-Morris-Pratt matching makes at most `2 * (text.length + needle.length)` comparisons of
 * code units, whatever `text` and `needle` hold. Restarting
 * `indexOf` after each occurrence instead re-reads up to `needle.length` characters per
 * occurrence, which is quadratic on a periodic text such as a long run of one letter.
 */
export function someOccurrence(
  text: string,
  needle: string,
  found: (start: number) => boolean,
): boolean {
  const length = needle.length;
  if (length === 0 || length > text.length) return false;
  // border[i]: the length of the longest proper prefix of needle[0..i] that also ends it.
  const border = new Int32Array(length);
  for (let i = 1, k = 0; i < length; i++) {
    const unit = needle.charCodeAt(i);
    while (k > 0 && unit !== needle.charCodeAt(k)) {
      k = border[k - 1];
    }
    if (unit === needle.charCodeAt(k)) k += 1;
    border[i] = k;
  }
  for (let i = 0, matched = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    while (matched > 0 && unit !== needle.charCodeAt(matched)) {
      matched = border[matched - 1];
    }
    if (unit === needle.charCodeAt(matched)) matched += 1;
    if (matched === length) {
      if (found(i - length + 1)) return true;
      matched = border[length - 1];
    }
  }
  return false;
}
