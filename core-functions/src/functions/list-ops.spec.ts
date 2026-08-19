import { FormulaErrorCodes } from '@formulang/definitions';
import { collectAllErrors, evalFormula, evalOk } from '../test-helpers/eval-formula';

describe('List ops', () => {
  it('sorts lists', async () => {
    expect(await evalOk('SORT(LIST(3; 1; 2))')).toStrictEqual([1, 2, 3]);
    expect(await evalOk('SORT(LIST(3; 1; 2); true)')).toStrictEqual([3, 2, 1]);
    expect(await evalOk('SORT(LIST("b"; "A"; "a"))')).toStrictEqual(['A', 'a', 'b']);

    // Stable sort: equal keys preserve original order.
    expect(await evalOk('SORT(LIST("b"; "B"; "a"))')).toStrictEqual(['a', 'b', 'B']);

    // Type ordering: numbers < strings < booleans < objects < null.
    const mixed = [true, null, 2, 'A', { a: 1 }, false, 'b', 1];
    expect(await evalOk('SORT(value)', { value: mixed })).toStrictEqual([
      1,
      2,
      'A',
      'b',
      false,
      true,
      { a: 1 },
      null,
    ]);

    // Non-list input is a type error.
    const sortType = await evalFormula('SORT(1)');
    const sortAll = collectAllErrors(sortType.parsed, sortType.compiled, sortType.res.errors);
    expect(sortAll.some((e) => e.code === FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH)).toBe(true);
  });

  it('indexes lists (1-based)', async () => {
    expect(await evalOk('INDEX(LIST(10; 20; 30); 2)')).toBe(20);
    expect(await evalOk('INDEX(LIST(10; 20; 30); 0)')).toBe(null);
    expect(await evalOk('INDEX(LIST(10; 20; 30); 4)')).toBe(null);

    // Fractional indexes are rejected.
    expect(await evalOk('INDEX(LIST(10; 20; 30); 1.2)')).toBe(null);
    // Non-list input is a type error.
    const indexType = await evalFormula('INDEX(1; 1)');
    const indexAll = collectAllErrors(indexType.parsed, indexType.compiled, indexType.res.errors);
    expect(indexAll.some((e) => e.code === FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH)).toBe(true);
  });

  it('reduces lists by operator name', async () => {
    expect(await evalOk('REDUCE(0; LIST(1; 2; 3); "+")')).toBe(6);
    expect(await evalOk('REDUCE(1; LIST(2; 3; 4); "*")')).toBe(24);
    expect(await evalOk('REDUCE(""; LIST("a"; "b"); "CONCAT")')).toBe('ab');

    // Empty list returns the initial value.
    expect(await evalOk('REDUCE(123; LIST(); "+")')).toBe(123);

    // Unknown operator reference is a type error.
    const unknownOp = await evalFormula('REDUCE(0; LIST(1; 2); "NOT_A_FUNCTION")');
    const unknownAll = collectAllErrors(unknownOp.parsed, unknownOp.compiled, unknownOp.res.errors);
    expect(unknownAll.some((e) => e.code === FormulaErrorCodes.UNKNOWN_FUNCTION_REFERENCE)).toBe(
      true,
    );
  });

  it('enforces maxListLength for REDUCE', async () => {
    const tooLarge = await evalFormula(
      'REDUCE(0; value; "+")',
      { value: [1, 2, 3] },
      {
        limits: { maxListLength: 2 },
      },
    );
    expect(tooLarge.res.errors.some((e) => e.code === FormulaErrorCodes.LIST_TOO_LARGE)).toBe(true);
  });

  it('sorts by property', async () => {
    const list = [{ a: 2 }, { a: 1 }, { a: 3 }];
    expect(await evalOk('SORT_BY_PROPERTY(value; "a")', { value: list })).toStrictEqual([
      { a: 1 },
      { a: 2 },
      { a: 3 },
    ]);

    const nested = [{ a: { b: 2 } }, { a: { b: 1 } }];
    expect(await evalOk('SORT_BY_PROPERTY(value; "a.b")', { value: nested })).toStrictEqual([
      { a: { b: 1 } },
      { a: { b: 2 } },
    ]);

    expect(await evalOk('SORT_BY_PROPERTY(value; "a"; true)', { value: list })).toStrictEqual([
      { a: 3 },
      { a: 2 },
      { a: 1 },
    ]);

    // Missing properties sort last and preserve original order.
    const missing = [{ a: 2 }, {}, { a: 1 }, {}];
    expect(await evalOk('SORT_BY_PROPERTY(value; "a")', { value: missing })).toStrictEqual([
      { a: 1 },
      { a: 2 },
      {},
      {},
    ]);
  });
});
