import { describe, expect, it } from 'vitest';
import { createTestRuntime } from '../test-helpers/eval-formula';
import { textCost } from './argument-readers';

/** The functions whose cost estimate `docs/best-practices.md` (§4.4) describes. */
const TEXT_FUNCTIONS = [
  'WORDS',
  'WORD_COUNT',
  'LEADING_WORDS',
  'SENTENCES',
  'LINES',
  'LINE_COUNT',
  'FIRST_CONTAINED',
  'CONTAINS_ANY',
  'MISSING_FROM',
  'PLAIN_TEXT',
  'MARKDOWN_BLOCKS',
];

describe('the cost estimate of the text functions', () => {
  const long = 'a'.repeat(10_000_000);

  it('grows with the length of the text below its cap, and never below zero', () => {
    expect(textCost('')).toBeGreaterThanOrEqual(0);
    expect(textCost('a')).toBeGreaterThanOrEqual(0);
    expect(textCost('a'.repeat(1_000))).toBeGreaterThan(textCost('a'));
    expect(textCost('a'.repeat(1_000))).toBeLessThan(0.05);
  });

  it('is capped at 0.05 units however long the text', () => {
    expect(textCost(long)).toBe(0.05);
  });

  it('is the capped estimate of the text for each text function', () => {
    const { registry, implementations } = createTestRuntime();
    for (const name of TEXT_FUNCTIONS) {
      const definitions = registry.listFunctionsByName(name);
      expect(definitions, name).toHaveLength(1);
      const implementation = implementations.get(definitions[0].signatureId);
      const args = name === 'MISSING_FROM' ? [['x'], long] : [long, ['x']];
      expect(implementation?.estimateCostsInSeconds?.(args), name).toBe(0.05);
    }
  });
});
