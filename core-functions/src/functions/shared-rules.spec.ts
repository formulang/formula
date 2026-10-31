import * as coreFunctions from '@formulang/core-functions';
import type {
  FormulaType,
  FunctionDefinition,
  FunctionParamDefinition,
  MutableFormulaRegistry,
} from '@formulang/definitions';
import {
  BuiltinSignatureIds,
  FormulaTypes,
  makeOkUnknown,
  optimizeRule,
} from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleOutputAsync } from '@formulang/runner';
import { readFileSync } from 'node:fs';
import baseline from '../../../scripts/compat/baseline-1.0.0.json';
import harness from '../../../scripts/compat/harness.js';
import { createTestRuntime } from '../test-helpers/eval-formula';

/**
 * Each rule under "Shared rules" in docs/functions.md, run as a cell against every function the
 * core registry adds to 1.0.0 and every parameter it governs, read from the live registry: a
 * function that departs from a rule is red, unless the rule's own opening sentence exempts the
 * parameter by name (a mode, and the operator of `FILTER_BY`, which a formula writes as literals).
 * Every cell names the rules it runs, and the first test holds those names to the rules the page
 * states, both ways, so a rule without a cell, or a cell for a rule the page no longer states, is
 * red.
 */

/** The names the core registry adds to those of 1.0.0, read from the live registry. */
const ADDED: string[] = harness.addedFunctionNames({ coreFunctions }, baseline.functionNames);

const DOCS = readFileSync(new URL('../../../docs/functions.md', import.meta.url), 'utf8');

/** The rules under "## Shared rules": each top-level bullet, joined across its lines. */
function readSharedRules(docs: string): string[] {
  const lines = docs.split('\n');
  const start = lines.indexOf('## Shared rules');
  const rules: string[] = [];
  for (let index = start + 1; index < lines.length && !/^#{1,3} /.test(lines[index]); index++) {
    if (!lines[index].startsWith('- ')) continue;
    const parts = [lines[index].slice(2)];
    while (/^ {2}\S/.test(lines[index + 1] ?? '') && !lines[index + 1].startsWith('  ```')) {
      index += 1;
      parts.push(lines[index].trim());
    }
    rules.push(parts.join(' '));
  }
  return rules;
}

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

/**
 * The functions with a check that reads more than one argument, and that check, as their sections
 * state it; the cell of Shared rule 9 holds this list to what the functions do, both ways.
 */
const JOINT: Record<string, string> = {
  WORDS:
    'an `option` outside the `locale` and `pattern` modes, and a pattern or text those modes refuse',
  WORD_COUNT: 'as `WORDS`',
  LEADING_WORDS: 'as `WORDS`',
  FIRST_CONTAINED: 'a phrase past 250 code units as it is searched for, which `ignoreCase` decides',
  CONTAINS_ANY: 'as `FIRST_CONTAINED`',
  MISSING_FROM: 'an item past 250 code units as it is searched for, which `normalise` decides',
  FILTER_BY: 'a `list` and `keys` of different lengths',
};

type Outcome = { value: unknown; warnings: string[]; errors: string[] };

type Param = FunctionParamDefinition & { index: number };

type Runtime = ReturnType<typeof createTestRuntime>;

/** A function the cells run: its parameters, its valid values, and how its runtime is made. */
type Subject = {
  name: string;
  params: Param[];
  governed: Param[];
  valid: Record<string, unknown>;
  /** Registers what the subject needs beyond the core registry (a fixture's function). */
  fixture?: (runtime: Runtime) => void;
};

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

/**
 * Values that pass the checks of their own argument but make a check that reads more than one
 * argument fail, for some function: a text past the regular expressions' input bound, an unsafe
 * pattern, a list of texts with a member past the phrase bound as written or once lower-cased,
 * lists of two lengths; and each boolean. Each is offered beside the parameter's valid value.
 */
function stress(type: FormulaType, valid: unknown): unknown[] {
  switch (type.kind) {
    case 'text':
      return [valid, 'a'.repeat(8001), '(a+)+'];
    case 'list':
      return isListOfText(type)
        ? [valid, ['a'.repeat(251)], [String.fromCharCode(0x130).repeat(126)]]
        : [valid, [1], [1, 2]];
    case 'boolean':
      return [valid, true, false];
    default:
      return [valid];
  }
}

