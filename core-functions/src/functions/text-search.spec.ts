import { contains, someOccurrence } from './text-search';

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

describe('contains', () => {
  it('answers as includes does, for needles either side of 250 code units', () => {
    expect(contains('abc', '')).toBe(true);
    expect(contains('', '')).toBe(true);
    expect(contains('ab', 'abc')).toBe(false);
    const random = generator(11);
    const pick = (alphabet: string, length: number) =>
      Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
    for (let round = 0; round < 400; round += 1) {
      // A text that holds the needle about half the time, with near misses around it.
      const length = 240 + Math.floor(random() * 30);
      const needle = pick('ab', length);
      const nearMiss = `${needle.slice(0, 1) === 'a' ? 'b' : 'a'}${needle.slice(1)}`;
      const text =
        pick('ab', Math.floor(random() * 300)) +
        (round % 2 === 0 ? needle : nearMiss) +
        pick('ab', Math.floor(random() * 300));
      expect(contains(text, needle), `round ${round}`).toBe(text.includes(needle));
    }
    // The shapes V8's own search reads slowly past 250 code units: the mismatch at the start.
    for (const length of [249, 250, 251, 252, 300, 8_000]) {
      const needle = `ab${'a'.repeat(length - 2)}`;
      expect(contains('a'.repeat(20_000), needle), String(length)).toBe(false);
      expect(contains(`${'a'.repeat(20_000)}${needle}a`, needle), String(length)).toBe(true);
    }
  });

  it('checks each place where the last 250 code units of a longer needle occur', () => {
    const tail = 'x'.repeat(250);
    const needle = `head${tail}`;
    // The tail occurs three times after a wrong head before the needle occurs.
    const misses = `nope${tail}-hea${tail}-bead${tail}-`;
    expect(contains(`${misses}${needle}`, needle)).toBe(true);
    expect(contains(misses, needle)).toBe(false);
    // The tail of this needle occurs at every position of a run: each place is a candidate,
    // whichever position the needle starts at.
    const longNeedle = `b${'a'.repeat(300)}`;
    for (const shift of [0, 1, 2, 3, 249]) {
      const run = 'a'.repeat(5_000 + shift);
      expect(contains(`${run}${longNeedle}`, longNeedle), String(shift)).toBe(true);
      expect(contains(`${run}b${'a'.repeat(299)}`, longNeedle), String(shift)).toBe(false);
    }
    // A place where the tail occurs too early for the rest of the needle to fit before it is no
    // candidate, though the text starts with that rest.
    expect(contains(`b${'a'.repeat(250)}`, longNeedle)).toBe(false);
    expect(contains(`b${'a'.repeat(299)}`, longNeedle)).toBe(false);
    expect(contains(`b${'a'.repeat(300)}`, longNeedle)).toBe(true);
  });
});
