import { FormulaTypes } from './types';

describe('FormulaTypes.union', () => {
  it('collapses empty union to any (preserving nullability)', () => {
    const a = FormulaTypes.union([]);
    expect(a.kind).toBe('any');
    expect(a.nullable).toBe(false);
    expect(typeof a.description).toBe('string');
    expect(a.description?.trim().length).toBeGreaterThan(0);

    const b = FormulaTypes.union([], true);
    expect(b.kind).toBe('any');
    expect(b.nullable).toBe(true);
    expect(typeof b.description).toBe('string');
    expect(b.description?.trim().length).toBeGreaterThan(0);
  });

  it('collapses single-member union to the member (preserving nullability)', () => {
    const n = FormulaTypes.union([FormulaTypes.number(false)]);
    expect(n.kind).toBe('number');
    expect(n.nullable).toBe(false);
    expect(typeof n.description).toBe('string');
    expect(n.description?.trim().length).toBeGreaterThan(0);

    // Union-level nullability should propagate to the collapsed primitive.
    const t1 = FormulaTypes.union([FormulaTypes.text(false)], true);
    expect(t1.kind).toBe('text');
    expect(t1.nullable).toBe(true);
    expect(typeof t1.description).toBe('string');
    expect(t1.description?.trim().length).toBeGreaterThan(0);

    // Member nullability should be preserved when collapsing.
    const t2 = FormulaTypes.union([FormulaTypes.text(true)]);
    expect(t2.kind).toBe('text');
    expect(t2.nullable).toBe(true);
    expect(typeof t2.description).toBe('string');
    expect(t2.description?.trim().length).toBeGreaterThan(0);
  });

  it('flattens nested unions and de-duplicates members', () => {
    const t = FormulaTypes.union([
      FormulaTypes.union([FormulaTypes.number(), FormulaTypes.text()]),
      FormulaTypes.number(),
      FormulaTypes.boolean(),
    ]);

    expect(t.kind).toBe('union');
    if (t.kind !== 'union') throw new Error('expected union');

    // Order is stable based on first appearance.
    expect(t.of.map((x) => x.kind)).toStrictEqual(['number', 'text', 'boolean']);
  });
});
