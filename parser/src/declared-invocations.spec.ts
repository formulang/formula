import type {
  FormulaRegistry,
  FormulaType,
  FunctionDefinition,
  FunctionParamDefinition,
  InvokedArgumentDeclaration,
} from '@formulang/definitions';
import {
  FormulaErrorCodes,
  FormulaTypes,
  createRegistry,
  registerCoreFormulaDefinitions,
  stripNullability,
} from '@formulang/definitions';
import { describe, expect, it } from 'vitest';
import { invokedArguments, type InvokedArgument } from './callable-invocations';
import { parseFormula } from './index';

/**
 * Registration and the parser read one declaration (`callableInvocation`), and this spec holds
 * them to one answer: over an enumeration of declarations on parameter layouts, registration
 * accepts exactly the declarations the parser applies as written. What the parser applies is
 * measured on the parser alone, from a registry that hands it the declaration as given:
 * - the parse does not throw;
 * - it applies the declaration where one literal-only callable parameter is named, and only there;
 * - each entry passes, in some call the definition takes, what the documentation of
 *   `InvokedArgumentDeclaration` says it passes, as the parser's `invokedArguments` computes it;
 * - the declaration passes the callable no more arguments than a call has or it lists, at any
 *   number of arguments, which keeps the parser's walk over nested callables finite.
 */

const number = FormulaTypes.number(false);
const flag = FormulaTypes.boolean(false);
const numbers = FormulaTypes.list(number, false);
const anything = FormulaTypes.any(true);
const callable = FormulaTypes.callable('function_or_operator');
const named = (name: string): FunctionParamDefinition => ({
  name,
  type: callable,
  literalOnly: true,
});

/** A callee that lists one admitted value at every position: any value it is passed is checked. */
const CHECK: FunctionDefinition = {
  signatureId: 'CHECK/v1',
  name: 'CHECK',
  category: 'custom',
  description: 'Lists one admitted value at every position.',
  params: [
    {
      name: 'value',
      type: FormulaTypes.text(false),
      literalOnly: true,
      literalValues: ['ok'],
      variadic: true,
    },
  ],
  returnType: flag,
  purity: 'pure',
};

/** Parameter layouts, each with the arguments of a call that names CHECK at every callable. */
const LAYOUTS: Record<string, { params: FunctionParamDefinition[]; call: string }> = {
  between: {
    params: [
      { name: 'list', type: numbers },
      named('fn'),
      { name: 'flag', type: flag, optional: true },
    ],
    call: 'LIST(1); "CHECK"; TRUE',
  },
  last: { params: [{ name: 'flag', type: flag }, named('fn')], call: 'TRUE; "CHECK"' },
  variadic: {
    params: [
      named('fn'),
      { name: 'list', type: numbers },
      { name: 'rest', type: flag, variadic: true },
    ],
    call: '"CHECK"; LIST(1); TRUE; TRUE',
  },
  none: {
    params: [
      { name: 'flag', type: flag },
      { name: 'list', type: numbers },
    ],
    call: 'TRUE; LIST(1)',
  },
  two: {
    params: [named('fn'), named('gn'), { name: 'list', type: numbers }],
    call: '"CHECK"; "CHECK"; LIST(1)',
  },
  loose: {
    params: [
      { name: 'list', type: numbers },
      { name: 'fn', type: callable },
    ],
    call: 'LIST(1); "CHECK"',
  },
};

const INDICES: unknown[] = [-1, 0, 1, 2, 3, 4, 1.5, '1', null];
const ENTRIES: unknown[] = [
  ...['of', 'at', 'from', 'typeOf'].flatMap((field) =>
    INDICES.map((index) => ({
      kind: { of: 'item', at: 'argument', from: 'arguments', typeOf: 'value' }[field],
      [field]: index,
    })),
  ),
  { kind: 'value' },
  { kind: 'element', of: 0 },
  { of: 0 },
  null,
  'item',
];
const DECLARATIONS: unknown[] = [
  undefined,
  null,
  [],
  {},
  'item',
  { kind: 'item', of: 0 },
  ...ENTRIES.map((entry) => [entry]),
  [{ kind: 'value' }, { kind: 'arguments', from: 1 }],
  [{ kind: 'value' }, { kind: 'value' }, { kind: 'arguments', from: 1 }],
  [{ kind: 'value' }, { kind: 'arguments', from: 0 }],
  [
    { kind: 'arguments', from: 1 },
    { kind: 'arguments', from: 2 },
  ],
  [
    { kind: 'argument', at: 1 },
    { kind: 'argument', at: 1 },
    { kind: 'argument', at: 0 },
  ],
];

