import { createCoreFormulaRuntime } from '@formulang/core-functions';
import type {
  FormulaNodeOutput,
  FunctionDefinition,
  FunctionImplementation,
  FunctionParamDefinition,
} from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaTypes,
  makeOkBoolean,
  optimizeRule,
  stripNullability,
} from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { describe, expect, it } from 'vitest';
import { evaluateRuleOutputAsync } from './index';

/**
 * The enumerated-literal rule through `parseFormula` and evaluation, on a generated matrix: where
 * the literal sits × how the name it reaches is defined × whether the literal is admitted or
 * misspelt, under the core registry and with the higher-order functions re-registered under new
 * signature ids. Every formula that compiles is also run, and every mode a host function receives
 * is checked against the values its own definition lists, so a misspelt literal that compiled
 * would show up there too.
 */

type Literal = 'admitted' | 'misspelt';
const LITERALS: Record<Literal, string> = { admitted: 'a', misspelt: 'zzz' };

/** The higher-order function that passes the literal to the host function. */
type Vehicle = 'EACH' | 'FILTER' | 'FILTER_BY';
const VEHICLES: readonly Vehicle[] = ['EACH', 'FILTER', 'FILTER_BY'];

type Placement =
  | { kind: 'direct' }
  | { kind: 'forwarded'; vehicle: Vehicle }
  | { kind: 'nested'; vehicle: Vehicle; depth: number };

const PLACEMENTS: readonly Placement[] = [
  { kind: 'direct' },
  ...VEHICLES.map((vehicle): Placement => ({ kind: 'forwarded', vehicle })),
  ...[1, 2, 3, 4].flatMap((depth) =>
    VEHICLES.map((vehicle): Placement => ({ kind: 'nested', vehicle, depth })),
  ),
];

type Shape = 'single' | 'match' | 'none' | 'none-arity' | 'some' | 'some-none';

/**
 * How the host function the literal reaches is defined, and the item whose type chooses among its
 * overloads: whether that type selects an overload, and whether the selected overload lists the
 * admitted values at the literal's position. Every name lists them in at least one overload.
 */
const SHAPES = {
  // ONE(text; mode ∈ a, b)
  single: { name: 'ONE', item: '"x"', selects: true, selectedListsValues: true },
  // TWO(text; mode ∈ a, b) and TWO(number; mode ∈ a, c): a number selects the second.
  match: { name: 'TWO', item: '1', selects: true, selectedListsValues: true },
  // A boolean selects neither overload of TWO.
  none: { name: 'TWO', item: 'TRUE', selects: false, selectedListsValues: false },
  // THREE(text; mode ∈ a, b; extra) and THREE(number; mode ∈ a, b; extra): two arguments select
  // neither.
  'none-arity': { name: 'THREE', item: '"x"', selects: false, selectedListsValues: false },
  // SOME(text; mode ∈ a, b) and SOME(list<text>; key): a list selects the second, which lists no
  // values.
  some: { name: 'SOME', item: 'LIST("x")', selects: true, selectedListsValues: false },
  // A number selects neither overload of SOME, and only one of them lists values.
  'some-none': { name: 'SOME', item: '1', selects: false, selectedListsValues: false },
} satisfies Record<
  Shape,
  { name: string; item: string; selects: boolean; selectedListsValues: boolean }
>;

/** The parse error codes the rule demands for one cell of the matrix. */
function expectedCodes(placement: Placement, shape: Shape, literal: Literal): string[] {
  const { selects, selectedListsValues } = SHAPES[shape];
  // The call written in the formula, and the callable a higher-order function names directly,
  // must take the types they are given (1.0.0); a nested callable's types are not checked.
  if (!selects && placement.kind !== 'nested') return [FormulaErrorCodes.NO_MATCHING_OVERLOAD];
  // Written directly, only the selected overload receives the literal; passed on by a
  // higher-order function, any overload of the name may.
  const bound = placement.kind === 'direct' ? selectedListsValues : true;
  return bound && literal === 'misspelt' ? [FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED] : [];
}

