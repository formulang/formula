import * as coreFunctions from '@formulang/core-functions';
import type { FunctionParamDefinition, MutableFormulaRegistry } from '@formulang/definitions';
import { FormulaTypes } from '@formulang/definitions';
import { readFileSync } from 'node:fs';
import baseline from '../../../scripts/compat/baseline-1.0.0.json';
import harness from '../../../scripts/compat/harness.js';
import { createTestRuntime, evalFormulaOutput } from '../test-helpers/eval-formula';

/**
 * The table under "Charges" in docs/functions.md, held against the runtime: for each function the
 * core registry adds to 1.0.0, read from the live registry, the cost and the steps a call charges,
 * computed from the table's own formulas for inputs of each kind its parameters take. The runner's
 * limits make both observable: a call raises `FUNCTION_COST_LIMIT_EXCEEDED` exactly when its cost
 * is above `maxFunctionCostUnits`, and an evaluation raises `EVAL_LIMIT_EXCEEDED` exactly when its
 * steps are more than `maxEvaluationSteps`.
 */

/** The names the core registry adds to those of 1.0.0, read from the live registry. */
const ADDED: string[] = harness.addedFunctionNames({ coreFunctions }, baseline.functionNames);

const DOCS = readFileSync(new URL('../../../docs/functions.md', import.meta.url), 'utf8');

type Quantity = 'T' | 'E' | 'N' | 'M';
type Quantities = Record<Quantity, number>;
type Row = { cost: string; steps: string };
type Param = FunctionParamDefinition & { index: number };

/** The rows of the table under "## Charges", by function name. */
function readCharges(docs: string): Map<string, Row> {
  const lines = docs.split('\n');
  const start = lines.indexOf('## Charges');
  expect(start, 'the Charges section').toBeGreaterThan(-1);
  let index = start + 1;
  while (index < lines.length && !lines[index].startsWith('|')) index += 1;
  expect(lines[index], 'the table header').toMatch(
    /^\| Function +\| Cost of a call +\| Steps of a call +\|$/,
  );
  const rows = new Map<string, Row>();
  for (index += 2; index < lines.length && lines[index].startsWith('|'); index += 1) {
    const cells = lines[index]
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    expect(cells, lines[index]).toHaveLength(3);
    const names = [...cells[0].matchAll(/`([A-Z0-9_]+)`/g)].map((match) => match[1]);
    expect(names.length, lines[index]).toBeGreaterThan(0);
    for (const name of names) {
      expect(rows.has(name), `${name}: one row`).toBe(false);
      rows.set(name, { cost: cells[1], steps: cells[2] });
    }
  }
  return rows;
}

/** The quantities a formula of the table names. */
function named(cell: string): Quantity[] {
  return (['T', 'E', 'N', 'M'] as const).filter((quantity) =>
    new RegExp(`\\b${quantity}\\b`).test(cell),
  );
}

