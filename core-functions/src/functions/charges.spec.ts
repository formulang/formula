import * as coreFunctions from '@formulang/core-functions';
import type { FunctionParamDefinition, MutableFormulaRegistry } from '@formulang/definitions';
import { FormulaTypes, optimizeRule } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleOutputAsync } from '@formulang/runner';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import baseline from '../../../scripts/compat/baseline-1.0.0.json';
import harness from '../../../scripts/compat/harness.js';
import { createTestRuntime, evalErrors, evalFormulaOutput } from '../test-helpers/eval-formula';

/**
 * The table under "Charges" in docs/functions.md, and the conditions it states, held against the
 * runtime: for each function the core registry adds to 1.0.0, read from the live registry, the
 * cost and the steps a call charges, computed from the table's own formulas for inputs of each
 * kind its parameters take, and what the runtime charges instead under each condition. The
 * runner's limits make every charge observable: a call raises `FUNCTION_COST_LIMIT_EXCEEDED`
 * exactly when its own cost is above `maxFunctionCostUnits`, an evaluation raises
 * `COST_LIMIT_EXCEEDED` exactly when all it is charged is above `maxTotalCostUnits`, and
 * `EVAL_LIMIT_EXCEEDED` exactly when its steps are more than `maxEvaluationSteps`.
 */

/** The names the core registry adds to those of 1.0.0, read from the live registry. */
const ADDED: string[] = harness.addedFunctionNames({ coreFunctions }, baseline.functionNames);

const DOCS = readFileSync(new URL('../../../docs/functions.md', import.meta.url), 'utf8');
const PRACTICES = readFileSync(new URL('../../../docs/best-practices.md', import.meta.url), 'utf8');

const QUANTITIES = ['T', 'E', 'N', 'M', 'C'] as const;
type Quantity = (typeof QUANTITIES)[number];
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
  return QUANTITIES.filter((quantity) => new RegExp(`\\b${quantity}\\b`).test(cell));
}

