import {
  FormulaErrorCodes,
  FormulaTypes,
  type MutableFormulaRegistry,
} from '@formulang/definitions';
import {
  collectAllErrors,
  evalFormula,
  evalOk,
  evalOkWithOutput,
} from '../test-helpers/eval-formula';

async function warningCodes(source: string, vars: Record<string, unknown> = {}) {
  const { output, value } = await evalOkWithOutput(source, vars);
  return { value, codes: (output.warnings ?? []).map((w) => w.code) };
}

async function runtimeErrorCodes(source: string, vars: Record<string, unknown> = {}) {
  const { res } = await evalFormula(source, vars);
  return res.errors.map((e) => e.code);
}

const tooLong = Array.from({ length: 1_001 }, (_, i) => i);

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

  describe('TAKE', () => {
    it('takes count items from a 1-based start', async () => {
      expect(await evalOk('TAKE(LIST(1; 2; 3); 2)')).toStrictEqual([1, 2]);
      expect(await evalOk('TAKE(LIST(1; 2; 3); 2; 3)')).toStrictEqual([3]);
      expect(await evalOk('TAKE(LIST(1; 2; 3); 0)')).toStrictEqual([]);
      expect(await evalOk('TAKE(LIST(1; 2; 3); 5; 2)')).toStrictEqual([2, 3]);
      expect(await evalOk('TAKE(LIST(1; 2; 3); 1; 9)')).toStrictEqual([]);
      expect(await evalOk('TAKE(LIST("a"; "b"); 1; INDEX(LIST(1); 0))')).toStrictEqual(['a']);
    });

    it('refuses a negative or fractional count or start, and a start below 1', async () => {
      for (const source of [
        'TAKE(LIST(1; 2); -1)',
        'TAKE(LIST(1; 2); 1.5)',
        'TAKE(LIST(1; 2); 1; 0)',
        'TAKE(LIST(1; 2); 1; 1.5)',
        'TAKE(LIST(1; 2); 1; -2)',
      ]) {
        expect(await warningCodes(source)).toStrictEqual({ value: null, codes: ['TYPE'] });
      }
    });

    it('follows the null convention and bounds the input', async () => {
      expect(await evalOk('TAKE(value; 1)', { value: null })).toBe(null);
      expect(await evalOk('TAKE(LIST(1); INDEX(LIST(1); 0))')).toBe(null);
      expect(await warningCodes('TAKE(value; 1)', { value: 'abc' })).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
      expect(await runtimeErrorCodes('TAKE(value; 1)', { value: tooLong })).toContain(
        FormulaErrorCodes.LIST_TOO_LARGE,
      );
    });
  });

  describe('INDEX_OF', () => {
    it('answers the 1-based position of the first equal item', async () => {
      expect(await evalOk('INDEX_OF(LIST("a"; "b"); "b")')).toBe(2);
      expect(await evalOk('INDEX_OF(LIST("a"; "b"; "a"); "a")')).toBe(1);
      expect(await evalOk('INDEX_OF(LIST("a"; "b"); "c")')).toBe(null);
      // The coerced equality INCLUDES uses: a number-like text equals the number.
      expect(await evalOk('INDEX_OF(value; "2")', { value: [1, 2, 3] })).toBe(2);
    });

    it('answers null for an empty value and follows the null convention', async () => {
      expect(await evalOk('INDEX_OF(LIST("a"; ""); "")')).toBe(null);
      expect(await evalOk('INDEX_OF(value; "a")', { value: null })).toBe(null);
      expect(await warningCodes('INDEX_OF(value; "a")', { value: 'abc' })).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
      expect(await runtimeErrorCodes('INDEX_OF(value; 1)', { value: tooLong })).toContain(
        FormulaErrorCodes.LIST_TOO_LARGE,
      );
    });
  });

  describe('DISTINCT and GROUP_COUNTS', () => {
    it('keeps first occurrences in order and counts each group', async () => {
      expect(await evalOk('DISTINCT(LIST("x"; "y"; "x"; ""))')).toStrictEqual(['x', 'y']);
      expect(await evalOk('GROUP_COUNTS(LIST("x"; "y"; "x"; ""))')).toStrictEqual([2, 1]);
      expect(await evalOk('DISTINCT(LIST())')).toStrictEqual([]);
      expect(await evalOk('GROUP_COUNTS(LIST())')).toStrictEqual([]);
    });

    it('compares text, numbers and booleans by value, with no conversion between them', async () => {
      const value = [1, '1', true, 1, 'true', false, 0, '', null, 'true'];
      expect(await evalOk('DISTINCT(value)', { value })).toStrictEqual([
        1,
        '1',
        true,
        'true',
        false,
        0,
      ]);
      expect(await evalOk('GROUP_COUNTS(value)', { value })).toStrictEqual([2, 1, 1, 2, 1, 1]);
      // Text is compared exactly, case included.
      expect(await evalOk('DISTINCT(LIST("a"; "A"; "a"))')).toStrictEqual(['a', 'A']);
      expect(await evalOk('COUNT(DISTINCT(LIST("a"; "A"; "a")))')).toBe(2);
    });

    it('compares dates, times and datetimes by kind and ISO text', async () => {
      expect(
        await evalOk('GROUP_COUNTS(LIST(DATE(2024; 1; 2); DATE(2024; 1; 3); DATE(2024; 1; 2)))'),
      ).toStrictEqual([2, 1]);
      expect(
        await evalOk('COUNT(DISTINCT(LIST(TIME(9; 30; 0); TIME(9; 30; 0); TIME(9; 30; 1))))'),
      ).toBe(2);
      expect(await evalOk('COUNT(DISTINCT(LIST(DATE(2024; 1; 2); DATE(2024; 1; 2))))')).toBe(1);
      const day = (extra: Record<string, unknown>) => ({
        __formula_object_kind: 'date',
        iso: '2024-01-02',
        year: 2024,
        month: 1,
        day: 2,
        ...extra,
      });
      // A property outside the date type does not split a group; the ISO text alone is no date.
      expect(
        await evalOk('GROUP_COUNTS(value)', {
          value: [day({ note: 'a' }), day({ note: 'b' }), '2024-01-02'],
        }),
      ).toStrictEqual([2, 1]);
    });

    it('answers null with TYPE for a list holding a list or an object', async () => {
      for (const value of [
        ['a', { a: 1 }],
        [
          [1, 2],
          [1, 2],
        ],
        [1, 'b', [3]],
      ]) {
        for (const fn of ['DISTINCT', 'GROUP_COUNTS']) {
          expect(
            await warningCodes(`${fn}(value)`, { value }),
            `${fn} ${JSON.stringify(value)}`,
          ).toStrictEqual({ value: null, codes: ['TYPE'] });
        }
      }
      // An empty member is skipped as before, an empty list included.
      expect(await evalOk('GROUP_COUNTS(value)', { value: ['a', [], 'a'] })).toStrictEqual([2]);
    });

    it('answers alike for objects that differ only in properties the type does not allowlist', async () => {
      // `staff.*.salary` is refused at parse time, so no answer may depend on salaries.
      const setup = (registry: MutableFormulaRegistry) =>
        registry.registerVariable({
          name: 'staff',
          description: 'People whose type allowlists only the name.',
          type: FormulaTypes.list(
            FormulaTypes.object('person', { name: FormulaTypes.text(true) }),
            true,
          ),
        });
      const differing = [
        { name: 'Ann', salary: 90000 },
        { name: 'Ann', salary: 50000 },
      ];
      const equal = [
        { name: 'Ann', salary: 90000 },
        { name: 'Ann', salary: 90000 },
      ];
      const { parsed } = await evalFormula('staff.*.salary', { staff: differing }, { setup });
      expect(parsed.errors.map((e) => e.code)).toContain(
        FormulaErrorCodes.PROPERTY_NOT_ALLOWLISTED,
      );
      for (const source of ['GROUP_COUNTS(staff)', 'COUNT(DISTINCT(staff))', 'DISTINCT(staff)']) {
        const answers = [];
        for (const staff of [differing, equal]) {
          const { output } = await evalOkWithOutput(source, { staff }, { setup });
          answers.push({ value: output.value, codes: (output.warnings ?? []).map((w) => w.code) });
        }
        expect(answers[0], source).toStrictEqual(answers[1]);
      }
      const { output } = await evalOkWithOutput(
        'GROUP_COUNTS(staff)',
        { staff: differing },
        { setup },
      );
      expect(output.value).toBe(null);
      expect((output.warnings ?? []).map((w) => w.code)).toStrictEqual(['TYPE']);
    });

    it('answers shared and self-containing values at once, without walking them', async () => {
      // One object shared 2^depth ways down a chain, its bottom pointing back to the top: keying
      // contents walked every path (doubling per level). Two cyclic values of different shape:
      // keying contents gave both one key.
      const sharedChain = (depth: number, backEdge: boolean) => {
        const top: Record<string, unknown> = { level: 0 };
        let current = top;
        for (let level = 1; level <= depth; level += 1) {
          const next: Record<string, unknown> = { level };
          current.left = next;
          current.right = next;
          current = next;
        }
        if (backEdge) current.back = top;
        return top;
      };
      const p: Record<string, unknown> = { x: {} };
      (p.x as Record<string, unknown>).y = p;
      const n: Record<string, unknown> = {};
      n.y = n;
      const q = { x: n };
      const values = [
        [sharedChain(14, true)],
        [sharedChain(16, true)],
        [sharedChain(18, true)],
        [sharedChain(18, false), sharedChain(18, false)],
        [p, q],
      ];
      for (const value of values) {
        for (const fn of ['DISTINCT', 'GROUP_COUNTS']) {
          expect(await warningCodes(`${fn}(value)`, { value })).toStrictEqual({
            value: null,
            codes: ['TYPE'],
          });
        }
      }
    });

    it('answers group balance questions', async () => {
      const segments = ['craft', 'retail', 'craft', 'health', 'retail', 'craft'];
      expect(
        await evalOk('MAX(GROUP_COUNTS(value)) - MIN(GROUP_COUNTS(value)) <= 1', {
          value: segments,
        }),
      ).toBe(false);
      expect(await evalOk('COUNT(DISTINCT(value))', { value: segments })).toBe(3);
      expect(
        await evalOk(
          'INDEX(DISTINCT(value); INDEX_OF(GROUP_COUNTS(value); MAX(GROUP_COUNTS(value))))',
          {
            value: segments,
          },
        ),
      ).toBe('craft');
    });

    it('follows the null convention and bounds the input', async () => {
      expect(await evalOk('DISTINCT(value)', { value: null })).toBe(null);
      expect(await evalOk('GROUP_COUNTS(value)', { value: null })).toBe(null);
      expect(await warningCodes('GROUP_COUNTS(value)', { value: 'abc' })).toStrictEqual({
        value: null,
        codes: ['TYPE'],
      });
      expect(await runtimeErrorCodes('DISTINCT(value)', { value: tooLong })).toContain(
        FormulaErrorCodes.LIST_TOO_LARGE,
      );
      expect(await runtimeErrorCodes('GROUP_COUNTS(value)', { value: tooLong })).toContain(
        FormulaErrorCodes.LIST_TOO_LARGE,
      );
    });
  });
});
