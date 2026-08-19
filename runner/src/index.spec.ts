import { createCoreFormulaRuntime } from '@formulang/core-functions';
import type { FormulaType } from '@formulang/definitions';
import { FormulaTypes, optimizeRule } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleAsync } from './index';

describe('evaluateRule', () => {
  async function evalFormula(source: string): Promise<unknown> {
    const { registry, implementations } = createCoreFormulaRuntime();
    const parsed = parseFormula(source, { registry });
    const compiled = optimizeRule(parsed, { registry });
    const res = await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: {},
    });
    expect(res.errors.length).toBe(0);
    return res.value;
  }

  async function evalWithExpectedReturnType(source: string, expectedReturnType: FormulaType) {
    const { registry, implementations } = createCoreFormulaRuntime();
    const parsed = parseFormula(source, { registry });
    const compiled = optimizeRule(parsed, { registry });
    return evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: {},
      expectedReturnType,
    });
  }

  it('evaluates arithmetic', async () => {
    const { registry, implementations } = createCoreFormulaRuntime();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    const parsed = parseFormula('1 + 2', { registry });
    const compiled = optimizeRule(parsed, { registry });
    const res = await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: {},
    });
    expect(res.errors.length).toBe(0);
    expect(res.value).toBe(3);
  });

  it('formula: coerces numeric strings in comparisons', async () => {
    expect(await evalFormula('1 = "1"')).toBe(true);
    expect(await evalFormula('"2" > 1')).toBe(true);
    expect(await evalFormula('"01" = "1"')).toBe(true);
  });

  it('formula: treats empty string as no value in comparisons', async () => {
    expect(await evalFormula('"" = 0')).toBeNull();
    expect(await evalFormula('"" = "0"')).toBeNull();
    expect(await evalFormula('"" = ""')).toBeNull();
  });

  it('formula: coerces only obvious boolean strings in comparisons', async () => {
    expect(await evalFormula('"true" = true')).toBe(true);
    expect(await evalFormula('"FALSE" = false')).toBe(true);
    expect(await evalFormula('"yes" = true')).toBe(false);
  });

  it('formula: coerces list to number for comparisons (COUNT semantics)', async () => {
    const { registry, implementations } = createCoreFormulaRuntime();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });

    const evalWithValue = async (formula: string, value: unknown) => {
      const parsed = parseFormula(formula, { registry });
      const compiled = optimizeRule(parsed, { registry });
      const res = await evaluateRuleAsync(compiled, {
        registry,
        resolver: implementations,
        variables: { value },
      });
      expect(res.errors.length).toBe(0);
      return res.value;
    };

    expect(await evalWithValue('value > 0', [])).toBe(false);
    expect(await evalWithValue('value = 0', [])).toBe(true);
    expect(await evalWithValue('value > 0', [null])).toBe(true);
    expect(await evalWithValue('value > 0', [1, 2])).toBe(true);
    expect(await evalWithValue('value < 2', [1, 2])).toBe(false);
    expect(await evalWithValue('value > "0"', ['x'])).toBe(true);
  });

  it('formula: evaluates comparison operators for lower_snake_case variable names', async () => {
    const { registry, implementations } = createCoreFormulaRuntime();
    registry.registerVariable({
      name: 'max_length',
      description: 'The maximum length value.',
      type: FormulaTypes.number(true),
    });

    const evalWithMaxLength = async (formula: string, max_length: unknown) => {
      const parsed = parseFormula(formula, { registry });
      const compiled = optimizeRule(parsed, { registry });
      const res = await evaluateRuleAsync(compiled, {
        registry,
        resolver: implementations,
        variables: { max_length },
      });
      expect(res.errors.length).toBe(0);
      return res.value;
    };

    expect(await evalWithMaxLength('max_length > 0', 2)).toBe(true);
    expect(await evalWithMaxLength('max_length >= 2', 2)).toBe(true);
    expect(await evalWithMaxLength('max_length < 3', 2)).toBe(true);
    expect(await evalWithMaxLength('max_length <= 2', 2)).toBe(true);
    expect(await evalWithMaxLength('max_length = 2', 2)).toBe(true);
    expect(await evalWithMaxLength('max_length <> 2', 2)).toBe(false);
  });

  it('formula: supports IF with comma-separated arguments and snake_case variable checks', async () => {
    const { registry, implementations } = createCoreFormulaRuntime();
    registry.registerVariable({
      name: 'max_length',
      description: 'The maximum length value.',
      type: FormulaTypes.number(true),
    });

    const parsed = parseFormula('IF(max_length > 0, "this", "that")', {
      registry,
      syntax: { argumentSeparator: ',' },
    });
    const compiled = optimizeRule(parsed, { registry });
    const res = await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: { max_length: 5 },
    });
    expect(res.errors.length).toBe(0);
    expect(res.value).toBe('this');
  });

  it('formula: supports IF with no-space <> between snake_case variables', async () => {
    const { registry, implementations } = createCoreFormulaRuntime();
    registry.registerVariable({
      name: 'some_variable',
      description: 'A first test value.',
      type: FormulaTypes.any(true),
    });
    registry.registerVariable({
      name: 'some_other_variable',
      description: 'A second test value.',
      type: FormulaTypes.any(true),
    });

    const parsed = parseFormula('IF(some_variable<>some_other_variable,"stuff","yes")', {
      registry,
      syntax: { argumentSeparator: ',' },
    });
    const compiled = optimizeRule(parsed, { registry });

    const a = await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: { some_variable: 'a', some_other_variable: 'b' },
    });
    expect(a.errors.length).toBe(0);
    expect(a.value).toBe('stuff');

    const b = await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: { some_variable: 'a', some_other_variable: 'a' },
    });
    expect(b.errors.length).toBe(0);
    expect(b.value).toBe('yes');
  });

  it('returns null for denylisted property', async () => {
    const { registry, implementations } = createCoreFormulaRuntime();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    const parsed = parseFormula('value.__proto__', { registry });
    const compiled = optimizeRule(parsed, { registry });
    const res = await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: { value: { a: 1 } },
    });
    expect(res.errors.some((e) => e.code === 'DENYLISTED_PROPERTY')).toBe(true);
  });

  it('maps wildcard over list and flattens one level', async () => {
    const { registry, implementations } = createCoreFormulaRuntime();
    registry.registerVariable({
      name: 'value',
      description: 'A test list of items.',
      type: FormulaTypes.list(
        FormulaTypes.object('Row', {
          ids: FormulaTypes.list(FormulaTypes.number(false), true),
        }),
        true,
      ),
    });
    const parsed = parseFormula('value.*.ids', { registry });
    const compiled = optimizeRule(parsed, { registry });
    const res = await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: { value: [{ ids: [1, 2] }, { ids: [3] }] },
    });
    expect(res.value).toStrictEqual([1, 2, 3]);
  });

  it('supports union types for expected output enforcement', async () => {
    const expected = FormulaTypes.union([FormulaTypes.number(false), FormulaTypes.text(false)]);

    const ok = await evalWithExpectedReturnType('1 + 2', expected);
    expect(ok.errors).toStrictEqual([]);
    expect(ok.value).toBe(3);

    const bad = await evalWithExpectedReturnType('LIST(1;2)', expected);
    expect(bad.errors.some((e) => e.code === 'OUTPUT_TYPE_NOT_ALLOWED')).toBe(true);
  });
});
