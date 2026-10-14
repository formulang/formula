import { createCoreFormulaRuntime } from '@formulang/core-functions';
import type {
  FormulaNodeOutput,
  FormulaType,
  FunctionDefinition,
  FunctionImplementation,
  FunctionImplementationResolver,
  FunctionParamDefinition,
} from '@formulang/definitions';
import {
  BuiltinSignatureIds,
  FormulaErrorCodes,
  FormulaTypes,
  makeOkBoolean,
  optimizeRule,
  stripNullability,
} from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { describe, expect, it } from 'vitest';
import baseline from '../../scripts/compat/baseline-1.0.0.json';
import { evaluateRuleOutputAsync } from './index';

/**
 * The enumerated-literal rule through `parseFormula` and evaluation, on a generated matrix: where
 * the literal sits × the overload set of the name it reaches × the item that chooses among the
 * overloads × every value an overload lists, and one none lists. The core higher-order functions
 * run the first definition of a name that has an implementation, which the parser cannot see, so
 * every formula that compiles also runs under registries that implement only some overloads, in
 * both registration orders, and every overload that runs must receive a value from its own list.
 */

const text = FormulaTypes.text(true);
const number = FormulaTypes.number(true);

/** The higher-order function that passes the literal to the overload set. */
type Vehicle = 'EACH' | 'FILTER' | 'FILTER_BY';
const VEHICLES: readonly Vehicle[] = ['EACH', 'FILTER', 'FILTER_BY'];

type Placement =
  | { kind: 'direct' }
  | { kind: 'forwarded'; vehicle: Vehicle }
  | { kind: 'nested'; vehicle: Vehicle; depth: number };

function placementsFor(vehicles: readonly Vehicle[]): Placement[] {
  return [
    { kind: 'direct' },
    ...vehicles.map((vehicle): Placement => ({ kind: 'forwarded', vehicle })),
    ...[1, 2, 3, 4].flatMap((depth) =>
      vehicles.map((vehicle): Placement => ({ kind: 'nested', vehicle, depth })),
    ),
  ];
}

/** One overload of a set: what it takes first, and the values it lists for the second argument. */
type Overload = {
  signatureId: string;
  subject: FormulaType;
  values?: string[];
  /** A third required parameter, which no invocation here passes. */
  extra?: FormulaType;
  /** A core definition: registered by the core runtime, not by the spec. */
  core?: true;
};

/** An overload set and the items whose types select each overload (null: none). */
type OverloadSet = {
  name: string;
  overloads: Overload[];
  items: Array<{ item: string; selects: string | null }>;
  /** The vehicles that take the set's result: FILTER and FILTER_BY need a boolean. */
  vehicles: readonly Vehicle[];
};

const SETS: OverloadSet[] = [
  {
    name: 'ONE',
    overloads: [{ signatureId: 'ONE/v1', subject: text, values: ['a', 'b'] }],
    items: [{ item: '"x"', selects: 'ONE/v1' }],
    vehicles: VEHICLES,
  },
  {
    name: 'TWO',
    overloads: [
      { signatureId: 'TWO/v1', subject: text, values: ['a', 'b'] },
      { signatureId: 'TWO_NUMBER/v1', subject: number, values: ['a', 'c'] },
    ],
    items: [
      { item: '"x"', selects: 'TWO/v1' },
      { item: '1', selects: 'TWO_NUMBER/v1' },
      { item: 'TRUE', selects: null },
    ],
    vehicles: VEHICLES,
  },
  {
    name: 'THREE',
    overloads: [
      { signatureId: 'THREE/v1', subject: text, values: ['a', 'b'], extra: text },
      { signatureId: 'THREE_NUMBER/v1', subject: number, values: ['a', 'b'], extra: number },
    ],
    // Two arguments, where both overloads take three.
    items: [{ item: '"x"', selects: null }],
    vehicles: VEHICLES,
  },
  {
    name: 'SOME',
    overloads: [
      { signatureId: 'SOME/v1', subject: text, values: ['a', 'b'] },
      { signatureId: 'SOME_LIST/v1', subject: FormulaTypes.list(text, true) },
      { signatureId: 'SOME_NUMBER/v1', subject: number, values: ['c'] },
    ],
    items: [
      { item: '"x"', selects: 'SOME/v1' },
      { item: 'LIST("x")', selects: 'SOME_LIST/v1' },
      { item: '1', selects: 'SOME_NUMBER/v1' },
      { item: 'TRUE', selects: null },
    ],
    vehicles: VEHICLES,
  },
  {
    // A host overload next to a core function with a mode.
    name: 'WORD_COUNT',
    overloads: [
      {
        signatureId: BuiltinSignatureIds.WORD_COUNT,
        subject: text,
        values: ['whitespace', 'letters', 'locale', 'pattern'],
        core: true,
      },
      {
        signatureId: 'WORD_COUNT_LIST/v1',
        subject: FormulaTypes.list(text, true),
        values: ['total'],
      },
    ],
    items: [
      { item: '"a b"', selects: BuiltinSignatureIds.WORD_COUNT },
      { item: 'LIST("a b"; "c")', selects: 'WORD_COUNT_LIST/v1' },
    ],
    vehicles: ['EACH'],
  },
];

