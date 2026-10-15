import { someOccurrence } from './text-search';

/** Every start of `needle` in `text`, as restarting `indexOf` after each occurrence finds them. */
function indexOfOccurrences(text: string, needle: string): number[] {
  const starts: number[] = [];
  if (needle.length === 0) return starts;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) starts.push(at);
  return starts;
}

function occurrences(text: string, needle: string): number[] {
  const starts: number[] = [];
  someOccurrence(text, needle, (at) => {
    starts.push(at);
    return false;
  });
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
    const found = someOccurrence('a-a-a', 'a', (at) => {
      seen.push(at);
      return at === 2;
    });
    expect(found).toBe(true);
    expect(seen).toStrictEqual([0, 2]);
    expect(someOccurrence('a-a-a', 'a', () => false)).toBe(false);
  });

  it('finds every occurrence in periodic texts, whose occurrences overlap at every position', () => {
    const inputs: Array<[string, [string, string]]> = [
      ['a run and a half-length run', ['a'.repeat(2_000), 'a'.repeat(1_000)]],
      ['a run and a near-miss run', ['a'.repeat(2_000), `${'a'.repeat(1_000)}b`]],
      ['repeated pairs', ['ab'.repeat(1_000), `${'ab'.repeat(500)}a`]],
      ['a long border', [`${'a'.repeat(1_999)}b`, `${'a'.repeat(500)}b`]],
    ];
    for (const [name, [text, needle]] of inputs) {
      expect(occurrences(text, needle), name).toStrictEqual(indexOfOccurrences(text, needle));
    }
    expect(occurrences('a'.repeat(2_000), 'a'.repeat(1_000))).toHaveLength(1_001);
  });
});
