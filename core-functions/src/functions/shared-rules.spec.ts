import * as coreFunctions from '@formulang/core-functions';
import type {
  FormulaType,
  FunctionParamDefinition,
  MutableFormulaRegistry,
} from '@formulang/definitions';
import { FormulaTypes } from '@formulang/definitions';
import { readFileSync } from 'node:fs';
import baseline from '../../../scripts/compat/baseline-1.0.0.json';
import harness from '../../../scripts/compat/harness.js';
import { createTestRuntime, evalFormulaOutput } from '../test-helpers/eval-formula';

/**
 * Each rule under "Shared rules" in docs/functions.md, run as a cell against every function the
 * core registry adds to 1.0.0 and every parameter it governs, read from the live registry: a
 * function that departs from a rule is red, unless the rule's own opening sentence exempts the
 * parameter by name (a mode, and the operator of `FILTER_BY`, which a formula writes as literals).
 */

/** The names the core registry adds to those of 1.0.0, read from the live registry. */
const ADDED: string[] = harness.addedFunctionNames({ coreFunctions }, baseline.functionNames);

const DOCS = readFileSync(new URL('../../../docs/functions.md', import.meta.url), 'utf8');

/**
 * A value each parameter takes, chosen so that a call with every argument valid gives a result a
 * departure would change. Parameters written as literals are not here: a mode takes the literal
 * in `LITERAL` or its first admitted value.
 */
const VALID: Record<string, Record<string, unknown>> = {
  WORDS: { text: 'Ab c', option: null },
  WORD_COUNT: { text: 'Ab c', option: null },
  LEADING_WORDS: { text: 'Ab c', count: 1, option: null },
  SENTENCES: { text: 'Ab. c', keep: ['Ab.'] },
  LINES: { text: 'Ab\nc' },
  LINE_COUNT: { text: 'Ab\nc' },
  FIRST_CONTAINED: { text: 'Ab c', phrases: ['ab', 'c'], ignoreCase: true },
  CONTAINS_ANY: { text: 'Ab c', phrases: ['ab'], ignoreCase: true },
  MISSING_FROM: { items: ['x', 'c'], text: 'Ab c' },
  PLAIN_TEXT: { markup: 'Ab c' },
  MARKDOWN_BLOCKS: { text: 'Ab c' },
  TAKE: { list: [1, 2, 2], count: 2, start: 2 },
  INDEX_OF: { list: [1, 2, 2], value: 2 },
  FILTER_BY: { list: [1, 2], keys: [true, true], operatorValue: true },
  DISTINCT: { list: [1, 2, 2] },
  GROUP_COUNTS: { list: [1, 2, 2] },
};

/** The literal a parameter written as one takes, where its first admitted value is not wanted. */
const LITERAL: Record<string, string> = {
  'MARKDOWN_BLOCKS.kind': 'paragraph',
  'FILTER_BY.operator': 'AND',
};

type Outcome = { value: unknown; warnings: string[]; errors: string[] };

type Param = FunctionParamDefinition & { index: number };

/** A mode, or FILTER_BY's operator: what the shared rules' opening sentence exempts. */
function exempt(name: string, param: FunctionParamDefinition): boolean {
  return (
    (param.literalValues?.length ?? 0) > 0 || (name === 'FILTER_BY' && param.name === 'operator')
  );
}

function isListOfText(type: FormulaType): boolean {
  return type.kind === 'list' && type.of.kind === 'text';
}

/** Values of another type than the parameter takes, `""` and `[]` included where they are. */
function otherTypes(type: FormulaType): unknown[] {
  switch (type.kind) {
    case 'text':
      return [[], 5];
    case 'number':
      return ['', [], '1'];
    case 'boolean':
      return ['', 'yes'];
    case 'list':
      return ['', 'x'];
    case 'template':
      return [[1]];
    default:
      return [];
  }
}

/** A member a list parameter takes, for lists of exactly a given length. */
function member(name: string, param: Param): unknown {
  const valid = VALID[name][param.name] as unknown[];
  return valid[valid.length - 1];
}

