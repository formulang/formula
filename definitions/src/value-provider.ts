import type { FormulaNodeOutput } from './execution-output';

/**
 * Lazy value wrapper used by function implementations.
 *
 * - Memoized: multiple calls must not re-evaluate.
 * - `output()` returns the full child output (including errors/warnings).
 * - `value()` is convenience for the unwrapped value.
 */
export interface FormulaValueProvider {
  output(): Promise<FormulaNodeOutput>;
  value(): Promise<unknown>;
}