function nestIn(levels: number, inner: string): string {
  let out = inner;
  for (let i = 0; i < levels; i++) out = `LIST(${out})`;
  return out;
}

function formulaFor(placement: Placement, shape: Shape, literal: Literal): string {
  const { name, item } = SHAPES[shape];
  const lit = `"${LITERALS[literal]}"`;
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
    ? { name: 'key', type: FormulaTypes.text(true) }
    : { name: 'mode', type: FormulaTypes.text(false), literalOnly: true, literalValues: values };
}

const text = FormulaTypes.text(true);
const number = FormulaTypes.number(true);

/** The host overload sets of `SHAPES`. */
const HOST_DEFINITIONS: Array<{
  signatureId: string;
  name: string;
  params: FunctionParamDefinition[];
}> = [
  {
    signatureId: 'ONE/v1',
    name: 'ONE',
    params: [{ name: 'subject', type: text }, modeParam(['a', 'b'])],
  },
  {
    signatureId: 'TWO/v1',
    name: 'TWO',
    params: [{ name: 'subject', type: text }, modeParam(['a', 'b'])],
  },
  {
    signatureId: 'TWO_NUMBER/v1',
    name: 'TWO',
    params: [{ name: 'subject', type: number }, modeParam(['a', 'c'])],
  },
  {
    signatureId: 'THREE/v1',
    name: 'THREE',
    params: [{ name: 'subject', type: text }, modeParam(['a', 'b']), { name: 'extra', type: text }],
  },
  {
    signatureId: 'THREE_NUMBER/v1',
    name: 'THREE',
    params: [
      { name: 'subject', type: number },
      modeParam(['a', 'b']),
      { name: 'extra', type: number },
    ],
  },
  {
    signatureId: 'SOME/v1',
    name: 'SOME',
    params: [{ name: 'subject', type: text }, modeParam(['a', 'b'])],
  },
  {
    signatureId: 'SOME_LIST/v1',
    name: 'SOME',
    params: [{ name: 'subject', type: FormulaTypes.list(text, true) }, modeParam()],
  },
];

type Received = { signatureId: string; mode: unknown };

/** A host implementation that records the mode it receives and answers true. */
function recording(signatureId: string, received: Received[]): FunctionImplementation {
  return {
    estimateCostsInSeconds: () => 0.0001,
    evaluateMultiple: async (calls) => {
      const outs: FormulaNodeOutput[] = [];
      for (const call of calls) {
        received.push({ signatureId, mode: await call.args[1]?.value() });
        outs.push(makeOkBoolean(signatureId, true));
      }
      return outs;
    },
  };
}

type RegistryShape = 'core' | 'reversioned';

function runtimeFor(registryShape: RegistryShape, received: Received[]) {
  const { registry, implementations } = createCoreFormulaRuntime();
  if (registryShape === 'reversioned') {
    // The documented way to change a function: retire its id and register the next version.
    const higherOrder = registry
      .listFunctions()
      .filter((def) => def.params.some((p) => stripNullability(p.type).kind === 'callable'));
    expect(higherOrder.length).toBeGreaterThanOrEqual(5);
    for (const def of higherOrder) {
      const next = `${def.name}/v2`;
      const implementation = implementations.get(def.signatureId);
      registry.retireFunction(def.signatureId);
      registry.registerFunction({ ...def, signatureId: next });
      if (implementation) implementations.register(next, implementation);
    }
  }
  for (const host of HOST_DEFINITIONS) {
    registry.registerFunction({
      ...host,
      category: 'custom',
      description: 'Host function of the enumerated-literal matrix.',
      returnType: FormulaTypes.boolean(true),
      purity: 'pure',
    });
    implementations.register(host.signatureId, recording(host.signatureId, received));
  }
  return { registry, implementations };
}

function admittedBy(signatureId: string): readonly string[] | undefined {
  return HOST_DEFINITIONS.find((def) => def.signatureId === signatureId)?.params[1]?.literalValues;
}

const SHAPE_NAMES = Object.keys(SHAPES) as Shape[];
const LITERAL_NAMES = Object.keys(LITERALS) as Literal[];