const VARIABLES = ['v0', 'v1', 'v2', 'v3', 'v4'];

function setup(registry: MutableFormulaRegistry): void {
  for (const variable of VARIABLES) {
    registry.registerVariable({
      name: variable,
      description: 'A cell argument.',
      type: FormulaTypes.any(true),
    });
  }
}

/**
 * Runs `name` with the arguments given by position; every other parameter up to the last given
 * or required one takes its valid value (a literal where it is written as one), and the rest are
 * omitted.
 */
async function run(name: string, params: Param[], given: Map<number, unknown>): Promise<Outcome> {
  const last = Math.max(
    -1,
    ...given.keys(),
    ...params.filter((param) => !param.optional).map((param) => param.index),
  );
  const args: string[] = [];
  const variables: Record<string, unknown> = {};
  for (const param of params.slice(0, last + 1)) {
    if (exempt(name, param)) {
      const literal = LITERAL[`${name}.${param.name}`] ?? (param.literalValues as string[])[0];
      args.push(JSON.stringify(literal));
      continue;
    }
    const variable = VARIABLES[param.index];
    variables[variable] = given.has(param.index) ? given.get(param.index) : VALID[name][param.name];
    args.push(variable);
  }
  const { parsed, compiled, output, errors } = await evalFormulaOutput(
    `${name}(${args.join('; ')})`,
    variables,
    {
      setup,
    },
  );
  expect(
    [...parsed.errors, ...compiled.errors].map((error) => error.code),
    `${name}(${args.join('; ')})`,
  ).toStrictEqual([]);
  return {
    value: output.value ?? null,
    warnings: (output.warnings ?? []).map((warning) => warning.code),
    errors: errors.map((error) => error.code),
  };
}

const NULL_ONLY: Outcome = { value: null, warnings: [], errors: [] };
const TYPE: Outcome = { value: null, warnings: ['TYPE'], errors: [] };
const TOO_LARGE: Outcome = { value: null, warnings: [], errors: ['LIST_TOO_LARGE'] };

const { registry } = createTestRuntime();

function paramsOf(name: string): Param[] {
  const definitions = registry.listFunctionsByName(name);
  expect(definitions, name).toHaveLength(1);
  return definitions[0].params.map((param, index) => ({ ...param, index }));
}

