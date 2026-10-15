import type {
  FormulaRegistry,
  FormulaType,
  FunctionDefinition,
  FunctionParamDefinition,
} from '@formulang/definitions';
import {
  createRegistry,
  FormulaErrorCodes,
  FormulaTypes,
  registerCoreFormulaDefinitions,
  stripNullability,
} from '@formulang/definitions';
import { describe, expect, it } from 'vitest';
import { parseFormula } from './index';

/**
 * One rule says where a literal is checked and against what (`literalCheckAt`): the parser reads it
 * for a call written in the formula and for a callable a higher-order call passes on, at any depth
 * its walk follows, and registration reads it for a `literalValues` list, with the parser's two
 * checks of an argument's type (`argumentSelects`, `argumentFits`). This spec drives the parser over
 * a matrix — the parameter a literal reaches, on a definition alone or beside a sibling overload ×
 * the higher-order function that passes it on, with its callable parameter literal-only or not ×
 * the literal, listed or not, or a value in its place — and compares every error code the parser
 * reports, written directly, passed on one level and passed on two levels, with a table written by
 * hand. The table gives the same codes at every level for every list registration takes, and
 * registration takes a list exactly there.
 */

const L = FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED;
const E = FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE;
const A = FormulaErrorCodes.ARGUMENT_TYPE_MISMATCH;
const N = FormulaErrorCodes.NO_MATCHING_OVERLOAD;

/** The codes of a formula written directly, passed on one level, and passed on two levels. */
type Levels = readonly [direct: readonly string[], one: readonly string[], two: readonly string[]];

/** The codes for the listed literal, the unlisted one, and a value in place of a literal. */
type Cells = { readonly listed: Levels; readonly unlisted: Levels; readonly value: Levels };

const everywhere = (codes: readonly string[]): Levels => [codes, codes, codes];

/** The list is read alike at every level: the unlisted literal is refused, a value is no literal. */
const CHECKED: Cells = {
  listed: everywhere([]),
  unlisted: everywhere([L]),
  value: everywhere([E]),
};

/** Nothing is checked at any level. */
const UNCHECKED: Cells = {
  listed: everywhere([]),
  unlisted: everywhere([]),
  value: everywhere([]),
};

/** A literal-only parameter without a list: a value is refused written, and reaches the function passed on, as on 1.0.0. */
const WRITTEN_ONLY: Cells = {
  listed: everywhere([]),
  unlisted: everywhere([]),
  value: [[E], [], []],
};

/**
 * A list on a type no string literal fits, on a definition alone: the bound call refuses the
 * literal's type, the callable it is passed to matches no overload for it, and two levels away,
 * where no overload is chosen, only the list is read.
 */
const TYPE_REFUSED_ALONE: Cells = {
  listed: [[A], [N], []],
  unlisted: [[A, L], [N, L], [L]],
  value: everywhere([E]),
};

/** The same list beside a sibling overload: the written call matches no overload either. */
const TYPE_REFUSED_BESIDE: Cells = {
  listed: [[N], [N], []],
  unlisted: [[N], [N, L], [L]],
  value: everywhere([E]),
};

/**
 * A parameter a literal can reach: TARGET's parameter at `position`, after a subject of any type,
 * with the codes TARGET gets alone and beside the sibling overload TARGET/v2(flag: boolean).
 */
type Kind = {
  label: string;
  /** TARGET's parameters after its subject. */
  params: FunctionParamDefinition[];
  /** Where the literal goes: 1, the parameter itself, or 2, an extra argument of a variadic one. */
  position: 1 | 2;
  listed: string;
  unlisted: string;
  alone: Cells;
  beside: Cells;
};

const listing = (type: FormulaType, extra: Partial<FunctionParamDefinition> = {}) => ({
  name: 'mode',
  type,
  literalOnly: true,
  literalValues: ['a', 'b'],
  ...extra,
});

