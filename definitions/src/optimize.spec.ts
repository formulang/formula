import { parseFormula } from '@formulang/parser';
import { optimizeRule } from './optimize';
import { registerCoreFormulaDefinitions } from './register-core-definitions';
import { createRegistry } from './registry-impl';
import { FormulaTypes } from './types';

describe('optimizeRule', () => {
  it('does not execute backend-only constant folding', () => {
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);
    const parsed = parseFormula('LIST(1;2)', { registry });
    expect(parsed.errors.length).toBe(0);

    const optimized = optimizeRule(parsed, { registry });
    // LIST has predictableValue but is not folded to a literal by the portable optimizer.
    expect(optimized.root.kind).toBe('call');
  });

  it('folds EMPTY()/BLANK() to a literal null', () => {
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);

    for (const src of ['EMPTY()', 'BLANK()']) {
      const parsed = parseFormula(src, { registry });
      expect(parsed.errors.length).toBe(0);

      const optimized = optimizeRule(parsed, { registry });
      expect(optimized.root.kind).toBe('literal');
      expect((optimized.root as any).value).toBe(null);
    }
  });

  it('preserves parse-time node ids', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'value',
      description: 'A test input value.',
      type: FormulaTypes.any(true),
    });
    const parsed = parseFormula('value', { registry });

    const optimized = optimizeRule(parsed, { registry });
    expect(optimized.root.id).toBe(parsed.root.id);
  });
});
