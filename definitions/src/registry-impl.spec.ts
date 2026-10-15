import { createRegistry } from './registry-impl';
import { formatType } from './type-utils';
import type { FormulaType } from './types';
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

  it('rejects admitted values on a parameter no string literal fits, and takes them where one does', () => {
    // A literal-only parameter takes a string literal; one whose type no text fits refuses every
    // call, whatever it lists, as an empty list would.
    const register = (type: FormulaType) => {
      const registry = createRegistry();
      registry.registerFunction({
        signatureId: 'MODE/v1',
        name: 'MODE',
        category: 'core',
        description: 'Admitted values on a parameter of the type given.',
        params: [{ name: 'mode', type, literalOnly: true, literalValues: ['1', 'true'] }],
        returnType: FormulaTypes.text(false),
        purity: 'pure',
      });
      return registry;
    };
    const refused = [
      FormulaTypes.number(false),
      FormulaTypes.boolean(true),
      FormulaTypes.list(FormulaTypes.text(false)),
      FormulaTypes.object('date'),
      FormulaTypes.union([FormulaTypes.number(false), FormulaTypes.boolean(false)]),
      FormulaTypes.template('T', { constraint: FormulaTypes.number(false) }),
    ];
    for (const type of refused) {
      expect(() => register(type), formatType(type)).toThrow(
        `Parameter 'mode' of MODE/v1 declares literalValues but takes no string literal (its type is ${formatType(type)})`,
      );
    }
    const taken = [
      FormulaTypes.text(true),
      FormulaTypes.any(true),
      FormulaTypes.template('T'),
      FormulaTypes.callable('function'),
      FormulaTypes.union([FormulaTypes.number(false), FormulaTypes.text(false)]),
    ];
    for (const type of taken) {
      expect(
        register(type).getFunction('MODE/v1')?.params[0]?.literalValues,
        formatType(type),
      ).toStrictEqual(['1', 'true']);
    }
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

  it('rejects admitted values that are not a list of texts', () => {
    // As an untyped transport (JSON, YAML, a JavaScript host) can give them.
    const holed: unknown[] = [];
    holed[1] = 'second';
    const malformed: unknown[] = ['whitespace', { length: 2 }, [1, 2], [null], ['first', 2], holed];
    for (const literalValues of malformed) {
      const registry = createRegistry();
      expect(
        () =>
          registry.registerFunction({
            signatureId: 'MODE/v1',
            name: 'MODE',
            category: 'core',
            description: 'Admitted values that are not texts (expected to throw).',
            params: [
              {
                name: 'mode',
                type: FormulaTypes.text(false),
                literalOnly: true,
                literalValues: literalValues as string[],
              },
            ],
            returnType: FormulaTypes.text(false),
            purity: 'pure',
          }),
        JSON.stringify(literalValues),
      ).toThrow(/declares literalValues that are not a list of texts/);
      expect(registry.getFunction('MODE/v1')).toBeUndefined();
    }
  });

  it('reads a null admitted-value list as none, and stores the definition without it', () => {
    const registry = createRegistry();
    const params = [
      { name: 'text', type: FormulaTypes.text(true) },
      {
        name: 'mode',
        type: FormulaTypes.text(false),
        literalOnly: true,
        literalValues: null as unknown as string[],
      },
      // `literalOnly` given as `null` too: neither applies.
      {
        name: 'option',
        type: FormulaTypes.text(true),
        literalOnly: null as unknown as boolean,
        literalValues: null as unknown as string[],
      },
    ];
    registry.registerFunction({
      signatureId: 'MODE/v1',
      name: 'MODE',
      category: 'core',
      description: 'Null admitted-value lists, as a JSON transport writes absent fields.',
      params,
      returnType: FormulaTypes.text(false),
      purity: 'pure',
    });
    const stored = registry.getFunction('MODE/v1');
    expect(
      stored?.params.map((param) => Object.keys(param).includes('literalValues')),
    ).toStrictEqual([false, false, false]);
    // The caller's definition is left as given.
    expect(params[1]?.literalValues).toBeNull();
  });
});
