import { parseFormula } from '@formulang/parser';
import { evaluateRuleAsync } from '@formulang/runner';
import { FormulaErrorCodes } from './errors';
import { makeOkNumber } from './execution-helpers';
import type {
  FunctionDefinition,
  FunctionImplementation,
  FunctionImplementationResolver,
} from './registry';
import { createRegistry } from './registry-impl';
import type { TypedRule } from './rule';
import { FormulaTypes } from './types';

/** Minimal Number -> Number definition used to exercise legacy registration paths. */
function numberFn(
  signatureId: string,
  overrides?: Partial<FunctionDefinition>,
): FunctionDefinition {
  return {
    signatureId,
    name: signatureId.split('/')[0],
    category: 'core',
    description: 'Test function used to validate legacy definition handling.',
    params: [{ name: 'input', type: FormulaTypes.number(false) }],
    returnType: FormulaTypes.number(false),
    purity: 'pure',
    ...overrides,
  };
}

/** Batch implementation that multiplies its single numeric argument by a fixed factor. */
function multiplyImplementation(name: string, factor: number): FunctionImplementation {
  return {
    evaluateMultiple: (calls) =>
      Promise.all(
        calls.map(async (call) => {
          const input = (await call.args[0].value()) as number;
          return makeOkNumber(name, input * factor);
        }),
      ),
  };
}

