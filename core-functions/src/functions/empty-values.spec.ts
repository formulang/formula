import { evalErrors, evalOkWithOutput, withOther } from '../test-helpers/eval-formula';

/**
 * One policy for the functions added to 1.0.0: only `null` is absent (a required argument answers
 * null, an optional one takes its default, a null member of a list of texts is skipped), while
 * `""` and `[]` are values, of the wrong type wherever a text, list or number of another kind is
 * read; and the arguments are read in order, each in full, so the first that fails decides.
 */
async function answerWith(source: string, vars: Record<string, unknown>) {
  const { output, value: result } = await evalOkWithOutput(source, vars, { setup: withOther });
  return { value: result, warnings: (output.warnings ?? []).map((warning) => warning.code) };
}

async function answer(source: string, value: unknown) {
  return answerWith(source, { value });
}

const TYPE = { value: null, warnings: ['TYPE'] };
const NULL = { value: null, warnings: [] };

describe('empty values', () => {
  it('reads [] where a text is expected as a value of another type', async () => {
    for (const source of [
      'WORDS(value)',
      'WORD_COUNT(value)',
      'LEADING_WORDS(value; 1)',
      'SENTENCES(value)',
      'LINES(value)',
      'LINE_COUNT(value)',
      'FIRST_CONTAINED(value; LIST("a"))',
      'CONTAINS_ANY(value; LIST("a"))',
      'MISSING_FROM(LIST("a"); value)',
      'PLAIN_TEXT(value; "html")',
      'MARKDOWN_BLOCKS(value; "paragraph")',
    ]) {
      expect(await answer(source, []), source).toStrictEqual(TYPE);
      expect(await answer(source, null), source).toStrictEqual(NULL);
    }
  });

  it('reads "" where a list is expected as a value of another type', async () => {
    for (const source of [
      'FIRST_CONTAINED("abc"; value)',
      'CONTAINS_ANY("abc"; value)',
      'MISSING_FROM(value; "abc")',
      'SENTENCES("a. b"; "punctuation"; value)',
      'TAKE(value; 1)',
      'INDEX_OF(value; 1)',
      'FILTER_BY(value; LIST(1); ">"; 0)',
      'FILTER_BY(LIST(1); value; ">"; 0)',
      'DISTINCT(value)',
      'GROUP_COUNTS(value)',
    ]) {
      expect(await answer(source, ''), source).toStrictEqual(TYPE);
    }
    // null is no list: the keep list of SENTENCES is optional, the others answer null.
    expect(await answer('SENTENCES("a. b"; "punctuation"; value)', null)).toStrictEqual({
      value: ['a.', 'b'],
      warnings: [],
    });
    expect(await answer('TAKE(value; 1)', null)).toStrictEqual(NULL);
  });

  it('reads [] as a member of a list of texts as a value of another type, and skips null and ""', async () => {
    for (const source of [
      'FIRST_CONTAINED("abc"; value)',
      'CONTAINS_ANY("abc"; value)',
      'MISSING_FROM(value; "abc")',
      'SENTENCES("a. b"; "punctuation"; value)',
    ]) {
      expect(await answer(source, ['b', []]), source).toStrictEqual(TYPE);
    }
    expect(await answer('FIRST_CONTAINED("abc"; value)', [null, '', 'b'])).toStrictEqual({
      value: 'b',
      warnings: [],
    });
  });

  it('reads "" and [] as a count or a start as values of another type', async () => {
    for (const value of ['', []]) {
      expect(await answer('TAKE(LIST(1; 2); value)', value)).toStrictEqual(TYPE);
      expect(await answer('TAKE(LIST(1; 2); 1; value)', value)).toStrictEqual(TYPE);
      expect(await answer('LEADING_WORDS("a b"; value)', value)).toStrictEqual(TYPE);
    }
    expect(await answer('TAKE(LIST(1; 2); 1; value)', null)).toStrictEqual({
      value: [1],
      warnings: [],
    });
  });
});

describe('the order of the argument checks', () => {
  it('reads the arguments left to right, each in full, so the first that fails decides', async () => {
    // LEADING_WORDS(text, count, mode, option): the count before the mode.
    expect(await answer('LEADING_WORDS("a b"; value; "whitespace"; "de")', null)).toStrictEqual(
      NULL,
    );
    expect(await answer('LEADING_WORDS("a b"; value; "whitespace"; "de")', 1)).toStrictEqual(TYPE);
    // FILTER_BY(list, keys, ...): the list in full before the keys.
    const filterBy = 'FILTER_BY(value; other; ">"; 0)';
    expect(await answerWith(filterBy, { value: 'abc', other: null })).toStrictEqual(TYPE);
    expect(await answerWith(filterBy, { value: null, other: 'abc' })).toStrictEqual(NULL);
    expect(
      await evalErrors(
        filterBy,
        { value: Array(1001).fill(1), other: 'abc' },
        { setup: withOther },
      ),
    ).toStrictEqual(['LIST_TOO_LARGE']);
    // INDEX_OF(list, value): the list's members before the value.
    expect(
      await answerWith('INDEX_OF(value; other)', { value: [[1], 2], other: null }),
    ).toStrictEqual(TYPE);
    expect(
      await answerWith('INDEX_OF(value; other)', { value: [1, 2], other: null }),
    ).toStrictEqual(NULL);
    // MISSING_FROM(items, text, ...): the items before the text.
    const missingFrom = 'MISSING_FROM(value; other)';
    expect(await answerWith(missingFrom, { value: ['a', 2], other: null })).toStrictEqual(TYPE);
    expect(await answerWith(missingFrom, { value: ['a'], other: null })).toStrictEqual(NULL);
    // FILTER_BY(list, keys, ...): the keys in full before the lengths are compared.
    const unequal = 'FILTER_BY(LIST(1); value; ">"; 0)';
    expect(await evalErrors(unequal, { value: Array(1001).fill(1) })).toStrictEqual([
      'LIST_TOO_LARGE',
    ]);
    expect(await answer(unequal, [1, 2])).toStrictEqual(TYPE);
    // FIRST_CONTAINED(text, phrases, match, ignoreCase): every argument before the phrase lengths.
    const long = { value: ['a'.repeat(251)], other: 'yes' };
    expect(await answerWith('FIRST_CONTAINED("a"; value; "substring"; other)', long)).toStrictEqual(
      TYPE,
    );
    expect(
      await evalErrors(
        'FIRST_CONTAINED("a"; value; "substring"; other)',
        { ...long, other: null },
        {
          setup: withOther,
        },
      ),
    ).toStrictEqual(['PHRASE_TOO_LONG']);
  });
});
