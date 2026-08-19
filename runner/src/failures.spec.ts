import { createCoreFormulaRuntime } from '@formulang/core-functions';
import { FormulaErrorCodes, FormulaTypes, makeOkNumber, makeOkText } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { describe, expect, it } from 'vitest';
import { evaluateRuleAsync, evaluateRuleOutputAsync } from './index';

describe('runner failures', () => {
  function makeRuntime() {
    const { registry, implementations } = createCoreFormulaRuntime();
    return { registry, implementations };
  }

  it('UNBOUND_FUNCTION (definition exists, implementation missing)', async () => {
    const { registry, implementations } = makeRuntime();

    registry.registerFunction({
      signatureId: 'UNIMPL/v1',
      name: 'UNIMPL',
      category: 'core',
      description: 'Test function definition with no implementation.',
      params: [{ name: 'x', type: FormulaTypes.number(true) }],
      returnType: FormulaTypes.number(true),
      purity: 'pure',
    });

    const rule = parseFormula('UNIMPL(1)', { registry });
    const res = await evaluateRuleAsync(rule, {
      registry,
      resolver: implementations,
      variables: {},
    });

    expect(res.errors.some((e) => e.code === FormulaErrorCodes.UNBOUND_FUNCTION)).toBe(true);
  });

  it('EVAL_CRASH (implementation throws unknown error)', async () => {
    const { registry, implementations } = makeRuntime();

    registry.registerFunction({
      signatureId: 'CRASH/v1',
      name: 'CRASH',
      category: 'core',
      description: 'Test function whose implementation throws an error.',
      params: [],
      returnType: FormulaTypes.any(true),
      purity: 'pure',
    });
    implementations.register('CRASH/v1', {
      async evaluateMultiple() {
        throw new Error('kaboom');
      },
    });

    const rule = parseFormula('CRASH()', { registry });
    const res = await evaluateRuleAsync(rule, {
      registry,
      resolver: implementations,
      variables: {},
    });

    expect(res.errors.some((e) => e.code === FormulaErrorCodes.EVAL_CRASH)).toBe(true);
  });

  it('NULL_NOT_ALLOWED (non-nullable param receives null)', async () => {
    const { registry, implementations } = makeRuntime();

    registry.registerVariable({
      name: 'value',
      description: 'A test number value.',
      type: FormulaTypes.number(true),
    });

    registry.registerFunction({
      signatureId: 'NONNULL/v1',
      name: 'NONNULL',
      category: 'core',
      description: 'Test function with a non-nullable parameter.',
      params: [{ name: 'x', type: FormulaTypes.number(false) }],
      returnType: FormulaTypes.number(true),
      purity: 'pure',
    });
    implementations.register('NONNULL/v1', {
      async evaluateMultiple() {
        return [makeOkNumber('NONNULL', 1, { signatureId: 'NONNULL/v1' })];
      },
    });

    const rule = parseFormula('NONNULL(value)', { registry });
    const res = await evaluateRuleAsync(rule, {
      registry,
      resolver: implementations,
      variables: { value: null },
    });

    expect(res.errors.some((e) => e.code === FormulaErrorCodes.NULL_NOT_ALLOWED)).toBe(true);
  });

  it('WILDCARD_OUTPUT_TOO_LARGE (flattened output too big)', async () => {
    const { registry, implementations } = makeRuntime();

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

    const rule = parseFormula('value.*.ids', { registry });

    const res = await evaluateRuleAsync(rule, {
      registry,
      resolver: implementations,
      variables: {
        value: [{ ids: [1, 2] }, { ids: [3, 4] }],
      },
      limits: { maxWildcardOutputLength: 2, maxListLength: 10 },
    });

    expect(res.errors.some((e) => e.code === FormulaErrorCodes.WILDCARD_OUTPUT_TOO_LARGE)).toBe(
      true,
    );
  });

  it('DENYLISTED_PROPERTY (runtime variable access)', async () => {
    const { registry, implementations } = createCoreFormulaRuntime();
    registry.registerVariable({
      name: 'constructor',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });

    const rule = parseFormula('constructor', { registry });
    const res = await evaluateRuleAsync(rule, {
      registry,
      resolver: implementations,
      variables: { constructor: 123 },
    });

    expect(res.errors.some((e) => e.code === FormulaErrorCodes.DENYLISTED_PROPERTY)).toBe(true);
  });

  it('OUTPUT_TYPE_NOT_ALLOWED (expectedReturnType mismatch)', async () => {
    const { registry, implementations } = makeRuntime();

    registry.registerFunction({
      signatureId: 'BADRET/v1',
      name: 'BADRET',
      category: 'core',
      description: 'Test function that returns an output with an invalid type.',
      params: [],
      returnType: FormulaTypes.number(true),
      purity: 'pure',
    });
    implementations.register('BADRET/v1', {
      async evaluateMultiple() {
        return [makeOkText('BADRET', 'oops', { signatureId: 'BADRET/v1' })];
      },
    });

    const rule = parseFormula('BADRET()', { registry });
    const res = await evaluateRuleOutputAsync(rule, {
      registry,
      resolver: implementations,
      variables: {},
      expectedReturnType: FormulaTypes.number(true),
    });

    expect(res.errors.some((e) => e.code === FormulaErrorCodes.OUTPUT_TYPE_NOT_ALLOWED)).toBe(true);
    expect(res.output.ok).toBe(false);
    expect(res.output.error?.code).toBe(FormulaErrorCodes.OUTPUT_TYPE_NOT_ALLOWED);
  });
});