describe('the shared rules, run against every added function', () => {
  it('reads the exemptions from the shared rules opening sentence, and has a value for every parameter', () => {
    expect(DOCS).toContain(
      'These rules hold in every section that states its function as rules, for each argument but a mode and the operator of `FILTER_BY`, which a formula writes as literals.',
    );
    expect(ADDED.length).toBeGreaterThan(0);
    expect(Object.keys(VALID).sort()).toStrictEqual([...ADDED].sort());
    for (const name of ADDED) {
      const governed = paramsOf(name)
        .filter((param) => !exempt(name, param))
        .map((param) => param.name);
      expect(Object.keys(VALID[name]).sort(), name).toStrictEqual([...governed].sort());
    }
  });

  for (const name of ADDED) {
    describe(name, () => {
      const params = paramsOf(name);
      const governed = params.filter((param) => !exempt(name, param));

      it('gives a result with every argument valid, which each cell below departs from', async () => {
        const outcome = await run(name, params, new Map());
        expect(outcome.errors, name).toStrictEqual([]);
        expect(outcome.warnings, name).toStrictEqual([]);
        expect(outcome.value, name).not.toBeNull();
      });

      it('returns null, with no warning, for a null required argument', async () => {
        for (const param of governed.filter((param) => !param.optional)) {
          expect(await run(name, params, new Map([[param.index, null]])), param.name).toStrictEqual(
            NULL_ONLY,
          );
        }
      });

      it('takes a null optional argument as if it were omitted', async () => {
        for (const param of governed.filter((param) => param.optional)) {
          const omitted = await run(name, params.slice(0, param.index), new Map());
          expect(
            await run(name, params.slice(0, param.index + 1), new Map([[param.index, null]])),
            param.name,
          ).toStrictEqual(omitted);
        }
      });

      it('returns null with a TYPE warning for a value of another type, "" and [] included', async () => {
        for (const param of governed) {
          for (const value of otherTypes(param.type)) {
            expect(
              await run(name, params, new Map([[param.index, value]])),
              `${param.name} = ${JSON.stringify(value)}`,
            ).toStrictEqual(TYPE);
          }
        }
      });

      it('skips a null or "" member of a list of texts, and refuses a member of another type', async () => {
        for (const param of governed.filter((param) => isListOfText(param.type))) {
          const valid = VALID[name][param.name] as unknown[];
          const plain = await run(name, params, new Map([[param.index, valid]]));
          expect(
            await run(name, params, new Map([[param.index, [null, '', ...valid]]])),
            param.name,
          ).toStrictEqual(plain);
          for (const other of [5, [], true]) {
            expect(
              await run(name, params, new Map([[param.index, [...valid, other]]])),
              `${param.name} member ${JSON.stringify(other)}`,
            ).toStrictEqual(TYPE);
          }
        }
      });

      it('raises LIST_TOO_LARGE for a list argument of more than 1,000 members, its length checked before its members', async () => {
        for (const param of governed.filter((param) => param.type.kind === 'list')) {
          const one = member(name, param);
          expect(
            await run(name, params, new Map([[param.index, Array(1001).fill(one)]])),
            param.name,
          ).toStrictEqual(TOO_LARGE);
          const at = await run(name, params, new Map([[param.index, Array(1000).fill(one)]]));
          expect(at.errors, `${param.name} at 1,000`).not.toContain('LIST_TOO_LARGE');
          // Members a member check refuses (texts take no number, the other lists no list).
          const refused = isListOfText(param.type) ? 5 : [];
          expect(
            await run(name, params, new Map([[param.index, Array(1001).fill(refused)]])),
            `${param.name} of refused members`,
          ).toStrictEqual(TOO_LARGE);
        }
      });

      it('checks the arguments from left to right, and the leftmost that fails decides', async () => {
        // Each way an argument can fail its check, with the outcome that failure gives.
        const failures = (param: Param): Array<{ how: string; value: unknown; gives: Outcome }> => {
          const out: Array<{ how: string; value: unknown; gives: Outcome }> = [];
          if (!param.optional) out.push({ how: 'null', value: null, gives: NULL_ONLY });
          const bad = otherTypes(param.type)[0];
          if (bad !== undefined) out.push({ how: 'of another type', value: bad, gives: TYPE });
          if (param.type.kind === 'list') {
            const oversize = Array(1001).fill(member(name, param));
            out.push({ how: 'too large', value: oversize, gives: TOO_LARGE });
          }
          return out;
        };
        let pairs = 0;
        for (const first of governed) {
          for (const second of governed.filter((param) => param.index > first.index)) {
            for (const left of failures(first)) {
              for (const right of failures(second)) {
                pairs += 1;
                expect(
                  await run(
                    name,
                    params,
                    new Map([
                      [first.index, left.value],
                      [second.index, right.value],
                    ]),
                  ),
                  `${first.name} ${left.how}, ${second.name} ${right.how}`,
                ).toStrictEqual(left.gives);
              }
            }
          }
        }
        // A function with one governed argument has no pair to order.
        expect(pairs > 0, `${name}: pairs of failing arguments`).toBe(governed.length > 1);
      });

      it('computes the result only once every argument has passed its check', async () => {
        const [lead] = governed;
        const empty = lead.type.kind === 'list' ? [] : '';
        for (const param of governed.filter((param) => param.index > lead.index)) {
          const bad = otherTypes(param.type)[0];
          if (bad === undefined) continue;
          expect(
            await run(
              name,
              params,
              new Map([
                [lead.index, empty],
                [param.index, bad],
              ]),
            ),
            `${lead.name} empty, ${param.name} bad`,
          ).toStrictEqual(TYPE);
        }
      });
    });
  }
});