const MISSPELT = 'zzz';

/** Every value an overload of the set lists, and one none lists. */
function literalsOf(set: OverloadSet): string[] {
  const values = set.overloads.flatMap((overload) => overload.values ?? []);
  return [...new Set(values), MISSPELT];
}

/** The parse error codes the rule demands. */
function expectedCodes(
  set: OverloadSet,
  placement: Placement,
  selects: string | null,
  literal: string,
): string[] {
  // The call written in the formula, and the callable a higher-order function names directly,
  // must take the types they are given (1.0.0); a nested callable's types are not checked.
  if (selects === null && placement.kind !== 'nested') {
    return [FormulaErrorCodes.NO_MATCHING_OVERLOAD];
  }
  const refused = [FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED];
  if (placement.kind === 'direct') {
    // Written directly, the call binds the overload its types select.
    const bound = set.overloads.find((overload) => overload.signatureId === selects);
    return bound?.values !== undefined && !bound.values.includes(literal) ? refused : [];
  }
  // Passed on, any overload may run: every overload that lists values must list the literal.
  const listing = set.overloads.filter((overload) => overload.values !== undefined);
  return listing.every((overload) => overload.values?.includes(literal)) ? [] : refused;
}

function nestIn(levels: number, inner: string): string {
  let out = inner;
  for (let i = 0; i < levels; i++) out = `LIST(${out})`;
  return out;
}

function formulaFor(set: OverloadSet, placement: Placement, item: string, literal: string): string {
  const lit = JSON.stringify(literal);
  const name = set.name;
  if (placement.kind === 'direct') return `${name}(${item}; ${lit})`;
  const depth = placement.kind === 'nested' ? placement.depth : 0;
  // `depth` levels of EACH below the written call, the innermost of them the vehicle itself or
  // naming it.
  const outer = '"EACH"; '.repeat(Math.max(depth - 1, 0));
  switch (placement.vehicle) {
    case 'EACH':
      return depth === 0
        ? `EACH(${nestIn(1, item)}; "${name}"; ${lit})`
        : `EACH(${nestIn(depth + 1, item)}; ${outer}"EACH"; "${name}"; ${lit})`;
    case 'FILTER':
      return depth === 0
        ? `FILTER(${nestIn(1, item)}; "${name}"; ${lit})`
        : `EACH(${nestIn(depth + 1, item)}; ${outer}"FILTER"; "${name}"; ${lit})`;
    case 'FILTER_BY':
      return depth === 0
        ? `FILTER_BY(LIST(0); ${nestIn(1, item)}; "${name}"; ${lit})`
        : `EACH(${nestIn(depth + 1, '0')}; ${outer}"FILTER_BY"; ${nestIn(1, item)}; "${name}"; ${lit})`;
  }
}

function modeParam(values?: string[]): FunctionParamDefinition {
  return values === undefined
    ? { name: 'key', type: text }
    : { name: 'mode', type: FormulaTypes.text(false), literalOnly: true, literalValues: values };
}

type Invocation = { signatureId: string; mode: unknown };

/** An implementation that records the mode it receives, then answers through `answer`. */
function recording(
  signatureId: string,
  invocations: Invocation[],
  answer?: FunctionImplementation,
): FunctionImplementation {
  return {
    estimateCostsInSeconds: () => 0.0001,
    evaluateMultiple: async (calls, ctx) => {
      for (const call of calls) {
        invocations.push({ signatureId, mode: await call.args[1]?.value() });
      }
      if (answer) return answer.evaluateMultiple(calls, ctx);
      return calls.map((): FormulaNodeOutput => makeOkBoolean(signatureId, true));
    },
  };
}

