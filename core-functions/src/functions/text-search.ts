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
 * The longest needle {@link contains} gives whole to the runtime's own substring search. V8 builds
 * its Boyer-Moore tables over a needle's last 250 code units only: up to that length they cover the
 * whole needle and the search is linear in the text, while a longer needle whose mismatch lies
 * before them is compared afresh at almost every position, in time proportional to the text's
 * length times the needle's.
 */
const NATIVE_SEARCH_LIMIT = 250;

/**
 * The work {@link contains} spends on the candidates of a longer needle, as a multiple of the
 * text's and the needle's lengths, before it leaves the search to {@link someOccurrence}.
 */
const CANDIDATE_BUDGET = 4;

/**
 * Whether `needle` occurs in `text`, as `text.includes(needle)` answers (an empty needle occurs
 * everywhere), in time linear in the lengths of the text and the needle.
 *
 * A needle of at most 250 code units goes to the runtime's own search. A longer one is looked for
 * by its last 250 code units, with the runtime's own search, and each place where they occur is
 * checked for the rest of the needle. Each such candidate is charged the needle's length; once the
 * charges pass four times the lengths of the text and the needle, the search is left to
 * {@link someOccurrence}, which is linear whatever the text holds. In ordinary text the last 250
 * code units of an absent needle occur rarely, if at all, so the search costs what the runtime's
 * own search costs.
 */
export function contains(text: string, needle: string): boolean {
  if (needle.length <= NATIVE_SEARCH_LIMIT) return text.includes(needle);
  const headLength = needle.length - NATIVE_SEARCH_LIMIT;
  const head = needle.slice(0, headLength);
  const tail = needle.slice(headLength);
  let budget = CANDIDATE_BUDGET * (text.length + needle.length);
  for (let at = text.indexOf(tail, headLength); at >= 0; at = text.indexOf(tail, at + 1)) {
    if (text.startsWith(head, at - headLength)) return true;
    budget -= needle.length;
    if (budget < 0) return someOccurrence(text, needle, () => true);
  }
  return false;
}
