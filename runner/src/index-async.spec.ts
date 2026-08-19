import { createCoreFormulaRuntime } from '@formulang/core-functions';
import {
  FormulaErrorCodes,
  FormulaTypes,
  makeOkBoolean,
  makeOkNumber,
  makeOkUnknown,
  optimizeRule,
  type FormulaType,
} from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleAsync, evaluateRuleOutputAsync } from './index';

function createTestRuntime(valueType: FormulaType = FormulaTypes.any(true)) {
  const { registry, implementations } = createCoreFormulaRuntime();
  registry.registerVariable({
    name: 'value',
    description: 'A test input value.',
    type: valueType,
  });
  return { registry, implementations };
}

function compile(formula: string, runtime = createTestRuntime()) {
  const { registry } = runtime;
  const parsed = parseFormula(formula, { registry });
  const compiled = optimizeRule(parsed, { registry });
  return { ...runtime, parsed, compiled };
}

describe('evaluateRuleAsync', () => {
  it('formula: supports async variable property resolvers', async () => {
    const runtime = createTestRuntime(
      FormulaTypes.object('Obj', { a: FormulaTypes.number(false) }, true),
    );
    const { registry, implementations, compiled } = compile('value.a + 1', runtime);

    const res = await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: {
        value: {
          a: async () => 123,
        },
      },
    });

    expect(res.errors).toStrictEqual([]);
    expect(res.value).toBe(124);
  });

  it('formula: supports lazy root variable resolvers', async () => {
    const { registry, implementations, compiled } = compile('value + 1');

    const res = await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: {
        value: async () => 41,
      },
    });

    expect(res.errors).toStrictEqual([]);
    expect(res.value).toBe(42);
  });

  it('formula: reuses pending promise for identical pure calls', async () => {
    const runtime = createTestRuntime();
    const { registry, implementations } = runtime;

    let calls = 0;
    registry.registerFunction({
      signatureId: 'SLOW/v1',
      name: 'SLOW',
      category: 'core',
      description: 'Test function that simulates a slow pure call.',
      params: [{ name: 'x', type: FormulaTypes.any(true) }],
      returnType: FormulaTypes.any(true),
      purity: 'pure',
    });
    implementations.register('SLOW/v1', {
      async evaluateMultiple(batchCalls) {
        calls += batchCalls.length;
        await new Promise((r) => setTimeout(r, 25));
        const outs = [];
        for (const c of batchCalls) {
          const x = (await c.args[0]?.output())?.value ?? null;
          outs.push(makeOkUnknown('SLOW', x, { signatureId: 'SLOW/v1' }));
        }
        return outs;
      },
    });

    const { compiled } = compile('SLOW(1)', runtime);

    const cache = new Map<string, unknown>();
    const pending = new Map<string, Promise<unknown>>();

    await Promise.all([
      evaluateRuleAsync(compiled, {
        registry,
        resolver: implementations,
        variables: {},
        cache,
        pending,
      }),
      evaluateRuleAsync(compiled, {
        registry,
        resolver: implementations,
        variables: {},
        cache,
        pending,
      }),
    ]);

    expect(calls).toBe(1);
  });

  it('formula: shared cache supports object args via identity keys', async () => {
    const runtime = createTestRuntime();
    const { registry, implementations } = runtime;

    let calls = 0;
    registry.registerFunction({
      signatureId: 'OBJTEST/v1',
      name: 'OBJTEST',
      category: 'core',
      description: 'Test function used to verify caching with object arguments.',
      params: [{ name: 'x', type: FormulaTypes.any(true) }],
      returnType: FormulaTypes.number(true),
      purity: 'pure',
    });
    implementations.register('OBJTEST/v1', {
      async evaluateMultiple(batchCalls) {
        calls += batchCalls.length;
        return batchCalls.map(() => makeOkNumber('OBJTEST', 123, { signatureId: 'OBJTEST/v1' }));
      },
    });

    const { compiled } = compile('OBJTEST(value)', runtime);

    const cache = new Map<string, unknown>();
    const pending = new Map<string, Promise<unknown>>();

    const obj = { a: 1 };
    await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: { value: obj },
      cache,
      pending,
    });
    await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: { value: obj },
      cache,
      pending,
    });

    expect(calls).toBe(1);
  });

  it('formula: does not cache calls with too-large string args', async () => {
    const runtime = createTestRuntime();
    const { registry, implementations } = runtime;

    let calls = 0;
    registry.registerFunction({
      signatureId: 'ECHO/v1',
      name: 'ECHO',
      category: 'core',
      description: 'Test function that echoes a text argument.',
      params: [{ name: 't', type: FormulaTypes.text(true) }],
      returnType: FormulaTypes.text(true),
      purity: 'pure',
    });
    implementations.register('ECHO/v1', {
      async evaluateMultiple(batchCalls) {
        calls += batchCalls.length;
        const outs = [];
        for (const c of batchCalls) {
          const t = (await c.args[0]?.output())?.value ?? null;
          outs.push(makeOkUnknown('ECHO', t, { signatureId: 'ECHO/v1' }));
        }
        return outs;
      },
    });

    const { compiled } = compile('ECHO("abcd")', runtime);

    const cache = new Map<string, unknown>();
    const pending = new Map<string, Promise<unknown>>();

    await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: {},
      cache,
      pending,
      limits: { maxCacheableStringLength: 3 },
    });
    await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: {},
      cache,
      pending,
      limits: { maxCacheableStringLength: 3 },
    });

    expect(calls).toBe(2);

    calls = 0;
    const { compiled: compiled2 } = compile('ECHO("ab")', runtime);

    await evaluateRuleAsync(compiled2, {
      registry,
      resolver: implementations,
      variables: {},
      cache,
      pending,
      limits: { maxCacheableStringLength: 3 },
    });
    await evaluateRuleAsync(compiled2, {
      registry,
      resolver: implementations,
      variables: {},
      cache,
      pending,
      limits: { maxCacheableStringLength: 3 },
    });

    expect(calls).toBe(1);
  });

  it('formula: enforces per-function cost limits', async () => {
    const runtime = createTestRuntime();
    const { registry, implementations } = runtime;

    let calls = 0;
    registry.registerFunction({
      signatureId: 'COSTLY/v1',
      name: 'COSTLY',
      category: 'core',
      description: 'Test function with an intentionally high estimated cost.',
      params: [{ name: 'x', type: FormulaTypes.any(true) }],
      returnType: FormulaTypes.any(true),
      purity: 'pure',
    });
    implementations.register('COSTLY/v1', {
      estimateCostsInSeconds: () => 5,
      async evaluateMultiple(batchCalls) {
        calls += batchCalls.length;
        const outs = [];
        for (const c of batchCalls) {
          const x = (await c.args[0]?.output())?.value ?? null;
          outs.push(makeOkUnknown('COSTLY', x, { signatureId: 'COSTLY/v1' }));
        }
        return outs;
      },
    });

    const { compiled } = compile('COSTLY(1)', runtime);

    const res = await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: {},
      limits: { maxFunctionCostUnits: 1, maxTotalCostUnits: 100 },
    });

    expect(calls).toBe(0);
    expect(res.errors.some((e) => e.code === FormulaErrorCodes.FUNCTION_COST_LIMIT_EXCEEDED)).toBe(
      true,
    );
  });

  it('formula: enforces total cost limits', async () => {
    const runtime = createTestRuntime();
    const { registry, implementations } = runtime;

    registry.registerFunction({
      signatureId: 'COST/v1',
      name: 'COST',
      category: 'core',
      description: 'Test function used to accumulate total cost units.',
      params: [{ name: 'x', type: FormulaTypes.any(true) }],
      returnType: FormulaTypes.number(true),
      purity: 'pure',
    });
    implementations.register('COST/v1', {
      estimateCostsInSeconds: () => 0.6,
      async evaluateMultiple(batchCalls) {
        return batchCalls.map(() => makeOkNumber('COST', 1, { signatureId: 'COST/v1' }));
      },
    });

    const { compiled } = compile('COST(1) + COST(2)', runtime);

    const res = await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: {},
      limits: { maxFunctionCostUnits: 10, maxTotalCostUnits: 1.0 },
    });

    expect(res.errors.some((e) => e.code === FormulaErrorCodes.COST_LIMIT_EXCEEDED)).toBe(true);
  });

  it('formula: enforces per-function wall time limits', async () => {
    const runtime = createTestRuntime();
    const { registry, implementations } = runtime;

    registry.registerFunction({
      signatureId: 'SLEEP/v1',
      name: 'SLEEP',
      category: 'core',
      description: 'Test function that sleeps to trigger wall-time limits.',
      params: [{ name: 'x', type: FormulaTypes.any(true) }],
      returnType: FormulaTypes.any(true),
      purity: 'pure',
    });
    implementations.register('SLEEP/v1', {
      async evaluateMultiple(batchCalls) {
        const outs = [];
        for (const c of batchCalls) {
          await new Promise((r) => setTimeout(r, 20));
          const x = (await c.args[0]?.output())?.value ?? null;
          outs.push(makeOkUnknown('SLEEP', x, { signatureId: 'SLEEP/v1' }));
        }
        return outs;
      },
    });

    const { compiled } = compile('SLEEP(1)', runtime);

    const res = await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: {},
      limits: { maxFunctionWallTimeMs: 5, maxWallTimeMs: 1000 },
    });

    expect(res.errors.some((e) => e.code === FormulaErrorCodes.WALL_TIME_LIMIT_EXCEEDED)).toBe(
      true,
    );
  });

  it('formula: output tree marks skipped IF branches', async () => {
    const runtime = createTestRuntime();
    const { registry, implementations } = runtime;

    let costlyCalls = 0;
    registry.registerFunction({
      signatureId: 'COSTLY/v1',
      name: 'COSTLY',
      category: 'core',
      description: 'Test uncached function used to verify IF short-circuit skipping.',
      params: [{ name: 'x', type: FormulaTypes.any(true) }],
      returnType: FormulaTypes.any(true),
      purity: 'uncached',
    });
    implementations.register('COSTLY/v1', {
      async evaluateMultiple(batchCalls) {
        costlyCalls += batchCalls.length;
        return batchCalls.map(() => makeOkUnknown('COSTLY', 999, { signatureId: 'COSTLY/v1' }));
      },
    });

    const {
      registry: r2,
      implementations: i2,
      compiled,
    } = compile('IF(false; COSTLY(1); 123)', runtime);
    const res = await evaluateRuleOutputAsync(compiled, {
      registry: r2,
      resolver: i2,
      variables: {},
    });

    expect(res.errors).toStrictEqual([]);
    expect(res.output.ok).toBe(true);
    expect(res.output.value).toBe(123);
    expect(costlyCalls).toBe(0);

    // IF call node has 3 ordered children; branch 1 should be skipped.
    expect(Array.isArray(res.output.children)).toBe(true);
    expect(res.output.children).toHaveLength(3);
    expect(res.output.children[1]?.skipped).toBe(true);
  });

  it('formula: FILTER batches predicate evaluation (single evaluateMultiple call)', async () => {
    const runtime = createTestRuntime();
    const { registry, implementations } = runtime;

    let predicateBatches = 0;
    let lastBatchSize = 0;
    registry.registerFunction({
      signatureId: 'PRED/v1',
      name: 'PRED',
      category: 'core',
      description: 'Test predicate function used by FILTER batching.',
      params: [{ name: 'x', type: FormulaTypes.any(true) }],
      returnType: FormulaTypes.boolean(true),
      purity: 'uncached',
    });
    implementations.register('PRED/v1', {
      async evaluateMultiple(batchCalls) {
        predicateBatches += 1;
        lastBatchSize = batchCalls.length;
        const outs = [];
        for (const c of batchCalls) {
          const x = (await c.args[0]?.output())?.value;
          outs.push(
            makeOkBoolean('PRED', typeof x === 'number' ? x > 1 : false, {
              signatureId: 'PRED/v1',
            }),
          );
        }
        return outs;
      },
    });

    const { compiled } = compile('FILTER(value; "PRED")', runtime);
    const res = await evaluateRuleAsync(compiled, {
      registry,
      resolver: implementations,
      variables: { value: [1, 2, 3] },
    });

    expect(res.errors).toStrictEqual([]);
    expect(res.value).toStrictEqual([2, 3]);
    expect(predicateBatches).toBe(1);
    expect(lastBatchSize).toBe(3);
  });

  it('formula: output tree surfaces security errors (ok:false with signatureId)', async () => {
    const { registry, implementations, compiled } = compile('MATCH_EXPRESSION("aaaa"; "(a+)+$")');
    const res = await evaluateRuleOutputAsync(compiled, {
      registry,
      resolver: implementations,
      variables: {},
    });

    expect(res.errors.some((e) => e.code === FormulaErrorCodes.REGEX_UNSAFE)).toBe(true);
    expect(res.output.ok).toBe(false);
    expect(res.output.signatureId).toBe('MATCH_EXPRESSION/v1');
    expect(res.output.error?.code).toBe(FormulaErrorCodes.REGEX_UNSAFE);
  });
});
