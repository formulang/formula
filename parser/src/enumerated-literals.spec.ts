import type { FormulaRegistry } from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaTypes,
  createRegistry,
  registerCoreFormulaDefinitions,
  stripNullability,
} from '@formulang/definitions';
import { describe, expect, it } from 'vitest';
import { WALK_STEPS_PER_ARGUMENT, callWalk, walkCallable } from './enumerated-literals';
import { parseFormula } from './index';

/** Limits raised for calls of thousands of arguments, as an embedder may raise them. */
const LIMITS = { maxTokens: 1_000_000, maxAstNodes: 1_000_000, maxSourceLength: 10_000_000 };

/**
 * The core registry with PICK(subject; mode), whose mode lists `a` and `b`, and MAP, a copy of
 * EACH under a name of its own, so a plain function for which no walk starts.
 */
function registryWithPick() {
  const registry = createRegistry();
  registerCoreFormulaDefinitions(registry);
  const [each] = registry.listFunctionsByName('EACH');
  if (each === undefined) throw new Error('no EACH');
  registry.registerFunction({ ...each, name: 'MAP', signatureId: 'MAP/v1' });
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

/**
 * Adds a host's EACH overload, which under a name of the table gets EACH's invocation: with a
 * variadic callable parameter, or with `width` parameters in all.
 */
function withHostEach(
  registry: ReturnType<typeof registryWithPick>,
  shape: { variadic: true } | { width: number },
) {
  const [each] = registry.listFunctionsByName('EACH');
  if (each === undefined) throw new Error('no EACH');
  const target = { name: 'target', type: FormulaTypes.list(FormulaTypes.number(true)) };
  const callable = {
    name: 'operator',
    type: FormulaTypes.callable('function'),
    literalOnly: true,
    variadic: 'variadic' in shape,
  };
  const options = 'width' in shape ? shape.width - 2 : 0;
  registry.registerFunction({
    ...each,
    signatureId: 'HOST_EACH/v1',
    params: [
      target,
      callable,
      ...Array.from({ length: options }, (_, index) => ({
        name: `option${index}`,
        type: FormulaTypes.text(true),
        optional: true,
      })),
    ],
  });
  return registry;
}

/** `head` over a list of lists, naming EACH at every argument but the last two: PICK and `mode`. */
function chain(count: number, mode: string, head = 'EACH'): string {
  return `${head}(LIST(LIST(1)); ${'"EACH"; '.repeat(count - 3)}"PICK"; "${mode}")`;
}

/**
 * Parses `source` and walks the callable its call names at argument 1, as the parser starts the
 * walk: one walk for the call written in the formula. Answers the parse and the walk.
 */
function walked(registry: FormulaRegistry, source: string, limits: object = LIMITS) {
  const rule = parseFormula(source, { registry, limits });
  const root = rule.root;
  if (root.kind !== 'call' || root.signatureId === undefined) throw new Error(`${source}: unbound`);
  const host = registry.getFunction(root.signatureId);
  const named = root.args[1];
  const param = host?.params[1];
  const callable = param === undefined ? undefined : stripNullability(param.type);
  if (host === undefined || named === undefined || callable?.kind !== 'callable') {
    throw new Error(`${source}: no callable at argument 1`);
  }
  const walk = callWalk(registry, [], { signatureId: root.signatureId, args: root.args });
  walkCallable(walk, {
    host,
    reference: callable.reference,
    name: String(named.predictableValue),
    index: 1,
    span: named.span,
  });
  return { rule, walk };
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
        expect(walk.limit).toBe(WALK_STEPS_PER_ARGUMENT * (count + 1));
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
    const { rule, walk } = walked(registry, source, {});
    expect(rule.errors).toStrictEqual([]);
    expect(walk.steps).toBeLessThanOrEqual(3 * 241);
  });

  it('stops at its limit, breadth first, without throwing or refusing the formula', () => {
    // A host's EACH overload with forty parameters makes every level of the chain visit forty
    // positions: the walk spends its limit before the end of the chain, checks every level above
    // where it stops, and leaves the rest to the functions when the call runs.
    const count = 120;
    const misspelt = chain(count, 'zzz');
    const wide = withHostEach(registryWithPick(), { width: 40 });
    const { rule, walk } = walked(wide, misspelt);
    expect(walk.steps).toBe(walk.limit);
    expect(codes(walk.errors)).toStrictEqual([]);
    expect(rule.errors).toStrictEqual([]);
    // In a call as long, a literal a level above the stop passes on is checked: here PICK is named
    // at the second level.
    const shallow = `EACH(LIST(LIST(1)); "EACH"; "PICK"; "zzz"; ${'"EACH"; '.repeat(count - 5)}"a")`;
    expect(codes(parseFormula(shallow, { registry: wide, limits: LIMITS }).errors)).toStrictEqual([
      FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
    ]);
    // Not vacuous: with the core definitions alone the walk reaches the end of the same chain.
    expect(codes(walked(registryWithPick(), misspelt).rule.errors)).toStrictEqual([
      FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
    ]);
  });

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
