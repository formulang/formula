import { FormulaErrorCodes } from '@formulang/definitions';
import {
  collectAllErrors,
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

  it('calls the overload of the operator that the parser checked', async () => {
    // STARTS_WITH has a text and a list overload; the list one is checked here and must run.
    expect(
      await evalOk(
        'FILTER_BY(LIST("x"; "y"; "z"); LIST("apple"; "banana"; "cherry"); "STARTS_WITH"; LIST("a"; "c"))',
      ),
    ).toStrictEqual(['x', 'z']);
    expect(
      await evalOk(
        'FILTER_BY(LIST("x"; "y"; "z"); LIST("apple"; "banana"; "cherry"); "STARTS_WITH"; "b")',
      ),
    ).toStrictEqual(['y']);
    // Each key answers as the direct call with the same literal arguments does.
    const literal = (value: string | string[]) =>
      Array.isArray(value)
        ? `LIST(${value.map((item) => JSON.stringify(item)).join('; ')})`
        : JSON.stringify(value);
    const keys = ['apple', 'banana', 'cherry', 'x'];
    for (const needles of [['a', 'c'], ['b'], ['x', 'ch'], [''], 'b', '']) {
      const kept: string[] = [];
      for (const key of keys) {
        const direct = `STARTS_WITH(${literal(key)}; ${literal(needles)})`;
        if ((await evalOk(direct)) === true) kept.push(key);
      }
      const source = `FILTER_BY(${literal(keys)}; ${literal(keys)}; "STARTS_WITH"; ${literal(needles)})`;
      expect(await evalOk(source), source).toStrictEqual(kept);
    }
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
