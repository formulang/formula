import type {
  FormulaRegistry,
  FormulaType,
  FunctionDefinition,
  FunctionParamDefinition,
} from '@formulang/definitions';
import {
  admittedValues,
  createRegistry,
  FormulaErrorCodes,
  FormulaTypes,
  literalCheckAt,
  registerCoreFormulaDefinitions,
  stripNullability,
} from '@formulang/definitions';
import { describe, expect, it } from 'vitest';
import { parseFormula } from './index';

/**
 * One rule says where a literal is checked and against what (`literalCheckAt`): the parser reads it
 * for a call written in the formula and for a callable a higher-order call passes on, at any depth
 * its walk follows, and registration reads it for a `literalValues` list. This spec drives the
 * parser over a generated matrix — the parameter a literal reaches × the higher-order function
 * that passes it on, with its callable parameter literal-only or not × the literal, listed or not —
 * and requires the same refusal written directly, passed on one level, and passed on two levels;
 * and it requires registration to take a list exactly where the parser checks a literal against it.
 */

const LITERAL_CODES: readonly string[] = [
  FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED,
  FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE,
];

/** A parameter a literal can reach: TARGET's parameter at `position`, after a subject of any type. */
type Kind = {
  label: string;
  /** TARGET's parameters after its subject. */
  params: FunctionParamDefinition[];
  /** Where the literal goes: 1, the parameter itself, or 2, an extra argument of a variadic one. */
  position: 1 | 2;
  listed: string;
  unlisted: string;
};

const listing = (type: FormulaType, extra: Partial<FunctionParamDefinition> = {}) => ({
  name: 'mode',
  type,
  literalOnly: true,
  literalValues: ['a', 'b'],
  ...extra,
});

