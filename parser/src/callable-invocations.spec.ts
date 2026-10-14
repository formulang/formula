import type {
  FormulaType,
  FunctionDefinition,
  FunctionParamDefinition,
} from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaTypes,
  createRegistry,
  registerCoreFormulaDefinitions,
  stripNullability,
} from '@formulang/definitions';
import { describe, expect, it } from 'vitest';
import baseline from '../../scripts/compat/baseline-1.0.0.json';
import {
  INVOCATIONS_BY_NAME,
  invocationOf,
  invokedArguments,
  type CallableInvocation,
} from './callable-invocations';
import { parseFormula } from './index';

/** The function names 1.0.0 had, from the compatibility baseline generated from 1.0.0. */
const NAMES_IN_1_0_0: readonly string[] = baseline.functionNames;

function coreHigherOrderFunctions() {
  const registry = createRegistry();
  registerCoreFormulaDefinitions(registry);
  return registry
    .listFunctions()
    .filter((def) => def.params.some((param) => stripNullability(param.type).kind === 'callable'));
}

function inOneZeroZero(def: { name: string }): boolean {
  return NAMES_IN_1_0_0.includes(def.name.toUpperCase());
}

describe('callable invocations', () => {
  it('knows the invocation of every core function with a callable parameter, from one source', () => {
    const higherOrder = coreHigherOrderFunctions();
    const byName = [
      ...new Set(higherOrder.filter(inOneZeroZero).map((def) => def.name.toUpperCase())),
    ].sort();
    // Not vacuous: EACH, FILTER, FILTER_PROPERTY and REDUCE from 1.0.0, and FILTER_BY since.
    expect(byName.length).toBeGreaterThanOrEqual(4);
    expect([...INVOCATIONS_BY_NAME.keys()].sort()).toStrictEqual(byName);
    const declaring = higherOrder.filter((def) => def.callableInvocation !== undefined);
    expect(declaring.length).toBeGreaterThanOrEqual(1);
    // The functions 1.0.0 had are keyed by name and declare nothing; every one added since
    // declares its invocation.
    expect(declaring.filter(inOneZeroZero)).toStrictEqual([]);
    expect(declaring.map((def) => def.signatureId).sort()).toStrictEqual(
      higherOrder
        .filter((def) => !inOneZeroZero(def))
        .map((def) => def.signatureId)
        .sort(),
    );
  });

  it('keeps the invocation for a copy under another signature id, never for a host function', () => {
    let byName = 0;
    let declared = 0;
    for (const def of coreHigherOrderFunctions()) {
      expect(invocationOf(def), def.signatureId).toBeDefined();
      // The documented way to change a function: the same definition under the next version.
      const reversioned: FunctionDefinition = { ...def, signatureId: `${def.name}/v9` };
      expect(invocationOf(reversioned), def.signatureId).toBe(invocationOf(def));
      // A function a host registered under the name, which declares no invocation.
      const { callableInvocation, ...hosts } = { ...def, signatureId: `HOST_${def.name}/v1` };
      void callableInvocation;
      if (inOneZeroZero(def)) {
        // 1.0.0 gave the name its invocation, whatever the definition.
        expect(invocationOf(hosts), def.signatureId).toBe(invocationOf(def));
        byName++;
      } else {
        expect(invocationOf(hosts), def.signatureId).toBeUndefined();
        declared++;
      }
    }
    expect(byName).toBeGreaterThan(0);
    expect(declared).toBeGreaterThan(0);
    expect(invocationOf({ name: 'LEN' })).toBeUndefined();
  });

  it('takes a declared invocation before the one 1.0.0 gave the name, under every name', () => {
    // Every invocation the parser knows, declared on a definition under each 1.0.0 name and under
    // a new one: the declaration decides.
    const shapes = [
      ...INVOCATIONS_BY_NAME.values(),
      ...coreHigherOrderFunctions().flatMap((def) => def.callableInvocation ?? []),
    ];
    const names = [...INVOCATIONS_BY_NAME.keys(), 'DECLARING'];
    for (const shape of shapes) {
      for (const name of [...names, ...names.map((n) => n.toLowerCase())]) {
        expect(invocationOf({ name, callableInvocation: shape }), name).toBe(shape);
      }
    }
    expect(shapes.length * names.length).toBeGreaterThan(5 * 4);
    // `null` declares nothing: a 1.0.0 name keeps 1.0.0's invocation, another name has none.
    const none = null as unknown as CallableInvocation;
    expect(invocationOf({ name: 'EACH', callableInvocation: none })).toBe(
      INVOCATIONS_BY_NAME.get('EACH'),
    );
    expect(invocationOf({ name: 'DECLARING', callableInvocation: none })).toBeUndefined();
  });

  it('checks a host overload under a 1.0.0 name by what it declares', () => {
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);
    registry.registerFunction({
      signatureId: 'PICK/v1',
      name: 'PICK',
      category: 'custom',
      description: 'A function with a mode.',
      params: [
        { name: 'subject', type: FormulaTypes.any(true) },
        {
          name: 'mode',
          type: FormulaTypes.text(false),
          literalOnly: true,
          literalValues: ['a', 'b'],
        },
      ],
      returnType: FormulaTypes.boolean(true),
      purity: 'pure',
    });
    // A host's FILTER overload taking four arguments, which calls op(item; mode) and says so.
    registry.registerFunction({
      signatureId: 'HOST_FILTER/v1',
      name: 'FILTER',
      category: 'custom',
      description: 'A FILTER overload passing its fourth argument on.',
      params: [
        { name: 'list', type: FormulaTypes.list(FormulaTypes.any(true), true) },
        {
          name: 'op',
          type: FormulaTypes.callable('function_or_operator', { minArity: 1 }),
          literalOnly: true,
        },
        { name: 'label', type: FormulaTypes.any(true) },
        { name: 'mode', type: FormulaTypes.any(true) },
      ],
      callableInvocation: [
        { kind: 'item', of: 0 },
        { kind: 'argument', at: 3 },
      ],
      returnType: FormulaTypes.list(FormulaTypes.any(true), true),
      purity: 'pure',
    });
    const codes = (source: string) => parseFormula(source, { registry }).errors.map((e) => e.code);
    expect(codes('FILTER(LIST(1); "PICK"; "a"; "zzz")')).toStrictEqual([
      FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
    ]);
    expect(codes('FILTER(LIST(1); "PICK"; "a"; "b")')).toStrictEqual([]);
    expect(codes('FILTER(LIST(1); "PICK"; 0; "a")')).toStrictEqual([]);
    // The core FILTER, which declares nothing, keeps 1.0.0's invocation.
    expect(codes('FILTER(LIST(1); "PICK"; "zzz")')).toStrictEqual([
      FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
    ]);
  });

  it('follows nested callables into every state they reach, past one level per argument', () => {
    // H and K take (fn; a1..a5) and call fn(a1; a2; a1; a4; a5; a3), and K lists 'a' at position
    // 3. In H("H"; "H"; "K"; "a"; "zzz"; "a") the callables alternate between H and K while a3..a5
    // rotate, so "zzz" first reaches K's position 3 seven invocations deep, past the six arguments.
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);
    for (const [name, listing] of [
      ['H', false],
      ['K', true],
    ] as const) {
      registry.registerFunction({
        signatureId: `${name}/v1`,
        name,
        category: 'custom',
        description: 'A higher-order function that reorders what it passes on.',
        params: [
          { name: 'fn', type: FormulaTypes.callable('function_or_operator'), literalOnly: true },
          ...[1, 2, 3, 4, 5].map((index): FunctionParamDefinition =>
            listing && index === 3
              ? {
                  name: `a${index}`,
                  type: FormulaTypes.text(false),
                  literalOnly: true,
                  literalValues: ['a'],
                }
              : { name: `a${index}`, type: FormulaTypes.any(true) },
          ),
        ],
        callableInvocation: [1, 2, 1, 4, 5, 3].map((at) => ({ kind: 'argument', at })),
        returnType: FormulaTypes.any(true),
        purity: 'pure',
      });
    }
    const errorsOf = (source: string) => parseFormula(source, { registry }).errors;
    const [refused, ...rest] = errorsOf('H("H"; "H"; "K"; "a"; "zzz"; "a")');
    expect(rest).toStrictEqual([]);
    expect(refused?.code).toBe(FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED);
    expect(refused?.span).toStrictEqual({ start: 22, end: 27 });
    expect(errorsOf('H("H"; "H"; "K"; "a"; "a"; "a")')).toStrictEqual([]);
  });

  it('reaches every callable parameter through the literal-only check', () => {
    // The parser validates a callable (and its invocation) only for a literal-only parameter.
    for (const def of coreHigherOrderFunctions()) {
      for (const param of def.params) {
        if (stripNullability(param.type).kind !== 'callable') continue;
        expect(param.literalOnly, `${def.signatureId} ${param.name}`).toBe(true);
      }
    }
  });

  it('forwards the call arguments each higher-order function passes on', () => {
    const text = FormulaTypes.text(false);
    const texts = FormulaTypes.list(text, false);
    const number = FormulaTypes.number(false);
    const core = coreHigherOrderFunctions();
    const invoke = (name: string, argTypes: FormulaType[]) => {
      const def = core.find((candidate) => candidate.name === name);
      const invocation = def && invocationOf(def);
      return (
        invocation && invokedArguments(invocation, argTypes).map((arg) => arg.forwards ?? null)
      );
    };

    expect(invoke('EACH', [texts, text, number, text])).toStrictEqual([null, 2, 3]);
    expect(invoke('FILTER', [texts, text, text])).toStrictEqual([null, 2]);
    expect(invoke('FILTER', [texts, text])).toStrictEqual([null]);
    expect(invoke('FILTER_PROPERTY', [texts, text, text, number])).toStrictEqual([null, 3]);
    expect(invoke('FILTER_BY', [texts, texts, text, number])).toStrictEqual([null, 3]);
    expect(invoke('REDUCE', [number, texts, text])).toStrictEqual([null, null]);
  });

  it('holds every invocation of the 1.0.0 table to the rule registration holds declarations to', () => {
    // The nested walk ends because no invocation passes on more arguments than it receives or
    // lists: registration refuses a declaration that would, and each table entry, declared on the
    // definition it describes, registers.
    const core = coreHigherOrderFunctions();
    for (const [name, invocation] of INVOCATIONS_BY_NAME) {
      const def = core.find((candidate) => candidate.name.toUpperCase() === name);
      expect(def, name).toBeDefined();
      const declaring = { ...def!, signatureId: `${name}/v9`, callableInvocation: [...invocation] };
      expect(() => createRegistry().registerFunction(declaring), name).not.toThrow();
    }
  });
});
