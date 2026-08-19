import { createCoreFormulaRuntime } from '@formulang/core-functions';
import { DEFAULT_FORMULA_LIMITS, FormulaTypes, resolveFormulaLimits } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleAsync } from './index';

describe('formula security limits', () => {
  function makeRuntime() {
    const { registry, implementations } = createCoreFormulaRuntime();
    registry.registerVariable({
      name: 'text',
      description: 'A test text value.',
      type: FormulaTypes.text(true),
    });
    return { registry, implementations };
  }

  it('rejects overly long source', () => {
    const { registry } = makeRuntime();
    const src = '1'.repeat(DEFAULT_FORMULA_LIMITS.maxSourceLength + 1);
    const rule = parseFormula(src, { registry });
    expect(rule.errors.some((e: any) => e.code === 'SOURCE_TOO_LONG')).toBe(true);
  });

  it('rejects too many tokens', () => {
    const { registry } = makeRuntime();
    // Build a long but valid expression: 1+1+1...
    const repeats = Math.floor(DEFAULT_FORMULA_LIMITS.maxTokens / 2) + 50;
    const parts: string[] = ['1'];
    for (let i = 0; i < repeats; i++) parts.push('+1');
    const src = parts.join('');
    const rule = parseFormula(src, { registry });
    expect(
      rule.errors.some((e: any) => e.code === 'TOO_MANY_TOKENS' || e.code === 'TOO_MANY_AST_NODES'),
    ).toBe(true);
  });

  it('rejects overly long string literals', () => {
    const { registry } = makeRuntime();
    const s = 'a'.repeat(DEFAULT_FORMULA_LIMITS.maxStringLiteralLength + 1);
    const rule = parseFormula(`"${s}"`, { registry });
    expect(rule.errors.some((e: any) => e.code === 'STRING_LITERAL_TOO_LONG')).toBe(true);
  });

  it('rejects excessive parentheses depth', () => {
    const { registry } = makeRuntime();
    const d = DEFAULT_FORMULA_LIMITS.maxParenDepth + 1;
    const src = '('.repeat(d) + '1' + ')'.repeat(d);
    const rule = parseFormula(src, { registry });
    expect(rule.errors.some((e: any) => e.code === 'PARENS_TOO_DEEP')).toBe(true);
  });

  it('does not crash on unexpected control characters', () => {
    const { registry } = makeRuntime();
    const src = `1\u0000+2`;
    const rule = parseFormula(src, { registry });
    expect(rule.errors.length).toBeGreaterThan(0);
  });

  it('caps wildcard expansion by list input size', async () => {
    const { registry, implementations } = makeRuntime();
    registry.registerVariable({
      name: 'value',
      description: 'A test list of items.',
      type: FormulaTypes.list(FormulaTypes.object('Row', { id: FormulaTypes.number(false) }), true),
    });
    const rule = parseFormula('value.*.id', { registry });
    const big = Array.from({ length: DEFAULT_FORMULA_LIMITS.maxListLength + 1 }, (_, i) => ({
      id: i,
    }));
    const result = await evaluateRuleAsync(rule, {
      registry,
      resolver: implementations,
      variables: { value: big },
    });
    expect(result.errors.some((e: any) => e.code === 'LIST_TOO_LARGE')).toBe(true);
  });

  it('caps EACH by list input size', async () => {
    const { registry, implementations } = makeRuntime();
    registry.registerVariable({
      name: 'value',
      description: 'A test list of numbers.',
      type: FormulaTypes.list(FormulaTypes.number(false), true),
    });
    const rule = parseFormula('EACH(value; "+"; 1)', { registry });
    const big = Array.from({ length: DEFAULT_FORMULA_LIMITS.maxListLength + 1 }, () => 1);
    const result = await evaluateRuleAsync(rule, {
      registry,
      resolver: implementations,
      variables: { value: big },
    });
    expect(result.errors.some((e: any) => e.code === 'LIST_TOO_LARGE')).toBe(true);
  });

  it('rejects unsafe regex patterns (nested quantifiers)', async () => {
    const { registry, implementations } = makeRuntime();
    const rule = parseFormula('MATCH_EXPRESSION(text; "(a+)+$")', { registry });
    const result = await evaluateRuleAsync(rule, {
      registry,
      resolver: implementations,
      variables: { text: 'a'.repeat(100) },
    });
    expect(result.errors.some((e: any) => e.code === 'REGEX_UNSAFE')).toBe(true);
  });

  it('rejects overly long regex input text', async () => {
    const { registry, implementations } = makeRuntime();
    const rule = parseFormula('MATCH_EXPRESSION(text; "a+")', { registry });
    const longText = 'a'.repeat(DEFAULT_FORMULA_LIMITS.maxRegexTextLength + 1);
    const result = await evaluateRuleAsync(rule, {
      registry,
      resolver: implementations,
      variables: { text: longText },
    });
    expect(result.errors.some((e: any) => e.code === 'REGEX_INPUT_TOO_LONG')).toBe(true);
  });

  it('enforces evaluation step budget', async () => {
    const { registry, implementations } = makeRuntime();
    registry.registerVariable({
      name: 'value',
      description: 'A test list of items.',
      type: FormulaTypes.list(FormulaTypes.object('Row', { id: FormulaTypes.number(false) }), true),
    });
    const rule = parseFormula('value.*.id', { registry });
    const list = Array.from({ length: 25 }, (_, i) => ({ id: i }));
    const limits = resolveFormulaLimits({ maxEvaluationSteps: 5 });
    const result = await evaluateRuleAsync(rule, {
      registry,
      resolver: implementations,
      variables: { value: list },
      limits,
    });
    expect(result.errors.some((e: any) => e.code === 'EVAL_LIMIT_EXCEEDED')).toBe(true);
  });

  it('rejects access to non-allowlisted object properties', async () => {
    const { registry, implementations } = makeRuntime();
    registry.registerVariable({
      name: 'value',
      description: 'A test input object.',
      type: FormulaTypes.object('Obj', { allowed: FormulaTypes.number(false) }, true),
    });

    const parsed = parseFormula('value.secret', { registry });
    expect(parsed.errors.some((e: any) => e.code === 'PROPERTY_NOT_ALLOWLISTED')).toBe(true);

    const result = await evaluateRuleAsync(parsed, {
      registry,
      resolver: implementations,
      variables: { value: { allowed: 1, secret: 2 } },
    });
    expect(result.errors.some((e: any) => e.code === 'PROPERTY_NOT_ALLOWLISTED')).toBe(true);
  });
});