const KINDS: Kind[] = [
  { label: 'a text that lists values', params: [listing(FormulaTypes.text(false))] },
  { label: 'any that lists values', params: [listing(FormulaTypes.any(true))] },
  { label: 'a template that lists values', params: [listing(FormulaTypes.template('T'))] },
  {
    label: 'a template constrained to numbers that lists values',
    params: [listing(FormulaTypes.template('T', { constraint: FormulaTypes.number(false) }))],
  },
  {
    label: 'a union with text that lists values',
    params: [listing(FormulaTypes.union([FormulaTypes.number(false), FormulaTypes.text(false)]))],
  },
  { label: 'a number that lists values', params: [listing(FormulaTypes.number(false))] },
  { label: 'a boolean that lists values', params: [listing(FormulaTypes.boolean(false))] },
  {
    label: 'a list of texts that lists values',
    params: [listing(FormulaTypes.list(FormulaTypes.text(false)))],
  },
  {
    label: 'a text that lists values but is not literal-only',
    params: [listing(FormulaTypes.text(false), { literalOnly: false })],
  },
  {
    label: 'a literal-only text that lists none',
    params: [{ name: 'mode', type: FormulaTypes.text(false), literalOnly: true }],
  },
  {
    label: 'a callable that lists the functions it admits',
    params: [listing(FormulaTypes.callable('function'), { literalValues: ['LEN', 'UPPER'] })],
    listed: 'LEN',
    unlisted: 'LOWER',
  },
  {
    label: 'an extra argument of a variadic text that lists values',
    params: [listing(FormulaTypes.text(false), { variadic: true })],
    position: 2,
  },
  {
    label: 'an extra argument of a variadic literal-only text that lists none',
    params: [{ name: 'mode', type: FormulaTypes.text(false), literalOnly: true, variadic: true }],
    position: 2,
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
 * The core registry with `rows`, TARGET handed to the parser as written (as a registry that is not
 * an `InMemoryFormulaRegistry` may hand it, so a definition registration refuses is parsed too),
 * and, with `literalOnlyCallable` false, the vehicle registered again as NAME/v9 with a callable
 * parameter that is not literal-only, the core one retired.
 */
function registryFor(
  def: FunctionDefinition,
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
  handing.getFunction = (id) => (id === def.signatureId ? def : registry.getFunction(id));
  handing.listFunctionsByName = (name) =>
    name.toUpperCase() === def.name ? [def] : registry.listFunctionsByName(name);
  return handing;
}

/** The literal refusals a formula gets: LITERAL_VALUE_NOT_ALLOWED, EXPECTED_STRING_LITERAL_REFERENCE. */
function literalCodes(registry: FormulaRegistry, source: string): string[] {
  return parseFormula(source, { registry })
    .errors.map((error) => error.code)
    .filter((code) => LITERAL_CODES.includes(code));
}

/** TARGET's arguments after its subject, with `literal` at the kind's position. */
function argumentsWith(kind: Kind, literal: string): string {
  return kind.position === 1
    ? JSON.stringify(literal)
    : `"${kind.listed}"; ${JSON.stringify(literal)}`;
}

describe('where a literal is checked, by one rule', () => {
  it('refuses a literal alike written directly, passed on one level and two levels', () => {
    let checked = 0;
    let unchecked = 0;
    for (const kind of KINDS) {
      const def = target(kind);
      // What the rule says of this parameter, read as the parser reads it.
      const rule = literalCheckAt(def.params, kind.position, admittedValues);
      for (const vehicle of VEHICLES) {
        if (kind.position === 2 && !vehicle.passesThird) continue;
        for (const literalOnlyCallable of [true, false]) {
          const registry = registryFor(def, vehicle.name, literalOnlyCallable);
          for (const literal of [kind.listed, kind.unlisted]) {
            const args = argumentsWith(kind, literal);
            const direct = literalCodes(registry, `TARGET(1; ${args})`);
            const one = literalCodes(registry, vehicle.one(args));
            const two = literalCodes(registry, vehicle.two(args));
            const cell = `${kind.label}, ${vehicle.name}${literalOnlyCallable ? '' : '/v9'}, ${literal}`;
            // Written directly, the literal is refused exactly where the rule checks it against
            // admitted values that leave it out.
            const refused =
              rule?.admitted !== undefined && !rule.admitted.includes(literal)
                ? [FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED]
                : [];
            expect(direct, cell).toStrictEqual(refused);
            // Passed on, it is refused as written where the callable parameter is literal-only,
            // and not at all where it is not, at every level alike.
            expect(one, cell).toStrictEqual(literalOnlyCallable ? direct : []);
            expect(two, cell).toStrictEqual(one);
            if (one.length > 0) checked++;
            else unchecked++;
          }
          // A value in place of the literal. Written directly, it is refused wherever the rule
          // checks a literal; passed on, where the parameter also lists admitted values (a
          // literal-only parameter without a list keeps 1.0.0 behaviour there), at every level.
          const args = kind.position === 1 ? 'value' : `"${kind.listed}"; value`;
          const cell = `${kind.label}, ${vehicle.name}${literalOnlyCallable ? '' : '/v9'}, value`;
          const written =
            rule === undefined ? [] : [FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE];
          expect(literalCodes(registry, `TARGET(1; ${args})`), cell).toStrictEqual(written);
          const passed =
            literalOnlyCallable && rule?.admitted !== undefined
              ? [FormulaErrorCodes.EXPECTED_STRING_LITERAL_REFERENCE]
              : [];
          expect(literalCodes(registry, vehicle.one(args)), cell).toStrictEqual(passed);
          expect(literalCodes(registry, vehicle.two(args)), cell).toStrictEqual(passed);
        }
      }
    }
    // Not vacuous: the matrix holds refusals at every level and literals no level checks.
    expect(checked).toBeGreaterThanOrEqual(20);
    expect(unchecked).toBeGreaterThanOrEqual(40);
  });

  it('takes a list at registration exactly where the parser checks a literal against it', () => {
    let accepted = 0;
    for (const kind of KINDS.filter((k) => k.params[0]?.literalValues !== undefined)) {
      const def = target(kind);
      let registers = true;
      try {
        const registry = createRegistry();
        registerCoreFormulaDefinitions(registry);
        registry.registerFunction(def);
      } catch {
        registers = false;
      }
      // The parser checks the literal against the list: a listed literal compiles, written
      // directly, and an unlisted one is refused as not admitted, with no other error.
      const registry = registryFor(def, 'EACH', true);
      const codes = (literal: string) =>
        parseFormula(`TARGET(1; ${argumentsWith(kind, literal)})`, { registry }).errors.map(
          (error) => error.code,
        );
      const checks =
        codes(kind.listed).length === 0 &&
        JSON.stringify(codes(kind.unlisted)) ===
          JSON.stringify([FormulaErrorCodes.LITERAL_VALUE_NOT_ALLOWED]);
      expect(registers, kind.label).toBe(checks);
      if (registers) accepted++;
    }
    // Not vacuous: text, any, both templates, the union, the callable and the variadic text
    // register; the number, the boolean, the list and the parameter that is not literal-only do
    // not.
    expect(accepted).toBe(7);
  });
});
