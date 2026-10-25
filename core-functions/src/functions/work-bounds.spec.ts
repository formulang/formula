import { evalFormulaOutput, withOther } from '../test-helpers/eval-formula';
import {
  EXACT,
  FAMILIES,
  KEEP_LONG,
  NOT_EXACT,
  SEARCHES,
  SIZES,
  UNITS_PER_CODE_UNIT,
} from '../test-helpers/work-corpus';
import { observeWork, WorkLimitExceeded } from './work-meter';

/**
 * The work of the text functions whose loops docs/functions.md (_Text_, **Work**) says read their
 * input in linear time, counted by the meter those loops feed (`work-meter.ts`): one unit per step
 * of each loop that walks the input and per code unit one of them hands to the runtime to search
 * (the short loops inside one tag name, run, cell or line are not counted). For each function,
 * inputs built to make one of its loops work hardest (`work-corpus.ts`) are evaluated at three
 * sizes, each twice the one before. The count must grow with the input and in proportion to it
 * (between 1.8 and 2.2 times as much at twice the size), and stay within `UNITS_PER_CODE_UNIT`
 * units per code unit of the input; a loop that reads again what it has read (a cursor not kept, a
 * search started over) breaks the last two. The Knuth-Morris-Pratt searches are held to their own
 * bound, at most `2 * (text + phrase)` units and at least `text + phrase - 1`. Every input whose
 * count is a fixed number of units per repetition is also held to that exact count (`EXACT`), so a
 * step a loop stops reporting fails the spec too; the two that have none say why (`NOT_EXACT`).
 * `keep` tokens longer than their text are held to one unit each, whatever their length. Each
 * evaluation is observed with its bound as the meter's limit, so a loop that works past it stops
 * at once and fails the spec, rather than running on.
 */

/** The units of work an evaluation counts, stopping past `limit`, and that it reports no error. */
async function unitsOf(
  source: string,
  value: unknown,
  other: unknown,
  limit: number,
): Promise<number> {
  const { result, units } = await observeWork(
    () => evalFormulaOutput(source, { value, other }, { setup: withOther }),
    limit,
  );
  const codes = [...result.parsed.errors, ...result.compiled.errors, ...result.errors].map(
    (error) => error.code,
  );
  expect(codes, `${source}: ${units} units, the limit ${limit}`).toStrictEqual([]);
  return units;
}

describe('the work of the text functions whose loops read their input in linear time', () => {
  it('holds every input either to an exact count or to a reason it has none', () => {
    const names = [...FAMILIES, ...SEARCHES].map((input) => input.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...Object.keys(EXACT), ...Object.keys(NOT_EXACT)].sort()).toStrictEqual(
      [...names].sort(),
    );
  });

  for (const family of FAMILIES) {
    it(`${family.source}: ${family.name}`, async () => {
      const counts: number[] = [];
      for (const size of SIZES) {
        const value = family.build(size);
        const bound = UNITS_PER_CODE_UNIT * value.length;
        const units = await unitsOf(family.source, value, size, bound);
        const where = `${family.name} at ${size} (${value.length} code units): ${units} units`;
        expect(units, where).toBeGreaterThan(0);
        expect(units, where).toBeLessThanOrEqual(bound);
        if (family.name in EXACT) {
          const [perRepetition, once] = EXACT[family.name];
          expect(units, where).toBe(perRepetition * size + once);
        }
        counts.push(units);
      }
      for (let index = 1; index < counts.length; index++) {
        const growth = counts[index] / counts[index - 1];
        const where = `${family.name}: ${counts.join(', ')} units at ${SIZES.join(', ')}`;
        expect(growth, where).toBeGreaterThanOrEqual(1.8);
        expect(growth, where).toBeLessThanOrEqual(2.2);
      }
    });
  }

  for (const search of SEARCHES) {
    it(`${search.source}: ${search.name}`, async () => {
      for (const size of SIZES) {
        const text = search.build(size);
        const bound = 2 * (text.length + search.phrase.length);
        const units = await unitsOf(search.source, text, search.phrase, bound);
        const where = `${search.name} at ${text.length} code units: ${units} units`;
        expect(units, where).toBeGreaterThanOrEqual(text.length + search.phrase.length - 1);
        expect(units, where).toBeLessThanOrEqual(bound);
        const [perRepetition, once] = EXACT[search.name];
        expect(units, where).toBe(perRepetition * size + once);
      }
    });
  }

  it(`${KEEP_LONG.source}: ${KEEP_LONG.name}, one unit each whatever their length`, async () => {
    // The text "a. b" costs its scans a fixed number of units, the same however many tokens there
    // are; each token costs one more, its search stopping before it reads the token.
    const alone = await unitsOf(KEEP_LONG.source, [], null, 100);
    for (const tokens of [1, 10, KEEP_LONG.tokens]) {
      for (const length of [5, 1000, KEEP_LONG.tokenLength]) {
        const value = KEEP_LONG.build(tokens, length);
        const units = await unitsOf(KEEP_LONG.source, value, null, alone + tokens);
        expect(units, `${tokens} tokens of ${length} code units`).toBe(alone + tokens);
      }
    }
  });

  it('stops an observed evaluation once its count passes the limit, and not before', async () => {
    const source = 'PLAIN_TEXT(value; "markdown")';
    const value = '`a` '.repeat(10);
    const exact = await unitsOf(source, value, null, Number.POSITIVE_INFINITY);
    expect(await unitsOf(source, value, null, exact)).toBe(exact);
    const stopped = await observeWork(
      () => evalFormulaOutput(source, { value }, { setup: withOther }),
      exact - 1,
    );
    expect(stopped.units).toBe(exact);
    expect(stopped.result.errors.map((error) => error.code)).toStrictEqual(['EVAL_CRASH']);
    expect(stopped.result.errors[0].message).toBe(new WorkLimitExceeded(exact).message);
  });

  it('counts nothing outside an observed evaluation', async () => {
    const outside = await evalFormulaOutput('PLAIN_TEXT(value; "markdown")', { value: '`a` ' });
    expect(outside.errors).toStrictEqual([]);
    const { units } = await observeWork(async () => 0);
    expect(units).toBe(0);
  });

  it('gives each observation its own count, an outer one counting again once an inner one ends', async () => {
    const source = 'PLAIN_TEXT(value; "markdown")';
    const alone = await unitsOf(source, '`a` ', null, Number.POSITIVE_INFINITY);
    const outer = await observeWork(async () => {
      const inner = await observeWork(() => evalFormulaOutput(source, { value: '`a` ' }));
      await evalFormulaOutput(source, { value: '`a` ' });
      return inner.units;
    });
    expect(alone).toBeGreaterThan(0);
    expect(outer.result).toBe(alone);
    expect(outer.units).toBe(alone);
  });
});
