import type { FormulaRegistry } from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaTypes,
  createRegistry,
  registerCoreFormulaDefinitions,
  stripNullability,
} from '@formulang/definitions';
import { describe, expect, it } from 'vitest';
import {
  admittedValues,
  callWalk,
  paramAt,
  runWalk,
  seedCallable,
  type CallWalk,
  type WalkStep,
} from './enumerated-literals';
import { parseFormula } from './index';

/** Limits raised for calls of thousands of arguments, as an embedder may raise them. */
const LIMITS = { maxTokens: 1_000_000, maxAstNodes: 1_000_000, maxSourceLength: 10_000_000 };

/** The documented bound: 16 argument positions per argument of the call, and 16 more. */
const documentedLimit = (args: number) => 16 * (args + 1);

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
 * callable parameter is variadic; one with `width` parameters in all; or one with `callables`
 * callable parameters after a number target, forty parameters in all, the last of them variadic,
 * so a call written with a number binds it at any length and its callables fan out at every level.
 */
function withHostEach(
  registry: Registry,
  shape: { variadic: true } | { width: number } | { callables: number },
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
  const params =
    'callables' in shape
      ? [
          { name: 'target', type: FormulaTypes.number(true) },
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

/**
 * Parses `source` and walks the callables its call names as the parser does: every callable
 * argument the call written in the formula checks seeds one walk, which then runs once. `limit`
 * replaces the walk's limit, and the walk records its steps in `trace`.
 */
function walked(
  registry: FormulaRegistry,
  source: string,
  options: { limits?: object; limit?: number } = {},
) {
  const rule = parseFormula(source, { registry, limits: options.limits ?? LIMITS });
  const root = rule.root;
  if (root.kind !== 'call' || root.signatureId === undefined) throw new Error(`${source}: unbound`);
  const host = registry.getFunction(root.signatureId);
  if (host === undefined) throw new Error(`${source}: no definition`);
  const trace: WalkStep[] = [];
  const base = callWalk(registry, [], { signatureId: root.signatureId, args: root.args });
  const walk: CallWalk = { ...base, trace, limit: options.limit ?? base.limit };
  for (let index = 0; index < Math.max(host.params.length, root.args.length); index++) {
    const param = paramAt(host.params, index);
    if (param === undefined || param.literalOnly !== true) continue;
    if (index >= host.params.length && admittedValues(param) === undefined) continue;
    const type = stripNullability(param.type);
    const named = root.args[index];
    if (type.kind !== 'callable' || typeof named?.predictableValue !== 'string') continue;
    seedCallable(walk, {
      host,
      reference: type.reference,
      name: named.predictableValue,
      index,
      span: named.span,
    });
  }
  runWalk(walk);
  return { rule, walk, trace, args: root.args.length };
}

const codes = (errors: readonly { code: string }[]) => errors.map((error) => error.code);

describe('the walk through nested callables', () => {
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
        const { rule, walk } = walked(registry, chain(count, 'zzz'));
        // One level per argument, three positions a level: the walk's own count, never near its
        // limit, whichever overloads the name has.
        expect(walk.steps, `${count} arguments`).toBeGreaterThanOrEqual(count);
        expect(walk.steps, `${count} arguments`).toBeLessThanOrEqual(3 * count);
        expect(walk.limit).toBe(documentedLimit(count));
        // The literal at the end of the chain is refused, and the parser refuses it as written.
        expect(codes(walk.errors)).toStrictEqual([FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED]);
        expect(codes(rule.errors)).toStrictEqual([FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED]);
        expect(rule.errors[0]?.span?.start).toBe(chain(count, 'zzz').lastIndexOf('"zzz"'));
        expect(parseFormula(chain(count, 'a'), { registry, limits: LIMITS }).errors).toStrictEqual(
          [],
        );
      }
    },
  );

  it('parses the longest chain the default limits admit through a variadic host EACH', () => {
    const registry = withHostEach(registryWithPick(), { variadic: true });
    const source = `EACH(LIST(LIST(1)); ${'"EACH"; '.repeat(238)}"ISNUMBER")`;
    const { rule, walk } = walked(registry, source, { limits: {} });
    expect(rule.errors).toStrictEqual([]);
    expect(walk.steps).toBeLessThanOrEqual(3 * 241);
  });

  it('stops at its limit without throwing or refusing the formula', () => {
    // A host's EACH overload with forty parameters makes every level of the chain visit forty
    // positions: the walk spends its limit before the end of the chain and leaves the rest to the
    // functions when the call runs.
    const count = 120;
    const misspelt = chain(count, 'zzz');
    const wide = withHostEach(registryWithPick(), { width: 40 });
    const { rule, walk } = walked(wide, misspelt);
    expect(walk.steps).toBe(walk.limit);
    expect(codes(walk.errors)).toStrictEqual([]);
    expect(rule.errors).toStrictEqual([]);
    // Not vacuous: with the core definitions alone the walk reaches the end of the same chain.
    expect(codes(walked(registryWithPick(), misspelt).rule.errors)).toStrictEqual([
      FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
    ]);
  });

  // Where the walk branches: several callables at every level (a host EACH overload with two
  // callable parameters beside the core EACH), and several callable parameters in the call written
  // in the formula (the same overload bound by a number), with the refused literal under the second
  // of them, behind a chain the first names, or under the first. Each formula holds a literal a
  // shallow state refuses and a chain deep enough to spend the limit at its larger sizes.
  const FAN_OUT = [
    {
      shape: 'several callables at every level',
      formula: (count: number) =>
        `EACH(LIST(LIST(1)); "EACH"; "PICK"; ${'"EACH"; '.repeat(count - 4)}"a")`,
      sizes: [20, 60, 120, 240],
    },
    {
      shape: 'the literal under the second callable parameter of the call',
      formula: (count: number) => `EACH(1; "EACH"; "PICK3"; ${'"EACH"; '.repeat(count - 4)}"a")`,
      sizes: [6, 10, 20, 30, 40],
    },
    {
      shape: 'the literal under the first callable parameter of the call',
      formula: (count: number) => `EACH(1; "PICKN"; ${'"EACH"; '.repeat(count - 3)}"a")`,
      sizes: [6, 10, 20, 30, 40],
    },
  ];

  it.each(FAN_OUT.map((entry) => [entry.shape, entry] as const))(
    'checks every level shallower than where it stops, with %s',
    (_, { formula, sizes }) => {
      const registry = withHostEach(registryWithPick(), { callables: 2 });
      let stopped = 0;
      for (const count of sizes) {
        const source = formula(count);
        // The shallow literal is refused at every size, by the parser as written.
        const { rule, walk, trace, args } = walked(registry, source);
        expect(codes(rule.errors), source).toStrictEqual([
          FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
        ]);
        expect(codes(walk.errors), source).toStrictEqual(codes(rule.errors));
        expect(walk.limit, source).toBe(documentedLimit(args));
        // The same walk without a limit visits every state.
        const { trace: full } = walked(registry, source, { limit: Number.POSITIVE_INFINITY });
        // Breadth first across every callable of the call: depths never decrease.
        for (let step = 1; step < full.length; step++) {
          expect(full[step]?.depth, `${source} step ${step}`).toBeGreaterThanOrEqual(
            full[step - 1]?.depth ?? 0,
          );
        }
        // The walk under its limit is the full walk cut at the limit, so every state shallower
        // than the one it stopped in was visited at every position.
        expect(trace).toStrictEqual(full.slice(0, trace.length));
        expect(trace.length).toBe(Math.min(walk.limit, full.length));
        const deepest = trace[trace.length - 1]?.depth ?? 0;
        const positions = (steps: readonly WalkStep[], state: string) =>
          steps.filter((step) => step.state === state).map((step) => step.position);
        for (const state of new Set(
          full.filter((step) => step.depth < deepest).map((s) => s.state),
        )) {
          expect(positions(trace, state), state).toStrictEqual(positions(full, state));
        }
        if (trace.length < full.length) stopped++;
      }
      // Not vacuous: the limit stops the walk at the larger sizes, past a level that branches.
      expect(stopped).toBeGreaterThanOrEqual(2);
    },
  );

  it.each(FAN_OUT.map((entry) => [entry.shape, entry] as const))(
    'spends at most its limit at every size, with %s',
    (_, { formula }) => {
      const registry = withHostEach(registryWithPick(), { callables: 2 });
      for (const count of [100, 1_000, 3_000, 6_000, 12_000]) {
        const { rule, walk } = walked(registry, formula(count));
        expect(walk.steps, `${count} arguments`).toBe(walk.limit);
        expect(walk.limit).toBe(documentedLimit(count));
        expect(codes(rule.errors)).toStrictEqual([FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED]);
      }
    },
  );

  it('parses a chain of 12,000 arguments in time comparable to the parse without the walk', () => {
    // The parse of the same formula under MAP, a plain copy of EACH for which no walk starts, is
    // the parse 1.0.0 makes of it, which has no walk. The step counts above are the invariant;
    // this bound only guards against a walk that is no longer linear, which at this size would
    // take hundreds of times as long.
    const registry = registryWithPick();
    const fastest = (source: string) => {
      let best = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        parseFormula(source, { registry, limits: LIMITS });
        best = Math.min(best, performance.now() - started);
      }
      return best;
    };
    const withWalk = fastest(chain(12_000, 'zzz'));
    const withoutWalk = fastest(chain(12_000, 'zzz', 'MAP'));
    expect(withWalk).toBeLessThan(10 * withoutWalk);
  });
});
