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

/** The smallest period of `value`: the least d with value[i] === value[i + d] wherever both exist. */
function smallestPeriod(value: string): number {
  for (let d = 1; d < value.length; d++) {
    if (value.slice(d) === value.slice(0, value.length - d)) return d;
  }
  return value.length;
}

/** `value` with the code unit at `at` replaced by one it does not hold there. */
function changeAt(value: string, at: number): string {
  return `${value.slice(0, at)}${value[at] === '~' ? '^' : '~'}${value.slice(at + 1)}`;
}

/**
 * A needle of 375 code units whose first 250 repeat with period `first` and whose last 250 repeat
 * with period `second`: each class of positions the two periods tie together gets a code unit of
 * its own, so the needle repeats with nothing the two do not force.
 */
function twoPeriodNeedle(first: number, second: number): string {
  const parent = Array.from({ length: 375 }, (_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i + first < 250; i++) parent[root(i)] = root(i + first);
  for (let i = 125; i + second < 375; i++) parent[root(i)] = root(i + second);
  const codes = new Map<number, number>();
  return Array.from({ length: 375 }, (_, i) => {
    const code = codes.get(root(i)) ?? 0x100 + codes.size;
    codes.set(root(i), code);
    return String.fromCharCode(code);
  }).join('');
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
  const random = generator(5);
  const pick = (alphabet: string, length: number) =>
    Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');

  it('answers as includes does, for needles either side of 250 code units', () => {
    expect(contains('abc', '')).toBe(true);
    expect(contains('', '')).toBe(true);
    expect(contains('ab', 'abc')).toBe(false);
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

  it('finds a needle after places where only its last 250 code units occur', () => {
    const tail = 'x'.repeat(250);
    const needle = `head${tail}`;
    const misses = `nope${tail}-hea${tail}-bead${tail}-`;
    expect(contains(`${misses}${needle}`, needle)).toBe(true);
    expect(contains(misses, needle)).toBe(false);
    const longNeedle = `b${'a'.repeat(300)}`;
    for (const shift of [0, 1, 2, 3, 249]) {
      const run = 'a'.repeat(5_000 + shift);
      expect(contains(`${run}${longNeedle}`, longNeedle), String(shift)).toBe(true);
      expect(contains(`${run}b${'a'.repeat(299)}`, longNeedle), String(shift)).toBe(false);
    }
    // Where the last 250 occur too early for the rest of the needle to fit before them, the text
    // starting with that rest does not make an occurrence.
    expect(contains(`b${'a'.repeat(250)}`, longNeedle)).toBe(false);
    expect(contains(`b${'a'.repeat(299)}`, longNeedle)).toBe(false);
    expect(contains(`b${'a'.repeat(300)}`, longNeedle)).toBe(true);
  });

  it('compares every code unit of the needle where its last 250 code units first occur', () => {
    const needle = pick('abcdefgh', 400);
    expect(contains(`xy${needle}yx`, needle)).toBe(true);
    for (const at of [0, 1, 75, 148, 149, 150, 399]) {
      expect(contains(`xy${changeAt(needle, at)}yx`, needle), String(at)).toBe(false);
    }
  });

  it('scans the rest of the text by the code unit under the last unit of the needle', () => {
    // The needle ends with a unit it holds nowhere else: a place whose unit under the needle's end
    // differs from every unit before it there shifts by the needle's whole length.
    const needle = `${pick('abcdefgh', 399)}!`;
    const block = `${pick('pqrs', 399)}Z`;
    for (const at of [0, 1, 149]) {
      const before = changeAt(needle, at);
      expect(contains(`${before}${needle}${block}`, needle), String(at)).toBe(true);
      expect(contains(`${before}${block}${needle}`, needle), String(at)).toBe(true);
      expect(contains(`${before}${block}${needle.slice(0, -1)}`, needle), String(at)).toBe(false);
      expect(contains(`${before}${block}${changeAt(needle, 398)}`, needle), String(at)).toBe(false);
    }
    // After a near miss, the needle at every place within its own length.
    const repeated = pick('abcdefgh', 400);
    for (let gap = 0; gap < 400; gap += 1) {
      const text = `${changeAt(repeated, 0)}${pick('abcdefgh', gap)}${repeated}`;
      expect(contains(text, repeated), String(gap)).toBe(true);
      expect(contains(changeAt(text, text.length - 200), repeated), String(gap)).toBe(
        changeAt(text, text.length - 200).includes(repeated),
      );
    }
  });

  it('reads code units above 255, and below 256 with their high bit set', () => {
    // Units whose low eight bits are those of other units: U+0101 and "\x01", U+0161 and "a"...
    const above = String.fromCharCode(
      0x101,
      0x161,
      0x4e00,
      0x141,
      0x241,
      0xe9,
      0xfc,
      0x20ac,
      0x1e9,
    );
    for (let round = 0; round < 40; round += 1) {
      const needle = `${pick(`ab${above}`, 300)}${pick(above, 1)}`;
      for (let gap = 0; gap < 30; gap += 1) {
        const text = `${changeAt(needle, 0)}${pick(`abi|${above}`, gap)}${needle}${pick('ab', 10)}`;
        expect(contains(text, needle), `${round} ${gap}`).toBe(true);
        const missed = text.replace(needle, changeAt(needle, 150));
        expect(contains(missed, needle), `${round} ${gap}`).toBe(missed.includes(needle));
      }
    }
  });

  it('finds a needle that ends where the text ends', () => {
    const needle = `${pick('abcdefgh', 399)}!`;
    expect(contains(`${changeAt(needle, 0)}xyz${needle}`, needle)).toBe(true);
    expect(contains(needle, needle)).toBe(true);
    const periodic = 'abc'.repeat(100);
    expect(contains(`${changeAt(periodic, 0)}x${periodic}`, periodic)).toBe(true);
    expect(contains(`xyz${periodic}`, periodic)).toBe(true);
    expect(contains(periodic, periodic)).toBe(true);
    expect(contains(periodic.slice(1), periodic)).toBe(false);
  });

  it('looks for a window with a long period when the last 250 code units repeat with a short one', () => {
    // The needle's last 250 are a run of one letter; it occurs once, after runs that hold them.
    const needle = `${pick('bcdefgh', 200)}${'a'.repeat(300)}`;
    const text = `${'a'.repeat(400)}${needle.slice(0, 199)}${'a'.repeat(500)}${needle}${'a'.repeat(50)}`;
    expect(contains(text, needle)).toBe(true);
    expect(contains(text.replace(needle, changeAt(needle, 0)), needle)).toBe(false);
    expect(contains('a'.repeat(5_000), needle)).toBe(false);
  });

  it('searches a needle whose windows all repeat with a short period as one periodic run', () => {
    // Each case starts with a near miss, which holds the needle's last 250 code units.
    const check = (text: string, needle: string) =>
      contains(`${changeAt(needle, 0)}-${text}`, needle);
    const needle = 'abc'.repeat(100);
    // A run that breaks one unit before the needle starts: the needle starts at the break.
    expect(check(`${'abc'.repeat(90)}ab${needle}`, needle)).toBe(true);
    // A run that breaks inside the needle's first period.
    const aab = 'aab'.repeat(100);
    expect(check(`${'aab'.repeat(90)}aa${aab}`, aab)).toBe(true);
    expect(check(`${'aab'.repeat(90)}a${aab}`, aab)).toBe(true);
    // Runs of the needle's period that do not hold the needle.
    const ab = 'ab'.repeat(150);
    expect(check(`${'ab'.repeat(125)}${'xb'.repeat(25)}`, ab)).toBe(false);
    expect(check(`${'ab'.repeat(125)}x${'ab'.repeat(25)}`, ab)).toBe(false);
    expect(check(`${'a'.repeat(299)}b${'a'.repeat(299)}`, 'a'.repeat(300))).toBe(false);
    expect(check(`${'a'.repeat(299)}b${'a'.repeat(300)}`, 'a'.repeat(300))).toBe(true);
    // Every break of a run of period 7, each followed at every offset by the needle.
    const unit = 'abacabd';
    const seven = unit.repeat(40);
    for (let cut = 1; cut <= 2 * unit.length; cut++) {
      for (let gap = 0; gap < 3; gap++) {
        const text = `${unit.repeat(36)}${unit.slice(0, cut % unit.length)}${'x'.repeat(gap)}${seven}`;
        expect(check(text, seven), `${cut} ${gap}`).toBe(true);
        expect(check(text.slice(0, -1), seven), `${cut} ${gap}`).toBe(
          text.slice(0, -1).includes(seven),
        );
      }
    }
  });

  it('does not take two short periods side by side for one', () => {
    const needle = `${'ab'.repeat(125)}${'abc'.repeat(83)}a`;
    expect(contains(`${changeAt(needle, 0)}${needle}`, needle)).toBe(true);
    expect(contains(`${changeAt(needle, 0)}x${needle}x`, needle)).toBe(true);
    // Two windows whose smallest periods, 63 and 64, are too long to be the same.
    const wide = twoPeriodNeedle(63, 64);
    expect(smallestPeriod(wide.slice(0, 250))).toBe(63);
    expect(smallestPeriod(wide.slice(125))).toBe(64);
    expect(contains(`${changeAt(wide, 0)}${wide}`, wide)).toBe(true);
    expect(contains(`${changeAt(wide, 0)}${wide.slice(0, 200)}${wide}`, wide)).toBe(true);
  });

  it('goes on with Knuth-Morris-Pratt matching where a long start of the needle matches', () => {
    // At places a block apart, the needle's last two units and all but its last 125 units agree
    // with a run of blocks; the needle itself occurs once, in many places.
    let block = pick('abcdefgh', 250);
    while (smallestPeriod(block) < 250) block = pick('abcdefgh', 250);
    const needle = `${block.repeat(8)}${changeAt(block, 125)}`;
    for (let blocks = 1; blocks <= 160; blocks += 1) {
      for (const after of [0, 100]) {
        const text = `${changeAt(needle, 0)}${block.repeat(blocks)}${needle}${block.repeat(after)}`;
        expect(contains(text, needle), `${blocks} ${after}`).toBe(true);
        const missed = text.replace(`${block}${needle}`, `${block}${changeAt(needle, 1_000)}`);
        expect(contains(missed, needle), `${blocks} ${after}`).toBe(false);
      }
    }
  });

  it('shifts past a pair the needle holds only before its last 1,024 pairs by 1,024 at most', () => {
    // The needle starts with a pair it holds nowhere else and ends with a pair it also holds two
    // units earlier: after the near miss, the next place puts that first pair under the needle's
    // end, where the needle starts 1,104 units further.
    const needle = `XY${pick('abcdefgh', 1_100)}pqpq`;
    expect(contains(`${changeAt(needle, 0)}${needle}zz`, needle)).toBe(true);
    expect(contains(`${changeAt(needle, 0)}${changeAt(needle, 600)}zz`, needle)).toBe(false);
  });

  it('resumes after Knuth-Morris-Pratt matching only where no start of the needle ends', () => {
    // A start of the needle, then the needle: the matching that follows the start reaches the
    // needle's first unit and goes on into the needle.
    const needle = `${pick('ab', 296)}abab`;
    for (let length = 1; length < needle.length; length += 1) {
      const text = `${changeAt(needle, 0)}${needle.slice(0, length)}${needle}`;
      expect(contains(text, needle), String(length)).toBe(true);
      expect(contains(text.slice(0, -1), needle), String(length)).toBe(
        text.slice(0, -1).includes(needle),
      );
    }
  });

  it('answers as includes on texts that repeat blocks, runs and borders', () => {
    const cases: Array<[string, string]> = [];
    const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
    for (let round = 0; round < 150; round++) {
      // Runs of a short period with breaks, and a needle of that period.
      const period = int(1, 70);
      const unit = pick('abc', period);
      const length = int(251, 700);
      const periodic = unit.repeat(Math.ceil(length / period) + 1).slice(0, length);
      const runs: string[] = [];
      for (let k = int(1, 6); k > 0; k--) {
        const runLength = int(1, length + 3 * period);
        const phase = int(0, period - 1);
        runs.push(
          unit.repeat(Math.ceil((runLength + phase) / period) + 1).slice(phase, phase + runLength),
        );
        runs.push(pick('abcx', int(0, 3)));
      }
      cases.push(
        [runs.join(''), periodic],
        [`${runs.join('')}${periodic.slice(0, length - 1)}`, periodic],
      );
      // Two short periods side by side.
      const first = pick('ab', int(1, 62));
      const second = pick('abc', int(1, 62));
      const sides = `${first.repeat(400).slice(0, int(125, 400))}${second.repeat(400).slice(0, int(125, 400))}`;
      cases.push(
        [`${pick('abc', int(0, 40))}${sides}`, sides],
        [changeAt(sides, int(0, sides.length - 1)), sides],
      );
      // A last 250 that ends with what it starts with, repeated with its period.
      const border = int(1, 120);
      const edge = pick('ab', border);
      const tail = `${edge}${pick('ab', 250 - 2 * border)}${edge}`.slice(0, 250).padEnd(250, 'a');
      const head = pick('ab', int(1, 300));
      const copies =
        Array.from({ length: int(2, 8) }, () => tail.slice(0, 250 - border)).join('') +
        tail.slice(250 - border);
      const where = int(0, copies.length - 250);
      cases.push([`${copies.slice(0, where)}${head}${copies.slice(where)}`, `${head}${tail}`]);
      // Text taken from random text, and the same with one unit changed.
      const text = pick('ab', int(300, 3_000));
      const taken = text.slice(0, int(251, 299));
      cases.push([text, taken], [text, changeAt(taken, int(0, taken.length - 1))]);
    }
    let present = 0;
    for (const [text, needle] of cases) {
      for (const lead of ['', changeAt(needle, 0)]) {
        expect(contains(`${lead}${text}`, needle), `${needle} in ${lead}${text}`).toBe(
          `${lead}${text}`.includes(needle),
        );
        if (`${lead}${text}`.includes(needle)) present += 1;
      }
    }
    // Both answers occur often.
    expect(present).toBeGreaterThan(cases.length / 2);
    expect(present).toBeLessThan((cases.length * 3) / 2);
  });
});