type RegistryShape = 'core' | 'reversioned';

/**
 * A runtime with `set` registered in `order` and only the overloads in `implemented` resolvable
 * (all when undefined), every overload recording what it receives.
 */
function runtimeFor(
  registryShape: RegistryShape,
  set: OverloadSet,
  order: 'listed' | 'reversed',
  invocations: Invocation[],
  implemented?: ReadonlySet<string>,
) {
  const { registry, implementations } = createCoreFormulaRuntime();
  if (registryShape === 'reversioned') {
    // The documented way to change a function: retire its id and register the next version. Only
    // the higher-order functions 1.0.0 had are keyed by name.
    const higherOrder = registry
      .listFunctions()
      .filter((def) => def.params.some((p) => stripNullability(p.type).kind === 'callable'))
      .filter((def) => baseline.functionNames.includes(def.name.toUpperCase()));
    expect(higherOrder.length).toBeGreaterThanOrEqual(4);
    for (const def of higherOrder) {
      const next = `${def.name}/v2`;
      const implementation = implementations.get(def.signatureId);
      registry.retireFunction(def.signatureId);
      registry.registerFunction({ ...def, signatureId: next });
      if (implementation) implementations.register(next, implementation);
    }
  }
  const hosts = set.overloads.filter((overload) => overload.core !== true);
  for (const overload of order === 'listed' ? hosts : [...hosts].reverse()) {
    const params: FunctionParamDefinition[] = [
      { name: 'subject', type: overload.subject },
      modeParam(overload.values),
    ];
    if (overload.extra) params.push({ name: 'extra', type: overload.extra });
    const def: FunctionDefinition = {
      signatureId: overload.signatureId,
      name: set.name,
      category: 'custom',
      description: 'Host overload of the enumerated-literal matrix.',
      params,
      returnType: FormulaTypes.boolean(true),
      purity: 'pure',
    };
    registry.registerFunction(def);
    implementations.register(overload.signatureId, recording(overload.signatureId, invocations));
  }
  for (const overload of set.overloads.filter((o) => o.core === true)) {
    const original = implementations.get(overload.signatureId);
    implementations.register(
      overload.signatureId,
      recording(overload.signatureId, invocations, original),
    );
  }
  const resolver: FunctionImplementationResolver = {
    get: (signatureId) => {
      const own = set.overloads.some((overload) => overload.signatureId === signatureId);
      if (own && implemented !== undefined && !implemented.has(signatureId)) return undefined;
      return implementations.get(signatureId);
    },
  };
  return { registry, resolver };
}

/** The implementation sets to run under: all overloads, and each overload alone. */
function implementedSets(set: OverloadSet): Array<ReadonlySet<string> | undefined> {
  return [undefined, ...set.overloads.map((overload) => new Set([overload.signatureId]))];
}

const cells = SETS.flatMap((set) =>
  placementsFor(set.vehicles).flatMap((placement) =>
    set.items.flatMap(({ item, selects }) =>
      literalsOf(set).map((literal) => ({
        set,
        placement,
        selects,
        literal,
        source: formulaFor(set, placement, item, literal),
        want: expectedCodes(set, placement, selects, literal),
      })),
    ),
  ),
);

