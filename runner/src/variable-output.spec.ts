import { createCoreFormulaRuntime } from '@formulang/core-functions';
import { FormulaErrorCodes, FormulaTypes, optimizeRule } from '@formulang/definitions';
import { parseFormula, parseVariableReference } from '@formulang/parser';
import { describe, expect, it } from 'vitest';
import { evaluateRuleOutputAsync, evaluateVariableOutputAsync } from './index';

describe('evaluateVariableOutputAsync', () => {
  function createTestRuntime() {
    const { registry, implementations } = createCoreFormulaRuntime();
    // Common vars for tests.
    registry.registerVariable({
      name: 'value',
      type: FormulaTypes.object(
        'Value',
        {
          a: FormulaTypes.object('A', { b: FormulaTypes.any(true) }, true),
        },
        true,
      ),
    });
    registry.registerVariable({
      name: 'list',
      type: FormulaTypes.list(
        FormulaTypes.object('Item', { name: FormulaTypes.any(true) }, true),
        true,
      ),
    });
    return { registry, implementations };
  }

  it('evaluates a root variable value', async () => {
    const { registry } = createTestRuntime();
    const parsed = parseVariableReference('value', { registry });
    const compiled = optimizeRule(parsed, { registry });

    const res = await evaluateVariableOutputAsync(compiled.root, {
      registry,
      variables: { value: 123 },
    });

    expect(res.errors).toStrictEqual([]);
    expect(res.output.ok).toBe(true);
    expect(res.output.value).toBe(123);
  });

  it('evaluates nested property access', async () => {
    const { registry } = createTestRuntime();
    const parsed = parseVariableReference('value.a.b', { registry });
    const compiled = optimizeRule(parsed, { registry });

    const res = await evaluateVariableOutputAsync(compiled.root, {
      registry,
      variables: { value: { a: { b: 'x' } } },
    });

    expect(res.errors).toStrictEqual([]);
    expect(res.output.ok).toBe(true);
    expect(res.output.value).toBe('x');
  });

  it('supports async root variable resolvers and property resolvers', async () => {
    const { registry } = createTestRuntime();
    const parsed = parseVariableReference('value.a', { registry });
    const compiled = optimizeRule(parsed, { registry });

    const res = await evaluateVariableOutputAsync(compiled.root, {
      registry,
      variables: {
        value: async () => ({ a: async () => 42 }),
      },
    });

    expect(res.errors).toStrictEqual([]);
    expect(res.output.ok).toBe(true);
    expect(res.output.value).toBe(42);
  });

  it('expands wildcards and flattens nested lists', async () => {
    const { registry } = createTestRuntime();
    const parsed = parseVariableReference('list.*.name', { registry });
    const compiled = optimizeRule(parsed, { registry });

    const res = await evaluateVariableOutputAsync(compiled.root, {
      registry,
      variables: {
        list: [{ name: 'a' }, { name: ['b', 'c'] }, { name: null }],
      },
    });

    expect(res.errors).toStrictEqual([]);
    expect(res.output.ok).toBe(true);
    expect(res.output.value).toStrictEqual(['a', 'b', 'c', null]);
  });

  it('matches evaluateRuleOutputAsync for the same variable-only expression', async () => {
    const { registry, implementations } = createTestRuntime();
    const source = 'list.*.name';

    const parsedFormula = parseFormula(source, { registry });
    const compiledFormula = optimizeRule(parsedFormula, { registry });
    const ruleRes = await evaluateRuleOutputAsync(compiledFormula, {
      registry,
      resolver: implementations,
      variables: { list: [{ name: 'x' }, { name: 'y' }] },
    });

    const parsedVar = parseVariableReference(source, { registry });
    const compiledVar = optimizeRule(parsedVar, { registry });
    const varRes = await evaluateVariableOutputAsync(compiledVar.root, {
      registry,
      variables: { list: [{ name: 'x' }, { name: 'y' }] },
    });

    expect(ruleRes.errors).toStrictEqual([]);
    expect(varRes.errors).toStrictEqual([]);
    expect(varRes.output.value).toStrictEqual(ruleRes.output.value);
  });

  it('surfaces denylisted property access as a security error', async () => {
    const { registry } = createTestRuntime();
    const parsed = parseVariableReference('value.__proto__', { registry });
    const compiled = optimizeRule(parsed, { registry });

    const res = await evaluateVariableOutputAsync(compiled.root, {
      registry,
      variables: { value: {} },
    });

    expect(res.errors.some((e) => e.code === FormulaErrorCodes.DENYLISTED_PROPERTY)).toBe(true);
    expect(res.output.ok).toBe(false);
  });
});
