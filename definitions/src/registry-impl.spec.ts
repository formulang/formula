import { createRegistry } from './registry-impl';
import { FormulaTypes } from './types';

describe('InMemoryFormulaRegistry', () => {
  it('registers and resolves functions by signature id', () => {
    const registry = createRegistry();
    registry.registerFunction({
      signatureId: 'TEST/v1',
      name: 'TEST',
      category: 'core',
      description: 'Test function used to validate registry lookup by signature id.',
      params: [],
      returnType: FormulaTypes.text(),
      purity: 'pure',
    });

    expect(registry.getFunction('TEST/v1')?.signatureId).toBe('TEST/v1');
    expect(registry.listFunctionsByName('TEST').length).toBe(1);
  });

  it('rejects duplicate function signature ids', () => {
    const registry = createRegistry();
    registry.registerFunction({
      signatureId: 'DUP/v1',
      name: 'DUP',
      category: 'core',
      description: 'Test function used to validate duplicate signature rejection.',
      params: [],
      returnType: FormulaTypes.text(),
      purity: 'pure',
    });

    expect(() =>
      registry.registerFunction({
        signatureId: 'DUP/v1',
        name: 'DUP',
        category: 'core',
        description: 'Second registration of the same signature id (expected to throw).',
        params: [],
        returnType: FormulaTypes.text(),
        purity: 'pure',
      }),
    ).toThrow(/already registered/i);
  });

  it('registers and resolves variables', () => {
    const registry = createRegistry();
    registry.registerVariable({
      name: 'foo',
      description: 'A test number value.',
      type: FormulaTypes.number(true),
    });
    expect(registry.getVariable('foo')?.name).toBe('foo');
  });

  it('rejects duplicate operator tokens', () => {
    const registry = createRegistry();
    registry.registerOperator({
      token: '+',
      precedence: 10,
      associativity: 'left',
      functionSignatureId: 'ADD/v1',
    });
    expect(() =>
      registry.registerOperator({
        token: '+',
        precedence: 10,
        associativity: 'left',
        functionSignatureId: 'ADD/v2',
      }),
    ).toThrow(/operator already registered/i);
  });

  it('rejects ambiguous overloads with identical param shapes', () => {
    const registry = createRegistry();
    registry.registerFunction({
      signatureId: 'OVER/v1',
      name: 'OVER',
      category: 'core',
      description: 'Test overload used to validate ambiguity detection.',
      params: [{ name: 'x', type: FormulaTypes.number(false) }],
      returnType: FormulaTypes.number(false),
      purity: 'pure',
    });

    expect(() =>
      registry.registerFunction({
        signatureId: 'OVER/v2',
        name: 'OVER',
        category: 'core',
        description: 'Second overload with identical shape (expected to throw).',
        params: [{ name: 'x', type: FormulaTypes.number(false) }],
        returnType: FormulaTypes.number(false),
        purity: 'pure',
      }),
    ).toThrow(/ambiguous overload/i);
  });

  it('rejects ambiguous overloads when a variadic overload overlaps a fixed overload', () => {
    const registry = createRegistry();
    registry.registerFunction({
      signatureId: 'VOVER/v1',
      name: 'VOVER',
      category: 'core',
      description: 'Variadic test overload used to validate ambiguity detection.',
      params: [{ name: 'x', type: FormulaTypes.number(false), variadic: true }],
      returnType: FormulaTypes.number(false),
      purity: 'pure',
    });

    expect(() =>
      registry.registerFunction({
        signatureId: 'VOVER/v2',
        name: 'VOVER',
        category: 'core',
        description: 'Fixed-arity overload overlapping variadic overload (expected to throw).',
        params: [{ name: 'x', type: FormulaTypes.number(false) }],
        returnType: FormulaTypes.number(false),
        purity: 'pure',
      }),
    ).toThrow(/ambiguous overload/i);
  });

  it('rejects ambiguous overloads with identical union param shapes', () => {
    const registry = createRegistry();
    const booleanLike = FormulaTypes.union([FormulaTypes.boolean(false), FormulaTypes.text(false)]);

    registry.registerFunction({
      signatureId: 'UOVER/v1',
      name: 'UOVER',
      category: 'core',
      description: 'Test overload using a union type to validate ambiguity detection.',
      params: [{ name: 'x', type: booleanLike }],
      returnType: FormulaTypes.text(false),
      purity: 'pure',
    });

    expect(() =>
      registry.registerFunction({
        signatureId: 'UOVER/v2',
        name: 'UOVER',
        category: 'core',
        description: 'Second overload with identical union shape (expected to throw).',
        params: [{ name: 'x', type: booleanLike }],
        returnType: FormulaTypes.text(false),
        purity: 'pure',
      }),
    ).toThrow(/ambiguous overload/i);
  });
});
