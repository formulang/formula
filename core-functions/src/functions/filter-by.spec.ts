import type { FormulaNodeOutput, FormulaType } from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaTypes,
  makeError,
  makeOkBoolean,
  makeOkText,
  optimizeRule,
} from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleOutputAsync } from '@formulang/runner';
import {
  collectAllErrors,
  createTestRuntime,
  evalFormula,
  evalOk,
  evalOkWithOutput,
} from '../test-helpers/eval-formula';

async function errorCodes(source: string, vars: Record<string, unknown> = {}) {
  const { parsed, compiled, res } = await evalFormula(source, vars);
  return [...new Set(collectAllErrors(parsed, compiled, res.errors).map((e) => e.code))];
}

async function warningCodes(source: string, vars: Record<string, unknown> = {}) {
  const { output, value } = await evalOkWithOutput(source, vars);
  return { value, codes: (output.warnings ?? []).map((w) => w.code) };
}

describe('FILTER_BY', () => {
  it('keeps the items whose same-position key satisfies the operator', async () => {
    expect(await evalOk('FILTER_BY(LIST("a"; "b"; "c"); LIST(9; 3; 12); ">"; 8)')).toStrictEqual([
      'a',
      'c',
    ]);
    expect(
      await evalOk('FILTER_BY(LIST(1; 2; 3); LIST("ab"; "cd"; "ae"); "STARTS_WITH"; "a")'),
    ).toStrictEqual([1, 3]);
    expect(await evalOk('FILTER_BY(LIST(1; 2); LIST(""; "x"); "IS_EMPTY")')).toStrictEqual([1]);
    expect(await evalOk('FILTER_BY(LIST(); LIST(); ">"; 1)')).toStrictEqual([]);
  });

  it('filters by a computed key list', async () => {
    const callouts = [
      'Kurz und klar.',
      'Dieser Satz hat ganz sicher mehr als acht einzelne Wörter.',
    ];
    expect(
      await evalOk('FILTER_BY(value; EACH(value; "WORD_COUNT"); ">"; 8)', { value: callouts }),
    ).toStrictEqual([callouts[1]]);
  });

  it('calls the operator as FILTER does', async () => {
    // FILTER_BY over a list and the same list as keys keeps what FILTER keeps: both call the
    // function behind an operator token, otherwise the first definition of the name that has an
    // implementation (STARTS_WITH's text form, whatever form the parser checked).
    const literal = (value: string | string[]) =>
      Array.isArray(value)
        ? `LIST(${value.map((item) => JSON.stringify(item)).join('; ')})`
        : JSON.stringify(value);
    const keys = literal(['apple', 'banana', 'cherry', 'x']);
    for (const needles of [['a', 'c'], ['b'], ['x', 'ch'], [''], 'b', '', 'ch']) {
      const filter = `FILTER(${keys}; "STARTS_WITH"; ${literal(needles)})`;
      const filterBy = `FILTER_BY(${keys}; ${keys}; "STARTS_WITH"; ${literal(needles)})`;
      expect(await evalOk(filterBy), filterBy).toStrictEqual(await evalOk(filter));
      // The same with the needle a run-time value, which the parser types as any.
      const filterAny = `FILTER(${keys}; "STARTS_WITH"; value)`;
      const filterByAny = `FILTER_BY(${keys}; ${keys}; "STARTS_WITH"; value)`;
      expect(await evalOk(filterByAny, { value: needles }), filterByAny).toStrictEqual(
        await evalOk(filterAny, { value: needles }),
      );
    }
    expect(
      await evalOk(
        'FILTER_BY(LIST("x"; "y"; "z"); LIST("apple"; "banana"; "cherry"); "STARTS_WITH"; "b")',
      ),
    ).toStrictEqual(['y']);
    // STARTS_WITH's text form runs, so a list of prefixes keeps nothing, as with FILTER.
    expect(
      await evalOk(
        'FILTER_BY(LIST("x"; "z"); LIST("apple"; "cherry"); "STARTS_WITH"; LIST("a"; "c"))',
      ),
    ).toStrictEqual([]);
    expect(await evalOk('FILTER_BY(LIST("a"; "b"); LIST(1; 5); ">"; 2)')).toStrictEqual(['b']);
  });

  describe('with an overload set of the host', () => {
    // CHECK(text) answers a boolean, CHECK(list<text>) a text, which a filter cannot use.
    function checkRuntime(implemented: readonly string[]) {
      const invoked: string[] = [];
      const runtime = createTestRuntime();
      const define = (signatureId: string, type: FormulaType, returnType: FormulaType) =>
        runtime.registry.registerFunction({
          signatureId,
          name: 'CHECK',
          category: 'custom',
          description: 'Host overload.',
          params: [{ name: 'value', type }],
          returnType,
          purity: 'pure',
        });
      define('CHECK/v1', FormulaTypes.text(true), FormulaTypes.boolean(true));
      define(
        'CHECK_LIST/v1',
        FormulaTypes.list(FormulaTypes.text(true), true),
        FormulaTypes.text(true),
      );
      define('CHECK_NUMBER/v1', FormulaTypes.number(true), FormulaTypes.boolean(true));
      const answers: Record<string, (value: unknown) => FormulaNodeOutput> = {
        'CHECK/v1': (value) => makeOkBoolean('CHECK', value === 'yes'),
        'CHECK_LIST/v1': () => makeOkText('CHECK', 'not a boolean'),
        'CHECK_NUMBER/v1': (value) => makeOkBoolean('CHECK', value === 1),
      };
      for (const signatureId of implemented) {
        runtime.implementations.register(signatureId, {
          estimateCostsInSeconds: () => 0.0001,
          evaluateMultiple: async (calls) => {
            const outs: FormulaNodeOutput[] = [];
            for (const call of calls) {
              invoked.push(signatureId);
              outs.push(answers[signatureId]!(await call.args[0]?.value()));
            }
            return outs;
          },
        });
      }
      return { ...runtime, invoked };
    }

    async function run(runtime: ReturnType<typeof checkRuntime>, source: string, value?: unknown) {
      const parsed = parseFormula(source, { registry: runtime.registry });
      const compiled = optimizeRule(parsed, { registry: runtime.registry });
      const out = await evaluateRuleOutputAsync(compiled, {
        registry: runtime.registry,
        resolver: runtime.implementations,
        variables: { value },
      });
      return {
        parse: parsed.errors.map((e) => e.code),
        value: out.output.value ?? null,
        warnings: (out.output.warnings ?? []).map((w) => w.code),
      };
    }

    const ALL = ['CHECK/v1', 'CHECK_LIST/v1', 'CHECK_NUMBER/v1'];

    it('never calls an overload the parser refuses for a filter', async () => {
      // Typed keys select CHECK(list<text>), whose text result the parser refuses.
      const typed = checkRuntime(ALL);
      expect(
        (await run(typed, 'FILTER_BY(LIST("p"; "q"); LIST(LIST("yes"); LIST("no")); "CHECK")'))
          .parse,
      ).toStrictEqual([FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH]);
      // Keys of type any select CHECK(text), the first definition, which is also what runs:
      // lists are not "yes", so nothing is kept, and CHECK(list<text>) is never called.
      const anyKeys = checkRuntime(ALL);
      expect(
        await run(anyKeys, 'FILTER_BY(LIST("p"; "q"); value; "CHECK")', [['yes'], ['no']]),
      ).toStrictEqual({ parse: [], value: [], warnings: [] });
      expect(anyKeys.invoked).toStrictEqual(['CHECK/v1', 'CHECK/v1']);
      const textKeys = checkRuntime(ALL);
      expect(
        await run(textKeys, 'FILTER_BY(LIST("p"; "q"); value; "CHECK")', ['yes', 'no']),
      ).toStrictEqual({ parse: [], value: ['p'], warnings: [] });
    });

    it('falls back to the first definition that has an implementation, as FILTER does', async () => {
      const runtime = checkRuntime(['CHECK_NUMBER/v1']);
      expect(await run(runtime, 'FILTER_BY(LIST("p"; "q"); LIST(1; 2); "CHECK")')).toStrictEqual({
        parse: [],
        value: ['p'],
        warnings: [],
      });
      expect(await run(runtime, 'FILTER(LIST(1; 2); "CHECK")')).toStrictEqual({
        parse: [],
        value: [1],
        warnings: [],
      });
      expect(runtime.invoked).toStrictEqual(Array(4).fill('CHECK_NUMBER/v1'));
    });

    it('keeps an item only where the operator answers TRUE, as FILTER does', async () => {
      // Only CHECK(list<text>) has an implementation, so it runs, and answers a text: no item is
      // kept, though the text is not empty.
      const runtime = checkRuntime(['CHECK_LIST/v1']);
      expect(
        await run(runtime, 'FILTER_BY(LIST("p"; "q"); value; "CHECK")', ['yes', 'no']),
      ).toStrictEqual({ parse: [], value: [], warnings: [] });
      expect(await run(runtime, 'FILTER(value; "CHECK")', ['yes', 'no'])).toStrictEqual({
        parse: [],
        value: [],
        warnings: [],
      });
    });

    it('answers null with a TYPE warning when no definition has an implementation', async () => {
      const runtime = checkRuntime([]);
      expect(
        await run(runtime, 'FILTER_BY(LIST("p"; "q"); LIST("yes"; "no"); "CHECK")'),
      ).toStrictEqual({ parse: [], value: null, warnings: ['TYPE'] });
      expect(runtime.invoked).toStrictEqual([]);
    });
  });

  describe('with an operator of the host', () => {
    // HOST(key, value?) answers each key as `answer` says and estimates its cost as `estimate` says.
    function hostRuntime(
      answer: (key: unknown) => FormulaNodeOutput | undefined,
      estimate: (args: unknown[]) => number = () => 0.0001,
    ) {
      const runtime = createTestRuntime();
      runtime.registry.registerFunction({
        signatureId: 'HOST/v1',
        name: 'HOST',
        category: 'custom',
        description: 'An operator of the host.',
        params: [
          { name: 'key', type: FormulaTypes.any(true) },
          { name: 'value', type: FormulaTypes.any(true), optional: true },
        ],
        returnType: FormulaTypes.boolean(true),
        purity: 'pure',
      });
      runtime.implementations.register('HOST/v1', {
        estimateCostsInSeconds: estimate,
        evaluateMultiple: async (calls) => {
          const outs: FormulaNodeOutput[] = [];
          for (const call of calls)
            outs.push(answer(await call.args[0]?.value()) as FormulaNodeOutput);
          return outs;
        },
      });
      return runtime;
    }

    async function evaluate(
      runtime: ReturnType<typeof hostRuntime>,
      source: string,
      limits: Record<string, number> = {},
      variables: Record<string, unknown> = {},
    ) {
      const compiled = optimizeRule(parseFormula(source, { registry: runtime.registry }), {
        registry: runtime.registry,
      });
      const out = await evaluateRuleOutputAsync(compiled, {
        registry: runtime.registry,
        resolver: runtime.implementations,
        limits,
        variables,
      });
      return {
        value: out.output.value ?? null,
        errors: out.errors.map((error) => `${error.kind}:${error.code}`),
      };
    }

    const NOT_OK = { ok: false, name: 'HOST', children: [] } as FormulaNodeOutput;

    it('raises an output of its operator that is not ok, as the runner reads one', async () => {
      // Not ok and with no error: EVAL_CRASH, as for the same output of a call written directly.
      const silent = hostRuntime((key) => (key === 2 ? NOT_OK : makeOkBoolean('HOST', true)));
      expect(await evaluate(silent, 'FILTER_BY(LIST("p"; "q"); LIST(1; 2); "HOST")')).toStrictEqual(
        { value: null, errors: ['runtime:EVAL_CRASH'] },
      );
      expect(await evaluate(silent, 'HOST(2)')).toStrictEqual({
        value: null,
        errors: ['runtime:EVAL_CRASH'],
      });
      // The first output that is not ok decides, in the order of the keys, with or without an error.
      const both = hostRuntime((key) =>
        key === 1
          ? NOT_OK
          : ({
              ...NOT_OK,
              error: { kind: 'security', code: FormulaErrorCodes.LIST_TOO_LARGE, message: 'x' },
            } as FormulaNodeOutput),
      );
      expect(await evaluate(both, 'FILTER_BY(LIST("p"; "q"); LIST(1; 2); "HOST")')).toStrictEqual({
        value: null,
        errors: ['runtime:EVAL_CRASH'],
      });
      expect(await evaluate(both, 'FILTER_BY(LIST("q"); LIST(2); "HOST")')).toStrictEqual({
        value: null,
        errors: ['security:LIST_TOO_LARGE'],
      });
      // An output that is ok is read for its value alone.
      const okWithError = hostRuntime(
        () =>
          ({
            ...makeOkBoolean('HOST', true),
            error: { kind: 'runtime', code: FormulaErrorCodes.EVAL_CRASH, message: 'x' },
          }) as FormulaNodeOutput,
      );
      expect(
        await evaluate(okWithError, 'FILTER_BY(LIST("p"; "q"); LIST(1; 2); "HOST")'),
      ).toStrictEqual({ value: ['p', 'q'], errors: [] });
    });

    // What HOST's implementation answers for a call, on each path the runner takes for HOST(key)
    // written in a formula: through its cache (a pure or run-cached function with a key it can
    // cache), or not (an uncached function, a key too long to cache, a control-flow function).
    const ANSWERS: Record<string, () => unknown> = {
      false: () => false,
      zero: () => 0,
      empty: () => '',
      nan: () => Number.NaN,
      null: () => null,
      undefined: () => undefined,
      five: () => 5,
      'ok TRUE': () => makeOkBoolean('HOST', true),
      'ok FALSE': () => makeOkBoolean('HOST', false),
      error: () =>
        makeError('HOST', {
          kind: 'runtime',
          code: FormulaErrorCodes.PHRASE_TOO_LONG,
          message: 'the host refuses',
        }),
    };
    const PATHS = {
      'pure, through the cache': { purity: 'pure', key: '1' },
      'run-cached, through the cache': { purity: 'run_cached', key: '1' },
      uncached: { purity: 'uncached', key: '1' },
      'pure, a key too long to cache': { purity: 'pure', key: 'long' },
      'control flow': { purity: 'pure', controlFlow: true, key: '1' },
    } as const;

    function pathRuntime(path: keyof typeof PATHS, answer: string) {
      const shape: { purity: 'pure' | 'run_cached' | 'uncached'; controlFlow?: boolean } =
        PATHS[path];
      const runtime = createTestRuntime();
      runtime.registry.registerFunction({
        signatureId: 'HOST/v1',
        name: 'HOST',
        category: 'custom',
        description: 'An operator of the host.',
        params: [{ name: 'key', type: FormulaTypes.any(true) }],
        returnType: FormulaTypes.boolean(true),
        purity: shape.purity,
        controlFlow: shape.controlFlow,
      });
      runtime.implementations.register('HOST/v1', {
        estimateCostsInSeconds: () => 0.0001,
        evaluateMultiple: async (calls) =>
          (answer === 'missing' ? [] : calls.map(() => ANSWERS[answer]())) as FormulaNodeOutput[],
      });
      return runtime;
    }

    describe('reads each answer of its operator as the runner reads the same call written, on every path', () => {
      // The runner reads an answer that is no output as `null` on a call it answers through its
      // cache, and as a failed call on every other path; FILTER_BY gives the written call's error,
      // or keeps the item exactly where the written call answers TRUE.
      const variables = { long: 'a'.repeat(501) };
      for (const path of Object.keys(PATHS) as (keyof typeof PATHS)[]) {
        for (const answer of [...Object.keys(ANSWERS), 'missing']) {
          it(`${path}, ${answer}`, async () => {
            const runtime = pathRuntime(path, answer);
            const key = PATHS[path].key;
            const written = await evaluate(runtime, `HOST(${key})`, {}, variables);
            const byFilter = await evaluate(
              runtime,
              `FILTER_BY(LIST("p"); LIST(${key}); "HOST")`,
              {},
              variables,
            );
            const wanted =
              written.errors.length > 0
                ? { value: null, errors: written.errors }
                : { value: written.value === true ? ['p'] : [], errors: [] };
            expect(byFilter, `HOST(${key}) gives ${JSON.stringify(written)}`).toStrictEqual(wanted);
          });
        }
      }

      it('meets both readings of an answer that is no output: null, and a failed call', async () => {
        const readings = new Set<string>();
        for (const path of Object.keys(PATHS) as (keyof typeof PATHS)[]) {
          const key = PATHS[path].key;
          const written = await evaluate(
            pathRuntime(path, 'missing'),
            `HOST(${key})`,
            {},
            variables,
          );
          readings.add(`${written.value}/${written.errors.join(',')}`);
        }
        expect([...readings].sort()).toStrictEqual(['null/', 'null/runtime:EVAL_CRASH']);
      });
    });

    it('charges a control-flow operator exactly 0.05 a call, as the runner charges it written', async () => {
      // AND, OR, NOT and SWITCH are control flow: each call costs 0.05 whatever its estimate, as
      // the Charges conditions state, made by FILTER_BY or written in the formula. A call passes a
      // maxFunctionCostUnits of 0.05 and is refused under the largest number below 0.05, so its
      // charge is 0.05 exactly, from both sides; FILTER_BY's own call costs less than either.
      const below = 0.049999999999999996;
      // No number lies between it and 0.05: their midpoint rounds to one of the two.
      expect(below).toBeLessThan(0.05);
      expect([below, 0.05]).toContain((below + 0.05) / 2);
      const cases = [
        ['FILTER_BY(LIST(1); LIST(TRUE); "AND"; TRUE)', 'AND(TRUE; TRUE)', [1], true],
        ['FILTER_BY(LIST(1); LIST(TRUE); "OR"; FALSE)', 'OR(TRUE; FALSE)', [1], true],
        ['FILTER_BY(LIST(1); LIST(FALSE); "NOT")', 'NOT(FALSE)', [1], true],
        ['FILTER_BY(LIST(1); LIST(1); "SWITCH"; 1)', 'SWITCH(1; 1)', [], null],
      ] as const;
      for (const [byFilter, written, kept, answer] of cases) {
        const runtime = hostRuntime(() => makeOkBoolean('HOST', true));
        for (const [source, value] of [
          [byFilter, kept],
          [written, answer],
        ] as const) {
          expect(
            (await evaluate(runtime, source, { maxFunctionCostUnits: below })).errors,
            `${source} under the largest number below 0.05`,
          ).toStrictEqual(['security:FUNCTION_COST_LIMIT_EXCEEDED']);
          expect(
            await evaluate(runtime, source, { maxFunctionCostUnits: 0.05 }),
            `${source} under 0.05`,
          ).toStrictEqual({ value, errors: [] });
        }
      }
    });

    it('charges each call of its operator the estimate for the key and the operator value', async () => {
      // The operator's estimate is its second argument: 0.3 for each of the two keys.
      const priced = hostRuntime(
        () => makeOkBoolean('HOST', true),
        (args) => (typeof args[1] === 'number' ? args[1] : 0),
      );
      const source = 'FILTER_BY(LIST("p"; "q"); LIST(1; 2); "HOST"; 0.3)';
      expect(await evaluate(priced, source, { maxFunctionCostUnits: 0.29 })).toStrictEqual({
        value: null,
        errors: ['security:FUNCTION_COST_LIMIT_EXCEEDED'],
      });
      expect(await evaluate(priced, source, { maxFunctionCostUnits: 0.31 })).toStrictEqual({
        value: ['p', 'q'],
        errors: [],
      });
      // Without an operator value each call is charged the estimate for the key alone.
      expect(
        await evaluate(priced, 'FILTER_BY(LIST("p"; "q"); LIST(1; 2); "HOST")', {
          maxFunctionCostUnits: 0.29,
        }),
      ).toStrictEqual({ value: ['p', 'q'], errors: [] });
    });
  });

  it('types the result as the list it filters', async () => {
    expect(await evalOk('JOIN(FILTER_BY(LIST("a"; "b"); LIST(1; 2); ">"; 1); "-")')).toBe('b');
  });

  it('refuses keys of a different length', async () => {
    expect(await warningCodes('FILTER_BY(LIST("a"; "b"); LIST(1); ">"; 0)')).toStrictEqual({
      value: null,
      codes: ['TYPE'],
    });
  });

  it('validates the operator reference at parse time', async () => {
    expect(await errorCodes('FILTER_BY(LIST("a"); LIST(1); "NOT_A_FUNCTION"; 1)')).toContain(
      FormulaErrorCodes.UNKNOWN_FUNCTION_REFERENCE,
    );
    // LEN returns a number, but the check must return a boolean.
    expect(await errorCodes('FILTER_BY(LIST("a"); LIST("x"); "LEN")')).toContain(
      FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH,
    );
    expect(await errorCodes('FILTER_BY(LIST("a"); LIST(1); value; 1)')).toContain(
      FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
    );
  });

  it('follows the null convention and bounds the input', async () => {
    expect(await evalOk('FILTER_BY(value; LIST(1); ">"; 0)', { value: null })).toBe(null);
    expect(await evalOk('FILTER_BY(LIST("a"); value; ">"; 0)', { value: null })).toBe(null);
    expect(await warningCodes('FILTER_BY(LIST("a"); value; ">"; 0)', { value: 'x' })).toStrictEqual(
      { value: null, codes: ['TYPE'] },
    );
    const tooLong = Array.from({ length: 1_001 }, (_, i) => i);
    const { res } = await evalFormula('FILTER_BY(value; value; ">"; 0)', { value: tooLong });
    expect(res.errors.map((e) => e.code)).toContain(FormulaErrorCodes.LIST_TOO_LARGE);
  });
});
