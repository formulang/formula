import type { FormulaType, FunctionDefinition } from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaTypes,
  createRegistry,
  formatType,
  registerCoreFormulaDefinitions,
  stripNullability,
} from '@formulang/definitions';
import { describe, expect, it } from 'vitest';
import baseline from '../../scripts/compat/baseline-1.0.0.json';
import {
  INVOCATIONS_BY_NAME,
  RESULTS_BY_NAME,
  invocationOf,
  invokedArguments,
  passedSources,
  sourceAt,
  sourceCount,
  walkStateKey,
  writtenArguments,
  type PassedSources,
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

  it('decides every invocation and result type by the name, whatever the signature id', () => {
    // Each function of the table, retired and registered again under another signature id with the
    // same name, must parse every probe below as the core definition does: its validation of the
    // callable, the walk through it, and its result type. A rule that keys on a signature id, a
    // definition object or anything but the name changes an outcome here, wherever the rule lives.
    const probes: Record<string, string[]> = {
      EACH: [
        'EACH(LIST("a"; "bb"); "LEN")',
        'EACH(LIST(1); "PICK"; "a")',
        'UPPER(INDEX(EACH(LIST("a"); "LEN"); 1))',
        'EACH(LIST(1); "PICK"; "zzz")',
        'EACH(LIST("a"); "LEN"; 1)',
        'EACH(LIST(LIST(1)); "EACH"; "PICK"; "zzz")',
      ],
      FILTER: [
        'FILTER(LIST(1; 2); ">"; 1)',
        'FILTER(LIST(1); "PICK"; "b")',
        'UPPER(INDEX(FILTER(LIST(1; 2); ">"; 1); 1))',
        'FILTER(LIST(1); "PICK"; "zzz")',
        'FILTER(LIST("a"; "bb"); "LEN")',
        'EACH(LIST(LIST(1)); "FILTER"; "PICK"; "zzz")',
      ],
      FILTER_PROPERTY: [
        'FILTER_PROPERTY(rows; "p"; "="; 1)',
        'FILTER_PROPERTY(LIST(1; 2); "p"; ">"; 1)',
        'UPPER(INDEX(FILTER_PROPERTY(LIST(1; 2); "p"; ">"; 1); 1))',
        'FILTER_PROPERTY(rows; "p"; "PICK"; "zzz")',
        'EACH(LIST(rows); "FILTER_PROPERTY"; "p"; "PICK"; "zzz")',
      ],
      REDUCE: [
        'REDUCE(0; LIST(1; 2); "+")',
        'REDUCE(""; LIST("a"); "PICK")',
        'REDUCE(0; LIST(1); "LEN")',
        'EACH(LIST(0); "REDUCE"; LIST(1); "PICK")',
      ],
      FILTER_BY: [
        'FILTER_BY(LIST(1; 2); LIST("a"; "b"); "STARTS_WITH"; "a")',
        'FILTER_BY(LIST(1); LIST("k"); "PICK"; "a")',
        'UPPER(INDEX(FILTER_BY(LIST(1; 2); LIST("a"; "b"); "STARTS_WITH"; "a"); 1))',
        'FILTER_BY(LIST(1); LIST("k"); "PICK"; "zzz")',
        'EACH(LIST(LIST(1)); "FILTER_BY"; LIST("k"); "PICK"; "zzz")',
      ],
    };
    // Both ways: probes for every function of the table, and a function of the table for each.
    expect(Object.keys(probes).sort()).toStrictEqual([...INVOCATIONS_BY_NAME.keys()].sort());
    const registry = (reversioned?: string) => {
      const built = registryWithPick();
      built.registerVariable({
        name: 'rows',
        description: 'Rows of `p`.',
        type: FormulaTypes.any(true),
      });
      if (reversioned !== undefined) {
        const def = only(built, reversioned);
        built.retireFunction(def.signatureId);
        built.registerFunction({ ...def, signatureId: `${reversioned}/v9` });
      }
      return built;
    };
    const outcome = (built: ReturnType<typeof registry>, source: string) => {
      const rule = parseFormula(source, { registry: built });
      return {
        type: formatType(rule.returnType),
        errors: rule.errors.map((e) => [e.code, e.message, e.span?.start, e.span?.end]),
      };
    };
    const core = registry();
    const codes = new Set<string>();
    let compiled = 0;
    for (const [name, sources] of Object.entries(probes)) {
      const reversioned = registry(name);
      expect(reversioned.getFunction(`${name}/v9`)).toBeDefined();
      for (const source of sources) {
        const want = outcome(core, source);
        expect(outcome(reversioned, source), `${source} under ${name}/v9`).toStrictEqual(want);
        if (want.errors.length === 0) compiled++;
        for (const [code] of want.errors) codes.add(String(code));
      }
    }
    // Not vacuous: result types, the callable's validation and the walk are all exercised.
    expect(compiled).toBeGreaterThanOrEqual(8);
    expect([...codes].sort()).toStrictEqual(
      [
        FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH,
        FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
        FormulaErrorCodes.NO_MATCHING_OVERLOAD,
      ].sort(),
    );
    // Every result rule names a function of the table.
    const resultRules = [...RESULTS_BY_NAME.keys()];
    expect(resultRules.filter((name) => !INVOCATIONS_BY_NAME.has(name))).toStrictEqual([]);
    expect(resultRules.length).toBeGreaterThan(0);
  });

  it('types a call of the table by its result rule, and as a plain copy where it has none', () => {
    // For every function of the table: with a rule, the call's type is the one the rule describes,
    // computed here from the types of the call's own arguments; without one, it is the type a copy
    // of the definition under a name of its own gets, a plain function, as for any definition.
    const calls: Record<string, { args: string[]; callable?: string }> = {
      EACH: { args: ['LIST("a"; "bb")', '"LEN"'], callable: 'LEN' },
      FILTER: { args: ['LIST(1; 2)', '">"', '1'] },
      FILTER_PROPERTY: { args: ['LIST(1; 2)', '"p"', '">"', '1'] },
      REDUCE: { args: ['0', 'LIST(1; 2)', '"+"'] },
      FILTER_BY: { args: ['LIST(1; 2)', 'LIST("a"; "b")', '"STARTS_WITH"', '"a"'] },
    };
    expect(Object.keys(calls).sort()).toStrictEqual([...INVOCATIONS_BY_NAME.keys()].sort());
    const registry = registryWithPick();
    for (const name of Object.keys(calls)) {
      registry.registerFunction({
        ...only(registry, name),
        name: `${name}_COPY`,
        signatureId: `${name}_COPY/v1`,
      });
    }
    const typeOf = (source: string) => {
      const rule = parseFormula(source, { registry });
      expect(rule.errors, source).toStrictEqual([]);
      return rule.returnType;
    };
    const ruled = new Set<string>();
    for (const [name, { args, callable }] of Object.entries(calls)) {
      const def = only(registry, name);
      const got = formatType(typeOf(`${name}(${args.join('; ')})`));
      const rule = RESULTS_BY_NAME.get(name);
      const nullable = def.returnType.nullable === true;
      if (rule === 'items') {
        const target = stripNullability(typeOf(args[0] as string));
        if (target.kind !== 'list') throw new Error(`${name}: the target is no list`);
        expect(got, name).toBe(formatType(FormulaTypes.list(target.of, nullable)));
        ruled.add(name);
      } else if (rule === 'results') {
        const returns = only(registry, callable as string).returnType;
        expect(got, name).toBe(formatType(FormulaTypes.list(returns, nullable)));
        ruled.add(name);
      } else {
        expect(got, name).toBe(formatType(typeOf(`${name}_COPY(${args.join('; ')})`)));
      }
    }
    // Both ways: every result rule was read, and the plain copies differ where a rule applies.
    expect([...ruled].sort()).toStrictEqual([...RESULTS_BY_NAME.keys()].sort());
    for (const name of ruled) {
      const { args } = calls[name] as { args: string[] };
      expect(formatType(typeOf(`${name}_COPY(${args.join('; ')})`)), name).not.toBe(
        formatType(typeOf(`${name}(${args.join('; ')})`)),
      );
    }
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
    // Along a chain of callables named by string literals, every level passes on fewer arguments
    // than the level before it, so no chain is longer than the call written in the formula.
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

  it('keys each state of the walk apart from every other, whatever the size of the call', () => {
    // No positions and one supplied value, a supplied value and a formula argument, a head and a
    // range, the order of the definitions, and parts that would read alike when joined: all
    // distinct states.
    const sources = (head: (number | undefined)[], from = 9, end = 9): PassedSources => ({
      head,
      from,
      end,
    });
    const base = { named: 1, host: 'EACH', candidates: ['PICK/v1'], sources: sources([]) };
    const states = [
      base,
      { ...base, sources: sources([undefined]) },
      { ...base, sources: sources([undefined, undefined]) },
      { ...base, sources: sources([0]) },
      { ...base, sources: sources([1, 0]) },
      { ...base, sources: sources([10]) },
      { ...base, sources: sources([1, undefined]) },
      { ...base, sources: sources([undefined], 3) },
      { ...base, sources: sources([undefined], 4) },
      { ...base, sources: sources([undefined], 3, 12) },
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
    expect(walkStateKey({ ...base, sources: sources([1, 0]) })).toBe(keys[4]);
    // A key does not grow with the call: the same state in a call of 12 and of 12,000 arguments
    // differs by the digits of its end alone.
    const short = walkStateKey({ ...base, sources: sources([undefined], 3, 12) });
    const long = walkStateKey({ ...base, sources: sources([undefined], 3, 12_000) });
    expect(long.length - short.length).toBe('12000'.length - '12'.length);
  });

  it('describes what an invocation passes as invokedArguments does, through every level', () => {
    // passedSources (what the walk reads, without copying a call's arguments) against
    // invokedArguments (what the parser types), for every entry and chain of up to three entries,
    // applied to calls of up to twelve arguments, both read as where each argument comes from.
    const entries = [...INVOCATIONS_BY_NAME.entries()];
    for (const [name, invocation] of entries) {
      // An `arguments` source is its entry's last, so what it passes on stays one range.
      const at = invocation.findIndex((source) => source.kind === 'arguments');
      expect(at === -1 || at === invocation.length - 1, name).toBe(true);
    }
    const chains = [
      ...entries.map((first) => [first]),
      ...entries.flatMap((first) => entries.map((second) => [first, second])),
      ...entries.flatMap((first) =>
        entries.flatMap((second) => entries.map((third) => [first, second, third])),
      ),
    ];
    const read = (sources: PassedSources) =>
      Array.from({ length: sourceCount(sources) }, (_, position) => {
        return sourceAt(sources, position) ?? null;
      });
    let compared = 0;
    for (let count = 0; count <= 12; count++) {
      for (const chain of chains) {
        let typed: (number | null)[] = Array.from({ length: count }, (_, index) => index);
        let lazy = writtenArguments(count);
        for (const [, invocation] of chain) {
          const invoked = invokedArguments(
            invocation,
            typed.map(() => FormulaTypes.any(true)),
          );
          typed = invoked.map((arg) =>
            arg.forwards === undefined ? null : (typed[arg.forwards] ?? null),
          );
          lazy = passedSources(invocation, lazy);
          const label = `${chain.map(([name]) => name).join(' > ')} on ${count} arguments`;
          expect(read(lazy), label).toStrictEqual(typed);
          // One description per list of sources: a written argument at the end of the head that
          // the range would continue is part of the range.
          expect(lazy.head[lazy.head.length - 1] === lazy.from - 1, label).toBe(false);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(2000);
  });
});
