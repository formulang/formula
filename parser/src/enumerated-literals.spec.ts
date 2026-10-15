import type { FormulaRegistry } from '@formulang/definitions';
import {
  createRegistry,
  FormulaErrorCodes,
  FormulaTypes,
  registerCoreFormulaDefinitions,
} from '@formulang/definitions';
import { describe, expect, it } from 'vitest';
import { parseFormula } from './index';
import { observeWork, type WalkEvent, type WorkRecord } from './work-trace';

/**
 * The walk through the callables a call names, observed on the parser's own code paths: every
 * parse here runs under `observeWork`, so the walk's queue and visits and the call checks' units of
 * work are what `parseFormula` did, in order. No assertion reads a clock.
 */

/** Limits raised for calls of thousands of arguments, as an embedder may raise them. */
const LIMITS = { maxTokens: 1_000_000, maxAstNodes: 1_000_000, maxSourceLength: 10_000_000 };

/** The documented bound: 16 argument positions per argument of the call, and 16 more. */
const documentedLimit = (args: number) => 16 * (args + 1);

const LVNA = FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED;

/**
 * The core registry with PICK(subject; mode), whose mode lists `a` and `b`; PICK3(subject; mode;
 * rest...), whose mode lists `EACH` and `a`; PICKN(subject; mode; rest...), whose mode lists `a`
 * and `b`; and MAP, a copy of EACH under a name of its own, so a plain function for which no walk
 * starts.
 */
function registryWithPick() {
  const registry = createRegistry();
  registerCoreFormulaDefinitions(registry);
  const [each] = registry.listFunctionsByName('EACH');
  if (each === undefined) throw new Error('no EACH');
  registry.registerFunction({ ...each, name: 'MAP', signatureId: 'MAP/v1' });
  const mode = (literalValues: string[]) => ({
    name: 'mode',
    type: FormulaTypes.text(false),
    literalOnly: true,
    literalValues,
  });
  registry.registerFunction({
    signatureId: 'PICK/v1',
    name: 'PICK',
    category: 'custom',
    description: 'A function with a mode.',
    params: [{ name: 'subject', type: FormulaTypes.any(true) }, mode(['a', 'b'])],
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
  });
  for (const [name, values] of [
    ['PICK3', ['EACH', 'a']],
    ['PICKN', ['a', 'b']],
  ] as const) {
    registry.registerFunction({
      signatureId: `${name}/v1`,
      name,
      category: 'custom',
      description: `A function whose mode lists ${values.join(' and ')}, and takes any further arguments.`,
      params: [
        { name: 'subject', type: FormulaTypes.any(true) },
        mode([...values]),
        { name: 'rest', type: FormulaTypes.any(true), optional: true, variadic: true },
      ],
      returnType: FormulaTypes.boolean(true),
      purity: 'pure',
    });
  }
  return registry;
}

type Registry = ReturnType<typeof registryWithPick>;

/**
 * Adds a host's EACH overload, which under a name of the table gets EACH's invocation: one whose
 * callable parameter is variadic; one with `width` parameters in all; one with `callables`
 * callable parameters after a number target, forty parameters in all, the last of them variadic,
 * so a call written with a number binds it at any length and its callables fan out at every level;
 * or one whose variadic callable parameter after a number target lists the callables `operators`
 * names, or lists none.
 */
function withHostEach(
  registry: Registry,
  shape:
    | { variadic: true }
    | { width: number }
    | { callables: number }
    | { operators: readonly string[] | 'unlisted' },
) {
  const [each] = registry.listFunctionsByName('EACH');
  if (each === undefined) throw new Error('no EACH');
  const callable = (name: string, variadic = false) => ({
    name,
    type: FormulaTypes.callable('function'),
    literalOnly: true,
    variadic,
  });
  const option = (index: number, variadic = false) => ({
    name: `option${index}`,
    type: FormulaTypes.text(true),
    optional: true,
    variadic,
  });
  const target = { name: 'target', type: FormulaTypes.number(true) };
  const params =
    'operators' in shape
      ? [
          target,
          {
            ...callable('operators', true),
            ...(shape.operators === 'unlisted' ? {} : { literalValues: [...shape.operators] }),
          },
        ]
      : 'callables' in shape
        ? [
            target,
            ...Array.from({ length: shape.callables }, (_, index) => callable(`callable${index}`)),
            ...Array.from({ length: 39 - shape.callables }, (_, index) =>
              option(index, index === 38 - shape.callables),
            ),
          ]
        : [
            { name: 'target', type: FormulaTypes.list(FormulaTypes.number(true)) },
            callable('operator', 'variadic' in shape),
            ...Array.from({ length: 'width' in shape ? shape.width - 2 : 0 }, (_, i) => option(i)),
          ];
  registry.registerFunction({ ...each, signatureId: 'HOST_EACH/v1', params });
  return registry;
}