const KINDS: Kind[] = [
  {
    label: 'a text that lists values',
    params: [listing(FormulaTypes.text(false))],
    alone: CHECKED,
    beside: CHECKED,
  },
  {
    label: 'any that lists values',
    params: [listing(FormulaTypes.any(true))],
    alone: CHECKED,
    beside: CHECKED,
  },
  {
    label: 'a template that lists values',
    params: [listing(FormulaTypes.template('T'))],
    alone: CHECKED,
    beside: CHECKED,
  },
  {
    label: 'a template constrained to texts that lists values',
    params: [listing(FormulaTypes.template('T', { constraint: FormulaTypes.text(false) }))],
    alone: CHECKED,
    beside: CHECKED,
  },
  {
    // The bound call takes any argument for a template, but choosing an overload honours the
    // constraint: alone, the call written binds TARGET anyway, the callable passed on one level
    // matches no overload, and two levels away only the list is read.
    label: 'a template constrained to numbers that lists values',
    params: [listing(FormulaTypes.template('T', { constraint: FormulaTypes.number(false) }))],
    alone: { listed: [[], [N], []], unlisted: [[L], [N, L], [L]], value: everywhere([E]) },
    beside: TYPE_REFUSED_BESIDE,
  },
  {
    label: 'a union with text that lists values',
    params: [listing(FormulaTypes.union([FormulaTypes.number(false), FormulaTypes.text(false)]))],
    alone: CHECKED,
    beside: CHECKED,
  },
  {
    label: 'a number that lists values',
    params: [listing(FormulaTypes.number(false))],
    alone: TYPE_REFUSED_ALONE,
    beside: TYPE_REFUSED_BESIDE,
  },
  {
    label: 'a boolean that lists values',
    params: [listing(FormulaTypes.boolean(false))],
    alone: TYPE_REFUSED_ALONE,
    beside: TYPE_REFUSED_BESIDE,
  },
  {
    label: 'a list of texts that lists values',
    params: [listing(FormulaTypes.list(FormulaTypes.text(false)))],
    alone: TYPE_REFUSED_ALONE,
    beside: TYPE_REFUSED_BESIDE,
  },
  {
    label: 'a text that lists values but is not literal-only',
    params: [listing(FormulaTypes.text(false), { literalOnly: false })],
    alone: UNCHECKED,
    beside: UNCHECKED,
  },
  {
    label: 'a literal-only text that lists none',
    params: [{ name: 'mode', type: FormulaTypes.text(false), literalOnly: true }],
    alone: WRITTEN_ONLY,
    beside: WRITTEN_ONLY,
  },
  {
    label: 'a callable that lists the functions it admits',
    params: [listing(FormulaTypes.callable('function'), { literalValues: ['LEN', 'UPPER'] })],
    listed: 'LEN',
    unlisted: 'LOWER',
    alone: CHECKED,
    beside: CHECKED,
  },
  {
    label: 'an extra argument of a variadic text that lists values',
    params: [listing(FormulaTypes.text(false), { variadic: true })],
    position: 2,
    alone: CHECKED,
    beside: CHECKED,
  },
  {
    // 1.0.0 checks only the first argument such a parameter takes.
    label: 'an extra argument of a variadic literal-only text that lists none',
    params: [{ name: 'mode', type: FormulaTypes.text(false), literalOnly: true, variadic: true }],
    position: 2,
    alone: UNCHECKED,
    beside: UNCHECKED,
  },
].map((kind) => ({ position: 1, listed: 'a', unlisted: 'zzz', ...kind }) as Kind);

function target(kind: Kind): FunctionDefinition {
  return {
    signatureId: 'TARGET/v1',
    name: 'TARGET',
    category: 'custom',
    description: 'The function a literal reaches.',
    templates: [{ name: 'T' }],
    params: [{ name: 'subject', type: FormulaTypes.any(true) }, ...kind.params],
    returnType: FormulaTypes.boolean(true),
    purity: 'pure',
  };
}

/** An overload of TARGET that no call of the matrix matches. */
const SIBLING: FunctionDefinition = {
  signatureId: 'TARGET/v2',
  name: 'TARGET',
  category: 'custom',
  description: 'A sibling overload of the function a literal reaches.',
  params: [{ name: 'flag', type: FormulaTypes.boolean(false) }],
  returnType: FormulaTypes.boolean(true),
  purity: 'pure',
};

const SHAPES = [
  { name: 'alone', definitions: (kind: Kind) => [target(kind)] },
  { name: 'beside', definitions: (kind: Kind) => [target(kind), SIBLING] },
] as const;

/**
 * The higher-order functions that pass a written argument on to their callable's second position,
 * with how a call of each writes it one level (`one`) and two levels (`two`, through EACH) away;
 * only EACH passes on a third argument.
 */
const VEHICLES = [
  {
    name: 'EACH',
    one: (args: string) => `EACH(LIST(1); "TARGET"; ${args})`,
    two: (args: string) => `EACH(LIST(LIST(1)); "EACH"; "TARGET"; ${args})`,
    passesThird: true,
  },
  {
    name: 'FILTER',
    one: (args: string) => `FILTER(LIST(1); "TARGET"; ${args})`,
    two: (args: string) => `EACH(LIST(LIST(1)); "FILTER"; "TARGET"; ${args})`,
    passesThird: false,
  },
  {
    name: 'FILTER_PROPERTY',
    one: (args: string) => `FILTER_PROPERTY(rows; "p"; "TARGET"; ${args})`,
    two: (args: string) => `EACH(LIST(rows); "FILTER_PROPERTY"; "p"; "TARGET"; ${args})`,
    passesThird: false,
  },
  {
    name: 'FILTER_BY',
    one: (args: string) => `FILTER_BY(LIST(1); LIST(0); "TARGET"; ${args})`,
    two: (args: string) => `EACH(LIST(LIST(1)); "FILTER_BY"; LIST(0); "TARGET"; ${args})`,
    passesThird: false,
  },
] as const;