describe('InMemoryFormulaRegistry legacy definitions', () => {
  it('registers same-shape legacy + active definitions in both orders', () => {
    const legacyFirst = createRegistry();
    legacyFirst.registerFunction(numberFn('FOO/v1', { legacy: true }));
    expect(() => legacyFirst.registerFunction(numberFn('FOO/v2'))).not.toThrow();

    const activeFirst = createRegistry();
    activeFirst.registerFunction(numberFn('FOO/v2'));
    expect(() => activeFirst.registerFunction(numberFn('FOO/v1', { legacy: true }))).not.toThrow();
  });

  it('still rejects same-shape overloads when both definitions are active', () => {
    const registry = createRegistry();
    registry.registerFunction(numberFn('FOO/v1'));
    expect(() => registry.registerFunction(numberFn('FOO/v2'))).toThrow(/ambiguous overload/i);
  });

  it('still rejects duplicate signature ids when one or both definitions are legacy', () => {
    const legacyFirst = createRegistry();
    legacyFirst.registerFunction(numberFn('DUP/v1', { legacy: true }));
    expect(() => legacyFirst.registerFunction(numberFn('DUP/v1', { legacy: true }))).toThrow(
      /already registered/i,
    );
    expect(() => legacyFirst.registerFunction(numberFn('DUP/v1'))).toThrow(/already registered/i);

    const activeFirst = createRegistry();
    activeFirst.registerFunction(numberFn('DUP/v1'));
    expect(() => activeFirst.registerFunction(numberFn('DUP/v1', { legacy: true }))).toThrow(
      /already registered/i,
    );
  });

  it('resolves legacy definitions by signature id but not by name', () => {
    const registry = createRegistry();
    registry.registerFunction(numberFn('FOO/v1', { legacy: true }));
    registry.registerFunction(numberFn('FOO/v2'));

    expect(registry.listFunctionsByName('FOO').map((d) => d.signatureId)).toEqual(['FOO/v2']);
    expect(registry.listFunctions().map((d) => d.signatureId)).toEqual(['FOO/v2']);
    expect(registry.getFunction('FOO/v1')?.legacy).toBe(true);
    expect(registry.getFunction('FOO/v2')?.signatureId).toBe('FOO/v2');
  });

  it('does not resolve aliases of a legacy definition', () => {
    const registry = createRegistry();
    registry.registerFunction(numberFn('BAR/v1', { legacy: true, aliases: ['OLD_BAR'] }));

    expect(registry.listFunctionsByName('BAR')).toEqual([]);
    expect(registry.listFunctionsByName('OLD_BAR')).toEqual([]);
    expect(registry.getFunction('BAR/v1')?.signatureId).toBe('BAR/v1');
  });

  it('retireFunction removes name/alias resolution but keeps id resolution', () => {
    const registry = createRegistry();
    const def = numberFn('BAZ/v1', { aliases: ['OLD_BAZ'] });
    registry.registerFunction(def);

    registry.retireFunction('BAZ/v1');

    expect(registry.listFunctionsByName('BAZ')).toEqual([]);
    expect(registry.listFunctionsByName('OLD_BAZ')).toEqual([]);
    expect(registry.listFunctions()).toEqual([]);
    expect(registry.getFunction('BAZ/v1')?.legacy).toBe(true);
    // The registry replaces its stored entry; the caller's object is not mutated.
    expect(def.legacy).toBeUndefined();
  });

  it('retireFunction is idempotent and rejects unknown signature ids', () => {
    const registry = createRegistry();
    registry.registerFunction(numberFn('BAZ/v1'));

    registry.retireFunction('BAZ/v1');
    expect(() => registry.retireFunction('BAZ/v1')).not.toThrow();
    expect(registry.getFunction('BAZ/v1')?.legacy).toBe(true);

    expect(() => registry.retireFunction('MISSING/v1')).toThrow(/not registered/i);
  });

  it('allows a same-shape successor after retiring the previous version', () => {
    const registry = createRegistry();
    registry.registerFunction(numberFn('BAZ/v1'));
    registry.retireFunction('BAZ/v1');

    expect(() => registry.registerFunction(numberFn('BAZ/v2'))).not.toThrow();
    expect(registry.listFunctionsByName('BAZ').map((d) => d.signatureId)).toEqual(['BAZ/v2']);
  });

  it('keeps persisted rules evaluable after retire + same-shape re-register (end to end)', async () => {
    const registry = createRegistry();
    const implementations = new Map<string, FunctionImplementation>();
    const resolver: FunctionImplementationResolver = {
      get: (signatureId) => implementations.get(signatureId),
    };

    registry.registerFunction(numberFn('MY_CALC/v1'));
    implementations.set('MY_CALC/v1', multiplyImplementation('MY_CALC', 2));

    const parsed = parseFormula('MY_CALC(2)', { registry });
    expect(parsed.errors).toEqual([]);
    expect(parsed.root).toMatchObject({ kind: 'call', signatureId: 'MY_CALC/v1' });
    expect(parsed.requirements.functionsUsed).toEqual(['MY_CALC/v1']);

    const before = await evaluateRuleAsync(parsed, { registry, resolver, variables: {} });
    expect(before.errors).toEqual([]);
    expect(before.value).toBe(4);

    // Persist the typed rule like a host application would.
    const stored = JSON.parse(JSON.stringify(parsed)) as TypedRule;

    // Evolve: retire v1 and register a same-shape v2 with new behavior.
    registry.retireFunction('MY_CALC/v1');
    registry.registerFunction(numberFn('MY_CALC/v2'));
    implementations.set('MY_CALC/v2', multiplyImplementation('MY_CALC', 10));

    // New parses of the same source bind the active v2.
    const reparsed = parseFormula('MY_CALC(2)', { registry });
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.root).toMatchObject({ kind: 'call', signatureId: 'MY_CALC/v2' });
    const after = await evaluateRuleAsync(reparsed, { registry, resolver, variables: {} });
    expect(after.errors).toEqual([]);
    expect(after.value).toBe(20);

    // Requirements pre-flight for the stored rule: pinned definition + implementation resolve.
    for (const signatureId of stored.requirements.functionsUsed) {
      expect(registry.getFunction(signatureId)).toBeDefined();
      expect(resolver.get(signatureId)).toBeDefined();
    }

    // The revived stored rule still evaluates with its pinned v1 behavior.
    const revived = await evaluateRuleAsync(stored, { registry, resolver, variables: {} });
    expect(revived.errors).toEqual([]);
    expect(revived.value).toBe(4);
  });

  it('hides legacy-only names from callable references but binds the active successor', () => {
    const registry = createRegistry();
    registry.registerFunction({
      signatureId: 'APPLY/v1',
      name: 'APPLY',
      category: 'core',
      description: 'Test higher-order function that references another function by name.',
      params: [
        { name: 'operation', type: FormulaTypes.callable('function'), literalOnly: true },
        { name: 'input', type: FormulaTypes.number(false) },
      ],
      returnType: FormulaTypes.number(false),
      purity: 'pure',
    });
    registry.registerFunction(numberFn('MY_HELPER/v1', { legacy: true }));

    const invisible = parseFormula('APPLY("MY_HELPER"; 2)', { registry });
    expect(invisible.errors.map((e) => e.code)).toEqual([
      FormulaErrorCodes.UNKNOWN_FUNCTION_REFERENCE,
    ]);

    registry.registerFunction(numberFn('MY_HELPER/v2'));
    const visible = parseFormula('APPLY("MY_HELPER"; 2)', { registry });
    expect(visible.errors).toEqual([]);
    // Runtime binding of callable references goes through listFunctionsByName,
    // so the reference resolves to the active v2.
    expect(registry.listFunctionsByName('MY_HELPER').map((d) => d.signatureId)).toEqual([
      'MY_HELPER/v2',
    ]);
  });

  it('reports UNKNOWN_FUNCTION when parsing a name whose only version is retired', () => {
    const registry = createRegistry();
    registry.registerFunction(numberFn('QUX/v1'));
    registry.retireFunction('QUX/v1');

    const parsed = parseFormula('QUX(1)', { registry });
    expect(parsed.errors.some((e) => e.code === FormulaErrorCodes.UNKNOWN_FUNCTION)).toBe(true);
  });
});