function subject(params: FunctionParamDefinition[], declaration: unknown): FunctionDefinition {
  const def: FunctionDefinition = {
    signatureId: 'SUBJECT/v1',
    name: 'SUBJECT',
    category: 'custom',
    description: 'A higher-order function under test.',
    params,
    returnType: anything,
    purity: 'pure',
  };
  if (declaration !== undefined) {
    def.callableInvocation = declaration as InvokedArgumentDeclaration[];
  }
  return def;
}

function coreRegistry() {
  const registry = createRegistry();
  registerCoreFormulaDefinitions(registry);
  registry.registerFunction(CHECK);
  return registry;
}

/** A registry that hands the parser `def` as given, past registration's checks. */
function handing(def: FunctionDefinition): FormulaRegistry {
  const registry = coreRegistry();
  const plain = { ...def };
  delete plain.callableInvocation;
  registry.registerFunction(plain);
  const raw = Object.create(registry) as FormulaRegistry;
  raw.listFunctionsByName = (name) =>
    registry.listFunctionsByName(name).map((d) => (d.signatureId === def.signatureId ? def : d));
  raw.getFunction = (id) => (id === def.signatureId ? def : registry.getFunction(id));
  return raw;
}

function parses(call: string, registry: FormulaRegistry): boolean {
  try {
    parseFormula(`SUBJECT(${call})`, { registry });
    return true;
  } catch {
    return false;
  }
}

/** How many callables the parser applies a declaration to, in the layout's call. */
function callablesApplied(layout: { params: FunctionParamDefinition[]; call: string }): number {
  const registry = handing(subject(layout.params, [{ kind: 'value' }]));
  return parseFormula(`SUBJECT(${layout.call})`, { registry }).errors.filter(
    (error) => error.code === FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
  ).length;
}

function isPosition(index: unknown): index is number {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0;
}

function indicesOf(entry: unknown): number[] {
  if (typeof entry !== 'object' || entry === null) return [];
  const { of, at, from, typeOf } = entry as Record<string, unknown>;
  return [of, at, from, typeOf].filter(isPosition);
}

/** The argument types of a call of `count` arguments, as the parameters take them. */
function typesFor(params: readonly FunctionParamDefinition[], count: number): FormulaType[] {
  const last = params[params.length - 1];
  return Array.from({ length: count }, (_, index) => {
    const param = index < params.length ? params[index] : last?.variadic ? last : undefined;
    return param?.type ?? anything;
  });
}

/**
 * What the documentation says `entry` passes the callable in a call with these argument types;
 * undefined where it passes nothing, or names nothing such a call has.
 */
function documented(entry: unknown, types: readonly FormulaType[]): InvokedArgument[] | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const { kind, of, at, from, typeOf } = entry as Record<string, unknown>;
  const passed = (index: unknown) =>
    isPosition(index) && index < types.length ? index : undefined;
  switch (kind) {
    case 'item': {
      const index = passed(of);
      const list = index === undefined ? undefined : stripNullability(types[index] ?? anything);
      return list?.kind === 'list' ? [{ type: list.of }] : undefined;
    }
    case 'argument': {
      const index = passed(at);
      return index === undefined
        ? undefined
        : [{ type: types[index] ?? anything, forwards: index }];
    }
    case 'arguments': {
      const index = passed(from);
      return index === undefined
        ? undefined
        : types.slice(index).map((type, offset) => ({ type, forwards: index + offset }));
    }
    case 'value': {
      if (typeOf === undefined || typeOf === null) return [{ type: anything }];
      const index = passed(typeOf);
      return index === undefined ? undefined : [{ type: types[index] ?? anything }];
    }
    default:
      return undefined;
  }
}