/** A formula of the table, a code span over `T`, `E`, `N` and `M`, as a function of them. */
function formula(cell: string): (quantities: Quantities) => number {
  const span = /^`([^`]+)`$/.exec(cell);
  expect(span, cell).not.toBeNull();
  const source = (span as RegExpExecArray)[1].replace(/×/g, '*').replace(/\bmin\(/g, 'Math.min(');
  expect(source.replace(/Math\.min\(/g, '('), cell).toMatch(/^[0-9.+*(), TENM]+$/);
  const run = new Function('T', 'E', 'N', 'M', `return ${source};`) as (
    ...values: number[]
  ) => number;
  return ({ T, E, N, M }) => run(T, E, N, M);
}

/** The parameters each quantity of the table reads, as the text under the table names them. */
const READS: Record<Exclude<Quantity, 'M'>, readonly string[]> = {
  T: ['text', 'markup'],
  E: ['keep', 'phrases', 'items'],
  N: ['list'],
};

/** A call whose every argument passes its check: the values it gives its parameters. */
const VALID: Record<string, Record<string, unknown>> = {
  WORDS: { text: 'Ab c' },
  WORD_COUNT: { text: 'Ab c' },
  LEADING_WORDS: { text: 'Ab c', count: 1 },
  SENTENCES: { text: 'Ab. c' },
  LINES: { text: 'Ab\nc' },
  LINE_COUNT: { text: 'Ab\nc' },
  FIRST_CONTAINED: { text: 'Ab c', phrases: ['c'] },
  CONTAINS_ANY: { text: 'Ab c', phrases: ['c'] },
  MISSING_FROM: { items: ['x'], text: 'Ab c' },
  PLAIN_TEXT: { markup: 'Ab c' },
  MARKDOWN_BLOCKS: { text: 'Ab c' },
  TAKE: { list: [1, 2], count: 1 },
  INDEX_OF: { list: [1, 2], value: 2 },
  FILTER_BY: { list: [1, 2], keys: [5, 0], operatorValue: 0 },
  DISTINCT: { list: [1, 2] },
  GROUP_COUNTS: { list: [1, 2] },
};

/** The literal a parameter written as one takes, where its first admitted value is not wanted. */
const LITERAL: Record<string, string> = {
  'PLAIN_TEXT.format': 'html',
  'MARKDOWN_BLOCKS.kind': 'paragraph',
  'FILTER_BY.operator': '>',
};

/** Texts of each kind: empty, short, long, past the cap, and no text at all. */
const TEXTS: readonly unknown[] = ['', 'abc', 'a'.repeat(1000), 'a'.repeat(60000), null, 5];

/** Lists of `keep`, phrases or items: empty, short, as long as allowed, and no list. */
const EXTRAS: readonly unknown[] = [[], ['x', 'y'], Array(1000).fill('x'), null];

/** Lists of each length, and values that are no list. */
const LISTS: readonly unknown[] = [[], [1, 2, 3], Array(1000).fill(1), null, 'x'];

/** A call: what it gives its parameters beyond the valid ones, and the keys FILTER_BY calls for. */
type Case = { given: Record<string, unknown>; keysCalled: number };

/** `FILTER_BY`'s cases, with the number of keys its operator is called for. */
const FILTER_BY_CASES: readonly Case[] = [
  { given: {}, keysCalled: 2 },
  { given: { list: [], keys: [] }, keysCalled: 0 },
  { given: { list: [1, 2, 3], keys: [5, 0, 5] }, keysCalled: 3 },
  { given: { list: Array(1000).fill(1), keys: Array(1000).fill(1) }, keysCalled: 1000 },
  { given: { list: [1], keys: [1, 2] }, keysCalled: 0 },
  { given: { list: null, keys: [1] }, keysCalled: 0 },
  { given: { list: [1, 2], keys: null }, keysCalled: 0 },
  { given: { list: ['a'], keys: 'x' }, keysCalled: 0 },
];

function paramOf(params: Param[], names: readonly string[]): Param | undefined {
  return params.find((param) => names.includes(param.name));
}

/** The cases of a function: its valid call, then each kind of text, extra list and list. */
function casesOf(name: string, params: Param[]): Case[] {
  if (name === 'FILTER_BY') return [...FILTER_BY_CASES];
  const cases: Case[] = [{ given: {}, keysCalled: 0 }];
  const text = paramOf(params, READS.T);
  const extra = paramOf(params, READS.E);
  const list = paramOf(params, READS.N);
  if (text) for (const value of TEXTS) cases.push({ given: { [text.name]: value }, keysCalled: 0 });
  if (text && extra) {
    for (const value of EXTRAS) {
      cases.push({ given: { [text.name]: 'a'.repeat(1000), [extra.name]: value }, keysCalled: 0 });
    }
  }
  if (list) for (const value of LISTS) cases.push({ given: { [list.name]: value }, keysCalled: 0 });
  return cases;
}

const VARIABLES = ['v0', 'v1', 'v2', 'v3', 'v4'];

function setup(registry: MutableFormulaRegistry): void {
  for (const variable of VARIABLES) {
    registry.registerVariable({
      name: variable,
      description: 'A charge argument.',
      type: FormulaTypes.any(true),
    });
  }
}

/**
 * The formula of a case and its variables: each parameter up to the last one given or required,
 * a literal where it is written as one, a variable otherwise.
 */
function callOf(
  name: string,
  params: Param[],
  given: Record<string, unknown>,
): { source: string; variables: Record<string, unknown>; values: Map<string, unknown> } {
  const values = new Map<string, unknown>(Object.entries({ ...VALID[name], ...given }));
  const last = Math.max(
    ...params
      .filter((param) => !param.optional || values.has(param.name))
      .map((param) => param.index),
  );
  const args: string[] = [];
  const variables: Record<string, unknown> = {};
  for (const param of params.slice(0, last + 1)) {
    const literal = LITERAL[`${name}.${param.name}`] ?? param.literalValues?.[0];
    if (literal !== undefined) {
      args.push(JSON.stringify(literal));
      continue;
    }
    variables[VARIABLES[param.index]] = values.get(param.name) ?? null;
    args.push(VARIABLES[param.index]);
  }
  return { source: `${name}(${args.join('; ')})`, variables, values };
}

/** The codes of the errors an evaluation reports under `limits`, its source compiling cleanly. */
async function errorsUnder(
  source: string,
  variables: Record<string, unknown>,
  limits: Record<string, number>,
): Promise<string[]> {
  const { parsed, compiled, errors } = await evalFormulaOutput(source, variables, {
    setup,
    limits,
  });
  expect(
    [...parsed.errors, ...compiled.errors].map((error) => error.code),
    source,
  ).toStrictEqual([]);
  return errors.map((error) => error.code);
}

const { registry } = createTestRuntime();

function paramsOf(name: string): Param[] {
  const definitions = registry.listFunctionsByName(name);
  expect(definitions, name).toHaveLength(1);
  return definitions[0].params.map((param, index) => ({ ...param, index }));
}

const CHARGES = readCharges(DOCS);

describe('the charges of the added functions, as the table under "Charges" states them', () => {
  it('has one row for each added function, whose formulas name only quantities its parameters give', () => {
    expect(ADDED.length).toBeGreaterThan(0);
    expect([...CHARGES.keys()].sort()).toStrictEqual([...ADDED].sort());
    expect(Object.keys(VALID).sort()).toStrictEqual([...ADDED].sort());
    for (const name of ADDED) {
      const row = CHARGES.get(name) as Row;
      const params = paramsOf(name);
      for (const quantity of [...named(row.cost), ...named(row.steps)]) {
        if (quantity === 'M') expect(name, row.steps).toBe('FILTER_BY');
        else expect(paramOf(params, READS[quantity]), `${name}: ${quantity}`).toBeDefined();
      }
    }
  });

  for (const name of ADDED) {
    it(`${name}: charges the cost and the steps its row states`, async () => {
      const row = CHARGES.get(name) as Row;
      const cost = formula(row.cost);
      const steps = formula(row.steps);
      const params = paramsOf(name);
      for (const { given, keysCalled } of casesOf(name, params)) {
        const { source, variables, values } = callOf(name, params, given);
        const read = (quantity: Exclude<Quantity, 'M'>) => {
          const param = paramOf(params, READS[quantity]);
          return param === undefined ? undefined : values.get(param.name);
        };
        const text = read('T');
        const extra = read('E');
        const list = read('N');
        const quantities: Quantities = {
          T: typeof text === 'string' ? text.length : 50,
          E: Array.isArray(extra) ? extra.length : 0,
          N: Array.isArray(list) ? list.length : 10,
          M: keysCalled,
        };
        const where = `${source} with ${JSON.stringify(given).slice(0, 80)}`;
        const charged = cost(quantities);
        expect(
          await errorsUnder(source, variables, { maxFunctionCostUnits: charged * (1 + 1e-9) }),
          `${where}: under its cost`,
        ).not.toContain('FUNCTION_COST_LIMIT_EXCEEDED');
        expect(
          await errorsUnder(source, variables, { maxFunctionCostUnits: charged * (1 - 1e-9) }),
          `${where}: below its cost`,
        ).toContain('FUNCTION_COST_LIMIT_EXCEEDED');
        // The call's own steps, and one for each argument's node.
        const total = steps(quantities) + source.split(';').length;
        expect(
          await errorsUnder(source, variables, { maxEvaluationSteps: total }),
          `${where}: at its steps`,
        ).not.toContain('EVAL_LIMIT_EXCEEDED');
        expect(
          await errorsUnder(source, variables, { maxEvaluationSteps: total - 1 }),
          `${where}: one step fewer`,
        ).toContain('EVAL_LIMIT_EXCEEDED');
      }
    });
  }
});