/** `head` over a list of lists, naming EACH at every argument but the last two: PICK and `mode`. */
function chain(count: number, mode: string, head = 'EACH'): string {
  return `${head}(LIST(LIST(1)); ${'"EACH"; '.repeat(count - 3)}"PICK"; "${mode}")`;
}

/** Parses `source` under `observeWork`: the rule, and the record of what the parse did. */
function observed(registry: FormulaRegistry, source: string, limits: object = LIMITS) {
  const { result: rule, work } = observeWork(() => parseFormula(source, { registry, limits }));
  return { rule, work, codes: rule.errors.map((error) => error.code) };
}

type WalkStart = Extract<WalkEvent, { kind: 'walk' }>;
type Queued = Extract<WalkEvent, { kind: 'queued' }>;
type Visited = Extract<WalkEvent, { kind: 'visited' }>;
type Walk = { start: WalkStart; events: WalkEvent[] };

/** The walks of a record, each with its events in order. */
function walksOf(work: WorkRecord): Walk[] {
  const walks = new Map<number, Walk>();
  for (const event of work.events) {
    if (event.kind === 'walk') walks.set(event.walk, { start: event, events: [] });
    else walks.get(event.walk)?.events.push(event);
  }
  return [...walks.values()];
}

/** The one walk of the call written at the start of the formula; fails if it has none or more. */
function rootWalk(work: WorkRecord): Walk {
  const walks = walksOf(work).filter((walk) => walk.start.start === 0);
  expect(walks.length, 'walks of the call written at the start').toBe(1);
  return walks[0] as Walk;
}

/**
 * Holds a walk to its guarantee, from what the parser did: one queue, seeded with every callable
 * the call names before the first visit; each state queued once and visited in the order queued,
 * at its positions in order, in full but for the last one visited; depths that never decrease; every
 * state queued at a depth shallower than the last visit visited in full; at most 16 × (n + 1)
 * visits for a call of n arguments, and all of them where it leaves a queued state unvisited.
 * Answers whether the walk stopped at its bound.
 */
function expectOneBreadthFirstQueue(walk: Walk, label: string): boolean {
  const { start, events } = walk;
  expect(start.limit, label).toBe(documentedLimit(start.args));
  const visits = events.filter((event): event is Visited => event.kind === 'visited');
  const queued = events.filter((event): event is Queued => event.kind === 'queued');
  expect(visits.length, label).toBeLessThanOrEqual(start.limit);
  const firstVisit = events.findIndex((event) => event.kind === 'visited');
  const lateSeed = events.findIndex(
    (event, index) =>
      event.kind === 'queued' && event.depth === 0 && firstVisit >= 0 && index > firstVisit,
  );
  expect(lateSeed, `${label}: a callable the call names queued after the first visit`).toBe(-1);
  expect(new Set(queued.map((event) => event.state)).size, label).toBe(queued.length);
  const toVisit = queued.filter((event) => event.positions > 0);
  const runs: Visited[][] = [];
  for (const visit of visits) {
    const run = runs[runs.length - 1];
    if (run !== undefined && run[0]?.state === visit.state) run.push(visit);
    else runs.push([visit]);
  }
  expect(
    runs.map((run) => run[0]?.state),
    `${label}: states visited in the order queued`,
  ).toStrictEqual(toVisit.slice(0, runs.length).map((event) => event.state));
  const outOfOrder = runs.findIndex((run, index) => {
    const owed = index < runs.length - 1 ? (toVisit[index]?.positions ?? 0) : run.length;
    return run.length !== owed || run.some((visit, position) => visit.position !== position);
  });
  expect(outOfOrder, `${label}: a state visited out of order, or in part before the last`).toBe(-1);
  const shallower = visits.findIndex(
    (visit, index) => index > 0 && visit.depth < (visits[index - 1]?.depth ?? 0),
  );
  expect(shallower, `${label}: a visit shallower than the one before it`).toBe(-1);
  const visitedInFull = new Set(
    runs
      .filter((run, index) => run.length === toVisit[index]?.positions)
      .map((run) => run[0]?.state),
  );
  const deepest = visits[visits.length - 1]?.depth ?? 0;
  const skipped = toVisit.find((event) => event.depth < deepest && !visitedInFull.has(event.state));
  expect(skipped, `${label}: a state shallower than the last visit left unvisited`).toBeUndefined();
  const stopped = toVisit.some((event) => !visitedInFull.has(event.state));
  if (stopped) expect(visits.length, `${label}: stopped short of its bound`).toBe(start.limit);
  return stopped;
}