/** Whether the parser passes what `entry` documents in some call the definition takes. */
function takesEffect(params: readonly FunctionParamDefinition[], entry: unknown): boolean {
  const required = params.filter((param) => param.optional !== true && param.variadic !== true);
  const variadic = params[params.length - 1]?.variadic === true;
  const longest = Math.max(params.length, ...indicesOf(entry).map((index) => index + 1));
  for (let count = required.length; count <= (variadic ? longest + 1 : params.length); count++) {
    const types = typesFor(params, count);
    const want = documented(entry, types);
    if (want === undefined) continue;
    try {
      const got = invokedArguments([entry as InvokedArgumentDeclaration], types);
      if (JSON.stringify(got) === JSON.stringify(want)) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Whether the callable receives no more arguments than the call has or the declaration lists. */
function passesOnNoMore(declaration: readonly unknown[]): boolean {
  const furthest = Math.max(0, ...declaration.flatMap(indicesOf));
  for (let count = 0; count <= 2 * furthest + 4; count++) {
    const types = Array.from({ length: count }, () => anything);
    const got = invokedArguments(declaration as InvokedArgumentDeclaration[], types);
    if (got.length > Math.max(count, declaration.length)) return false;
  }
  return true;
}

function parserApplies(
  layout: { params: FunctionParamDefinition[]; call: string },
  declaration: unknown,
): boolean {
  const def = subject(layout.params, declaration);
  if (!parses(layout.call, handing(def))) return false;
  // Declaring nothing (absent, or `null`) is applied as no declaration, in any layout.
  if (declaration === undefined || declaration === null) return true;
  if (!Array.isArray(declaration)) return false;
  if (callablesApplied(layout) !== 1) return false;
  if (!declaration.every((entry) => takesEffect(layout.params, entry))) return false;
  return passesOnNoMore(declaration);
}

function registrationAccepts(params: FunctionParamDefinition[], declaration: unknown): boolean {
  try {
    coreRegistry().registerFunction(subject(params, declaration));
    return true;
  } catch {
    return false;
  }
}

describe('declared invocations', () => {
  it('are accepted by registration exactly when the parser applies them as written', () => {
    const mismatches: unknown[] = [];
    const accepted: string[] = [];
    let refused = 0;
    for (const [name, layout] of Object.entries(LAYOUTS)) {
      for (const declaration of DECLARATIONS) {
        const registers = registrationAccepts(layout.params, declaration);
        const applies = parserApplies(layout, declaration);
        if (registers !== applies) {
          mismatches.push({ layout: name, declaration, registers, applies });
        }
        if (!registers) {
          refused++;
          continue;
        }
        accepted.push(`${name} ${JSON.stringify(declaration)}`);
        // What registration accepts and stores, the parser applies without throwing.
        const registry = coreRegistry();
        registry.registerFunction(subject(layout.params, declaration));
        if (!parses(layout.call, registry)) {
          mismatches.push({ layout: name, declaration, stored: 'parse throws' });
        }
      }
    }
    expect(mismatches).toStrictEqual([]);
    // Not vacuous: both answers occur, and the cases this rule turns on are among them.
    expect(refused).toBeGreaterThan(100);
    expect(accepted.length).toBeGreaterThan(30);
    for (const accepts of [
      // An argument written before the callable, and the callable itself, passed on.
      'between [{"kind":"argument","at":0}]',
      'between [{"kind":"argument","at":1}]',
      'last [{"kind":"argument","at":0}]',
      'between [{"kind":"value","typeOf":1}]',
      'between [{"kind":"value","typeOf":null}]',
      'between null',
      'variadic [{"kind":"argument","at":4}]',
      'between [{"kind":"value"},{"kind":"arguments","from":1}]',
    ]) {
      expect(accepted, accepts).toContain(accepts);
    }
    for (const refuses of [
      'between [{"kind":"argument","at":3}]',
      'between [{"kind":"item","of":2}]',
      'between [{"kind":"value","typeOf":1.5}]',
      'between [{"kind":"value"},{"kind":"value"},{"kind":"arguments","from":1}]',
      'between [null]',
      'between {}',
      'two []',
      'loose []',
    ]) {
      expect(accepted, refuses).not.toContain(refuses);
    }
  });
});
