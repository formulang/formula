import { FormulaTypes } from '@formulang/definitions';
import { describe, expect, it } from 'vitest';
import { createTestRuntime, evalFormula } from '../test-helpers/eval-formula';
import { TEXT_PASS_COST, TEXT_SEARCH_COST, textCost } from './argument-readers';

/** Each text function with how its arguments are laid out: the text, and the list it searches by. */
const TEXT_FUNCTIONS: { name: string; args: (text: string, list: string[]) => unknown[] }[] = [
  { name: 'WORDS', args: (text) => [text] },
  { name: 'WORD_COUNT', args: (text) => [text] },
  { name: 'LEADING_WORDS', args: (text) => [text, 1] },
  { name: 'LINES', args: (text) => [text] },
  { name: 'LINE_COUNT', args: (text) => [text] },
  { name: 'SENTENCES', args: (text, list) => [text, null, list] },
  { name: 'FIRST_CONTAINED', args: (text, list) => [text, list] },
  { name: 'CONTAINS_ANY', args: (text, list) => [text, list] },
  { name: 'MISSING_FROM', args: (text, list) => [list, text] },
];

const SEARCHING = new Set(['SENTENCES', 'FIRST_CONTAINED', 'CONTAINS_ANY', 'MISSING_FROM']);

describe('the cost estimate of the text functions', () => {
  it('grows with the text, and with the number of searches of it, without a cap', () => {
    expect(textCost('')).toBeGreaterThan(0);
    expect(textCost('a'.repeat(1_000))).toBeGreaterThan(textCost('a'));
    expect(textCost('a'.repeat(1_000), 10)).toBeGreaterThan(textCost('a'.repeat(1_000)));
    const length = 10_000_000;
    expect(textCost('a'.repeat(length))).toBeCloseTo(0.00001 + TEXT_PASS_COST * length, 10);
    expect(textCost('a'.repeat(length), 3)).toBeCloseTo(
      0.00001 + TEXT_PASS_COST * length + TEXT_SEARCH_COST * length * 3,
      10,
    );
  });

  it('is what each text function estimates for its text and the list it searches by', () => {
    const { registry, implementations } = createTestRuntime();
    const text = 'a'.repeat(100_000);
    const list = ['x', 'y', 'z'];
    for (const { name, args } of TEXT_FUNCTIONS) {
      const definitions = registry.listFunctionsByName(name);
      expect(definitions, name).toHaveLength(1);
      const implementation = implementations.get(definitions[0].signatureId);
      const expected = textCost(text, SEARCHING.has(name) ? list.length : 0);
      expect(implementation?.estimateCostsInSeconds?.(args(text, list)), name).toBe(expected);
    }
  });

  it('refuses a search too large for the per-call limit before running it', async () => {
    // A million-unit text searched for 1,000 whole-word phrases: tens of seconds of work if run.
    const started = Date.now();
    const { res } = await evalFormula(
      'CONTAINS_ANY(value; phrases; "word")',
      { value: 'a'.repeat(1_000_000), phrases: Array(1_000).fill('a'.repeat(250)) },
      {
        setup: (registry) =>
          registry.registerVariable({
            name: 'phrases',
            description: 'Phrases to search for.',
            type: FormulaTypes.list(FormulaTypes.text(true), true),
          }),
      },
    );
    expect(res.value).toBe(null);
    expect(res.errors.map((error) => error.code)).toStrictEqual(['FUNCTION_COST_LIMIT_EXCEEDED']);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