/** A member a list parameter takes, for lists of exactly a given length. */
function member(subject: Subject, param: Param): unknown {
  const valid = subject.valid[param.name] as unknown[];
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

type RunOptions = {
  /** The last parameter written; by default the last given or required one. */
  through?: number;
  /** The admitted value each mode takes, by parameter name, where its default is not wanted. */
  modes?: Record<string, string>;
  /**
   * Calls the subject through `APPLY`, a host's higher-order function that passes on exactly the
   * arguments it is given, so a required argument can be left out, as only such a function or a
   * callable named when the call runs can leave it out, and an argument given as `HOST_UNDEFINED`
   * reaches the subject as `undefined`.
   */
  apply?: boolean;
};

/**
 * What a cell gives `APPLY` for an argument that a host's function hands on as `undefined`, which
 * no formula writes and no variable carries (the runner reads a variable's `undefined` as `null`).
 */
const HOST_UNDEFINED = Object.freeze({ hostUndefined: true });

/** An argument whose value is `undefined`, as a host's function can hand one on. */
const UNDEFINED_ARGUMENT = {
  output: async () => makeOkUnknown('const', undefined),
  value: async () => undefined,
};

/**
 * Registers `APPLY(name, args...)`: calls the function the name resolves to, as the core
 * higher-order functions resolve it, with the other arguments, each given as `HOST_UNDEFINED`
 * handed on as `undefined`, and answers that call's own output, warnings included.
 */
function withApply(runtime: Runtime): void {
  runtime.registry.registerFunction({
    signatureId: 'APPLY/v1',
    name: 'APPLY',
    category: 'custom',
    description: 'Calls the named function with the other arguments and answers its output.',
    params: [
      { name: 'name', type: FormulaTypes.text(true) },
      { name: 'args', type: FormulaTypes.any(true), optional: true, variadic: true },
    ],
    returnType: FormulaTypes.any(true),
    purity: 'pure',
  });
  runtime.implementations.register('APPLY/v1', {
    estimateCostsInSeconds: () => 0.0001,
    evaluateMultiple: async (calls, ctx) => {
      const outs = [];
      for (const call of calls) {
        const name = String(await call.args[0]?.value());
        const def = ctx.registry
          .listFunctionsByName(name)
          .find((candidate) => ctx.resolver.get(candidate.signatureId) !== undefined);
        const implementation = def && ctx.resolver.get(def.signatureId);
        if (!implementation) throw new Error(`no implementation of ${name}`);
        const args = await Promise.all(
          call.args
            .slice(1)
            .map(async (arg) =>
              (await arg.value()) === HOST_UNDEFINED ? UNDEFINED_ARGUMENT : arg,
            ),
        );
        const [out] = await implementation.evaluateMultiple([{ args, callId: '0' }], ctx);
        outs.push(out);
      }
      return outs;
    },
  });
}

/**
 * Runs the subject with the arguments given by position; every other parameter up to the last
 * written one takes its valid value (a literal where it is written as one), and the rest are
 * omitted.
 */
async function run(
  subject: Subject,
  given: Map<number, unknown>,
  options: RunOptions = {},
): Promise<Outcome> {
  const { name, params } = subject;
  const last =
    options.through ??
    Math.max(
      -1,
      ...given.keys(),
      ...params.filter((param) => !param.optional).map((param) => param.index),
    );
  const args: string[] = [];
  const variables: Record<string, unknown> = {};
  for (const param of params.slice(0, last + 1)) {
    if (exempt(name, param)) {
      const literal =
        options.modes?.[param.name] ??
        LITERAL[`${name}.${param.name}`] ??
        (param.literalValues as string[])[0];
      args.push(JSON.stringify(literal));
      continue;
    }
    const variable = VARIABLES[param.index];
    variables[variable] = given.has(param.index)
      ? given.get(param.index)
      : subject.valid[param.name];
    args.push(variable);
  }
  const source = options.apply
    ? `APPLY(${[JSON.stringify(name), ...args].join('; ')})`
    : `${name}(${args.join('; ')})`;
  const runtime = createTestRuntime(setup);
  subject.fixture?.(runtime);
  if (options.apply) withApply(runtime);
  const parsed = parseFormula(source, { registry: runtime.registry });
  expect(
    parsed.errors.map((error) => error.code),
    source,
  ).toStrictEqual([]);
  const compiled = optimizeRule(parsed, { registry: runtime.registry });
  const { output, errors } = await evaluateRuleOutputAsync(compiled, {
    registry: runtime.registry,
    resolver: runtime.implementations,
    variables,
  });
  return {
    value: output.value ?? null,
    warnings: (output.warnings ?? []).map((warning) => warning.code),
    errors: errors.map((error) => error.code),
  };
}

const NULL_ONLY: Outcome = { value: null, warnings: [], errors: [] };
const TYPE: Outcome = { value: null, warnings: ['TYPE'], errors: [] };
const TOO_LARGE: Outcome = { value: null, warnings: [], errors: ['LIST_TOO_LARGE'] };

/** Each way an argument can fail its own check, with the outcome that failure gives. */
function failures(
  subject: Subject,
  param: Param,
): Array<{ how: string; value: unknown; gives: Outcome }> {
  const out: Array<{ how: string; value: unknown; gives: Outcome }> = [];
  if (!param.optional) out.push({ how: 'null', value: null, gives: NULL_ONLY });
  const bad = otherTypes(param.type)[0];
  if (bad !== undefined) out.push({ how: 'of another type', value: bad, gives: TYPE });
  if (param.type.kind === 'list') {
    const oversize = Array(1001).fill(member(subject, param));
    out.push({ how: 'too large', value: oversize, gives: TOO_LARGE });
  }
  if (isListOfText(param.type)) {
    const refused = [...(subject.valid[param.name] as unknown[]), 5];
    out.push({ how: 'with a refused member', value: refused, gives: TYPE });
  }
  return out;
}

/** Every combination of one value from each list. */
function combinations<T>(lists: T[][]): T[][] {
  return lists.reduce<T[][]>(
    (done, list) => done.flatMap((prefix) => list.map((value) => [...prefix, value])),
    [[]],
  );
}

/** Every combination of the admitted values of the subject's modes, each named by its parameter. */
function modeCombinations(subject: Subject): Array<Record<string, string>> {
  const modes = subject.params.filter(
    (param) => (param.literalValues?.length ?? 0) > 0 && exempt(subject.name, param),
  );
  return combinations(modes.map((param) => param.literalValues as string[])).map((values) =>
    Object.fromEntries(values.map((value, index) => [modes[index].name, value])),
  );
}

/** A cell: the shared rules it runs, as the page states them, and how it runs them. */
type Cell = { title: string; rules: readonly string[]; run: (subject: Subject) => Promise<void> };

const CELLS: readonly Cell[] = [
  {
    title:
      'returns null, with no warning, for a null required argument, and for one a host leaves out',
    rules: ['A `null` given for an argument the function requires returns `null`.'],
    run: async (subject) => {
      for (const param of subject.governed.filter((param) => !param.optional)) {
        expect(await run(subject, new Map([[param.index, null]])), param.name).toStrictEqual(
          NULL_ONLY,
        );
        // Left out, or given as `undefined`, as a host's function can do, it is read as `null`, as
        // the page's convention on empty values states: the same answer.
        expect(
          await run(subject, new Map(), { through: param.index - 1, apply: true }),
          `${param.name} left out`,
        ).toStrictEqual(NULL_ONLY);
        expect(
          await run(subject, new Map([[param.index, HOST_UNDEFINED]]), { apply: true }),
          `${param.name} given as undefined`,
        ).toStrictEqual(NULL_ONLY);
      }
    },
  },
  {
    title: 'takes a null optional argument as if it were omitted',
    rules: ['A `null` given for an optional argument is taken as if the argument were omitted.'],
    run: async (subject) => {
      for (const param of subject.governed.filter((param) => param.optional)) {
        // Both calls write every parameter before this one, at its valid value; one stops there.
        const omitted = await run(subject, new Map(), { through: param.index - 1 });
        expect(
          await run(subject, new Map([[param.index, null]]), { through: param.index }),
          param.name,
        ).toStrictEqual(omitted);
        // Given as `undefined` by a host's function, it is read as `null`, as the page's
        // convention on empty values states.
        expect(
          await run(subject, new Map([[param.index, HOST_UNDEFINED]]), {
            through: param.index,
            apply: true,
          }),
          `${param.name} given as undefined`,
        ).toStrictEqual(omitted);
      }
    },
  },
  {
    title: 'returns null with a TYPE warning for a value of another type, "" and [] included',
    rules: [
      'A value of another type than the argument takes, the empty text `""` and the empty list `[]` included, returns `null` with a `TYPE` warning.',
    ],
    run: async (subject) => {
      for (const param of subject.governed) {
        for (const value of otherTypes(param.type)) {
          expect(
            await run(subject, new Map([[param.index, value]])),
            `${param.name} = ${JSON.stringify(value)}`,
          ).toStrictEqual(TYPE);
        }
      }
    },
  },
  {
    title: 'skips a null or "" member of a list of texts, and refuses a member of another type',
    rules: [
      'A member of a list of texts that is `null` or `""` is skipped.',
      'A member of a list of texts that is neither text nor `null`, the empty list included, returns `null` with a `TYPE` warning.',
    ],
    run: async (subject) => {
      for (const param of subject.governed.filter((param) => isListOfText(param.type))) {
        const valid = subject.valid[param.name] as unknown[];
        const plain = await run(subject, new Map([[param.index, valid]]));
        expect(
          await run(subject, new Map([[param.index, [null, '', ...valid]]])),
          param.name,
        ).toStrictEqual(plain);
        // A host's list can hold `undefined`, which no formula writes: it is skipped as `null` is,
        // as the page's convention on empty values states.
        expect(
          await run(subject, new Map([[param.index, [undefined, ...valid]]])),
          `${param.name} with undefined`,
        ).toStrictEqual(plain);
        for (const other of [5, [], true]) {
          expect(
            await run(subject, new Map([[param.index, [...valid, other]]])),
            `${param.name} member ${JSON.stringify(other)}`,
          ).toStrictEqual(TYPE);
        }
      }
    },
  },
  {
    title:
      'raises LIST_TOO_LARGE for a list argument of more than 1,000 members, its length checked before its members',
    rules: [
      'A list argument of more than `maxListLength` (1,000) members raises `LIST_TOO_LARGE`.',
      "A list argument's length is checked before its members.",
    ],
    run: async (subject) => {
      for (const param of subject.governed.filter((param) => param.type.kind === 'list')) {
        const one = member(subject, param);
        expect(
          await run(subject, new Map([[param.index, Array(1001).fill(one)]])),
          param.name,
        ).toStrictEqual(TOO_LARGE);
        const at = await run(subject, new Map([[param.index, Array(1000).fill(one)]]));
        expect(at.errors, `${param.name} at 1,000`).not.toContain('LIST_TOO_LARGE');
        // Members a member check refuses (texts take no number, the other lists no list).
        const refused = isListOfText(param.type) ? 5 : [];
        expect(
          await run(subject, new Map([[param.index, Array(1001).fill(refused)]])),
          `${param.name} of refused members`,
        ).toStrictEqual(TOO_LARGE);
      }
    },
  },
  {
    title: 'checks the arguments from left to right, and the leftmost that fails decides',
    rules: ['The leftmost argument whose check fails decides the result.'],
    run: async (subject) => {
      let pairs = 0;
      for (const first of subject.governed) {
        for (const second of subject.governed.filter((param) => param.index > first.index)) {
          for (const left of failures(subject, first)) {
            for (const right of failures(subject, second)) {
              pairs += 1;
              expect(
                await run(
                  subject,
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
      expect(pairs > 0, `${subject.name}: pairs of failing arguments`).toBe(
        subject.governed.length > 1,
      );
    },
  },
  {
    title:
      'checks what reads more than one argument only after every argument has passed its own check',
    rules: ['A check that needs more than one argument comes after every argument is checked.'],
    run: async (subject) => {
      let joint = false;
      for (const modes of modeCombinations(subject)) {
        // With every argument valid on its own, whether some combination fails a joint check.
        for (const values of combinations(
          subject.governed.map((param) => stress(param.type, subject.valid[param.name])),
        )) {
          const outcome = await run(
            subject,
            new Map(subject.governed.map((param, index) => [param.index, values[index]])),
            { modes },
          );
          // A refusal is a warning or an error; a null value alone can be an answer.
          if (outcome.warnings.length > 0 || outcome.errors.length > 0) joint = true;
        }
        // Each way one argument fails its own check, beside every such combination of the others.
        for (const failing of subject.governed) {
          const others = subject.governed.filter((param) => param !== failing);
          for (const failure of failures(subject, failing)) {
            for (const values of combinations(
              others.map((param) => stress(param.type, subject.valid[param.name])),
            )) {
              const given = new Map(others.map((param, index) => [param.index, values[index]]));
              given.set(failing.index, failure.value);
              expect(
                await run(subject, given, { modes }),
                `${failing.name} ${failure.how}, the others ${JSON.stringify(values).slice(0, 120)}, modes ${JSON.stringify(modes)}`,
              ).toStrictEqual(failure.gives);
            }
          }
        }
      }
      expect(joint, `${subject.name}: a check that reads more than one argument`).toBe(
        subject.name in JOINT,
      );
    },
  },
  {
    title: 'computes the result only once every argument has passed its check',
    rules: ['The result is computed only once every check has passed.'],
    run: async (subject) => {
      const [lead] = subject.governed;
      const empty = lead.type.kind === 'list' ? [] : '';
      for (const param of subject.governed.filter((param) => param.index > lead.index)) {
        const bad = otherTypes(param.type)[0];
        if (bad === undefined) continue;
        expect(
          await run(
            subject,
            new Map([
              [lead.index, empty],
              [param.index, bad],
            ]),
          ),
          `${lead.name} empty, ${param.name} bad`,
        ).toStrictEqual(TYPE);
      }
    },
  },
];

const { registry } = createTestRuntime();

function subjectOf(name: string): Subject {
  const definitions = registry.listFunctionsByName(name);
  expect(definitions, name).toHaveLength(1);
  const params = definitions[0].params.map((param, index) => ({ ...param, index }));
  return {
    name,
    params,
    governed: params.filter((param) => !exempt(name, param)),
    valid: VALID[name],
  };
}

/**
 * A function whose optional parameter follows another and is ignored by its implementation: TAKE
 * with a `stride` it does not read. A null `stride` is an omitted one, so the cell of Shared rule 2
 * must find no departure in it.
 */
function takeWithStride(): Subject {
  const take = registry.getFunction(BuiltinSignatureIds.TAKE) as FunctionDefinition;
  const definition: FunctionDefinition = {
    ...take,
    signatureId: 'TAKE_STRIDE/v1',
    name: 'TAKE_STRIDE',
    category: 'custom',
    params: [
      ...take.params,
      {
        name: 'stride',
        description: 'Read by nothing.',
        type: FormulaTypes.number(true),
        optional: true,
      },
    ],
  };
  const params = definition.params.map((param, index) => ({ ...param, index }));
  return {
    name: 'TAKE_STRIDE',
    params,
    governed: params,
    valid: { ...VALID.TAKE, stride: 1 },
    fixture: (runtime) => {
      runtime.registry.registerFunction(definition);
      const implementation = runtime.implementations.get(BuiltinSignatureIds.TAKE);
      if (implementation === undefined) throw new Error('TAKE has no implementation');
      runtime.implementations.register('TAKE_STRIDE/v1', {
        estimateCostsInSeconds: implementation.estimateCostsInSeconds?.bind(implementation),
        evaluateMultiple: (calls, ctx) =>
          implementation.evaluateMultiple(
            calls.map((call) => ({ ...call, args: call.args.slice(0, 3) })),
            ctx,
          ),
      });
    },
  };
}

describe('the shared rules, run against every added function', () => {
  it('runs every shared rule the page states in a cell, and no rule it does not state', () => {
    const rules = readSharedRules(DOCS);
    expect(rules.length).toBeGreaterThan(0);
    const run = CELLS.flatMap((cell) => cell.rules);
    expect(new Set(run).size, 'each rule in one cell').toBe(run.length);
    expect([...run].sort()).toStrictEqual([...rules].sort());
  });

  it('reads the exemptions from the shared rules opening sentence, and has a value for every parameter', () => {
    expect(DOCS).toContain(
      'These rules hold in every section that states its function as rules, for each argument but a mode and the operator of `FILTER_BY`, which a formula writes as literals.',
    );
    expect(ADDED.length).toBeGreaterThan(0);
    expect(Object.keys(VALID).sort()).toStrictEqual([...ADDED].sort());
    expect(Object.keys(JOINT).filter((name) => !ADDED.includes(name))).toStrictEqual([]);
    for (const name of ADDED) {
      const subject = subjectOf(name);
      expect(Object.keys(VALID[name]).sort(), name).toStrictEqual(
        subject.governed.map((param) => param.name).sort(),
      );
    }
  });

  it('finds no departure from Shared rule 2 where a governed optional parameter follows another', async () => {
    const fixture = takeWithStride();
    const [cell] = CELLS.filter((each) => each.title.startsWith('takes a null optional'));
    // Not vacuous: the last two governed parameters are optional, one after the other.
    expect(fixture.governed.slice(-2).every((param) => param.optional)).toBe(true);
    await cell.run(fixture);
  });

  for (const name of ADDED) {
    describe(name, () => {
      const subject = subjectOf(name);

      it('gives a result with every argument valid, which each cell below departs from', async () => {
        const outcome = await run(subject, new Map());
        expect(outcome.errors, name).toStrictEqual([]);
        expect(outcome.warnings, name).toStrictEqual([]);
        expect(outcome.value, name).not.toBeNull();
      });

      for (const cell of CELLS) {
        it(cell.title, () => cell.run(subject), 120_000);
      }
    });
  }
});