/**
 * The shapes the walk takes: chains, levels with several callables, calls with several callable
 * parameters, and the extra arguments of a variadic callable parameter that lists the callables it
 * admits, each with the codes the formula gets and whether the bound must stop it at some size.
 */
const SHAPES = [
  {
    shape: 'a chain of EACH',
    registry: () => registryWithPick(),
    formula: (count: number) => chain(count, 'zzz'),
    sizes: [6, 20, 100, 1_000, 12_000],
    codes: [LVNA],
    stops: false,
  },
  {
    shape: 'a chain through a host EACH with a variadic callable',
    registry: () => withHostEach(registryWithPick(), { variadic: true }),
    formula: (count: number) => chain(count, 'zzz'),
    sizes: [6, 20, 100, 1_000, 12_000],
    codes: [LVNA],
    stops: false,
  },
  {
    shape: 'several callables at every level',
    registry: () => withHostEach(registryWithPick(), { callables: 2 }),
    formula: (count: number) =>
      `EACH(LIST(LIST(1)); "EACH"; "PICK"; ${'"EACH"; '.repeat(count - 4)}"a")`,
    sizes: [20, 60, 120, 240, 1_000],
    codes: [LVNA],
    stops: true,
  },
  {
    shape: 'the literal under the second callable parameter of the call',
    registry: () => withHostEach(registryWithPick(), { callables: 2 }),
    formula: (count: number) => `EACH(1; "EACH"; "PICK3"; ${'"EACH"; '.repeat(count - 4)}"a")`,
    sizes: [6, 10, 20, 40, 100, 1_000, 12_000],
    codes: [LVNA],
    stops: true,
  },
  {
    shape: 'the literal under the first callable parameter of the call',
    registry: () => withHostEach(registryWithPick(), { callables: 2 }),
    formula: (count: number) => `EACH(1; "PICKN"; ${'"EACH"; '.repeat(count - 3)}"a")`,
    sizes: [6, 10, 20, 40, 100, 1_000, 12_000],
    codes: [LVNA],
    stops: true,
  },
  {
    shape: 'the literal under an extra argument of a variadic callable that lists its callables',
    registry: () => withHostEach(registryWithPick(), { operators: ['EACH', 'PICK3'] }),
    formula: (count: number) => `EACH(1; "EACH"; "PICK3"${'; "EACH"'.repeat(count - 3)})`,
    sizes: [4, 10, 20, 40, 100, 1_000, 12_000],
    codes: [LVNA],
    stops: true,
  },
  {
    shape: 'every argument a callable parameter',
    registry: () => withHostEach(registryWithPick(), { operators: ['EACH', 'PICK'] }),
    formula: (count: number) => `EACH(1; ${'"EACH"; '.repeat(count - 2)}"EACH")`,
    sizes: [10, 100, 1_000, 12_000],
    codes: [],
    stops: true,
  },
];

