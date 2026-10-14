import { createCoreFormulaRuntime } from '@formulang/core-functions';
import type {
  FormulaNodeOutput,
  FormulaType,
  FunctionDefinition,
  FunctionImplementation,
  FunctionImplementationResolver,
  FunctionParamDefinition,
  InvokedArgumentDeclaration,
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
import {
  INVOCATIONS_BY_NAME,
  invocationOf,
  invokedArguments,
} from '../../parser/src/callable-invocations';
import { evaluateRuleOutputAsync } from './index';

/**
 * The enumerated-literal rule through `parseFormula` and evaluation, on a generated matrix: the
 * higher-order function that passes the literal on (every one whose invocation the parser knows,
 * from its tables) × the position the literal reaches (every position the invocation passes on) ×
 * where the call sits × the overload set of the name it reaches × the item that chooses among the
 * overloads × every value an overload lists, and one none lists. The higher-order functions run
 * the first definition of a name that has an implementation, which the parser cannot see, so every
 * formula that compiles also runs under registries that implement only some overloads, in both
 * registration orders, and every overload that runs must receive a value from its own list.
 */

const text = FormulaTypes.text(true);
const number = FormulaTypes.number(true);
const anything = FormulaTypes.any(true);

const coreHigherOrder = createCoreFormulaRuntime()
  .registry.listFunctions()
  .filter((def) => def.params.some((p) => stripNullability(p.type).kind === 'callable'));

/** The higher-order functions whose invocation the parser knows: its name table, its declarations. */
const VEHICLES: readonly string[] = [
  ...INVOCATIONS_BY_NAME.keys(),
  ...coreHigherOrder
    .filter((def) => def.callableInvocation !== undefined)
    .map((def) => def.name.toUpperCase()),
].sort();

/** An item of an overload set: how the formula writes it, its value, the overload its type selects. */
type Item = { item: string; value: unknown; selects: string | null };

/**
 * How a call of each vehicle writes the arguments its invocation does not describe, so the item
 * reaches the callable at position 0: FILTER_BY's list beside the keys, and FILTER_PROPERTY's
 * target, whose property `p` holds the item (`rows`), and the property's name. A vehicle without an
 * entry here, or an entry for no vehicle, fails the first test.
 */
const UNDESCRIBED: Record<string, Record<number, string>> = {
  EACH: {},
  FILTER: {},
  FILTER_PROPERTY: { 0: 'rows', 1: '"p"' },
  FILTER_BY: { 0: 'LIST(0)' },
  REDUCE: {},
};

/** Where the literal sits in the vehicle's invocation, and what the call passes there. */
type Reach = {
  vehicle: string;
  /** The invoked position the mode parameter is at. */
  position: number;
  /** The call argument passed on to that position; undefined: the vehicle supplies a value. */
  forwardedFrom: number | undefined;
  /** Whether the item reaching position 0 is typed by the item written in the formula. */
  typedItem: boolean;
  /** The call's arguments, the item, the name and the literal as placeholders. */
  args: string[];
};

const ITEM = '\u0000item';
const NAME = '\u0000name';
const LITERAL = '\u0000literal';

/** The positions each vehicle's invocation passes something to after position 0, at most three. */
function reachesOf(vehicle: string): Reach[] {
  const def = coreHigherOrder.find((candidate) => candidate.name.toUpperCase() === vehicle);
  const invocation = def && invocationOf(def);
  if (def === undefined || invocation === undefined) throw new Error(`no invocation: ${vehicle}`);
  const callableAt = def.params.findIndex((p) => stripNullability(p.type).kind === 'callable');
  const variadic = def.params[def.params.length - 1]?.variadic === true;
  // Three arguments past the last parameter reach every position a variadic invocation forwards.
  const count = def.params.length + (variadic ? 2 : 0);
  const invoked = invokedArguments(
    invocation,
    Array.from({ length: count }, () => anything),
  );
  const reaches: Reach[] = [];
  for (let position = 1; position < Math.min(invoked.length, 4); position++) {
    const forwardedFrom = invoked[position]?.forwards;
    const args: string[] = [];
    // Pass on arguments up to the one at `position`, and no further.
    const last = forwardedFrom ?? Math.max(callableAt, ...invocation.map(argumentIndexOf));
    for (let index = 0; index <= last; index++) {
      const undescribed = UNDESCRIBED[vehicle]?.[index];
      const source = invocation.find((s) => argumentIndexOf(s) === index);
      if (index === callableAt) args.push(NAME);
      else if (undescribed !== undefined) args.push(undescribed);
      else if (index === forwardedFrom) args.push(LITERAL);
      else if (source?.kind === 'item' && invokedFrom(invocation, index) === 0)
        args.push(`LIST(${ITEM})`);
      else if (source?.kind === 'item') args.push(`LIST(${LITERAL})`);
      else if (source?.kind === 'value') args.push(ITEM);
      else args.push('0');
    }
    reaches.push({
      vehicle,
      position,
      forwardedFrom,
      typedItem: invocation[0]?.kind !== 'value' || invocation[0].typeOf !== undefined,
      args,
    });
  }
  return reaches;
}

function argumentIndexOf(source: { kind: string } & Record<string, unknown>): number {
  const index = source.of ?? source.at ?? source.from ?? source.typeOf;
  return typeof index === 'number' ? index : -1;
}

/** The invoked position a source fills: the first for an item of list `index`. */
function invokedFrom(invocation: readonly { kind: string }[], index: number): number {
  return invocation.findIndex(
    (source) => argumentIndexOf(source as { kind: string } & Record<string, unknown>) === index,
  );
}

type Placement =
  { kind: 'direct'; position: number } | { kind: 'passed'; reach: Reach; depth: number };

/** One overload of a set: what it takes first, and the values it lists for the mode. */
type Overload = {
  signatureId: string;
  subject: FormulaType;
  values?: string[];
  /** A further required parameter, which no invocation here passes. */
  extra?: FormulaType;
  /** A core definition: registered by the core runtime, not by the spec. */
  core?: true;
};

type OverloadSet = {
  name: string;
  overloads: Overload[];
  items: Item[];
  /** The positions its mode can sit at; a set holding a core definition keeps the core's. */
  positions?: readonly number[];
  /** The vehicles that take its result. */
  vehicles?: readonly string[];
};

const SETS: OverloadSet[] = [
  {
    name: 'ONE',
    overloads: [{ signatureId: 'ONE/v1', subject: text, values: ['a', 'b'] }],
    items: [{ item: '"x"', value: 'x', selects: 'ONE/v1' }],
  },
  {
    name: 'TWO',
    overloads: [
      { signatureId: 'TWO/v1', subject: text, values: ['a', 'b'] },
      { signatureId: 'TWO_NUMBER/v1', subject: number, values: ['a', 'c'] },
    ],
    items: [
      { item: '"x"', value: 'x', selects: 'TWO/v1' },
      { item: '1', value: 1, selects: 'TWO_NUMBER/v1' },
      { item: 'TRUE', value: true, selects: null },
    ],
  },
  {
    name: 'THREE',
    overloads: [
      { signatureId: 'THREE/v1', subject: text, values: ['a', 'b'], extra: text },
      { signatureId: 'THREE_NUMBER/v1', subject: number, values: ['a', 'b'], extra: number },
    ],
    // One argument short of what both overloads take.
    items: [{ item: '"x"', value: 'x', selects: null }],
  },
  {
    name: 'SOME',
    overloads: [
      { signatureId: 'SOME/v1', subject: text, values: ['a', 'b'] },
      { signatureId: 'SOME_LIST/v1', subject: FormulaTypes.list(text, true) },
      { signatureId: 'SOME_NUMBER/v1', subject: number, values: ['c'] },
    ],
    items: [
      { item: '"x"', value: 'x', selects: 'SOME/v1' },
      { item: 'LIST("x")', value: ['x'], selects: 'SOME_LIST/v1' },
      { item: '1', value: 1, selects: 'SOME_NUMBER/v1' },
      { item: 'TRUE', value: true, selects: null },
    ],
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
      { item: '"a b"', value: 'a b', selects: BuiltinSignatureIds.WORD_COUNT },
      { item: 'LIST("a b"; "c")', value: ['a b', 'c'], selects: 'WORD_COUNT_LIST/v1' },
    ],
    positions: [1],
    // It answers a number, which neither a filter nor REDUCE's text accumulator takes.
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
  { selects }: Item,
  literal: string,
): string[] {
  const listing = set.overloads.filter((overload) => overload.values !== undefined);
  if (placement.kind === 'direct') {
    // Written directly, the call binds the overload its types select.
    if (selects === null) return [FormulaErrorCodes.NO_MATCHING_OVERLOAD];
    const bound = set.overloads.find((overload) => overload.signatureId === selects);
    return bound?.values !== undefined && !bound.values.includes(literal)
      ? [FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED]
      : [];
  }
  const { reach, depth } = placement;
  // The callable the call written in the formula names must take the types it is given (1.0.0);
  // an item the vehicle reads at run time (a property value) is of any type, which any overload
  // with the arity takes. A nested callable's types are not checked.
  const takes = reach.typedItem
    ? selects !== null
    : set.overloads.some((overload) => overload.extra === undefined);
  if (depth === 0 && !takes) return [FormulaErrorCodes.NO_MATCHING_OVERLOAD];
  if (listing.length === 0) return [];
  // A value the vehicle supplies when it runs can be no listed literal.
  if (reach.forwardedFrom === undefined)
    return [FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE];
  // Passed on, any overload may run: every overload that lists values must list the literal.
  return listing.every((overload) => overload.values?.includes(literal))
    ? []
    : [FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED];
}

function nestIn(levels: number, inner: string): string {
  let out = inner;
  for (let i = 0; i < levels; i++) out = `LIST(${out})`;
  return out;
}

/**
 * The formula of a cell: the vehicle written under `vehicle` (its own name by default), nested
 * `depth` levels below calls of `carrier`, which passes on its item and every argument after it.
 */
function formulaFor(
  set: OverloadSet,
  placement: Placement,
  item: string,
  literal: string,
  vehicle?: string,
  carrier = 'EACH',
) {
  const lit = JSON.stringify(literal);
  if (placement.kind === 'direct') {
    const fillers = Array.from({ length: placement.position - 1 }, () => '0');
    return `${set.name}(${[item, ...fillers, lit].join('; ')})`;
  }
  const { reach, depth } = placement;
  const name = vehicle ?? reach.vehicle;
  const args = reach.args.map((arg) =>
    arg.replace(ITEM, item).replace(NAME, JSON.stringify(set.name)).replace(LITERAL, lit),
  );
  if (depth === 0) return `${name}(${args.join('; ')})`;
  // `depth` levels of the carrier below the written call, the innermost naming the vehicle, which
  // the carrier calls with the item first and every argument after it.
  const [first = '', ...rest] = args;
  const outer = `"${carrier}"; `.repeat(depth - 1);
  return `${carrier}(${nestIn(depth, first)}; ${outer}"${name}"; ${rest.join('; ')})`;
}

function paramsOf(overload: Overload, position: number): FunctionParamDefinition[] {
  const params: FunctionParamDefinition[] = [{ name: 'subject', type: overload.subject }];
  for (let index = 1; index < position; index++) {
    params.push({ name: `filler${index}`, type: anything });
  }
  params.push(
    overload.values === undefined
      ? { name: 'key', type: text }
      : {
          name: 'mode',
          type: FormulaTypes.text(false),
          literalOnly: true,
          literalValues: overload.values,
        },
  );
  if (overload.extra) params.push({ name: 'extra', type: overload.extra });
  return params;
}

type Invocation = { signatureId: string; mode: unknown };

/** An implementation that records the mode it receives at `position`, then answers. */
function recording(
  signatureId: string,
  position: number,
  invocations: Invocation[],
  answer?: FunctionImplementation,
): FunctionImplementation {
  return {
    estimateCostsInSeconds: () => 0.0001,
    evaluateMultiple: async (calls, ctx) => {
      for (const call of calls) {
        invocations.push({ signatureId, mode: await call.args[position]?.value() });
      }
      if (answer) return answer.evaluateMultiple(calls, ctx);
      return calls.map((): FormulaNodeOutput => makeOkBoolean(signatureId, true));
    },
  };
}

type RegistryShape = 'core' | 'reversioned';

/**
 * A runtime with `set` registered in `order`, its mode at `position`, only the overloads in
 * `implemented` resolvable (all when undefined), every overload recording what it receives.
 */
function runtimeFor(
  registryShape: RegistryShape,
  set: OverloadSet,
  order: 'listed' | 'reversed',
  invocations: Invocation[],
  position = 1,
  implemented?: ReadonlySet<string>,
) {
  const { registry, implementations } = createCoreFormulaRuntime();
  registry.registerVariable({ name: 'rows', description: 'Rows of `p`.', type: anything });
  if (registryShape === 'reversioned') {
    // The documented way to change a function: retire its id and register the next version.
    const higherOrder = registry
      .listFunctions()
      .filter((def) => def.params.some((p) => stripNullability(p.type).kind === 'callable'));
    expect(higherOrder.length).toBe(VEHICLES.length);
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
    const def: FunctionDefinition = {
      signatureId: overload.signatureId,
      name: set.name,
      category: 'custom',
      description: 'Host overload of the enumerated-literal matrix.',
      params: paramsOf(overload, position),
      // Any result, so every vehicle takes it: a filter's check, REDUCE's accumulator.
      returnType: anything,
      purity: 'pure',
    };
    registry.registerFunction(def);
    implementations.register(
      overload.signatureId,
      recording(overload.signatureId, position, invocations),
    );
  }
  for (const overload of set.overloads.filter((o) => o.core === true)) {
    const original = implementations.get(overload.signatureId);
    implementations.register(
      overload.signatureId,
      recording(overload.signatureId, position, invocations, original),
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

/**
 * The registry of `runtimeFor` with the vehicle `core` copied under `name`, declaring `invocation`,
 * every definition `name` named before retired; and CARRY, a copy of EACH that declares EACH's
 * invocation, to carry nested cells whatever `name` is.
 */
function declaringRegistry(
  set: OverloadSet,
  position: number,
  core: FunctionDefinition,
  invocation: readonly InvokedArgumentDeclaration[],
  name: string,
) {
  const { registry } = runtimeFor('core', set, 'listed', [], position);
  for (const def of registry.listFunctionsByName(name)) registry.retireFunction(def.signatureId);
  registry.registerFunction({
    ...core,
    name,
    signatureId: `${name}/v7`,
    callableInvocation: [...invocation],
  });
  const each = coreHigherOrder.find((def) => def.name === 'EACH');
  const carried = each && invocationOf(each);
  if (each === undefined || carried === undefined) throw new Error('no EACH to carry cells');
  registry.registerFunction({
    ...each,
    name: 'CARRY',
    signatureId: 'CARRY/v1',
    callableInvocation: [...carried],
  });
  return registry;
}

/** The implementation sets to run under: all overloads, and each overload alone. */
function implementedSets(set: OverloadSet): Array<ReadonlySet<string> | undefined> {
  return [undefined, ...set.overloads.map((overload) => new Set([overload.signatureId]))];
}

const REACHES = VEHICLES.flatMap(reachesOf);

const cells = SETS.flatMap((set) => {
  const positions = set.positions ?? [1, 2, 3];
  const placements: Placement[] = [
    ...positions.map((position): Placement => ({ kind: 'direct', position })),
    ...REACHES.filter(
      (reach) =>
        positions.includes(reach.position) &&
        (set.vehicles === undefined || set.vehicles.includes(reach.vehicle)),
    ).flatMap((reach) =>
      [0, 1, 2, 3, 4].map((depth): Placement => ({ kind: 'passed', reach, depth })),
    ),
  ];
  return placements.flatMap((placement) =>
    set.items.flatMap((item) =>
      literalsOf(set).map((literal) => ({
        set,
        placement,
        item,
        literal,
        position: placement.kind === 'direct' ? placement.position : placement.reach.position,
        vehicle: placement.kind === 'direct' ? null : placement.reach.vehicle,
        source: formulaFor(set, placement, item.item, literal),
        want: expectedCodes(set, placement, item, literal),
      })),
    ),
  );
});

describe('the enumerated-literal rule, generated', () => {
  it('takes every vehicle from the parser’s invocations, and every position they pass on', () => {
    // Both ways: every vehicle has its undescribed arguments, and every entry names a vehicle.
    expect(Object.keys(UNDESCRIBED).sort()).toStrictEqual([...VEHICLES]);
    // Not vacuous: 1.0.0's four by name, and FILTER_BY by declaration.
    expect(VEHICLES.length).toBeGreaterThanOrEqual(5);
    for (const vehicle of VEHICLES) {
      expect(
        cells.some((cell) => cell.vehicle === vehicle),
        vehicle,
      ).toBe(true);
    }
    // EACH passes on every argument after its callable: the mode sits at three positions.
    expect(
      REACHES.filter((reach) => reach.vehicle === 'EACH').map((r) => r.position),
    ).toStrictEqual([1, 2, 3]);
    // A value the vehicle supplies itself also reaches the mode (REDUCE's item).
    expect(REACHES.some((reach) => reach.forwardedFrom === undefined)).toBe(true);
  });

  it('covers every placement, overload set, item and listed value, with every outcome', () => {
    // FILTER_PROPERTY reads its item from `rows`, so the item is part of what makes a cell.
    const cases = cells.map((cell) => `${cell.source} ${JSON.stringify(cell.item.value)}`);
    expect(new Set(cases).size).toBe(cells.length);
    expect(cells.length).toBeGreaterThan(1000);
    const outcomes = new Set(cells.map((cell) => cell.want.join() || 'compiles'));
    expect([...outcomes].sort()).toStrictEqual(
      [
        'compiles',
        FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
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
      const ranThrough = new Set<string>();
      let compiledCells = 0;
      let runs = 0;
      let divergent = 0;
      for (const { set, placement, item, position, vehicle, source, want } of cells) {
        for (const order of ['listed', 'reversed'] as const) {
          const parsedUnder = runtimeFor(registryShape, set, order, [], position);
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
              position,
              implemented,
            );
            const compiled = optimizeRule(parseFormula(source, { registry }), { registry });
            const out = await evaluateRuleOutputAsync(compiled, {
              registry,
              resolver,
              variables: { rows: [{ p: item.value }] },
            });
            runs++;
            if (out.errors.length > 0) mismatches.push({ source, order, runErrors: out.errors });
            if (implemented === undefined && invocations.length === 0) {
              mismatches.push({ source, order, invoked: 'nothing' });
            }
            if (vehicle !== null && invocations.length > 0) ranThrough.add(vehicle);
            for (const { signatureId, mode } of invocations) {
              const overload = set.overloads.find((o) => o.signatureId === signatureId);
              if (item.selects !== null && signatureId !== item.selects) divergent++;
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
      // sets, overloads other than the one the types select do run, and an overload runs through
      // every vehicle that passes a literal on.
      expect(compiledCells).toBeGreaterThan(300);
      expect(runs).toBeGreaterThan(2 * compiledCells);
      expect(divergent).toBeGreaterThan(0);
      const passingOn = VEHICLES.filter((vehicle) =>
        REACHES.some((reach) => reach.vehicle === vehicle && reach.forwardedFrom !== undefined),
      );
      expect([...ranThrough].sort()).toStrictEqual(passingOn);
    },
    300_000,
  );

  it('compiles every cell alike under every name its vehicle’s declaration is registered under', () => {
    // Each invocation the matrix holds, declared on a copy of its vehicle registered under each
    // name 1.0.0 keyed invocations by and under a new name: the declaration decides, not the name.
    const names = [...INVOCATIONS_BY_NAME.keys(), 'DECLARED'];
    const registries = new Map<string, ReturnType<typeof declaringRegistry>>();
    const differing: unknown[] = [];
    let compared = 0;
    for (const vehicle of VEHICLES) {
      const core = coreHigherOrder.find((def) => def.name.toUpperCase() === vehicle);
      const invocation = core && invocationOf(core);
      if (core === undefined || invocation === undefined) throw new Error(`no ${vehicle}`);
      for (const cell of cells.filter((candidate) => candidate.vehicle === vehicle)) {
        const outcomes = names.map((name) => {
          const key = `${cell.set.name} ${cell.position} ${vehicle} ${name}`;
          const registry =
            registries.get(key) ??
            declaringRegistry(cell.set, cell.position, core, invocation, name);
          registries.set(key, registry);
          const { placement, item, literal } = cell;
          const source = formulaFor(cell.set, placement, item.item, literal, name, 'CARRY');
          return parseFormula(source, { registry }).errors.map((error) => [
            error.code,
            error.path?.[3],
            error.message.replaceAll(name, '<vehicle>'),
          ]);
        });
        compared++;
        const [first, ...others] = outcomes.map((outcome) => JSON.stringify(outcome));
        if (others.some((other) => other !== first)) {
          differing.push({ vehicle, cell: cell.source, outcomes });
        }
      }
    }
    expect(differing).toStrictEqual([]);
    // Not vacuous: every vehicle, under every name, on more than a few hundred cells.
    expect(compared).toBeGreaterThan(500);
    expect(registries.size).toBeGreaterThanOrEqual(VEHICLES.length * names.length);
  });

  it('keeps FILTER_BY’s checks when it is registered again under another signature id', () => {
    const check = runtimeFor('reversioned', SETS[0] as OverloadSet, 'listed', []);
    expect(check.registry.getFunction('FILTER_BY/v2')).toBeDefined();
    const codes = (source: string) =>
      parseFormula(source, { registry: check.registry }).errors.map((e) => e.code);
    expect(codes('FILTER_BY(LIST("k"); LIST("x"); "ONE"; "zzz")')).toStrictEqual([
      FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
    ]);
    expect(codes('FILTER_BY(LIST("k"); LIST("x"); "WORD_COUNT"; "whitespce")')).toStrictEqual([
      FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
      FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH,
    ]);
    expect(codes('FILTER_BY(LIST("k"); LIST(1); "LEN")')).toStrictEqual([
      FormulaErrorCodes.NO_MATCHING_OVERLOAD,
    ]);
  });

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
      'FILTER_PROPERTY(rows; "p"; "TWO"; "c")',
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
    const mode = (values?: string[]): FunctionParamDefinition =>
      values === undefined
        ? { name: 'key', type: text }
        : {
            name: 'mode',
            type: FormulaTypes.text(false),
            literalOnly: true,
            literalValues: values,
          };
    registry.registerFunction(pick('PICK/v1', [{ name: 'text', type: text }, mode(['a', 'b'])]));
    registry.registerFunction(
      pick('PICK_LIST/v1', [{ name: 'list', type: FormulaTypes.list(text, true) }, mode()]),
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
