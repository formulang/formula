/**
 * The borders of `pattern`: `border[i]` is the length of the longest proper prefix of
 * `pattern[0..i]` that also ends it.
 */
function borders(pattern: string): Int32Array {
  const border = new Int32Array(pattern.length);
  for (let i = 1, k = 0; i < pattern.length; i++) {
    const unit = pattern.charCodeAt(i);
    while (k > 0 && unit !== pattern.charCodeAt(k)) k = border[k - 1];
    if (unit === pattern.charCodeAt(k)) k += 1;
    border[i] = k;
  }
  return border;
}

/**
 * Calls `found` with the start of each occurrence of `needle` in `text`, left to right and
 * overlapping occurrences included, until `found` returns true; returns whether it did. An empty
 * needle occurs nowhere.
 *
 * Uses Knuth-Morris-Pratt matching, which stays linear in `text.length + needle.length` even on
 * periodic input such as a long run of one letter, where restarting `indexOf` after each
 * occurrence would be quadratic.
 */
export function someOccurrence(
  text: string,
  needle: string,
  found: (start: number) => boolean,
): boolean {
  const length = needle.length;
  if (length === 0 || length > text.length) return false;
  const border = borders(needle);
  for (let i = 0, matched = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    while (matched > 0 && unit !== needle.charCodeAt(matched)) matched = border[matched - 1];
    if (unit === needle.charCodeAt(matched)) matched += 1;
    if (matched === length) {
      if (found(i - length + 1)) return true;
      matched = border[length - 1];
    }
  }
  return false;
}
