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
 * `2 * (text + phrase)` units and at least `text + phrase - 1`.
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
  for (const family of FAMILIES) {
    it(`${family.source}: ${family.name}`, async () => {
      const counts: number[] = [];
      for (const size of SIZES) {
        const value = family.build(size);
        const units = await unitsOf(family.source, value, size);
        const where = `${family.name} at ${size} (${value.length} code units): ${units} units`;
        expect(units, where).toBeGreaterThan(0);
        expect(units, where).toBeLessThanOrEqual(UNITS_PER_CODE_UNIT * value.length);
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
      }
    });
  }

  it('counts nothing outside an observed evaluation', async () => {
    const outside = await evalFormulaOutput('PLAIN_TEXT(value; "markdown")', { value: '`a` ' });
    expect(outside.errors).toStrictEqual([]);
    const { units } = await observeWork(async () => 0);
    expect(units).toBe(0);
  });
});