/** A formula of the table, a code span over the quantities, as a function of them. */
function formula(cell: string): (quantities: Quantities) => number {
  const span = /^`([^`]+)`$/.exec(cell);
  expect(span, cell).not.toBeNull();
  const source = (span as RegExpExecArray)[1].replace(/×/g, '*').replace(/\bmin\(/g, 'Math.min(');
  expect(source.replace(/Math\.min\(/g, '('), cell).toMatch(/^[0-9.+*(), TENMC]+$/);
  const run = new Function(...QUANTITIES, `return ${source};`) as (...values: number[]) => number;
  return (quantities) => run(...QUANTITIES.map((quantity) => quantities[quantity]));
}

/** The parameters each quantity of the table reads, as the text under the table names them. */
const READS: Record<'T' | 'E' | 'N', readonly string[]> = {
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

/** A call: what it gives its parameters beyond the valid ones. */
type Case = { given: Record<string, unknown> };

/** `FILTER_BY`'s cases: keys its operator is called for, none, and arguments that fail. */
const FILTER_BY_CASES: readonly Case[] = [
  { given: {} },
  { given: { list: [], keys: [] } },
  { given: { list: [1, 2, 3], keys: [5, 0, 5] } },
  { given: { list: Array(1000).fill(1), keys: Array(1000).fill(1) } },
  { given: { list: [1], keys: [1, 2] } },
  { given: { list: null, keys: [1] } },
  { given: { list: [1, 2], keys: null } },
  { given: { list: ['a'], keys: 'x' } },
];

function paramOf(params: Param[], names: readonly string[]): Param | undefined {
  return params.find((param) => names.includes(param.name));
}

/** The cases of a function: its valid call, then each kind of text, extra list and list. */
function casesOf(name: string, params: Param[]): Case[] {
  if (name === 'FILTER_BY') return [...FILTER_BY_CASES];
  const cases: Case[] = [{ given: {} }];
  const text = paramOf(params, READS.T);
  const extra = paramOf(params, READS.E);
  const list = paramOf(params, READS.N);
  if (text) for (const value of TEXTS) cases.push({ given: { [text.name]: value } });
  if (text && extra) {
    for (const value of EXTRAS) {
      cases.push({ given: { [text.name]: 'a'.repeat(1000), [extra.name]: value } });
    }
  }
  if (list) for (const value of LISTS) cases.push({ given: { [list.name]: value } });
  return cases;
}

const VARIABLES = ['v0', 'v1', 'v2', 'v3', 'v4', 'w0', 'w1', 'w2', 'w3', 'w4', 'rows'];

function setup(registry: MutableFormulaRegistry): void {
  for (const variable of VARIABLES) {
    registry.registerVariable({
      name: variable,
      description: 'A charge argument.',
      type: FormulaTypes.any(true),
    });
  }
}

const runtime = createTestRuntime(setup);
const { registry } = runtime;

function paramsOf(name: string): Param[] {
  const definitions = registry.listFunctionsByName(name);
  expect(definitions, name).toHaveLength(1);
  return definitions[0].params.map((param, index) => ({ ...param, index }));
}

/** The signature id a name or an operator token resolves to, as the higher-order functions find it. */
function signatureOf(name: string): string {
  const operator = registry.getOperator(name);
  if (operator) return operator.functionSignatureId;
  const found = registry
    .listFunctionsByName(name)
    .find((def) => runtime.implementations.get(def.signatureId) !== undefined);
  expect(found, name).toBeDefined();
  return (found as { signatureId: string }).signatureId;
}

/** A callee's own estimate for these arguments, or 0.05 without one, as the runner reads it. */
function estimateOf(name: string, args: unknown[]): number {
  const implementation = runtime.implementations.get(signatureOf(name));
  const raw = implementation?.estimateCostsInSeconds?.(args);
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0.05;
}

/** What the runner charges a call of a function the table does not hold, written in a formula. */
function chargeOf(name: string, args: unknown[]): number {
  return registry.getFunction(signatureOf(name))?.controlFlow ? 0.05 : estimateOf(name, args);
}

/** A call of `name`: its source and its variables, under a prefix, and the values it gives. */
type Call = {
  source: string;
  variables: Record<string, unknown>;
  values: Map<string, unknown>;
  /** The nodes of its arguments, one each. */
  argNodes: number;
};

/**
 * The call of a case: each parameter up to the last one given or required, a literal where it is
 * written as one, a variable otherwise, named with `prefix` and the parameter's position.
 */
function callOf(name: string, given: Record<string, unknown>, prefix = 'v'): Call {
  const params = paramsOf(name);
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
    variables[`${prefix}${param.index}`] = values.get(param.name) ?? null;
    args.push(`${prefix}${param.index}`);
  }
  return { source: `${name}(${args.join('; ')})`, variables, values, argNodes: args.length };
}

/** Whether the arguments of a FILTER_BY call pass every check: then it calls its operator. */
function filterByCalls(values: Map<string, unknown>): unknown[] {
  const list = values.get('list');
  const keys = values.get('keys');
  if (!Array.isArray(list) || !Array.isArray(keys) || list.length !== keys.length) return [];
  if (list.length > 1000) return [];
  return keys;
}

/** The quantities of a call, read from the values it gives, as the text under the table says. */
function quantitiesOf(name: string, values: Map<string, unknown>): Quantities {
  const params = paramsOf(name);
  const read = (quantity: 'T' | 'E' | 'N') => {
    const param = paramOf(params, READS[quantity]);
    return param === undefined ? undefined : values.get(param.name);
  };
  const text = read('T');
  const extra = read('E');
  const list = read('N');
  const called = name === 'FILTER_BY' ? filterByCalls(values) : [];
  const operator = LITERAL[`${name}.operator`];
  const operatorValue = values.get('operatorValue');
  return {
    T: typeof text === 'string' ? text.length : 50,
    E: Array.isArray(extra) ? extra.length : 0,
    N: Array.isArray(list) ? list.length : 10,
    M: called.length,
    C: called.reduce<number>(
      (sum, key) =>
        sum + estimateOf(operator, operatorValue == null ? [key] : [key, operatorValue]),
      0,
    ),
  };
}

const CHARGES = readCharges(DOCS);

/** What a call costs in all, by its row, and what its own call costs (all but `C`). */
function costOf(name: string, values: Map<string, unknown>): { all: number; own: number } {
  const quantities = quantitiesOf(name, values);
  const cost = formula((CHARGES.get(name) as Row).cost);
  return { all: cost(quantities), own: cost({ ...quantities, C: 0 }) };
}

/** The steps a call takes by its row, its node's included. */
function stepsOf(name: string, values: Map<string, unknown>): number {
  return formula((CHARGES.get(name) as Row).steps)(quantitiesOf(name, values));
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

/** Holds an evaluation to `cost` in all: no limit error a billionth above it, one a billionth below. */
async function holdsCost(
  where: string,
  source: string,
  variables: Record<string, unknown>,
  cost: number,
) {
  expect(
    await errorsUnder(source, variables, { maxTotalCostUnits: cost * (1 + 1e-9) }),
    `${where}: under ${cost}`,
  ).not.toContain('COST_LIMIT_EXCEEDED');
  expect(
    await errorsUnder(source, variables, { maxTotalCostUnits: cost * (1 - 1e-9) }),
    `${where}: below ${cost}`,
  ).toContain('COST_LIMIT_EXCEEDED');
}

/** Holds an evaluation to `steps` exactly: no limit error at them, one at a step fewer. */
async function holdsSteps(
  where: string,
  source: string,
  variables: Record<string, unknown>,
  steps: number,
) {
  expect(
    await errorsUnder(source, variables, { maxEvaluationSteps: steps }),
    `${where}: at ${steps} steps`,
  ).not.toContain('EVAL_LIMIT_EXCEEDED');
  expect(
    await errorsUnder(source, variables, { maxEvaluationSteps: steps - 1 }),
    `${where}: at ${steps - 1} steps`,
  ).toContain('EVAL_LIMIT_EXCEEDED');
}

/**
 * Two calls in a `LIST`, after a first copy of the first one, so that both stand where the same
 * type is expected of them (LIST's variadic parameter types its first argument alone, so that copy
 * is charged as well): what the formula is charged, the second call answered from the cache or
 * not.
 */
async function holdsPair(where: string, first: Call, second: Call, cached: boolean, name: string) {
  const source = `LIST(${first.source}; ${first.source}; ${second.source})`;
  const variables = { ...first.variables, ...second.variables };
  const { all } = costOf(name, first.values);
  const list = chargeOf('LIST', [null, null, null]);
  const last = cached ? 0 : costOf(name, second.values).all;
  await holdsCost(where, source, variables, list + 2 * all + last);
  const steps = stepsOf(name, first.values) + first.argNodes;
  await holdsSteps(
    where,
    source,
    variables,
    1 + 2 * steps + (cached ? 1 : stepsOf(name, second.values)) + second.argNodes,
  );
}

/**
 * The cache's bounds as the conditions under the table state them: the longest text it keys, the
 * longest list it keys by its members' values, and how many members of a list it reads for such
 * texts. The cells below are built from these numbers, so a condition that states another bound
 * than the runtime's fails them.
 */
function readCacheBounds(docs: string): { text: number; byValue: number; scanned: number } {
  const section = docs.slice(docs.indexOf('## Charges'), docs.indexOf('## Operator aliases'));
  const text = /`maxCacheableStringLength`\s+\((\d+)\s+code\s+units\s+by\s+default\)/.exec(section);
  const byValue = /a\s+list\s+of\s+at\s+most\s+(\d+)\s+members/.exec(section);
  const scanned = /among\s+the\s+first\s+(\d+)\s+members\s+the\s+cache\s+reads/.exec(section);
  expect([text, byValue, scanned], 'the bounds the conditions state').not.toContain(null);
  return {
    text: Number((text as RegExpExecArray)[1]),
    byValue: Number((byValue as RegExpExecArray)[1]),
    scanned: Number((scanned as RegExpExecArray)[1]),
  };
}

const BOUNDS = readCacheBounds(DOCS);

/** The values of a call with each list it gives at `length` members (FILTER_BY's keys alike). */
function widened(name: string, length: number): Record<string, unknown> {
  const params = paramsOf(name);
  const out: Record<string, unknown> = {};
  for (const param of params) {
    const value = VALID[name][param.name];
    if (Array.isArray(value)) out[param.name] = Array(length).fill(value[value.length - 1]);
  }
  return out;
}

/** The values of a call with a text past the cache's bound: its text, or the first list item. */
function long(name: string): Record<string, unknown> {
  const params = paramsOf(name);
  const text = paramOf(params, READS.T);
  const past = 'a'.repeat(BOUNDS.text + 1);
  if (text) return { [text.name]: past };
  const list = paramOf(params, READS.N) as Param;
  return { [list.name]: [past, ...(VALID[name][list.name] as unknown[]).slice(1)] };
}

/** The values of a call whose list holds a list (FILTER_BY's keys one long alike). */
function nested(name: string): Record<string, unknown> | undefined {
  const params = paramsOf(name);
  const list = paramOf(params, READS.N);
  if (list === undefined) return undefined;
  const out: Record<string, unknown> = { [list.name]: [[1]] };
  const keys = VALID[name].keys;
  if (Array.isArray(keys)) out.keys = [keys[0]];
  return out;
}

/** A copy of `call` whose variables carry another prefix, so its values are other objects. */
function copied(name: string, given: Record<string, unknown>): Call {
  return callOf(name, JSON.parse(JSON.stringify(given)) as Record<string, unknown>, 'w');
}

describe('the charges of the added functions, as the table under "Charges" states them', () => {
  it('has one row for each added function, whose formulas name only quantities its parameters give', () => {
    expect(ADDED.length).toBeGreaterThan(0);
    expect([...CHARGES.keys()].sort()).toStrictEqual([...ADDED].sort());
    expect(Object.keys(VALID).sort()).toStrictEqual([...ADDED].sort());
    for (const name of ADDED) {
      const row = CHARGES.get(name) as Row;
      const params = paramsOf(name);
      for (const quantity of [...named(row.cost), ...named(row.steps)]) {
        if (quantity === 'M' || quantity === 'C') expect(name, row.cost).toBe('FILTER_BY');
        else expect(paramOf(params, READS[quantity]), `${name}: ${quantity}`).toBeDefined();
      }
    }
  });

  for (const name of ADDED) {
    it(`${name}: charges the cost and the steps its row states`, async () => {
      for (const { given } of casesOf(name, paramsOf(name))) {
        const call = callOf(name, given);
        const { source, variables, values } = call;
        const where = `${source} with ${JSON.stringify(given).slice(0, 80)}`;
        const { all, own } = costOf(name, values);
        expect(
          await errorsUnder(source, variables, { maxFunctionCostUnits: own * (1 + 1e-9) }),
          `${where}: under its own cost`,
        ).not.toContain('FUNCTION_COST_LIMIT_EXCEEDED');
        expect(
          await errorsUnder(source, variables, { maxFunctionCostUnits: own * (1 - 1e-9) }),
          `${where}: below its own cost`,
        ).toContain('FUNCTION_COST_LIMIT_EXCEEDED');
        await holdsCost(where, source, variables, all);
        await holdsSteps(where, source, variables, stepsOf(name, values) + call.argNodes);
      }
    });
  }
});

describe('the conditions under which the runtime charges a call otherwise, for every added function', () => {
  for (const name of ADDED) {
    it(`${name}: answers a second call from its cache, but past the cache's bounds or from another list`, async () => {
      // The same short arguments twice: the second call is answered from the cache.
      await holdsPair('short, twice', callOf(name, {}), callOf(name, {}), true, name);
      // Equal short values in other variables are the same arguments by value.
      await holdsPair('short, in two variables', callOf(name, {}), copied(name, {}), true, name);
      // A text past maxCacheableStringLength: never answered from the cache.
      await holdsPair(
        'long text, twice',
        callOf(name, long(name)),
        callOf(name, long(name)),
        false,
        name,
      );
      const wide = widened(name, BOUNDS.byValue + 1);
      if (Object.keys(wide).length > 0) {
        // Longer lists are keyed by identity: the same variable is, an equal one is not.
        await holdsPair('a longer list, twice', callOf(name, wide), callOf(name, wide), true, name);
        await holdsPair(
          'a longer list, in two variables',
          callOf(name, wide),
          copied(name, wide),
          false,
          name,
        );
        // At the bound, equal lists in two variables are the same by value.
        const atBound = widened(name, BOUNDS.byValue);
        await holdsPair(
          'a list at the bound, in two variables',
          callOf(name, atBound),
          copied(name, atBound),
          true,
          name,
        );
      }
      const holding = nested(name);
      if (holding !== undefined) {
        // A list that holds a list is keyed by identity however short.
        await holdsPair(
          'a list holding a list, in two variables',
          callOf(name, holding),
          copied(name, holding),
          false,
          name,
        );
      }
    });

    it(`${name}: charges nothing of its own for a call EACH makes`, async () => {
      const params = paramsOf(name);
      const [first] = params;
      const items = [VALID[name][first.name], VALID[name][first.name], VALID[name][first.name]];
      const rest = callOf(name, {}, 'w');
      // The arguments after the first, as `callOf` writes them, passed on by EACH.
      const written = rest.source
        .slice(name.length + 1, -1)
        .split('; ')
        .slice(1);
      const variables: Record<string, unknown> = { ...rest.variables, v0: items };
      delete variables[`w${first.index}`];
      const source = `EACH(${['v0', `"${name}"`, ...written].join('; ')})`;
      const extras = written.map((arg) => (arg in variables ? variables[arg] : JSON.parse(arg)));
      // FILTER_BY still charges the calls it makes of its operator, and takes its keys' steps.
      const inside = items.map((item) => {
        const values = new Map(rest.values);
        values.set(first.name, item);
        return name === 'FILTER_BY'
          ? { cost: quantitiesOf(name, values).C, steps: quantitiesOf(name, values).M }
          : { cost: 0, steps: 0 };
      });
      const cost =
        chargeOf('EACH', [items, name, ...extras]) +
        inside.reduce((sum, each) => sum + each.cost, 0);
      await holdsCost(source, source, variables, cost);
      const steps =
        1 + 2 + written.length + items.length + inside.reduce((sum, each) => sum + each.steps, 0);
      await holdsSteps(source, source, variables, steps);
    });
  }

  it('reads a list for a long text only as far as the members the conditions state', async () => {
    // SENTENCES' keep tokens carry no bound of their own, so a long one can stand in the list: in
    // the members the cache reads, the call is never answered from it; past them, the same list
    // read twice is.
    const past = 'a'.repeat(BOUNDS.text + 1);
    const within = [...Array<string>(BOUNDS.scanned - 1).fill('t'), past];
    const beyond = [...Array<string>(BOUNDS.scanned).fill('t'), past];
    await holdsPair(
      'a long text among the members read',
      callOf('SENTENCES', { keep: within }),
      callOf('SENTENCES', { keep: within }),
      false,
      'SENTENCES',
    );
    await holdsPair(
      'a long text past the members read',
      callOf('SENTENCES', { keep: beyond }),
      callOf('SENTENCES', { keep: beyond }),
      true,
      'SENTENCES',
    );
  });

  it('charges nothing of its own for a call FILTER, FILTER_PROPERTY or REDUCE makes', async () => {
    const texts = ['Ab c', 'x', 'c'];
    const cases: Array<{
      source: string;
      variables: Record<string, unknown>;
      cost: number;
      steps: number;
    }> = [
      {
        source: 'FILTER(v0; "CONTAINS_ANY"; v1)',
        variables: { v0: texts, v1: ['c'] },
        cost: chargeOf('FILTER', [texts, 'CONTAINS_ANY', ['c']]),
        steps: 1 + 3 + texts.length,
      },
      {
        source: 'FILTER_PROPERTY(rows; "t"; "CONTAINS_ANY"; v1)',
        variables: { rows: texts.map((t) => ({ t })), v1: ['c'] },
        cost: chargeOf('FILTER_PROPERTY', [texts.map((t) => ({ t })), 't', 'CONTAINS_ANY', ['c']]),
        steps: 1 + 4 + texts.length,
      },
      {
        source: 'REDUCE(v1; v0; "TAKE")',
        variables: { v0: [1, 2], v1: [5, 6, 7] },
        cost: chargeOf('REDUCE', [[5, 6, 7], [1, 2], 'TAKE']),
        steps: 1 + 3 + 2,
      },
    ];
    for (const { source, variables, cost, steps } of cases) {
      await holdsCost(source, source, variables, cost);
      await holdsSteps(source, source, variables, steps);
    }
  });

  it('answers a call from a cache the host passes, in a later evaluation, at no cost', async () => {
    const cache = new Map<string, unknown>();
    const evaluate = async (limits: Record<string, number>) => {
      const fresh = createTestRuntime(setup);
      const parsed = parseFormula('WORD_COUNT(v0)', { registry: fresh.registry });
      const out = await evaluateRuleOutputAsync(
        optimizeRule(parsed, { registry: fresh.registry }),
        {
          registry: fresh.registry,
          resolver: fresh.implementations,
          variables: { v0: 'a b' },
          limits,
          cache,
        },
      );
      return out.errors.map((error) => error.code);
    };
    // Charged on the first evaluation: refused under a limit below its cost, and not stored.
    expect(await evaluate({ maxTotalCostUnits: 1e-12 })).toContain('COST_LIMIT_EXCEEDED');
    expect(await evaluate({})).toStrictEqual([]);
    // Answered from the cache the second time, so nothing is charged.
    expect(await evaluate({ maxTotalCostUnits: 1e-12 })).toStrictEqual([]);
  });

  it('runs the examples of best practices §4.4, under the default limits', async () => {
    const lines = PRACTICES.split('\n');
    const start = lines.findIndex((line) => line.startsWith('### 4.4 '));
    const end = lines.findIndex((line, index) => index > start && line.startsWith('### '));
    // Each statement from its `await` to the line that closes it with `); // ...`.
    const statements: string[] = [];
    for (let index = start; index < end; index++) {
      if (!/^await (evalOk|evalErrors)\(/.test(lines[index])) continue;
      let last = index;
      while (last < end && !/\); \/\/ .*$/.test(lines[last])) last += 1;
      statements.push(lines.slice(index, last + 1).join('\n'));
      index = last;
    }
    expect(statements.length, 'the examples').toBeGreaterThanOrEqual(2);
    for (const statement of statements) {
      const [, helper, call, comment] = /^await (evalOk|evalErrors)\(([\s\S]*)\); \/\/ (.*)$/.exec(
        statement,
      ) as RegExpExecArray;
      const [source, variables] = new Function(`return [${call}];`)() as [
        string,
        Record<string, unknown>,
      ];
      const stated = JSON.parse(comment) as unknown;
      if (helper === 'evalErrors') {
        expect(await evalErrors(source, variables), statement).toStrictEqual(stated);
      } else {
        const { output, errors } = await evalFormulaOutput(source, variables);
        expect(errors, statement).toStrictEqual([]);
        expect(isDeepStrictEqual(output.value, stated), statement).toBe(true);
      }
    }
  });
});