describe('the enumerated-literal rule, generated', () => {
  it('covers every placement, overload set, item and listed value, with every outcome', () => {
    expect(new Set(cells.map((cell) => cell.source)).size).toBe(cells.length);
    expect(cells.length).toBeGreaterThan(500);
    const outcomes = new Set(cells.map((cell) => cell.want.join() || 'compiles'));
    expect([...outcomes].sort()).toStrictEqual(
      [
        'compiles',
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
        FormulaErrorCodes.NO_MATCHING_OVERLOAD,
      ].sort(),
    );
    // The values only some overloads list are generated, not only shared and unlisted ones.
    expect(cells.some((cell) => cell.set.name === 'TWO' && cell.literal === 'c')).toBe(true);
  });

  it.each(['core', 'reversioned'] as const)(
    'gives every cell the rule’s outcome, and every overload that runs a value it lists (%s registry)',
    async (registryShape) => {
      // An overload that ran with a value it does not list: the behaviour the rule exists for.
      const unlisted: unknown[] = [];
      // A parse outcome other than the rule's, or a run that failed or invoked nothing.
      const mismatches: unknown[] = [];
      let compiledCells = 0;
      let runs = 0;
      let divergent = 0;
      for (const { set, placement, selects, source, want } of cells) {
        for (const order of ['listed', 'reversed'] as const) {
          const parsedUnder = runtimeFor(registryShape, set, order, []);
          const parsed = parseFormula(source, { registry: parsedUnder.registry });
          const got = parsed.errors.map((e) => e.code);
          if (JSON.stringify(got) !== JSON.stringify(want)) {
            mismatches.push({ source, order, want, got });
          }
          // Every formula that compiles runs, whatever the rule above expected of it.
          if (got.length > 0) continue;
          compiledCells++;
          // A direct call binds its overload; through a higher-order call, the first definition
          // that has an implementation runs, so every implementation set is tried.
          const sets = placement.kind === 'direct' ? [undefined] : implementedSets(set);
          for (const implemented of sets) {
            const invocations: Invocation[] = [];
            const { registry, resolver } = runtimeFor(
              registryShape,
              set,
              order,
              invocations,
              implemented,
            );
            const compiled = optimizeRule(parseFormula(source, { registry }), { registry });
            const out = await evaluateRuleOutputAsync(compiled, {
              registry,
              resolver,
              variables: {},
            });
            runs++;
            if (out.errors.length > 0) mismatches.push({ source, order, runErrors: out.errors });
            if (implemented === undefined && invocations.length === 0) {
              mismatches.push({ source, order, invoked: 'nothing' });
            }
            for (const { signatureId, mode } of invocations) {
              const overload = set.overloads.find((o) => o.signatureId === signatureId);
              if (selects !== null && signatureId !== selects) divergent++;
              if (overload?.values !== undefined && !overload.values.includes(String(mode))) {
                const only = implemented === undefined ? 'all' : [...implemented].join();
                unlisted.push({ source, order, implemented: only, signatureId, received: mode });
              }
            }
          }
        }
      }
      expect(unlisted, 'overloads that ran with a value they do not list').toStrictEqual([]);
      expect(mismatches).toStrictEqual([]);
      // Not vacuous: many cells compile, each higher-order one runs under several implementation
      // sets, and overloads other than the one the types select do run.
      expect(compiledCells).toBeGreaterThan(100);
      expect(runs).toBeGreaterThan(2 * compiledCells);
      expect(divergent).toBeGreaterThan(0);
    },
    120_000,
  );

  it('names the overloads that do not list a refused value', () => {
    const { registry } = runtimeFor('core', SETS[1] as OverloadSet, 'listed', []);
    const errorsOf = (source: string) => parseFormula(source, { registry }).errors;
    const [refused, ...rest] = errorsOf('EACH(LIST(1); "TWO"; "b")');
    expect(rest).toStrictEqual([]);
    expect(refused?.message).toBe(
      `Parameter 'mode' of TWO must be one of "a", the values every overload of TWO lists here; got "b", which TWO_NUMBER/v1 does not list`,
    );
    expect(errorsOf('EACH(LIST(1); "TWO"; "zzz")')[0]?.message).toBe(
      `Parameter 'mode' of TWO must be one of "a", the values every overload of TWO lists here; got "zzz", which TWO/v1, TWO_NUMBER/v1 do not list`,
    );
    const some = runtimeFor('core', SETS[3] as OverloadSet, 'listed', []);
    expect(
      parseFormula('EACH(LIST(LIST("x")); "SOME"; "a")', { registry: some.registry }).errors[0]
        ?.message,
    ).toBe(
      `Parameter 'mode' of SOME must be one of the values every overload of SOME lists here, and they list none in common; got "a", which SOME_NUMBER/v1 does not list`,
    );
  });

  it('refuses a literal that an overload other than the selected one does not list', () => {
    const two = runtimeFor('core', SETS[1] as OverloadSet, 'listed', []);
    const codes = (source: string, registry = two.registry) =>
      parseFormula(source, { registry }).errors.map((e) => e.code);
    for (const source of [
      'EACH(LIST(1); "TWO"; "c")',
      'FILTER(LIST(1); "TWO"; "c")',
      'FILTER_BY(LIST(0); LIST(1); "TWO"; "c")',
      'EACH(LIST(LIST(1)); "EACH"; "TWO"; "c")',
      'EACH(LIST(LIST(TRUE)); "EACH"; "TWO"; "c")',
      'EACH(LIST(1); "TWO"; "b")',
    ]) {
      expect(codes(source), source).toStrictEqual([FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED]);
    }
    expect(codes('EACH(LIST(1); "TWO"; "a")')).toStrictEqual([]);
    // Written directly, the call binds the overload its types select.
    expect(codes('TWO(1; "c")')).toStrictEqual([]);
    const some = runtimeFor('core', SETS[3] as OverloadSet, 'listed', []);
    expect(codes('EACH(LIST(LIST("x")); "SOME"; "c")', some.registry)).toStrictEqual([
      FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
    ]);
    const wordCount = runtimeFor('core', SETS[4] as OverloadSet, 'listed', []);
    for (const source of [
      'EACH(LIST(LIST("a b"; "c")); "WORD_COUNT"; "total")',
      'EACH(LIST("a b"); "WORD_COUNT"; "letters")',
    ]) {
      expect(codes(source, wordCount.registry), source).toStrictEqual([
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
      ]);
    }
    expect(codes('WORD_COUNT(LIST("a b"); "total")', wordCount.registry)).toStrictEqual([]);
    expect(codes('WORD_COUNT("a b"; "letters")', wordCount.registry)).toStrictEqual([]);
  });

  it('refuses a misspelt literal that reaches an overload set the nested types do not select', () => {
    const { registry } = createCoreFormulaRuntime();
    const pick = (signatureId: string, params: FunctionParamDefinition[]): FunctionDefinition => ({
      signatureId,
      name: 'PICK',
      category: 'custom',
      description: 'Host overload set with an enumerated mode.',
      params,
      returnType: text,
      purity: 'pure',
    });
    registry.registerFunction(
      pick('PICK/v1', [{ name: 'text', type: text }, modeParam(['a', 'b'])]),
    );
    registry.registerFunction(
      pick('PICK_LIST/v1', [{ name: 'list', type: FormulaTypes.list(text, true) }, modeParam()]),
    );
    const errorsOf = (source: string) => parseFormula(source, { registry }).errors;
    const codes = (source: string) => errorsOf(source).map((e) => e.code);
    expect(codes('EACH(LIST(1); "PICK"; "zzz")')).toStrictEqual([
      FormulaErrorCodes.NO_MATCHING_OVERLOAD,
    ]);
    for (const nested of [
      'EACH(LIST(LIST(1)); "EACH"; "PICK"; "zzz")',
      'EACH(LIST(LIST("x")); "EACH"; "PICK"; "zzz"; "q")',
      'EACH(LIST(LIST("x")); "EACH"; "PICK"; "zzz")',
    ]) {
      expect(codes(nested), nested).toStrictEqual([FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED]);
    }
    expect(errorsOf('EACH(LIST(LIST(1)); "EACH"; "PICK"; "zzz")')[0]?.message).toBe(
      `Parameter 'mode' of PICK must be one of "a", "b"; got "zzz"`,
    );
    expect(codes('EACH(LIST(LIST(1)); "EACH"; "PICK"; "b")')).toStrictEqual([]);
  });

  it('follows a nested higher-order call whose own types select no overload', () => {
    // From the second level on, an EACH receives a number where it takes a list, so its types
    // select no overload; the literal it passes on is still checked.
    const { registry } = runtimeFor('core', SETS[0] as OverloadSet, 'listed', []);
    const codes = (source: string) => parseFormula(source, { registry }).errors.map((e) => e.code);
    for (const levels of [2, 3, 4]) {
      const names = '"EACH"; '.repeat(levels);
      const misspelt = `EACH(LIST(LIST(1)); ${names}"ONE"; "zzz")`;
      expect(codes(misspelt), misspelt).toStrictEqual([
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
      ]);
      const admitted = `EACH(LIST(LIST(1)); ${names}"ONE"; "a")`;
      expect(codes(admitted), admitted).toStrictEqual([]);
    }
  });
});
