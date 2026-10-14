import type { FormulaType, FunctionDefinition } from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaTypes,
  createRegistry,
  registerCoreFormulaDefinitions,
  stripNullability,
} from '@formulang/definitions';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import baseline from '../../scripts/compat/baseline-1.0.0.json';
import {
  INVOCATIONS_BY_NAME,
  RESULTS_BY_NAME,
  invocationOf,
  invokedArguments,
  walkStateKey,
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

/** The core registry with PICK(subject; mode), whose mode lists `a` and `b`. */
function registryWithPick() {
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
  return registry;
}

function only(registry: ReturnType<typeof createRegistry>, name: string): FunctionDefinition {
  const [def] = registry.listFunctionsByName(name);
  if (def === undefined) throw new Error(`no ${name}`);
  return def;
}

describe('callable invocations', () => {
  it('knows the invocation of every core function with a callable parameter, from one table', () => {
    const names = [
      ...new Set(coreHigherOrderFunctions().map((def) => def.name.toUpperCase())),
    ].sort();
    // Both ways: every core higher-order function has an entry, and every entry names one.
    expect([...INVOCATIONS_BY_NAME.keys()].sort()).toStrictEqual(names);
    // Not vacuous: EACH, FILTER, FILTER_PROPERTY and REDUCE from 1.0.0, and FILTER_BY since.
    expect(names.filter((name) => NAMES_IN_1_0_0.includes(name)).length).toBe(4);
    expect(names.filter((name) => !NAMES_IN_1_0_0.includes(name)).length).toBeGreaterThan(0);
  });

  it('names a higher-order function in the parser only in its table module', () => {
    // Every reader of an invocation reads the table: no other module of the parser names a core
    // higher-order function, so no name-keyed rule decides an invocation on its own, and every
    // name-keyed result rule of the table module names an entry.
    const names = [...new Set(coreHigherOrderFunctions().map((def) => def.name.toUpperCase()))];
    const modules = readdirSync(__dirname).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'),
    );
    expect(modules).toContain('index.ts');
    for (const module of modules) {
      if (module === 'callable-invocations.ts') continue;
      const text = readFileSync(join(__dirname, module), 'utf8');
      const named = names.filter((name) => new RegExp(`['"\`]${name}['"\`]`).test(text));
      expect(named, module).toStrictEqual([]);
    }
    const resultRules = [...RESULTS_BY_NAME.keys()];
    expect(resultRules.filter((name) => !INVOCATIONS_BY_NAME.has(name))).toStrictEqual([]);
    expect(resultRules.length).toBeGreaterThan(0);
  });

  it('gives the entry to every definition of the name, and to none under another name', () => {
    for (const def of coreHigherOrderFunctions()) {
      const entry = INVOCATIONS_BY_NAME.get(def.name.toUpperCase());
      expect(entry, def.signatureId).toBeDefined();
      expect(invocationOf(def), def.signatureId).toBe(entry);
      // The documented way to change a function: the same definition under the next version.
      expect(invocationOf({ ...def, signatureId: `${def.name}/v9` }), def.signatureId).toBe(entry);
      // A host's own function under the name, in any letter case.
      expect(invocationOf({ name: def.name.toLowerCase() }), def.signatureId).toBe(entry);
      // A copy under another name is a plain function, as a copy of EACH is on 1.0.0.
      expect(invocationOf({ ...def, name: `${def.name}_COPY` }), def.signatureId).toBeUndefined();
    }
    expect(invocationOf({ name: 'LEN' })).toBeUndefined();
  });

  it('checks every definition under a table name, and a copy under another name as plain', () => {
    const registry = registryWithPick();
    // FILTER_BY re-registered under another signature id, and copies of FILTER_BY and EACH under
    // names of their own.
    const filterBy = only(registry, 'FILTER_BY');
    registry.retireFunction(filterBy.signatureId);
    registry.registerFunction({ ...filterBy, signatureId: 'FILTER_BY/v2' });
    registry.registerFunction({ ...filterBy, name: 'KEYED', signatureId: 'KEYED/v1' });
    registry.registerFunction({ ...only(registry, 'EACH'), name: 'MAP', signatureId: 'MAP/v1' });
    const codes = (source: string) => parseFormula(source, { registry }).errors.map((e) => e.code);
    for (const checked of [
      'FILTER_BY(LIST(1); LIST("k"); "PICK"; "zzz")',
      'EACH(LIST(1); "PICK"; "zzz")',
      'EACH(LIST(LIST(1)); "FILTER_BY"; LIST("k"); "PICK"; "zzz")',
    ]) {
      expect(codes(checked), checked).toStrictEqual([FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED]);
    }
    for (const plain of [
      'KEYED(LIST(1); LIST("k"); "PICK"; "zzz")',
      'MAP(LIST(1); "PICK"; "zzz")',
      'EACH(LIST(LIST(1)); "MAP"; "PICK"; "zzz")',
    ]) {
      expect(codes(plain), plain).toStrictEqual([]);
    }
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

  it('passes the callable fewer arguments than its call holds whenever it passes one on', () => {
    // What ends the walk through nested callables: along a chain of callables named by string
    // literals, every level passes on fewer arguments than the level before it.
    const furthest = Math.max(
      ...[...INVOCATIONS_BY_NAME.values()].flat().map((source) => {
        const { of, at, from, typeOf } = source as Record<string, number | undefined>;
        return of ?? at ?? from ?? typeOf ?? 0;
      }),
    );
    let forwarding = 0;
    for (const [name, invocation] of INVOCATIONS_BY_NAME) {
      for (let count = 0; count <= 2 * furthest + 4; count++) {
        const argTypes = Array.from({ length: count }, () => FormulaTypes.any(true));
        const invoked = invokedArguments(invocation, argTypes);
        if (invoked.every((arg) => arg.forwards === undefined)) continue;
        expect(invoked.length, `${name} with ${count} arguments`).toBeLessThan(count);
        forwarding++;
      }
    }
    // Not vacuous: every entry but REDUCE passes arguments on.
    expect(forwarding).toBeGreaterThan(4 * furthest);
  });

  it('follows a chain of EACH calls as deep as the call written holds arguments', () => {
    // Every level of EACH passes on one argument fewer, so a call of n arguments reaches PICK n - 2
    // levels down; the literal is checked there, and only an admitted one compiles.
    const registry = registryWithPick();
    const codes = (source: string) => parseFormula(source, { registry }).errors.map((e) => e.code);
    for (const count of [4, 8, 16]) {
      const levels = count - 2;
      const list = `${'LIST('.repeat(levels)}1${')'.repeat(levels)}`;
      const chain = '"EACH"; '.repeat(levels - 1);
      const misspelt = `EACH(${list}; ${chain}"PICK"; "zzz")`;
      expect(codes(misspelt), misspelt).toStrictEqual([
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
      ]);
      expect(codes(misspelt.replace('"zzz"', '"a"'))).toStrictEqual([]);
    }
  });

  it('checks each state once where overloads follow a callable along several reference kinds', () => {
    // A host's EACH overload whose callable takes functions only, beside the core EACH's functions
    // or operators: at every level both follow the callable named there. Checked once per state,
    // the chain takes a moment; walked once per path, it would take 2^23 walks. (Only the first
    // level's types are checked, so a list of lists is enough for every level.)
    const registry = registryWithPick();
    const each = only(registry, 'EACH');
    registry.registerFunction({
      ...each,
      signatureId: 'HOST_EACH/v1',
      params: each.params.map((param, index) => {
        if (index === 0) return { ...param, type: FormulaTypes.list(FormulaTypes.number(true)) };
        if (stripNullability(param.type).kind !== 'callable') return param;
        return { ...param, type: FormulaTypes.callable('function') };
      }),
    });
    const levels = 24;
    const source = `EACH(LIST(LIST(1)); ${'"EACH"; '.repeat(levels - 1)}"PICK"; "zzz")`;
    const started = performance.now();
    const errors = parseFormula(source, { registry }).errors.map((e) => e.code);
    expect(errors).toStrictEqual([FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED]);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('keys each state of the walk apart from every other', () => {
    // No positions and one supplied value, a supplied value and a formula argument, the order of
    // the definitions, and parts that would read alike when joined: all distinct states.
    const base = { named: 1, host: 'EACH', candidates: ['PICK/v1'], sources: [] };
    const states = [
      base,
      { ...base, sources: [undefined] },
      { ...base, sources: [undefined, undefined] },
      { ...base, sources: [0] },
      { ...base, sources: [1, 0] },
      { ...base, sources: [10] },
      { ...base, sources: [1, undefined] },
      { ...base, named: 11 },
      { ...base, host: 'FILTER' },
      { ...base, candidates: [] },
      { ...base, candidates: ['PICK/v1', 'PICK_LIST/v1'] },
      { ...base, candidates: ['PICK_LIST/v1', 'PICK/v1'] },
      { ...base, candidates: ['PICK/v1+PICK_LIST/v1'] },
      { ...base, candidates: ['PICK/v1|1'] },
    ];
    const keys = states.map((state) => walkStateKey(state));
    expect(new Set(keys).size).toBe(states.length);
    // The same state, the same key.
    expect(walkStateKey({ ...base, sources: [1, 0] })).toBe(keys[4]);
  });
});
