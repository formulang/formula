import { evalFormulaOutput, withOther } from '../test-helpers/eval-formula';
import { observeWork } from './work-meter';

/**
 * The work of the text functions whose loops docs/functions.md (_Text_, **Work**) says read their
 * input in linear time, counted by the meter those loops feed (`work-meter.ts`): one unit per step
 * of a loop and per code unit one of the code's own `indexOf` scans reads. For each function,
 * inputs built to make one of its loops work hardest are evaluated at three sizes, each twice the
 * one before. The count must grow with the input and in proportion to it (between 1.8 and 2.2
 * times as much at twice the size), and stay within `UNITS_PER_CODE_UNIT` units per code unit of
 * the input; a loop that reads again what it has read (a cursor not kept, a search started over)
 * breaks the last two. The Knuth-Morris-Pratt searches are held to their own bound, at most
 * `2 * (text + phrase)` units and at least `text + phrase - 1`. Every input whose count is a fixed
 * number of units per repetition is also held to that exact count (`EXACT`), so a step a loop
 * stops reporting fails the spec too; the two that have none say why (`NOT_EXACT`).
 */

/** The most units of work any of these functions may count per code unit of its input. */
const UNITS_PER_CODE_UNIT = 6;

/** The sizes each input is built at: how many times its piece repeats. */
const SIZES = [1000, 2000, 4000];

type Family = {
  /** What the input makes the function do. */
  name: string;
  /** The formula, reading the input from `value` (and a size from `other`, where it names one). */
  source: string;
  /** The input at a size. */
  build: (size: number) => string;
};

const FAMILIES: Family[] = [
  { name: 'html text', source: 'PLAIN_TEXT(value; "html")', build: (k) => 'ab cd '.repeat(k) },
  { name: 'html tags', source: 'PLAIN_TEXT(value; "html")', build: (k) => '<b>x</b>'.repeat(k) },
  {
    name: 'html attributes',
    source: 'PLAIN_TEXT(value; "html")',
    build: (k) => `<a href="x>y" title='z' b=c>w</a>`.repeat(k),
  },
  {
    name: 'html comments',
    source: 'PLAIN_TEXT(value; "html")',
    build: (k) => 'x<!-- c -- d -->'.repeat(k),
  },
  {
    name: 'html comment never closed',
    source: 'PLAIN_TEXT(value; "html")',
    build: (k) => '<!--' + '--x'.repeat(k),
  },
  {
    name: 'html declarations',
    source: 'PLAIN_TEXT(value; "html")',
    build: (k) => '<!x>y'.repeat(k),
  },
  {
    name: 'html dropped content',
    source: 'PLAIN_TEXT(value; "html")',
    build: (k) => '<script>x</script>y<head><noscript>n</noscript></head>'.repeat(k),
  },
  {
    name: 'html end tags that almost close',
    source: 'PLAIN_TEXT(value; "html")',
    build: (k) => '<script>' + '</scrip x'.repeat(k),
  },
  {
    name: 'html references',
    source: 'PLAIN_TEXT(value; "html")',
    build: (k) => '&amp;&#65;x'.repeat(k),
  },
  { name: 'html lone <', source: 'PLAIN_TEXT(value; "html")', build: (k) => '1 < 2 '.repeat(k) },
  {
    name: 'html pre',
    source: 'PLAIN_TEXT(value; "html")',
    build: (k) => '<pre>a\nb</pre>'.repeat(k),
  },
  {
    name: 'markdown code spans',
    source: 'PLAIN_TEXT(value; "markdown")',
    build: (k) => '`a` '.repeat(k),
  },
  {
    name: 'markdown code spans in a paragraph block',
    source: 'MARKDOWN_BLOCKS(value; "paragraph")',
    build: (k) => '`a` '.repeat(k),
  },
  {
    name: 'markdown backtick runs that pair with none',
    source: 'PLAIN_TEXT(value; "markdown")',
    build: (k) => '`a`` '.repeat(k),
  },
  {
    name: 'markdown backtick runs in a list item block',
    source: 'MARKDOWN_BLOCKS(value; "list-item")',
    build: (k) => '- ' + '``a` '.repeat(k),
  },
  {
    name: 'markdown emphasis',
    source: 'PLAIN_TEXT(value; "markdown")',
    build: (k) => '*a* _b_ '.repeat(k),
  },
  {
    name: 'markdown runs that open and never close',
    source: 'PLAIN_TEXT(value; "markdown")',
    build: (k) => '*a _b '.repeat(k),
  },
  {
    name: 'markdown runs of both markers interleaved',
    source: 'MARKDOWN_BLOCKS(value; "paragraph")',
    build: (k) => '_a *b_ c* '.repeat(k),
  },
  {
    name: 'markdown links',
    source: 'PLAIN_TEXT(value; "markdown")',
    build: (k) => '[a](b) ![c](d) <https://e.f> '.repeat(k),
  },
  {
    name: 'markdown escapes',
    source: 'PLAIN_TEXT(value; "markdown")',
    build: (k) => '\\* \\` '.repeat(k),
  },
  {
    name: 'markdown list items',
    source: 'MARKDOWN_BLOCKS(value; "list-item")',
    build: (k) => '- a\n'.repeat(k),
  },
  {
    name: 'markdown table rows',
    source: 'MARKDOWN_BLOCKS(value; "table-row")',
    build: (k) => '| a | b |\n|---|---|\n' + '| 1 | 2 |\n'.repeat(k),
  },
  {
    name: 'markdown headings',
    source: 'MARKDOWN_BLOCKS(value; "heading")',
    build: (k) => '## a ##\n'.repeat(k),
  },
  {
    name: 'markdown quotes',
    source: 'MARKDOWN_BLOCKS(value; "paragraph")',
    build: (k) => '> > q\n'.repeat(k),
  },
  {
    name: 'markdown fences',
    source: 'MARKDOWN_BLOCKS(value; "code")',
    build: (k) => '```\nx\n```\n'.repeat(k),
  },
  { name: 'sentences', source: 'SENTENCES(value)', build: (k) => 'Ab. '.repeat(k) },
  {
    name: 'sentences with keep tokens at every place',
    source: 'SENTENCES(value; "punctuation"; LIST("b. A"; "Ab."; "aaa"))',
    build: (k) => 'Ab. '.repeat(k) + 'a'.repeat(k),
  },
  {
    name: 'sentences by terminators',
    source: 'SENTENCES(value; "terminators")',
    build: (k) => 'ab.! '.repeat(k),
  },
  { name: 'lines', source: 'LINES(value)', build: (k) => 'ab\r\n'.repeat(k) },
  {
    name: 'non-blank lines counted',
    source: 'LINE_COUNT(value; "non-blank")',
    build: (k) => ' \na\n'.repeat(k),
  },
  { name: 'words', source: 'WORDS(value)', build: (k) => 'a '.repeat(k) },
  {
    name: 'words by letters',
    source: 'WORD_COUNT(value; "letters")',
    build: (k) => 'a, '.repeat(k),
  },
  {
    name: 'leading words',
    source: 'LEADING_WORDS(value; other)',
    build: (k) => 'a '.repeat(k),
  },
  {
    name: 'words by locale',
    source: 'WORD_COUNT(value; "locale"; "en")',
    build: (k) => 'a b '.repeat(k),
  },
];

