import type { FormulaNodeOutput, FormulaType } from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaTypes,
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

    it('answers null with a TYPE warning when no definition has an implementation', async () => {
      const runtime = checkRuntime([]);
      expect(
        await run(runtime, 'FILTER_BY(LIST("p"; "q"); LIST("yes"; "no"); "CHECK")'),
      ).toStrictEqual({ parse: [], value: null, warnings: ['TYPE'] });
      expect(runtime.invoked).toStrictEqual([]);
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
