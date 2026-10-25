/**
 * The inputs on which the work of the text functions is counted: built to make each loop that walks
 * the input work hardest, each at three sizes, with the exact count where the loops give one. Read
 * by `work-bounds.spec.ts`, and by the judge that times a surviving mutant on each input at its
 * largest size before calling it equivalent (`WORST_CASES`).
 */

/** The most units of work any of these functions may count per code unit of its input. */
export const UNITS_PER_CODE_UNIT = 6;

/** The sizes each input is built at: how many times its piece repeats. */
export const SIZES = [1000, 2000, 4000];

export type Family = {
  /** What the input makes the function do. */
  name: string;
  /** The formula, reading the input from `value` (and a size from `other`, where it names one). */
  source: string;
  /** The input at a size. */
  build: (size: number) => string;
};

export const FAMILIES: Family[] = [
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
export type Search = {
  name: string;
  source: string;
  phrase: string;
  build: (size: number) => string;
};

export const SEARCHES: Search[] = [
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
export const EXACT: Record<string, [number, number]> = {
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
  'sentences with keep tokens at every place': [21, 12],
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
export const NOT_EXACT: Record<string, string> = {
  'markdown backtick runs that pair with none':
    'runs of one and of two backticks pair across repetitions, so the cursor steps differ between them',
  'markdown backtick runs in a list item block':
    'runs of one and of two backticks pair across repetitions, so the cursor steps differ between them',
};

/**
 * `keep` tokens longer than the text they protect: none can occur in it, so each costs the search
 * one step whatever its length, and SENTENCES works in proportion to the text and the number of
 * tokens, not to their length. `TOKENS` tokens of `TOKEN_LENGTH` code units, the same text each.
 */
export const KEEP_LONG = {
  name: 'keep tokens longer than the text',
  source: 'SENTENCES("a. b"; "punctuation"; value)',
  tokens: 1000,
  tokenLength: 1_000_000,
  build: (tokens: number, tokenLength: number): string[] =>
    Array<string>(tokens).fill('x'.repeat(tokenLength)),
};

/** One input at its largest size: what the judge of equivalence times on the head and a mutant. */
export type WorstCase = { name: string; source: string; value: unknown; other: unknown };

/** Every input of the corpus at its largest size, the families, the searches and `KEEP_LONG`. */
export function worstCases(): WorstCase[] {
  const size = SIZES[SIZES.length - 1];
  return [
    ...FAMILIES.map((family) => ({
      name: family.name,
      source: family.source,
      value: family.build(size),
      other: size,
    })),
    ...SEARCHES.map((search) => ({
      name: search.name,
      source: search.source,
      value: search.build(size),
      other: search.phrase,
    })),
    {
      name: KEEP_LONG.name,
      source: KEEP_LONG.source,
      value: KEEP_LONG.build(KEEP_LONG.tokens, KEEP_LONG.tokenLength),
      other: null,
    },
  ];
}
