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

/**
 * The longest needle {@link contains} gives to the runtime's own substring search. V8 builds its
 * Boyer-Moore tables over a needle's last 250 code units only; a longer needle whose mismatch lies
 * before them is compared afresh at almost every position, in time proportional to the text's
 * length times the needle's.
 */
const NATIVE_SEARCH_LIMIT = 250;

/**
 * Whether `needle` occurs in `text`, as `text.includes(needle)` answers (an empty needle occurs
 * everywhere), in time linear in the lengths of the text and the needle. A needle of at most 250
 * code units goes to the runtime's own search, whose tables in V8 then cover the whole needle; a
 * longer one to {@link someOccurrence}.
 */
export function contains(text: string, needle: string): boolean {
  if (needle.length <= NATIVE_SEARCH_LIMIT) return text.includes(needle);
  return someOccurrence(text, needle, () => true);
}