/** The Knuth-Morris-Pratt searches: one phrase, in `"word"` mode, over a text. */
type Search = { name: string; source: string; phrase: string; build: (size: number) => string };

const SEARCHES: Search[] = [
  {
    name: 'a phrase found at every place, each occurrence inside a word',
    source: 'FIRST_CONTAINED(value; LIST(other); "word")',
    phrase: 'a'.repeat(250),
    build: (k) => 'a'.repeat(4 * k),
  },
  {
    name: 'a phrase that fails at its last unit at every place',
    source: 'CONTAINS_ANY(value; LIST(other); "word")',
    phrase: 'a'.repeat(249) + 'b',
    build: (k) => 'a'.repeat(4 * k),
  },
  {
    name: 'a phrase whose occurrences overlap',
    source: 'FIRST_CONTAINED(value; LIST(other); "word"; TRUE)',
    phrase: 'aba',
    build: (k) => 'AB'.repeat(2 * k),
  },
];

/**
 * The meter's exact count on each input whose count is a fixed number of units per repetition of
 * its piece plus a fixed number once, `[per repetition, once]`, as the loops work it out, so that
 * every step a loop reports is held, not only the bound. Two worked through:
 *
 * - The code spans, `` `a` `` and a space: per repetition 8, as the constructor of the backtick
 *   runs finds two runs (a step and the two code units its `indexOf` reads, for each), the inline
 *   scan steps twice (the opening run, the space) and the cursor twice; once -1, as the first
 *   `indexOf` reads one code unit (+1), the paragraph's line is trimmed of its last space (one
 *   code unit fewer read after the last run, and one scan step fewer: -2), the first cursor call
 *   steps once (-1), and the paragraph is one line (+1).
 * - 249 `a`s and a `b` searched for over `a`s: per repetition (four code units of text) 8, two
 *   per code unit, a step and one step back along the borders at the `b`; once 248, as the
 *   borders take 249 steps and 248 steps back at the `b` (+497) and the first 249 code units of
 *   the text never step back (-249).
 */
