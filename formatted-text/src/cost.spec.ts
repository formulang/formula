import { DEFAULT_FORMULA_LIMITS } from '@formulang/definitions';
import { MARKUP_READ_COST, markupCost } from './argument-readers';
import { FormattedTextSignatureIds } from './definitions';
import { createTestRuntime, evalFormula } from './test-helpers/eval-formula';

describe('the cost estimate of reading markup', () => {
  it('grows with the length of the markup and is not capped', () => {
    expect(markupCost('')).toBe(0.00001);
    expect(markupCost('x'.repeat(1_000))).toBeCloseTo(0.00001 + 1_000 * MARKUP_READ_COST, 12);
    expect(markupCost('x'.repeat(10_000_000))).toBeGreaterThan(
      DEFAULT_FORMULA_LIMITS.maxFunctionCostUnits,
    );
    // A text that is not there yet is assumed 50 code units long.
    expect(markupCost(null)).toBe(markupCost('x'.repeat(50)));
  });

  it('is what both functions declare', () => {
    const { implementations } = createTestRuntime();
    const markup = '# a\n'.repeat(1_000);
    for (const id of Object.values(FormattedTextSignatureIds)) {
      expect(implementations.get(id)?.estimateCostsInSeconds?.([markup, 'markdown']), id).toBe(
        markupCost(markup),
      );
    }
  });

  it.each([
    ['PLAIN_TEXT(value; "markdown")'],
    ['PLAIN_TEXT(value; "html")'],
    ['MARKDOWN_BLOCKS(value; "paragraph")'],
  ])('refuses %s on markup past maxFunctionCostUnits before it runs', async (source) => {
    // Just past the default limit of 2 units.
    const value = '*a _a '.repeat(Math.ceil(2 / MARKUP_READ_COST / 6) + 1);
    const { res } = await evalFormula(source, { value });
    expect(res.value).toBe(null);
    expect(res.errors.map((error) => error.code)).toStrictEqual(['FUNCTION_COST_LIMIT_EXCEEDED']);
  });

  it('admits markup just under the limit', async () => {
    const value = 'a\n'.repeat(Math.floor((2 - 0.00001) / MARKUP_READ_COST / 2) - 1);
    const { res } = await evalFormula('LEN(PLAIN_TEXT(value; "markdown"))', { value });
    expect(res.errors).toStrictEqual([]);
    expect(res.value).toBe(value.length - 1);
  }, 60_000);
});
