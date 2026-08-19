import { formatType, isAssignable } from './type-utils';
import { FormulaTypes } from './types';

describe('type-utils union support', () => {
  it('treats X as assignable to union if it matches any member', () => {
    const union = FormulaTypes.union([FormulaTypes.number(), FormulaTypes.text()]);
    expect(isAssignable(FormulaTypes.number(), union)).toBe(true);
    expect(isAssignable(FormulaTypes.text(), union)).toBe(true);
    expect(isAssignable(FormulaTypes.boolean(), union)).toBe(false);
  });

  it('treats union as assignable to T only if all members match', () => {
    const union = FormulaTypes.union([FormulaTypes.number(), FormulaTypes.text()]);
    expect(isAssignable(union, FormulaTypes.text())).toBe(false);
    expect(isAssignable(union, FormulaTypes.any())).toBe(true);
  });

  it('treats union-to-union as assignable when each member matches some target member', () => {
    const a = FormulaTypes.union([FormulaTypes.number(), FormulaTypes.text()]);
    const b = FormulaTypes.union([FormulaTypes.text(), FormulaTypes.number()]);
    const c = FormulaTypes.union([FormulaTypes.number(), FormulaTypes.boolean()]);

    expect(isAssignable(a, b)).toBe(true);
    expect(isAssignable(a, c)).toBe(false);
  });

  it('formats union types as parenthesized one-of with outer nullability', () => {
    const t = FormulaTypes.union([FormulaTypes.number(false), FormulaTypes.text(true)], true);
    // Note: formatType strips member nullability inside unions, and applies nullable at the union level.
    expect(formatType(t)).toBe('(number | text)?');
  });
});

describe('type-utils template support', () => {
  it('formats template types using the template name', () => {
    expect(formatType(FormulaTypes.template('T'))).toBe('T');
    expect(formatType(FormulaTypes.template('T', { nullable: true }))).toBe('T?');
  });

  it('treats unconstrained template as assignable to/from any type', () => {
    const T = FormulaTypes.template('T');
    expect(isAssignable(FormulaTypes.number(), T)).toBe(true);
    expect(isAssignable(T, FormulaTypes.number())).toBe(true);
  });

  it('respects template constraints when present', () => {
    const TN = FormulaTypes.template('T', { constraint: FormulaTypes.number() });
    expect(isAssignable(FormulaTypes.number(), TN)).toBe(true);
    expect(isAssignable(FormulaTypes.text(), TN)).toBe(false);
  });
});

describe('type-utils callable support', () => {
  it('treats text as assignable to callable', () => {
    expect(isAssignable(FormulaTypes.text(), FormulaTypes.callable('function_or_operator'))).toBe(
      true,
    );
  });

  it('can compare typed callable signatures', () => {
    const pred = FormulaTypes.callable('function', {
      paramTypes: [FormulaTypes.text(true)],
      returnType: FormulaTypes.boolean(false),
      minArity: 1,
      maxArity: 1,
    });
    const untyped = FormulaTypes.callable('function');
    expect(isAssignable(pred, untyped)).toBe(true);
    expect(isAssignable(untyped, pred)).toBe(false);
  });

  it('formats callable types as Function/Operator labels', () => {
    expect(formatType(FormulaTypes.callable('function'))).toBe('Function');
    expect(formatType(FormulaTypes.callable('operator'))).toBe('Operator');
    expect(formatType(FormulaTypes.callable('function_or_operator'))).toBe('FunctionOrOperator');
  });

  it('formats typed callable signatures', () => {
    const t = FormulaTypes.callable('function_or_operator', {
      paramTypes: [FormulaTypes.number(true), FormulaTypes.text(false)],
      returnType: FormulaTypes.boolean(true),
    });
    expect(formatType(t)).toBe('FunctionOrOperator(number?, text) -> boolean?');
  });
});
