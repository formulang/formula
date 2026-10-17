/**
 * The borders of `pattern`: `border[i]` is the length of the longest proper prefix of
 * `pattern[0..i]` that also ends it.
 */
function borders(pattern: string): Int32Array {
  const border = new Int32Array(pattern.length);
  for (let i = 1, k = 0; i < pattern.length; i++) {
    const unit = pattern.charCodeAt(i);
    while (k > 0 && unit !== pattern.charCodeAt(k)) {
      k = border[k - 1];
    }
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
 * Knuth-Morris-Pratt matching makes at most `2 * (text.length + needle.length)` comparisons of
 * code units, whatever `text` and `needle` hold. Restarting `indexOf` after each occurrence
 * instead re-reads up to `needle.length` characters per occurrence, which is quadratic on a
 * periodic text such as a long run of one letter.
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
 * The longest needle {@link contains} gives whole to the runtime's own substring search, and the
 * length of the windows of a longer needle that it looks for there. V8 builds its Boyer-Moore
 * tables over a needle's last 250 code units only: up to that length they cover the whole needle
 * and the search is linear in the text, while a longer needle whose mismatch lies before them is
 * compared afresh at almost every position, in time proportional to the text's length times the
 * needle's.
 */
const WINDOW = 250;

/**
 * The longest smallest period of a window that {@link contains} counts as short. A window that
 * repeats with a short period, such as a run of one letter, occurs all along a text that repeats
 * with it, so another window is looked for as well.
 */
const LONGEST_SHORT_PERIOD = 63;

/** The key of a pair of code units in {@link scan}'s shift table: six low bits of each. */
function pairKey(first: number, second: number): number {
  return ((first & 63) << 6) | (second & 63);
}

/**
 * The longest shift {@link scan} takes from the pairs of the needle it has looked at: it looks at
 * the last 1,024 pairs only, so that a long needle costs no more to prepare than that.
 */
const LONGEST_PAIR_SHIFT = 1024;

/**
 * Whether `needle` (longer than 2 code units) occurs in `text` at `start` or later, by a scan that
 * compares each code unit of the text a bounded number of times.
 *
 * At each place the needle could start, the two code units of the text under its last two are
 * compared with them first, and decide how far the next place lies: a table keyed by
 * {@link pairKey} holds, for each key, the shortest shift after which one of the needle's last
 * 1,024 pairs with that key lies under those two units, and otherwise the needle's length less
 * one, or 1,024 when that is shorter. Where the last two agree, the needle is compared from its
 * start, up to the first unit that differs. When the next place would start before that unit,
 * Knuth-Morris-Pratt matching goes on from it until no start of the needle ends where it stands,
 * and the scan resumes there. A unit compared from the start, or by that matching, lies before
 * the next place, so each is compared that way once, and by the matching at most twice more.
 */
function scan(text: string, needle: string, start: number): boolean {
  const last = needle.length - 1;
  const shift = new Int32Array(64 * 64).fill(Math.min(last, LONGEST_PAIR_SHIFT));
  for (let i = Math.max(0, last - 1 - LONGEST_PAIR_SHIFT); i + 1 < last; i++) {
    shift[pairKey(needle.charCodeAt(i), needle.charCodeAt(i + 1))] = last - 1 - i;
  }
  let border: Int32Array | undefined;
  for (let at = start; at + last < text.length;) {
    const before = text.charCodeAt(at + last - 1);
    const unit = text.charCodeAt(at + last);
    let next = at + shift[pairKey(before, unit)];
    if (unit === needle.charCodeAt(last) && before === needle.charCodeAt(last - 1)) {
      let matched = 0;
      while (matched < last - 1 && needle.charCodeAt(matched) === text.charCodeAt(at + matched)) {
        matched += 1;
      }
      if (matched === last - 1) return true;
      if (at + matched > next) {
        border ??= borders(needle);
        // `matched` code units of the needle end before the unit at `next`.
        next = at + matched;
        while (matched > 0 && next < text.length) {
          const current = text.charCodeAt(next);
          while (matched > 0 && current !== needle.charCodeAt(matched)) {
            matched = border[matched - 1];
          }
          if (current === needle.charCodeAt(matched)) matched += 1;
          if (matched === needle.length) return true;
          next += 1;
        }
      }
    }
    at = next;
  }
  return false;
}

/**
 * Whether `needle` occurs in `text`, as `text.includes(needle)` answers (an empty needle occurs
 * everywhere), in time linear in the lengths of the text and the needle.
 *
 * A needle of at most 250 code units goes to the runtime's own search. A longer one first has its
 * last 250 code units looked for there: where they do not occur, neither does the needle, and
 * where they first occur bounds where it can start and is where the rest of the needle is compared
 * once. When those 250 repeat with a period of at most 63, the first of the needle's windows of 250
 * code units, 125 apart towards its start, whose smallest period is longer is looked for in the
 * same way. From the place found, {@link scan} reads the rest of the text.
 */
export function contains(text: string, needle: string): boolean {
  if (needle.length <= WINDOW) return text.includes(needle);
  const tail = needle.length - WINDOW;
  const first = text.indexOf(needle.slice(tail), tail);
  if (first < 0) return false;
  let start = first - tail;
  let matched = 0;
  while (matched < tail && needle.charCodeAt(matched) === text.charCodeAt(start + matched)) {
    matched += 1;
  }
  if (matched === tail) return true;
  if (smallestPeriod(needle.slice(tail)) <= LONGEST_SHORT_PERIOD) {
    for (let offset = tail; offset > 0;) {
      offset = Math.max(0, offset - WINDOW / 2);
      const window = needle.slice(offset, offset + WINDOW);
      if (smallestPeriod(window) > LONGEST_SHORT_PERIOD) {
        const at = text.indexOf(window, start + offset);
        if (at < 0) return false;
        start = at - offset;
        break;
      }
    }
  }
  return scan(text, needle, start);
}

/** The smallest period of `window`: the least `p` such that each unit equals the one `p` before. */
function smallestPeriod(window: string): number {
  return window.length - borders(window)[window.length - 1];
}