const EXACT: Record<string, [number, number]> = {
  'html text': [6, 1],
  'html tags': [5, 0],
  'html attributes': [30, 0],
  'html comments': [11, 0],
  'html comment never closed': [3, 2],
  'html declarations': [5, 1],
  'html dropped content': [15, 0],
  'html end tags that almost close': [9, 3],
  'html references': [11, 1],
  'html lone <': [6, 1],
  'html pre': [7, 0],
  'markdown code spans': [8, -1],
  'markdown code spans in a paragraph block': [8, -1],
  'markdown emphasis': [12, 0],
  'markdown runs that open and never close': [8, 0],
  'markdown runs of both markers interleaved': [15, 0],
  'markdown links': [8, 0],
  'markdown escapes': [4, 0],
  'markdown list items': [2, 1],
  'markdown table rows': [3, 4],
  'markdown headings': [2, 1],
  'markdown quotes': [3, 0],
  'markdown fences': [3, 1],
  sentences: [1, 0],
  'sentences with keep tokens at every place': [21, 9],
  'sentences by terminators': [1, 0],
  lines: [1, 0],
  'non-blank lines counted': [2, 0],
  words: [1, 0],
  'words by letters': [1, 0],
  'leading words': [1, 0],
  'words by locale': [4, 0],
  'a phrase found at every place, each occurrence inside a word': [4, 249],
  'a phrase that fails at its last unit at every place': [8, 248],
  'a phrase whose occurrences overlap': [4, 2],
};

/** The inputs whose count is no fixed number per repetition, and why. */
const NOT_EXACT: Record<string, string> = {
  'markdown backtick runs that pair with none':
    'runs of one and of two backticks pair across repetitions, so the cursor steps differ between them',
  'markdown backtick runs in a list item block':
    'runs of one and of two backticks pair across repetitions, so the cursor steps differ between them',
};

/** The units of work an evaluation counts, and that it reports no error. */
async function unitsOf(source: string, value: string, other: unknown): Promise<number> {
  const { result, units } = await observeWork(() =>
    evalFormulaOutput(source, { value, other }, { setup: withOther }),
  );
  const codes = [...result.parsed.errors, ...result.compiled.errors, ...result.errors].map(
    (error) => error.code,
  );
  expect(codes, source).toStrictEqual([]);
  return units;
}

describe('the work of the text functions whose loops read their input in linear time', () => {
  it('holds every input either to an exact count or to a reason it has none', () => {
    const names = [...FAMILIES, ...SEARCHES].map((input) => input.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...Object.keys(EXACT), ...Object.keys(NOT_EXACT)].sort()).toStrictEqual(
      [...names].sort(),
    );
  });

  for (const family of FAMILIES) {
    it(`${family.source}: ${family.name}`, async () => {
      const counts: number[] = [];
      for (const size of SIZES) {
        const value = family.build(size);
        const units = await unitsOf(family.source, value, size);
        const where = `${family.name} at ${size} (${value.length} code units): ${units} units`;
        expect(units, where).toBeGreaterThan(0);
        expect(units, where).toBeLessThanOrEqual(UNITS_PER_CODE_UNIT * value.length);
        if (family.name in EXACT) {
          const [perRepetition, once] = EXACT[family.name];
          expect(units, where).toBe(perRepetition * size + once);
        }
        counts.push(units);
      }
      for (let index = 1; index < counts.length; index++) {
        const growth = counts[index] / counts[index - 1];
        const where = `${family.name}: ${counts.join(', ')} units at ${SIZES.join(', ')}`;
        expect(growth, where).toBeGreaterThanOrEqual(1.8);
        expect(growth, where).toBeLessThanOrEqual(2.2);
      }
    });
  }

  for (const search of SEARCHES) {
    it(`${search.source}: ${search.name}`, async () => {
      for (const size of SIZES) {
        const text = search.build(size);
        const units = await unitsOf(search.source, text, search.phrase);
        const where = `${search.name} at ${text.length} code units: ${units} units`;
        expect(units, where).toBeGreaterThanOrEqual(text.length + search.phrase.length - 1);
        expect(units, where).toBeLessThanOrEqual(2 * (text.length + search.phrase.length));
        const [perRepetition, once] = EXACT[search.name];
        expect(units, where).toBe(perRepetition * size + once);
      }
    });
  }

  it('counts nothing outside an observed evaluation', async () => {
    const outside = await evalFormulaOutput('PLAIN_TEXT(value; "markdown")', { value: '`a` ' });
    expect(outside.errors).toStrictEqual([]);
    const { units } = await observeWork(async () => 0);
    expect(units).toBe(0);
  });

  it('gives each observation its own count, an outer one counting again once an inner one ends', async () => {
    const source = 'PLAIN_TEXT(value; "markdown")';
    const alone = await unitsOf(source, '`a` ', null);
    const outer = await observeWork(async () => {
      const inner = await observeWork(() => evalFormulaOutput(source, { value: '`a` ' }));
      await evalFormulaOutput(source, { value: '`a` ' });
      return inner.units;
    });
    expect(alone).toBeGreaterThan(0);
    expect(outer.result).toBe(alone);
    expect(outer.units).toBe(alone);
  });
});
