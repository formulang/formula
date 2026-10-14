import { someOccurrence } from './text-search';
import type { WorkCount } from './work-count';

/** Every start of `needle` in `text`, as restarting `indexOf` after each occurrence finds them. */
function indexOfOccurrences(text: string, needle: string): number[] {
  const starts: number[] = [];
  if (needle.length === 0) return starts;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) starts.push(at);
  return starts;
}

function occurrences(text: string, needle: string, work: WorkCount = { steps: 0 }): number[] {
  const starts: number[] = [];
  someOccurrence(
    text,
    needle,
    (at) => {
      starts.push(at);
      return false;
    },
    work,
  );
  return starts;
}

/** A small deterministic generator, so a failing case can be replayed. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
    return state / 2 ** 32;
  };
}

describe('someOccurrence', () => {
  it('finds exactly the occurrences indexOf finds, overlapping ones included', () => {
    expect(occurrences('aaaa', 'aa')).toStrictEqual([0, 1, 2]);
    expect(occurrences('abababa', 'aba')).toStrictEqual([0, 2, 4]);
    expect(occurrences('abc', '')).toStrictEqual([]);
    expect(occurrences('ab', 'abc')).toStrictEqual([]);
    // Code units, as indexOf: a surrogate pair is two of them.
    expect(occurrences('x\u{1F600}\u{1F600}', '\u{1F600}')).toStrictEqual([1, 3]);
    const random = generator(7);
    const pick = (alphabet: string, length: number) =>
      Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
    for (let round = 0; round < 3_000; round += 1) {
      const text = pick('ab', Math.floor(random() * 40));
      const needle = pick(round % 2 === 0 ? 'ab' : 'abc', 1 + Math.floor(random() * 6));
      expect(occurrences(text, needle), `${needle} in ${text}`).toStrictEqual(
        indexOfOccurrences(text, needle),
      );
    }
  });

  it('stops at the first occurrence found accepts', () => {
    const seen: number[] = [];
    const found = someOccurrence(
      'a-a-a',
      'a',
      (at) => {
        seen.push(at);
        return at === 2;
      },
      { steps: 0 },
    );
    expect(found).toBe(true);
    expect(seen).toStrictEqual([0, 2]);
    expect(someOccurrence('a-a-a', 'a', () => false, { steps: 0 })).toBe(false);
  });

  it('compares each character a bounded number of times, however periodic the input', () => {
    // A run of one letter holds an occurrence of a half-length run at every position, and
    // restarting a search after each one re-reads half the text each time.
    const inputs: Array<[string, (n: number) => [string, string, number]]> = [
      ['a run and a half-length run', (n) => ['a'.repeat(n), 'a'.repeat(n / 2), n / 2 + 1]],
      ['a run and a near-miss run', (n) => ['a'.repeat(n), `${'a'.repeat(n / 2)}b`, 0]],
      ['repeated pairs', (n) => ['ab'.repeat(n / 2), `${'ab'.repeat(n / 4)}a`, n / 4]],
      ['a long border', (n) => [`${'a'.repeat(n - 1)}b`, `${'a'.repeat(n / 4)}b`, 1]],
    ];
    for (const [name, build] of inputs) {
      for (const n of [20_000, 80_000]) {
        const [text, needle, count] = build(n);
        const work: WorkCount = { steps: 0 };
        const starts = occurrences(text, needle, work);
        expect(work.steps, `${name} n=${n}`).toBeGreaterThanOrEqual(text.length);
        expect(work.steps, `${name} n=${n}`).toBeLessThanOrEqual(2 * (text.length + needle.length));
        expect(starts.length, `${name} n=${n}`).toBe(count);
      }
    }
  });
});
