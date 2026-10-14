import type {
  FunctionDefinition,
  FunctionParamDefinition,
  InvokedArgumentDeclaration,
} from './registry';
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

  it('registers a literal-only parameter with admitted values', () => {
    const registry = createRegistry();
    registry.registerFunction({
      signatureId: 'MODE/v1',
      name: 'MODE',
      category: 'core',
      description: 'Test function with an enumerated literal-only mode.',
      params: [
        {
          name: 'mode',
          type: FormulaTypes.text(false),
          literalOnly: true,
          literalValues: ['first', 'second'],
        },
      ],
      returnType: FormulaTypes.text(false),
      purity: 'pure',
    });

    expect(registry.getFunction('MODE/v1')?.params[0]?.literalValues).toStrictEqual([
      'first',
      'second',
    ]);
  });

  it('rejects admitted literal values on a parameter that is not literal-only', () => {
    const registry = createRegistry();
    expect(() =>
      registry.registerFunction({
        signatureId: 'MODE/v1',
        name: 'MODE',
        category: 'core',
        description: 'Admitted values without literalOnly (expected to throw).',
        params: [{ name: 'mode', type: FormulaTypes.text(false), literalValues: ['first'] }],
        returnType: FormulaTypes.text(false),
        purity: 'pure',
      }),
    ).toThrow(/declares literalValues but is not literalOnly/);
    expect(registry.getFunction('MODE/v1')).toBeUndefined();
  });

  it('rejects an empty admitted-value list', () => {
    const registry = createRegistry();
    expect(() =>
      registry.registerFunction({
        signatureId: 'MODE/v1',
        name: 'MODE',
        category: 'core',
        description: 'An empty admitted-value list (expected to throw).',
        params: [
          { name: 'mode', type: FormulaTypes.text(false), literalOnly: true, literalValues: [] },
        ],
        returnType: FormulaTypes.text(false),
        purity: 'pure',
      }),
    ).toThrow(/empty literalValues list/);
  });

  it('registers a declared callable invocation, and refuses one the parser could not apply', () => {
    const higherOrder = (
      callableInvocation: InvokedArgumentDeclaration[],
      params: FunctionParamDefinition[] = [
        { name: 'list', type: FormulaTypes.list(FormulaTypes.any(true), true) },
        { name: 'keys', type: FormulaTypes.list(FormulaTypes.any(true), true) },
        {
          name: 'operator',
          type: FormulaTypes.callable('function_or_operator', { minArity: 1 }),
          literalOnly: true,
        },
        { name: 'value', type: FormulaTypes.any(true), optional: true },
      ],
    ): FunctionDefinition => ({
      signatureId: 'KEYED/v1',
      name: 'KEYED',
      category: 'custom',
      description: 'A higher-order function that declares its invocation.',
      params,
      callableInvocation,
      returnType: FormulaTypes.list(FormulaTypes.any(true), true),
      purity: 'pure',
    });
    const register = (def: FunctionDefinition) => () => createRegistry().registerFunction(def);

    const keyed = higherOrder([
      { kind: 'item', of: 1 },
      { kind: 'argument', at: 3 },
    ]);
    const registry = createRegistry();
    registry.registerFunction(keyed);
    expect(registry.getFunction('KEYED/v1')?.callableInvocation).toStrictEqual(
      keyed.callableInvocation,
    );
    expect(
      register(
        higherOrder([
          { kind: 'value', typeOf: 0 },
          { kind: 'arguments', from: 3 },
        ]),
      ),
    ).not.toThrow();

    for (const [invocation, message] of [
      [[{ kind: 'item', of: 4 }], /names no parameter other than the callable at of/],
      [[{ kind: 'item', of: 2 }], /names no parameter other than the callable at of/],
      [[{ kind: 'item', of: 3 }], /takes items from parameter 3, which is not a list/],
      [[{ kind: 'argument', at: 1 }], /passes on argument 1, before the callable/],
      [[{ kind: 'arguments', from: 0 }], /passes on argument 0, before the callable/],
      [[{ kind: 'value', typeOf: 9 }], /names no parameter other than the callable at typeOf/],
      [[{ kind: 'element', of: 0 }], /declares an unknown argument kind/],
    ] as const) {
      expect(
        register(higherOrder(invocation as unknown as InvokedArgumentDeclaration[])),
        JSON.stringify(invocation),
      ).toThrow(message);
    }
    const withoutCallable = higherOrder(
      [{ kind: 'item', of: 0 }],
      [{ name: 'list', type: FormulaTypes.list(FormulaTypes.any(true), true) }],
    );
    expect(register(withoutCallable)).toThrow(/needs exactly one callable parameter/);
    const notLiteralOnly = higherOrder(
      [{ kind: 'item', of: 0 }],
      [
        { name: 'list', type: FormulaTypes.list(FormulaTypes.any(true), true) },
        { name: 'operator', type: FormulaTypes.callable('function_or_operator', {}) },
      ],
    );
    expect(register(notLiteralOnly)).toThrow(/needs its callable parameter to be literalOnly/);
  });
});
