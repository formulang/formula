import { createCoreFormulaRuntime } from '@formulang/core-functions';
import {
  FormulaErrorCodes,
  FormulaTypes,
  optimizeRule,
  type FormulaType,
} from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleAsync } from './index';

function createTestRuntime(valueType: FormulaType = FormulaTypes.any(true)) {
  const { registry, implementations } = createCoreFormulaRuntime();
  registry.registerVariable({
    name: 'value',
    description: 'A test input value.',
    type: valueType,
  });
  return { registry, implementations };
}

async function evalFormula(
  formula: string,
  vars: Record<string, unknown> = {},
  valueType: Parameters<typeof createTestRuntime>[0] = FormulaTypes.any(true),
) {
  const { registry, implementations } = createTestRuntime(valueType);
  const parsed = parseFormula(formula, { registry });
  const compiled = optimizeRule(parsed, { registry });
  const res = await evaluateRuleAsync(compiled, {
    registry,
    resolver: implementations,
    variables: vars,
  });
  return { parsed, compiled, res };
}

describe('builtins', () => {
  it('supports operator precedence: 1 + 2 * 3 == 7', async () => {
    const { res } = await evalFormula('1 + 2 * 3');
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toBe(7);
  });

  it('supports comparisons: 2 >= 2 is true', async () => {
    const { res } = await evalFormula('2 >= 2');
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toBe(true);
  });

  it('supports IF short-circuit (does not evaluate else branch)', async () => {
    const { res } = await evalFormula(
      'IF(TRUE; 1; value.foo)',
      { value: 123 },
      FormulaTypes.object('Obj', { foo: FormulaTypes.any(true) }, true),
    );
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toBe(1);
  });

  it('supports ampersand concat operator with CHAR newline', async () => {
    const { res } = await evalFormula('"Issues to fix:" & CHAR(10) & "A"');
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toBe('Issues to fix:\nA');
  });

  it('supports IF + IS_EMPTY + ampersand concat expression', async () => {
    const { registry, implementations } = createCoreFormulaRuntime();
    registry.registerVariable({
      name: 'issue_descriptions',
      description: 'Issue descriptions text.',
      type: FormulaTypes.text(true),
    });

    const formula =
      'IF(IS_EMPTY(issue_descriptions); ""; "Issues to fix:" & CHAR(10) & issue_descriptions)';

    const parsedEmpty = parseFormula(formula, { registry });
    const compiledEmpty = optimizeRule(parsedEmpty, { registry });
    const empty = await evaluateRuleAsync(compiledEmpty, {
      registry,
      resolver: implementations,
      variables: { issue_descriptions: '' },
    });

    expect(parsedEmpty.errors).toStrictEqual([]);
    expect(compiledEmpty.errors).toStrictEqual([]);
    expect(empty.errors).toStrictEqual([]);
    expect(empty.value).toBe('');

    const parsedText = parseFormula(formula, { registry });
    const compiledText = optimizeRule(parsedText, { registry });
    const text = await evaluateRuleAsync(compiledText, {
      registry,
      resolver: implementations,
      variables: { issue_descriptions: 'Fix login bug' },
    });

    expect(parsedText.errors).toStrictEqual([]);
    expect(compiledText.errors).toStrictEqual([]);
    expect(text.errors).toStrictEqual([]);
    expect(text.value).toBe('Issues to fix:\nFix login bug');
  });

  it('validates FILTER operator parameter must be string literal', () => {
    const { registry } = createTestRuntime();
    registry.registerVariable({
      name: 'op',
      description: 'A test operator name.',
      type: FormulaTypes.text(false),
    });
    const parsed = parseFormula('FILTER(LIST(1;2); op; 1)', { registry });
    expect(
      parsed.errors.some(
        (e: any) => e.code === FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
      ),
    ).toBe(true);
  });

  it('FILTER with STARTS_WITH works', async () => {
    const { res } = await evalFormula('FILTER(LIST("data:a";"x"); "STARTS_WITH"; "data:")');
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toStrictEqual(['data:a']);
  });

  it('LIST requires all items have same type', async () => {
    const { parsed, compiled } = await evalFormula('LIST(1; "2")');
    expect(
      [...parsed.errors, ...compiled.errors].some(
        (e: any) => e.code === FormulaErrorCodes.ARGUMENT_TYPES_MUST_HAVE_SAME_TYPE,
      ),
    ).toBe(true);
  });

  it('IS_EMPTY treats null/empty string/empty list as empty', async () => {
    expect((await evalFormula('IS_EMPTY(1/0)')).res.value).toBe(true);
    expect((await evalFormula('IS_EMPTY("")')).res.value).toBe(true);
    expect((await evalFormula('IS_EMPTY(LIST())')).res.value).toBe(true);
    expect((await evalFormula('IS_EMPTY(0)')).res.value).toBe(false);
  });

  it('AVG ignores nulls and averages numbers', async () => {
    const { res } = await evalFormula('AVG(LIST(1;2;3))');
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toBe(2);
  });

  it('RANGE_SCORE returns 1 inside warn range', async () => {
    const { res } = await evalFormula('RANGE_SCORE(5; 0; 3; 7; 10)');
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toBe(1);
  });

  it('COUNT_UNIQUE counts unique non-empty values', async () => {
    const { res } = await evalFormula('COUNT_UNIQUE("a";"a";"b";"";1/0)');
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toBe(2);
  });

  it('FLAT fully flattens nested lists', async () => {
    const { res } = await evalFormula('FLAT(LIST(LIST(1;2); LIST(3)))');
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toStrictEqual([1, 2, 3]);
  });

  it('LENGTH is an alias for LEN', async () => {
    const { res } = await evalFormula('LENGTH("abc")');
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toBe(3);
  });

  it('LOWER/UPPER work', async () => {
    expect((await evalFormula('LOWER("AbC")')).res.value).toBe('abc');
    expect((await evalFormula('UPPER("AbC")')).res.value).toBe('ABC');
  });

  it('STARTS_WITH supports prefix list overload', async () => {
    const { res } = await evalFormula('STARTS_WITH("xyz123"; LIST("abc";"xyz"))');
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toBe(true);
  });

  it('INCLUDES returns true when list contains value', async () => {
    const { res } = await evalFormula('INCLUDES(LIST("a";"b"); "b")');
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toBe(true);
  });

  it('EACH maps over list items', async () => {
    const { res } = await evalFormula('EACH(value; "LEN")', { value: ['a', 'bb'] });
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toStrictEqual([1, 2]);
  });

  it('FILTER_PROPERTY filters objects by nested property', async () => {
    const items = [{ a: { b: 1 } }, { a: { b: 2 } }, { a: null }];
    const { res } = await evalFormula('FILTER_PROPERTY(value; "a.b"; "="; 2)', { value: items });
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toStrictEqual([items[1]]);
  });

  it('segments a text variable into words, sentences and lines', async () => {
    const text = 'Wir helfen z. B. Handwerkern.\nKennst du das?';
    const counts = await evalFormula(
      'LIST(WORD_COUNT(value); COUNT(SENTENCES(value; "punctuation"; LIST("z. B."))); LINE_COUNT(value))',
      { value: text },
      FormulaTypes.text(true),
    );
    expect(counts.res.errors).toStrictEqual([]);
    expect(counts.res.value).toStrictEqual([8, 2, 2]);

    const opening = await evalFormula(
      'LEADING_WORDS(value; 2)',
      { value: text },
      FormulaTypes.text(true),
    );
    expect(opening.res.errors).toStrictEqual([]);
    expect(opening.res.value).toBe('Wir helfen');
  });

  it('checks phrases and headings of a markdown document variable', async () => {
    const document = ['## 1. Erstens', 'Kennst du das?', '## 2. Zweitens', '- Punkt'].join('\n');
    const missing = await evalFormula(
      'MISSING_FROM(LIST("1. Erstens"; "3. Drittens"); JOIN(MARKDOWN_BLOCKS(value; "heading-2"); " | "))',
      { value: document },
      FormulaTypes.text(true),
    );
    expect(missing.res.errors).toStrictEqual([]);
    expect(missing.res.value).toStrictEqual(['3. Drittens']);

    const phrase = await evalFormula(
      'FIRST_CONTAINED(LOWER(PLAIN_TEXT(value; "markdown")); LIST("oder?"; "kennst du das?"))',
      { value: document },
      FormulaTypes.text(true),
    );
    expect(phrase.res.errors).toStrictEqual([]);
    expect(phrase.res.value).toBe('kennst du das?');
  });

  it('slices, filters and groups a list variable', async () => {
    const segments = ['craft', 'retail', 'craft'];
    const listOfText = FormulaTypes.list(FormulaTypes.text(true), true);
    const grouped = await evalFormula(
      'LIST(MAX(GROUP_COUNTS(value)) - MIN(GROUP_COUNTS(value)); COUNT(DISTINCT(value)); INDEX_OF(value; "retail"))',
      { value: segments },
      listOfText,
    );
    expect(grouped.res.errors).toStrictEqual([]);
    expect(grouped.res.value).toStrictEqual([1, 2, 2]);

    const kept = await evalFormula(
      'TAKE(FILTER_BY(value; LIST(3; 1; 5); ">"; 2); 1)',
      { value: segments },
      listOfText,
    );
    expect(kept.res.errors).toStrictEqual([]);
    expect(kept.res.value).toStrictEqual(['craft']);
  });

  it('resolves a function name a higher-order call passes on when it runs', async () => {
    const nested = await evalFormula('EACH(LIST(LIST(1; 2; 3)); "FILTER"; ">"; 1)');
    expect(nested.parsed.errors).toStrictEqual([]);
    expect(nested.res.value).toStrictEqual([[2, 3]]);

    // A name the registry does not know invokes nothing: the nested FILTER yields null.
    const unknown = await evalFormula('EACH(LIST(LIST(1; 2; 3)); "FILTER"; "NOPE")');
    expect(unknown.parsed.errors).toStrictEqual([]);
    expect(unknown.res.errors).toStrictEqual([]);
    expect(unknown.res.value).toStrictEqual([null]);
  });

  it('estimated cost counts nested calls exactly once', () => {
    const { registry } = createTestRuntime();
    registry.registerVariable({
      name: 'a',
      description: 'A test text value.',
      type: FormulaTypes.text(true),
    });
    registry.registerVariable({
      name: 'b',
      description: 'A test text value.',
      type: FormulaTypes.text(true),
    });
    registry.registerVariable({
      name: 'x',
      description: 'A test text value.',
      type: FormulaTypes.text(true),
    });

    const nested = optimizeRule(parseFormula('LEN(CONCAT(a; b))', { registry }), { registry });
    expect(nested.errors).toStrictEqual([]);
    expect(nested.requirements.estimatedCostUnits).toBe(0);

    const concatOnly = optimizeRule(parseFormula('CONCAT(a; b)', { registry }), { registry });
    const lenOnly = optimizeRule(parseFormula('LEN(x)', { registry }), { registry });
    expect(concatOnly.errors).toStrictEqual([]);
    expect(lenOnly.errors).toStrictEqual([]);

    const expected =
      concatOnly.requirements.estimatedCostUnits + lenOnly.requirements.estimatedCostUnits;
    expect(nested.requirements.estimatedCostUnits).toBeCloseTo(expected, 12);
  });

  it('estimated cost uses average assumptions for dynamic args', () => {
    const { registry } = createTestRuntime();
    registry.registerVariable({
      name: 'x',
      description: 'A test text value.',
      type: FormulaTypes.text(true),
    });
    registry.registerVariable({
      name: 'items',
      description: 'A test list of items.',
      type: FormulaTypes.list(FormulaTypes.any(true), true),
    });

    const lenDyn = optimizeRule(parseFormula('LEN(x)', { registry }), { registry });
    expect(lenDyn.errors).toStrictEqual([]);
    expect(lenDyn.requirements.estimatedCostUnits).toBe(0);

    const filterDyn = optimizeRule(parseFormula('FILTER(items; "="; 1)', { registry }), {
      registry,
    });
    expect(filterDyn.errors).toStrictEqual([]);
    expect(filterDyn.requirements.estimatedCostUnits).toBe(0);
  });
});