const cells = PLACEMENTS.flatMap((placement) =>
  SHAPE_NAMES.flatMap((shape) =>
    LITERAL_NAMES.map((literal) => ({
      placement,
      shape,
      literal,
      source: formulaFor(placement, shape, literal),
      want: expectedCodes(placement, shape, literal),
    })),
  ),
);

describe('the enumerated-literal rule, generated', () => {
  it('covers every placement, definition shape and literal, with every outcome the rule has', () => {
    // direct + 3 vehicles × (passed on directly + nested at depth 1 to 4)
    expect(PLACEMENTS).toHaveLength(1 + VEHICLES.length * 5);
    expect(cells).toHaveLength(PLACEMENTS.length * SHAPE_NAMES.length * LITERAL_NAMES.length);
    expect(new Set(cells.map((cell) => cell.source)).size).toBe(cells.length);
    const outcomes = new Set(cells.map((cell) => cell.want.join() || 'compiles'));
    expect([...outcomes].sort()).toStrictEqual(
      [
        'compiles',
        FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
        FormulaErrorCodes.NO_MATCHING_OVERLOAD,
      ].sort(),
    );
  });

  it.each(['core', 'reversioned'] as const)(
    'gives every cell the outcome the rule demands, compiling and running (%s registry)',
    async (registryShape) => {
      const mismatches: unknown[] = [];
      let ran = 0;
      for (const { source, want } of cells) {
        const received: Received[] = [];
        const { registry, implementations } = runtimeFor(registryShape, received);
        const parsed = parseFormula(source, { registry });
        const got = parsed.errors.map((e) => e.code);
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          mismatches.push({ source, want, got });
          continue;
        }
        if (got.length > 0) continue;
        const compiled = optimizeRule(parsed, { registry });
        const out = await evaluateRuleOutputAsync(compiled, {
          registry,
          resolver: implementations,
          variables: {},
        });
        ran++;
        if (out.errors.length > 0) mismatches.push({ source, runErrors: out.errors });
        if (received.length === 0) mismatches.push({ source, received: 'nothing' });
        for (const { signatureId, mode } of received) {
          const admitted = admittedBy(signatureId);
          if (admitted !== undefined && !admitted.includes(String(mode))) {
            mismatches.push({ source, signatureId, receivedMode: mode });
          }
        }
      }
      expect(mismatches).toStrictEqual([]);
      expect(ran).toBeGreaterThan(cells.length / 3);
    },
  );

  it('refuses the hunt probes that reach an overload set the nested types do not select', () => {
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

  it('admits a value any overload lists when the selected overload lists none', () => {
    // SOME(text; mode ∈ a, b), SOME(list<text>; key) and SOME(number; mode ∈ c): a list item
    // selects the overload without values, so the literal must be one another overload lists.
    const { registry } = runtimeFor('core', []);
    registry.registerFunction({
      signatureId: 'SOME_NUMBER/v1',
      name: 'SOME',
      category: 'custom',
      description: 'Host overload with other admitted values.',
      params: [{ name: 'subject', type: number }, modeParam(['c'])],
      returnType: FormulaTypes.boolean(true),
      purity: 'pure',
    });
    const errorsOf = (source: string) => parseFormula(source, { registry }).errors;
    expect(errorsOf('EACH(LIST(LIST("x")); "SOME"; "c")')).toStrictEqual([]);
    expect(errorsOf('EACH(LIST(LIST(LIST("x"))); "EACH"; "SOME"; "b")')).toStrictEqual([]);
    const [error, ...rest] = errorsOf('EACH(LIST(LIST("x")); "SOME"; "zzz")');
    expect(rest).toStrictEqual([]);
    expect(error?.message).toBe(`Parameter 'mode' of SOME must be one of "a", "b", "c"; got "zzz"`);
  });

  it('follows a nested higher-order call whose own types select no overload', () => {
    // From the second level on, an EACH receives a number where it takes a list, so its types
    // select no overload; the literal it passes on is still checked.
    const { registry } = runtimeFor('core', []);
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