describe('the walk through nested callables', () => {
  it.each(SHAPES.map((entry) => [entry.shape, entry] as const))(
    'walks every callable the call names through one breadth-first queue, for %s',
    (_, { registry: registryFor, formula, sizes, codes, stops }) => {
      const registry = registryFor();
      let stopped = 0;
      for (const count of sizes) {
        const source = formula(count);
        const label = `${count} arguments`;
        const parse = observed(registry, source);
        // The formula's answer, as the walk leaves it: the shallow literal refused at every size.
        expect(parse.codes, label).toStrictEqual(codes);
        const walk = rootWalk(parse.work);
        expect(walk.start.args, label).toBe(count);
        if (expectOneBreadthFirstQueue(walk, label)) stopped++;
      }
      // Not vacuous: where the shape branches, the bound stops the walk at the larger sizes.
      if (stops) expect(stopped).toBeGreaterThanOrEqual(2);
      else expect(stopped).toBe(0);
    },
    60_000,
  );

  it.each([
    ['the core EACH chain', () => registryWithPick()],
    [
      'a host EACH with a variadic callable',
      () => withHostEach(registryWithPick(), { variadic: true }),
    ],
  ] as const)(
    'takes steps linear in the call, and checks the chain to its end, for %s',
    (_, registryFor) => {
      const registry = registryFor();
      for (const count of [100, 1_000, 3_000, 6_000, 12_000]) {
        const { codes, work, rule } = observed(registry, chain(count, 'zzz'));
        const visits = rootWalk(work).events.filter((event) => event.kind === 'visited');
        // One level per argument, three positions a level, never near the bound.
        expect(visits.length, `${count} arguments`).toBeGreaterThanOrEqual(count);
        expect(visits.length, `${count} arguments`).toBeLessThanOrEqual(3 * count);
        // The literal at the end of the chain is refused, where it is written.
        expect(codes).toStrictEqual([LVNA]);
        expect(rule.errors[0]?.span?.start).toBe(chain(count, 'zzz').lastIndexOf('"zzz"'));
        expect(observed(registry, chain(count, 'a')).codes).toStrictEqual([]);
      }
    },
    60_000,
  );

  it('validates the callables a call names in work linear in the call', () => {
    // A variadic callable parameter that lists the callables it admits makes every argument of
    // the call a callable parameter, each validated and seeded into the walk. What the call passes
    // its callables, the templates it binds and the overload a name chooses are worked out once
    // per call, so the argument types the checks of the call read stay within a constant number
    // per argument, however many callable parameters it has; work per callable parameter in
    // proportion to the call would read a number in proportion to its square.
    const registry = withHostEach(registryWithPick(), { operators: ['EACH', 'PICK'] });
    for (const count of [10, 100, 1_000, 3_000]) {
      const { work, codes } = observed(registry, `EACH(1; ${'"EACH"; '.repeat(count - 2)}"EACH")`);
      expect(codes).toStrictEqual([]);
      expect(work.units.arguments, `${count} arguments`).toBeGreaterThanOrEqual(count);
      expect(work.units.arguments, `${count} arguments`).toBeLessThanOrEqual(16 * (count + 1));
    }
  });

  it('parses the longest chain the default limits admit through a variadic host EACH', () => {
    const registry = withHostEach(registryWithPick(), { variadic: true });
    const source = `EACH(LIST(LIST(1)); ${'"EACH"; '.repeat(238)}"ISNUMBER")`;
    const { codes, work } = observed(registry, source, {});
    expect(codes).toStrictEqual([]);
    const walk = rootWalk(work);
    expect(walk.events.filter((event) => event.kind === 'visited').length).toBeLessThanOrEqual(
      3 * 241,
    );
  });

  it('stops at its limit without throwing or refusing the formula', () => {
    // A host's EACH overload with forty parameters makes every level of the chain visit forty
    // positions: the walk spends its limit before the end of the chain and leaves the rest to the
    // functions when the call runs.
    const count = 120;
    const misspelt = chain(count, 'zzz');
    const wide = observed(withHostEach(registryWithPick(), { width: 40 }), misspelt);
    expect(wide.codes).toStrictEqual([]);
    expect(expectOneBreadthFirstQueue(rootWalk(wide.work), 'forty parameters')).toBe(true);
    // Not vacuous: with the core definitions alone the walk reaches the end of the same chain.
    expect(observed(registryWithPick(), misspelt).codes).toStrictEqual([LVNA]);
  });

  it('follows a variadic callable parameter at the arguments a written call checks', () => {
    // A variadic callable parameter that lists the callables it admits is checked at every
    // argument where the call is written, and followed at every argument in the walk; one that
    // lists none is checked, and followed, at its first argument only.
    // Written: the overload binds, and its second callable, PICK, receives "PICK" as its mode.
    const written = 'EACH(1; "EACH"; "PICK")';
    // Nested: the core EACH calls EACH, whose overload's second callable is PICK, alike.
    const nested = 'EACH(LIST(1); "EACH"; "EACH"; "PICK")';
    // Whether the walk visits PICK at its mode, which only the second callable passes it.
    const modeVisited = (work: WorkRecord) =>
      work.events.some(
        (event) =>
          event.kind === 'visited' && event.state.includes('PICK/v1') && event.position === 1,
      );
    for (const source of [written, nested]) {
      const listing = withHostEach(registryWithPick(), { operators: ['EACH', 'PICK'] });
      const listed = observed(listing, source, {});
      expect(listed.codes, source).toStrictEqual([LVNA]);
      expect(modeVisited(listed.work), source).toBe(true);
      // Without a list, neither checks nor follows the second callable, though the walk runs.
      const unlisted = observed(
        withHostEach(registryWithPick(), { operators: 'unlisted' }),
        source,
        {},
      );
      expect(unlisted.codes, source).toStrictEqual([]);
      expect(
        unlisted.work.events.some((event) => event.kind === 'visited'),
        source,
      ).toBe(true);
      expect(modeVisited(unlisted.work), source).toBe(false);
    }
  });
});