/**
 * The core registry with `rows` and `value`, TARGET's definitions handed to the parser as written
 * (as a registry that is not an `InMemoryFormulaRegistry` may hand them, so a definition
 * registration refuses is parsed too), and, with `literalOnlyCallable` false, the vehicle
 * registered again as NAME/v9 with a callable parameter that is not literal-only, the core one
 * retired.
 */
function registryFor(
  definitions: readonly FunctionDefinition[],
  vehicle: string,
  literalOnlyCallable: boolean,
): FormulaRegistry {
  const registry = createRegistry();
  registerCoreFormulaDefinitions(registry);
  registry.registerVariable({ name: 'rows', description: 'Rows.', type: FormulaTypes.any(true) });
  registry.registerVariable({
    name: 'value',
    description: 'A value.',
    type: FormulaTypes.any(true),
  });
  if (!literalOnlyCallable) {
    const [core] = registry.listFunctionsByName(vehicle);
    if (core === undefined) throw new Error(`no ${vehicle}`);
    registry.retireFunction(core.signatureId);
    registry.registerFunction({
      ...core,
      signatureId: `${vehicle}/v9`,
      params: core.params.map((param) =>
        stripNullability(param.type).kind === 'callable' ? { ...param, literalOnly: false } : param,
      ),
    });
  }
  const handing = Object.create(registry) as typeof registry;
  handing.getFunction = (id) =>
    definitions.find((def) => def.signatureId === id) ?? registry.getFunction(id);
  handing.listFunctionsByName = (name) =>
    name.toUpperCase() === 'TARGET' ? [...definitions] : registry.listFunctionsByName(name);
  return handing;
}

/** Every error code a formula gets, in the order the parser reports them. */
function codes(registry: FormulaRegistry, source: string): string[] {
  return parseFormula(source, { registry }).errors.map((error) => error.code);
}

/** TARGET's arguments after its subject for each cell: the listed literal, the unlisted one, a value. */
function argumentsOf(kind: Kind): Array<[keyof Cells, string]> {
  const at = (argument: string) =>
    kind.position === 1 ? argument : `${JSON.stringify(kind.listed)}; ${argument}`;
  return [
    ['listed', at(JSON.stringify(kind.listed))],
    ['unlisted', at(JSON.stringify(kind.unlisted))],
    ['value', at('value')],
  ];
}

/** Registers the core definitions and `definitions`; false where registration throws. */
function registers(definitions: readonly FunctionDefinition[]): boolean {
  try {
    const registry = createRegistry();
    registerCoreFormulaDefinitions(registry);
    for (const def of definitions) registry.registerFunction(def);
    return true;
  } catch {
    return false;
  }
}

describe('where a literal is checked, by one rule', () => {
  it('reports the codes of the table written directly, one level and two levels away', () => {
    let cells = 0;
    for (const kind of KINDS) {
      for (const shape of SHAPES) {
        const expected = kind[shape.name];
        for (const vehicle of VEHICLES) {
          if (kind.position === 2 && !vehicle.passesThird) continue;
          for (const literalOnlyCallable of [true, false]) {
            const registry = registryFor(
              shape.definitions(kind),
              vehicle.name,
              literalOnlyCallable,
            );
            for (const [name, args] of argumentsOf(kind)) {
              const [direct, one, two] = expected[name];
              const cell = `${kind.label}, ${shape.name}, ${vehicle.name}${literalOnlyCallable ? '' : '/v9'}, ${name}`;
              expect(codes(registry, `TARGET(1; ${args})`), `${cell}, written`).toStrictEqual(
                direct,
              );
              // Where the callable parameter is not literal-only, the parser follows no callable:
              // nothing is checked one or two levels away.
              expect(codes(registry, vehicle.one(args)), `${cell}, one level`).toStrictEqual(
                literalOnlyCallable ? one : [],
              );
              expect(codes(registry, vehicle.two(args)), `${cell}, two levels`).toStrictEqual(
                literalOnlyCallable ? two : [],
              );
              cells++;
            }
          }
        }
      }
    }
    // Every cell visited: 12 parameters through four vehicles and 2 through EACH, each alone and
    // beside the sibling, with both kinds of callable parameter, for three arguments.
    expect(cells).toBe((12 * 4 + 2) * 2 * 2 * 3);
  });

  it('takes a list at registration exactly where the table reads it alike at every level', () => {
    const readAlike = (cells: Cells) => JSON.stringify(cells) === JSON.stringify(CHECKED);
    let accepted = 0;
    for (const kind of KINDS.filter((k) => k.params[0]?.literalValues !== undefined)) {
      const alone = registers([target(kind)]);
      expect(registers([target(kind), SIBLING]), kind.label).toBe(alone);
      expect(alone, kind.label).toBe(readAlike(kind.alone) && readAlike(kind.beside));
      if (alone) accepted++;
    }
    // Not vacuous: text, any, both templates that take a text, the union, the callable and the
    // variadic text register; the template constrained to numbers, the number, the boolean, the
    // list and the parameter that is not literal-only do not.
    expect(accepted).toBe(7);
  });
});
