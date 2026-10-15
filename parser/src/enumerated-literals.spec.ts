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

describe('admitted lists', () => {
  /** `code<from>` ... `code<from + k - 1>`. */
  const codes = (k: number, from = 0) =>
    Array.from({ length: k }, (_, index) => `code${from + index}`);

  /**
   * `codes(k)` as a list that counts every read of one of its values, whichever code reads it: the
   * parser's own reads of a definition's list, seen from outside it.
   */
  function countedList(k: number) {
    const reads = { count: 0 };
    const list = new Proxy(codes(k), {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads.count++;
        return Reflect.get(target, key, receiver);
      },
    });
    return { list, reads };
  }

  /**
   * The core registry with CODE(subject; code), whose code lists `list`; with `second`, CODE has a
   * second overload, CODE(text; code), whose code lists `second`.
   */
  function registryWithCode(list: string[], second?: string[]) {
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);
    const code = (values: string[]) => ({
      name: 'code',
      type: FormulaTypes.text(false),
      literalOnly: true,
      literalValues: values,
    });
    const overloads = [
      { id: 'CODE/v1', subject: FormulaTypes.number(true), values: list },
      ...(second === undefined
        ? []
        : [{ id: 'CODE/v2', subject: FormulaTypes.text(true), values: second }]),
    ];
    for (const { id, subject, values } of overloads) {
      registry.registerFunction({
        signatureId: id,
        name: 'CODE',
        category: 'custom',
        description: 'A function whose code lists many values.',
        params: [{ name: 'subject', type: subject }, code(values)],
        returnType: FormulaTypes.boolean(true),
        purity: 'pure',
      });
    }
    return registry;
  }

  /** `count` checks of `literal` against CODE's list, written directly or passed on by EACH. */
  const checks = (count: number, literal: string, through: 'written' | 'EACH') =>
    `LIST(${Array.from({ length: count }, () =>
      through === 'written' ? `CODE(1; "${literal}")` : `EACH(LIST(1); "CODE"; "${literal}")`,
    ).join('; ')})`;

  it('reads a list once per parse, and tests each literal in one lookup', () => {
    // Forty checks within the default limits, against lists of 1,000, 5,000 and 20,000 values,
    // smallest first: reading a list per check, or a list per value, fails at the first size.
    for (const k of [1_000, 5_000, 20_000]) {
      for (const through of ['written', 'EACH'] as const) {
        const label = `${k} values, ${through}`;
        const { list, reads } = countedList(k);
        const registry = registryWithCode(list);
        // Taken: the list is read once, to check it is a list of texts and to build its set (2k),
        // and each of the forty checks is one lookup.
        reads.count = 0;
        const accepted = observed(registry, checks(40, `code${k - 1}`, through), {});
        expect(accepted.codes, label).toStrictEqual([]);
        expect(accepted.work.units.admitted, label).toBe(2 * k + 40);
        expect(reads.count, label).toBe(2 * k);
        // Refused: each refusal is its lookup; the forty print one message, which reads the k
        // values once, from the set, on its first report.
        reads.count = 0;
        const refused = observed(registry, checks(40, 'z0', through), {});
        expect(refused.codes, label).toStrictEqual(Array.from({ length: 40 }, () => LVNA));
        expect(refused.rule.errors[0]?.message, label).toContain(`"code${k - 1}"; got "z0"`);
        expect(new Set(refused.rule.errors.map((error) => error.message)).size, label).toBe(1);
        expect(refused.work.units.admitted, label).toBe(2 * k + 40 + k);
        expect(reads.count, label).toBe(2 * k);
      }
    }
  }, 60_000);

  it('works out the values two overloads list in common once per parse', () => {
    // CODE's two overloads list code0 ... code<k-1> and code1 ... code<k>: a literal passed on to
    // CODE must be one of code1 ... code<k-1>, which either overload lists.
    for (const k of [1_000, 5_000]) {
      const label = `${k} values`;
      const registry = registryWithCode(codes(k), codes(k, 1));
      const parse = (count: number, literal: string) =>
        observed(registry, checks(count, literal, 'EACH'), {});
      // Reading both lists is linear in the lists, once per parse; every further check is one
      // lookup in each of the two.
      const one = parse(1, `code${k - 1}`);
      expect(one.work.units.admitted, label).toBeLessThanOrEqual(10 * k);
      const forty = parse(40, `code${k - 1}`);
      expect(forty.codes, label).toStrictEqual([]);
      expect(forty.work.units.admitted - one.work.units.admitted, label).toBe(2 * 39);
      // The first refusal works out the k - 1 values in common, which it prints, and does one
      // lookup per overload for its message; every further refusal of the same value is its
      // lookups alone.
      const refusedOne = parse(1, 'code0');
      const refusedForty = parse(40, 'code0');
      expect(refusedForty.codes, label).toStrictEqual(Array.from({ length: 40 }, () => LVNA));
      expect(refusedForty.rule.errors[0]?.message, label).toContain('which CODE/v2 does not list');
      expect(refusedForty.work.units.admitted - refusedOne.work.units.admitted, label).toBe(2 * 39);
    }
  }, 60_000);
  it('names the overload that leaves a value out, whatever values a list repeats', () => {
    // CODE/v1 lists a and b, b twice; CODE/v2 lists a three times: they list different values,
    // so refusing b names CODE/v2. Listing the same values in another order or number, they list
    // the same values, and the refusal prints each once.
    const differ = observed(
      registryWithCode(['a', 'b', 'b'], ['a', 'a', 'a']),
      checks(1, 'b', 'EACH'),
      {},
    );
    expect(differ.codes).toStrictEqual([LVNA]);
    expect(differ.rule.errors[0]?.message).toBe(
      `Parameter 'code' of CODE must be one of "a", the values every overload of CODE lists here; got "b", which CODE/v2 does not list`,
    );
    const same = observed(
      registryWithCode(['a', 'b', 'b'], ['b', 'a']),
      checks(1, 'z', 'EACH'),
      {},
    );
    expect(same.rule.errors[0]?.message).toBe(
      `Parameter 'code' of CODE must be one of "a", "b"; got "z"`,
    );
  });

  /**
   * The core registry with PICK, whose variadic mode lists `first`, and lists `second` on an
   * overload that takes a text subject.
   */
  function registryWithVariadicPick(first: readonly string[], second: readonly string[]) {
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);
    const overloads = [
      ['PICK/v1', FormulaTypes.number(true), first],
      ['PICK/v2', FormulaTypes.text(true), second],
    ] as const;
    for (const [signatureId, subject, values] of overloads) {
      registry.registerFunction({
        signatureId,
        name: 'PICK',
        category: 'custom',
        description: 'A function whose variadic mode lists many values.',
        params: [
          { name: 'subject', type: subject },
          {
            name: 'mode',
            type: FormulaTypes.text(false),
            literalOnly: true,
            variadic: true,
            literalValues: [...values],
          },
        ],
        returnType: FormulaTypes.boolean(true),
        purity: 'pure',
      });
    }
    return registry;
  }

  /**
   * The core registry with PICKN(subject; mode; rest...), whose mode lists `values`, and a host's
   * EACH overload whose variadic callable parameter lists PICKN, so every argument of a call of it
   * after the first names PICKN.
   */
  function registryWithPickN(values: readonly string[]) {
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);
    registry.registerFunction({
      signatureId: 'PICKN/v1',
      name: 'PICKN',
      category: 'custom',
      description: 'A function whose mode lists many values, and takes any further arguments.',
      params: [
        { name: 'subject', type: FormulaTypes.any(true) },
        {
          name: 'mode',
          type: FormulaTypes.text(false),
          literalOnly: true,
          literalValues: [...values],
        },
        { name: 'rest', type: FormulaTypes.any(true), optional: true, variadic: true },
      ],
      returnType: FormulaTypes.boolean(true),
      purity: 'pure',
    });
    return withHostEach(registry, { operators: ['PICKN'] });
  }

  /**
   * The core registry with MANY: `count` overloads whose variadic mode starts one position further on
   * each, after object parameters of the overload's own, each listing code0 ... code<size - 1> but
   * one, its own index: each position up to `count` is checked against a different set of lists.
   */
  function registryWithStaggeredModes(count: number, size: number) {
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);
    for (let index = 0; index < count; index++) {
      registry.registerFunction({
        signatureId: `MANY/v${index + 1}`,
        name: 'MANY',
        category: 'custom',
        description: "A variadic mode after the overload's own object parameters.",
        params: [
          { name: 'subject', type: FormulaTypes.number(true) },
          ...Array.from({ length: index }, (_, at) => ({
            name: `x${at}`,
            type: FormulaTypes.object(`C${index}x${at}`),
          })),
          {
            name: 'mode',
            type: FormulaTypes.text(false),
            literalOnly: true,
            variadic: true,
            literalValues: codes(size).filter((value) => value !== `code${index}`),
          },
        ],
        returnType: FormulaTypes.boolean(true),
        purity: 'pure',
      });
    }
    return registry;
  }

  /** The sets of two or more of four overloads, as indices, and the name given to each. */
  const ALIASED_SETS = Array.from({ length: 16 }, (_, mask) =>
    [0, 1, 2, 3].filter((index) => (mask >> index) & 1),
  ).filter((set) => set.length >= 2);
  const ALIAS_NAMES = ALIASED_SETS.map((set) => `P${set.join('')}`);

  /**
   * The core registry with PICK on four subject types, each variadic mode listing code0 ...
   * code<size - 1>, and a name for every set of two or more of the overloads, which each of them
   * takes as an alias, so each name reaches its own set of lists; and `items`, of any type.
   */
  function registryWithAliasedPicks(size: number) {
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);
    registry.registerVariable({
      name: 'items',
      description: 'Items of any type.',
      type: FormulaTypes.any(true),
    });
    const subjects = [
      FormulaTypes.number(true),
      FormulaTypes.text(true),
      FormulaTypes.boolean(true),
      FormulaTypes.list(FormulaTypes.number(true), true),
    ];
    subjects.forEach((subject, index) => {
      registry.registerFunction({
        signatureId: `PICK/v${index + 1}`,
        name: 'PICK',
        aliases: ALIAS_NAMES.filter((_, at) => ALIASED_SETS[at]?.includes(index)),
        category: 'custom',
        description: 'A variadic mode, under names that each reach a set of overloads.',
        params: [
          { name: 'subject', type: subject },
          {
            name: 'mode',
            type: FormulaTypes.text(false),
            literalOnly: true,
            variadic: true,
            literalValues: codes(size),
          },
        ],
        returnType: FormulaTypes.boolean(true),
        purity: 'pure',
      });
    });
    return registry;
  }

  /** `registry`, handing out a fresh copy of each definition on every lookup. */
  function copying(registry: FormulaRegistry): FormulaRegistry {
    const handing = Object.create(registry) as FormulaRegistry;
    handing.listFunctionsByName = (name) =>
      registry.listFunctionsByName(name).map((def) => structuredClone(def));
    handing.getFunction = (id) => {
      const def = registry.getFunction(id);
      return def === undefined ? undefined : structuredClone(def);
    };
    return handing;
  }

  /** `count` arguments, all `literal` but the last, which is `last`. */
  const literals = (count: number, literal: string, last = literal) =>
    `${`"${literal}"; `.repeat(count - 1)}"${last}"`;

  /**
   * Shapes in which admitted values are read at many positions or one refusal is reached by many
   * walk states, each written directly and passed on one and two levels down, within the default
   * limits: n = 200 arguments, lists of k = 20,000 values. `lists` is the length of the lists the
   * registry declares; `least` the length of the shortest list a parse of the shape reads;
   * `refusals` how many literals each formula refuses.
   */
  const k = 20_000;
  const n = 200;
  const forms = (args: string, callable: string) => [
    { level: 'written', source: `${callable}(1; ${args})` },
    { level: 'one level down', source: `EACH(LIST(1); "${callable}"; ${args})` },
    { level: 'two levels down', source: `EACH(LIST(LIST(1)); "EACH"; "${callable}"; ${args})` },
  ];
  const pickNForms = [
    { level: 'written', source: `PICKN(1; ${literals(n, 'PICKN')})` },
    { level: 'one level down', source: `EACH(1; ${literals(n, 'PICKN')})` },
    { level: 'two levels down', source: `EACH(LIST(1); "EACH"; ${literals(n, 'PICKN')})` },
  ];
  const everyName = (call: (name: string) => string) =>
    `LIST(${ALIAS_NAMES.map((name) => call(name)).join('; ')})`;
  const calls = (call: string) => `LIST(${Array.from({ length: 25 }, () => call).join('; ')})`;
  const WORK_SHAPES = [
    {
      shape: 'a variadic mode two overloads list, every argument taken',
      registry: () => registryWithVariadicPick(codes(k), codes(k, 1)),
      lists: 2 * k,
      least: k,
      refusals: 0,
      forms: forms(literals(n, 'code1'), 'PICK'),
    },
    {
      shape: 'a variadic mode two overloads list, the last argument refused',
      registry: () => registryWithVariadicPick(codes(k), codes(k, 1)),
      lists: 2 * k,
      least: k,
      refusals: 1,
      forms: forms(literals(n, 'code1', 'zzz'), 'PICK'),
    },
    {
      shape: 'one refused literal that every callable parameter of a call passes on',
      registry: () => registryWithPickN(codes(k)),
      lists: k + 1,
      least: k,
      refusals: 1,
      forms: pickNForms,
    },
    {
      shape: 'a variadic mode that starts at a different position on each of 20 overloads',
      registry: () => registryWithStaggeredModes(20, 5_000),
      lists: 20 * 4_999,
      least: 4_999,
      refusals: 0,
      forms: forms(literals(n, 'code100'), 'MANY'),
    },
    {
      shape: 'eleven names, each reaching its own set of four listing overloads',
      registry: () => registryWithAliasedPicks(k),
      lists: 4 * k,
      least: k,
      refusals: 0,
      forms: [
        { level: 'written', source: everyName((name) => `${name}(items; "code1")`) },
        {
          level: 'one level down',
          source: everyName((name) => `EACH(items; "${name}"; "code1")`),
        },
        {
          level: 'two levels down',
          source: everyName((name) => `EACH(LIST(items); "EACH"; "${name}"; "code1")`),
        },
      ],
    },
    {
      shape: 'a registry handing out fresh definitions, a variadic mode two overloads list',
      registry: () => copying(registryWithVariadicPick(codes(k), codes(k, 1))),
      lists: 2 * k,
      least: k,
      refusals: 0,
      forms: forms(literals(n, 'code1'), 'PICK'),
    },
    {
      shape: 'a registry handing out fresh definitions, one refused literal passed on',
      registry: () => copying(registryWithPickN(codes(k))),
      lists: k + 1,
      least: k,
      refusals: 1,
      forms: pickNForms,
    },
    {
      shape: 'a registry handing out fresh definitions, twenty-five calls of one name',
      registry: () => copying(registryWithVariadicPick(codes(k), codes(k, 1))),
      lists: 2 * k,
      least: k,
      refusals: 0,
      forms: [
        { level: 'written', source: calls('PICK(1; "code1")') },
        { level: 'one level down', source: calls('EACH(LIST(1); "PICK"; "code1")') },
        {
          level: 'two levels down',
          source: calls('EACH(LIST(LIST(1)); "EACH"; "PICK"; "code1")'),
        },
      ],
    },
  ];

  /** 4 x (the length of the lists + the characters the refusals in `errors` print). */
  const bound = (lists: number, errors: readonly { message: string }[]) =>
    4 * (lists + errors.reduce((sum, error) => sum + error.message.length, 0));

  it.each(WORK_SHAPES)(
    'reads admitted values in work bounded by the lists and what the refusals print: $shape',
    ({ registry: registryFor, lists, least, refusals, forms: sources }) => {
      // At every variadic position and every report of a refusal, the units of admitted values a
      // parse reads stay within the bound.
      const registry = registryFor();
      for (const { level, source } of sources) {
        const { rule, work, codes: got } = observed(registry, source, {});
        expect(got, level).toStrictEqual(Array.from({ length: refusals }, () => LVNA));
        // Not vacuous: the parse read a list, and a check passed on was walked.
        expect(work.units.admitted, level).toBeGreaterThanOrEqual(least);
        if (level !== 'written') expect(walksOf(work).length, level).toBeGreaterThan(0);
        expect(work.units.admitted, level).toBeLessThanOrEqual(bound(lists, rule.errors));
      }
    },
    60_000,
  );
});
