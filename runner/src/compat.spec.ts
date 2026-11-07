import * as coreFunctions from '@formulang/core-functions';
import * as definitions from '@formulang/definitions';
import * as parser from '@formulang/parser';
import { createHash } from 'node:crypto';
import { INVOCATIONS_BY_NAME, invokedArguments } from '../../parser/src/callable-invocations';
import baseline from '../../scripts/compat/baseline-1.0.0.json';
import corpus from '../../scripts/compat/corpus.json';
import harness from '../../scripts/compat/harness.js';
import * as runner from './index';

/** The commit both committed fixtures were generated from: the 1.0.0 release. */
const BASELINE_COMMIT = '699d57efa2c51e8f32747b1aa081c00538c0fa05';

const packages = { definitions, parser, runner, coreFunctions };

type Run = { value: unknown };
type Outcome = { parse?: string[]; run?: Run; runs?: Run[]; namesAdded?: true };
type BaselineFormula = { source: string; outcome: Outcome; byShape?: Record<string, Outcome> };
type ByShape = Record<string, Outcome[]>;

const formulas: BaselineFormula[] = baseline.formulas as BaselineFormula[];
const shapes: string[] = baseline.shapes;

/** The function names the core registry adds to those of 1.0.0, from the live registry. */
const added: string[] = harness.addedFunctionNames(packages, baseline.functionNames);

/** A formula whose text calls one of `names`, or names it as a callable, in any case. */
function writing(names: readonly string[]): RegExp {
  return new RegExp(`\\b(${names.join('|')})\\s*\\(|"(${names.join('|')})"`, 'i');
}

const writesAnAddedName = writing(added);

/**
 * The names 1.1.0 adds that the parser checks by name, as 1.0.0 checks EACH, FILTER,
 * FILTER_PROPERTY and REDUCE: every function registered under one gets the table's invocation.
 */
const keyedByName: string[] = added.filter((name) => INVOCATIONS_BY_NAME.has(name));

function wanted(formula: BaselineFormula, shape: string): Outcome {
  return formula.byShape?.[shape] ?? formula.outcome;
}

/**
 * Whether the formula at `index` names a function 1.1.0 adds: written in its source in any letter
 * case (called, or a string literal naming a callable), or produced when the call runs by a value
 * or an expression. The union of the names the source writes, the names the formula asked the
 * registry for on 1.0.0 (the baseline's record) and the names it asks for at the head (`atHead`),
 * which looks a callable a nested call names up when it parses, where 1.0.0 did so only when the
 * nested call ran.
 */
function namesAnAddedFunction(atHead: ByShape, index: number, shape: string): boolean {
  const formula = formulas[index];
  if (formula === undefined) throw new Error(`no formula ${index}`);
  return (
    writesAnAddedName.test(formula.source) ||
    wanted(formula, shape).namesAdded === true ||
    atHead[shape]?.[index]?.namesAdded === true
  );
}

/** What a formula does: its outcome without the record of the names it asked the registry for. */
function behaviour(outcome: Outcome | undefined): string {
  if (outcome === undefined) return 'none';
  const { namesAdded, ...rest } = outcome;
  void namesAdded;
  return JSON.stringify(rest);
}

function differencesFrom1_0_0(
  byShape: ByShape,
  selected: (index: number, shape: string) => boolean,
) {
  const differences: Array<{ shape: string; source: string; want: Outcome; got: unknown }> = [];
  formulas.forEach((formula, index) => {
    for (const shape of shapes) {
      if (!selected(index, shape)) continue;
      const want = wanted(formula, shape);
      const got = byShape[shape]?.[index];
      if (behaviour(got) !== behaviour(want)) {
        differences.push({ shape, source: formula.source, want, got });
      }
    }
  });
  return differences;
}

describe('compatibility with 1.0.0', () => {
  let atHead: ByShape;
  beforeAll(async () => {
    atHead = await harness.runCorpus(packages, corpus, baseline.addedFunctionNames);
  }, 120_000);

  it('compares against a baseline generated from 1.0.0 for exactly this corpus and these probes', () => {
    expect(corpus.provenance.commit).toBe(BASELINE_COMMIT);
    expect(baseline.provenance.commit).toBe(BASELINE_COMMIT);
    const sources = corpus.formulas.map((f: { source: string }) => f.source);
    const sha = createHash('sha256').update(JSON.stringify(sources)).digest('hex');
    expect(baseline.provenance.corpusSha256).toBe(sha);
    expect(formulas.map((f) => f.source)).toStrictEqual(
      harness.formulasFor(corpus, baseline.addedFunctionNames),
    );
    expect(shapes).toStrictEqual(harness.shapeNames(baseline.addedFunctionNames));
    // Not vacuous: the 1.0.0 spec files, docs and probes, with outcomes some shapes change, runs
    // that hold the value of every node, and the formulas that read the clock compared by value.
    expect(sources.length).toBeGreaterThan(400);
    expect(formulas.filter((f) => f.byShape).length).toBeGreaterThan(0);
    expect(JSON.stringify(formulas)).toContain('"nodes"');
    const day = formulas.find((f) => f.source === 'DAY()');
    expect(day?.outcome.run?.value).toBe(new Date(harness.FROZEN_CLOCK).getUTCDate());
  });

  it('derives a host-function and a host-alias shape for every name 1.1.0 adds, and for no other name', () => {
    // The re-versioned shape re-registers exactly the functions of the parser's invocation table.
    expect(harness.higherOrderNames(packages)).toStrictEqual(
      [...INVOCATIONS_BY_NAME.keys()].sort(),
    );
    expect(added.length).toBeGreaterThan(0);
    expect(baseline.addedFunctionNames).toStrictEqual(added);
    for (const name of baseline.addedFunctionNames) {
      expect(baseline.functionNames).not.toContain(name);
    }
    for (const prefix of [harness.HOST_FUNCTION_SHAPE, harness.HOST_ALIAS_SHAPE]) {
      expect(shapes.filter((shape) => shape.startsWith(prefix))).toStrictEqual(
        added.map((name) => `${prefix}${name}`),
      );
    }
  });

  it('gives every formula that names no function 1.1.0 adds its 1.0.0 outcome under every shape', () => {
    const differences = differencesFrom1_0_0(
      atHead,
      (index, shape) => !namesAnAddedFunction(atHead, index, shape),
    );
    expect(differences.slice(0, 20)).toStrictEqual([]);
    expect(differences.length).toBe(0);
    // Not vacuous: the corpus formulas name no function 1.1.0 adds.
    const unnamed = formulas.filter((_, index) => !namesAnAddedFunction(atHead, index, 'core'));
    expect(unnamed.length).toBeGreaterThan(400);
  });

  it('gives every formula its 1.0.0 behaviour once the definitions 1.1.0 adds are retired', async () => {
    // With the new definitions retired the head behaves as 1.0.0 did, also for a function a host
    // registered under one of the new names, or under a name of its own with one of them as an
    // alias, and for every formula that names one, with one exception: the parser checks a call of
    // any function named FILTER_BY by FILTER_BY's entry in its table, as 1.0.0 checks one named
    // EACH, so where a host registered its own FILTER_BY under that name, a formula that writes the
    // name is checked now (an alias takes no entry, as on 1.0.0). Which names a formula asks the
    // registry for is no behaviour, and can differ: the head looks up a nested callable a string
    // literal names when it parses, where 1.0.0 did so only when the nested call ran.
    expect(keyedByName).toStrictEqual(['FILTER_BY']);
    const retired = await harness.runCorpus(packages, corpus, baseline.addedFunctionNames, added);
    const checkedNow = (index: number, shape: string) =>
      keyedByName.some(
        (name) =>
          shape === `${harness.HOST_FUNCTION_SHAPE}${name}` &&
          writing([name]).test(formulas[index]?.source ?? ''),
      );
    const differences = differencesFrom1_0_0(retired, (index, shape) => !checkedNow(index, shape));
    expect(differences.slice(0, 20)).toStrictEqual([]);
    expect(differences.length).toBe(0);
    // The exception, stated: of the 13 formulas that write FILTER_BY, three call the host's
    // FILTER_BY naming a callable that takes one argument, to which FILTER_BY's invocation passes
    // two (the key and the fourth argument); each ran on 1.0.0 and now fails to compile.
    const exempted = keyedByName.flatMap((name) =>
      formulas.filter((_, index) => checkedNow(index, `${harness.HOST_FUNCTION_SHAPE}${name}`)),
    );
    expect(exempted.length).toBe(13);
    const checked = differencesFrom1_0_0(retired, checkedNow);
    expect(checked.length).toBe(3);
    for (const { source, want, got } of checked) {
      expect(want.parse, source).toBeUndefined();
      expect(
        (got as Outcome).parse?.every((code) => code === 'NO_MATCHING_OVERLOAD'),
        source,
      ).toBe(true);
    }
  }, 120_000);

  it('keys an alias as a name: every formula alike under both host shapes, but FILTER_BY at the head', () => {
    // The registry keys a definition's aliases as its name, so a host function that answers to a
    // new name only through its aliases collides with the built-in as one registered under it.
    // The formulas whose outcome differs between the two shapes of a name, as `name: formula`.
    const differing = (outcomeOf: (index: number, shape: string) => Outcome | undefined) =>
      added.flatMap((name) =>
        formulas.flatMap((formula, index) =>
          behaviour(outcomeOf(index, `${harness.HOST_ALIAS_SHAPE}${name}`)) ===
          behaviour(outcomeOf(index, `${harness.HOST_FUNCTION_SHAPE}${name}`))
            ? []
            : [`${name}: ${formula.source}`],
        ),
      );
    // 1.0.0: alike for every formula, the host's own calls among them.
    expect(
      differing((index, shape) => wanted(formulas[index] as BaselineFormula, shape)),
    ).toStrictEqual([]);
    // The head: alike but for the host's own calls of FILTER_BY. A function named FILTER_BY gets
    // FILTER_BY's invocation, which passes the callable two arguments, so those calls fail to
    // compile; one that answers to FILTER_BY through an alias gets none, as on 1.0.0 for EACH, and
    // they keep their 1.0.0 outcome.
    const atHeadDiffering = differing((index, shape) => atHead[shape]?.[index]);
    const ownCalls = [
      'FILTER_BY(value; "ISNUMBER"; 1; 2)',
      'FILTER_BY(LIST(1; 2; 3); "ISNUMBER"; 1; 2) + 1',
      'FILTER_BY(LIST("a"; "bb"); "ISTEXT"; other; value)',
    ];
    expect(atHeadDiffering).toStrictEqual(ownCalls.map((source) => `FILTER_BY: ${source}`));
    for (const source of ownCalls) {
      const index = formulas.findIndex((formula) => formula.source === source);
      const asAlias = `${harness.HOST_ALIAS_SHAPE}FILTER_BY`;
      expect(behaviour(atHead[asAlias]?.[index]), source).toBe(
        behaviour(wanted(formulas[index] as BaselineFormula, asAlias)),
      );
      expect(
        atHead[`${harness.HOST_FUNCTION_SHAPE}FILTER_BY`]?.[index]?.parse,
        source,
      ).toStrictEqual(['NO_MATCHING_OVERLOAD', 'NO_MATCHING_OVERLOAD']);
    }
    // Not vacuous: under either shape the host's own calls differ from the core registry's.
    for (const name of added) {
      const own = formulas.findIndex(
        (formula) => formula.source === `${name}(value; "ISNUMBER"; 1; 2)`,
      );
      expect(own, name).toBeGreaterThanOrEqual(0);
      expect(
        behaviour(wanted(formulas[own] as BaselineFormula, `${harness.HOST_ALIAS_SHAPE}${name}`)),
        name,
      ).not.toBe(behaviour(wanted(formulas[own] as BaselineFormula, 'core')));
    }
  });

  it('changes a formula that names a function 1.1.0 adds in one of three ways, each from its call', () => {
    // Such a formula writes the name, in any letter case, or a value or an expression produces it
    // when the call runs. With the core registry it changes in one of three ways. It failed to
    // compile on 1.0.0, the name being unknown, and now resolves the name: it compiles and calls
    // the function, or fails on the function's own checks. It compiled on 1.0.0, a nested
    // higher-order call resolving the name when it runs and yielding null there, and now calls the
    // function. Or it compiled on 1.0.0, whether the nested call ran or not, and now fails to
    // compile on what a mode of the function receives, in one of two kinds: a string literal the
    // mode does not list (LITERAL_VALUE_NOT_ALLOWED), or a value that is no string literal
    // (EXPECTED_STRING_LITERAL_REFERENCE). With the new definitions retired it gives the 1.0.0
    // outcome again (the test above), so the new function is the whole change.
    const unknownName = ['UNKNOWN_FUNCTION', 'UNKNOWN_FUNCTION_REFERENCE'];
    const nowFailsToCompile: Record<string, number> = {
      LITERAL_VALUE_NOT_ALLOWED: 0,
      EXPECTED_STRING_LITERAL_REFERENCE: 0,
    };
    let failedToCompile = 0;
    let yieldedNull = 0;
    let fromData = 0;
    let changed = 0;
    let named = 0;
    formulas.forEach((formula, index) => {
      if (!namesAnAddedFunction(atHead, index, 'core')) return;
      named++;
      if (!writesAnAddedName.test(formula.source)) fromData++;
      const before = wanted(formula, 'core');
      const now = atHead.core?.[index];
      if (before.parse !== undefined) {
        expect(
          before.parse.every((code) => unknownName.includes(code)),
          formula.source,
        ).toBe(true);
        // The name resolves now: the call compiles, or fails on the function's own checks.
        expect(
          (now?.parse ?? []).some((code) => unknownName.includes(code)),
          formula.source,
        ).toBe(false);
        failedToCompile++;
      } else if (now?.parse !== undefined) {
        // One kind per formula.
        const kinds = [...new Set(now.parse)];
        expect(kinds.length, formula.source).toBe(1);
        const kind = kinds[0] ?? '';
        expect(Object.keys(nowFailsToCompile), formula.source).toContain(kind);
        nowFailsToCompile[kind] = (nowFailsToCompile[kind] ?? 0) + 1;
      } else {
        const values = before.run ? [before.run.value] : (before.runs ?? []).map((r) => r.value);
        expect(values.length, formula.source).toBeGreaterThan(0);
        for (const value of values) {
          expect(value, formula.source).toStrictEqual([null]);
        }
        yieldedNull++;
      }
      if (behaviour(now) !== behaviour(before)) changed++;
    });
    // For this corpus and these probes: 144 formulas failed to compile on 1.0.0, 48 yielded null
    // there, and 20 that compiled now fail to compile, by kind.
    expect([failedToCompile, yieldedNull, nowFailsToCompile]).toStrictEqual([
      144,
      48,
      { LITERAL_VALUE_NOT_ALLOWED: 9, EXPECTED_STRING_LITERAL_REFERENCE: 11 },
    ]);
    // Not vacuous: names written in lower case, and names a value or an expression produces.
    const lowerCase = formulas.filter(
      (f, index) =>
        added.some((name) => f.source.includes(JSON.stringify(name.toLowerCase()))) &&
        namesAnAddedFunction(atHead, index, 'core'),
    );
    expect(lowerCase.length).toBe(added.length);
    expect(fromData).toBeGreaterThanOrEqual(harness.RUN_TIME_NAMES.length);
    expect(changed).toBe(named);
    expect(named).toBe(
      failedToCompile +
        yieldedNull +
        Object.values(nowFailsToCompile).reduce((sum, count) => sum + count, 0),
    );
  });

  it('freezes the clock the functions read, not the one the runner measures its limits by', async () => {
    // A function that takes 20 ms by a clock the harness leaves alone, against a 5 ms limit.
    const { registry, implementations } = coreFunctions.createCoreFormulaRuntime();
    registry.registerFunction({
      signatureId: 'SLOW/v1',
      name: 'SLOW',
      category: 'custom',
      description: 'Takes 20 ms.',
      params: [],
      returnType: definitions.FormulaTypes.boolean(true),
      purity: 'uncached',
    });
    implementations.register('SLOW/v1', {
      estimateCostsInSeconds: () => 0.0001,
      evaluateMultiple: async (calls) => {
        const until = performance.now() + 20;
        while (performance.now() < until) {
          // The time passes on the clock the runner reads.
        }
        return calls.map(() => definitions.makeOkBoolean('SLOW/v1', true));
      },
    });
    const compiled = definitions.optimizeRule(parser.parseFormula('SLOW()', { registry }), {
      registry,
    });
    const codes = await harness.withFrozenClock(async () => {
      expect(new Date().getTime()).toBe(harness.FROZEN_CLOCK);
      const out = await runner.evaluateRuleOutputAsync(compiled, {
        registry,
        resolver: implementations,
        variables: {},
        limits: { maxFunctionWallTimeMs: 5 },
      });
      return out.errors.map((error) => error.code);
    });
    expect(codes).toStrictEqual([definitions.FormulaErrorCodes.WALL_TIME_LIMIT_EXCEEDED]);
  });
});

/**
 * What a call of the compatibility shape's host function gets through EACH at the head, for each
 * name 1.1.0 adds: EACH runs the first definition of the name that has an implementation, the
 * built-in, so the call either no longer compiles, where the built-in takes a literal at a
 * position the call passes another value to, or runs the built-in.
 */
const THROUGH_EACH: Record<string, { refused: string } | { builtInAnswers: unknown }> = {
  CONTAINS_ANY: { refused: 'EXPECTED_STRING_LITERAL_REFERENCE' },
  DISTINCT: { builtInAnswers: [[1, 2, 3]] },
  FILTER_BY: { builtInAnswers: [null] },
  FIRST_CONTAINED: { refused: 'EXPECTED_STRING_LITERAL_REFERENCE' },
  GROUP_COUNTS: { builtInAnswers: [[1, 1, 1]] },
  INDEX_OF: { builtInAnswers: [null] },
  LEADING_WORDS: { refused: 'EXPECTED_STRING_LITERAL_REFERENCE' },
  LINES: { refused: 'LITERAL_VALUE_NOT_ALLOWED' },
  LINE_COUNT: { refused: 'LITERAL_VALUE_NOT_ALLOWED' },
  MARKDOWN_BLOCKS: { refused: 'LITERAL_VALUE_NOT_ALLOWED' },
  MISSING_FROM: { refused: 'EXPECTED_STRING_LITERAL_REFERENCE' },
  PLAIN_TEXT: { refused: 'LITERAL_VALUE_NOT_ALLOWED' },
  SENTENCES: { refused: 'LITERAL_VALUE_NOT_ALLOWED' },
  TAKE: { builtInAnswers: [null] },
  WORDS: { refused: 'LITERAL_VALUE_NOT_ALLOWED' },
  WORD_COUNT: { refused: 'LITERAL_VALUE_NOT_ALLOWED' },
};

/** A literal of the parameter's type: what a call that takes it passes. */
function argumentFor(param: definitions.FunctionParamDefinition): string {
  if (param.literalValues !== undefined) return JSON.stringify(param.literalValues[0]);
  const type = definitions.stripNullability(param.type);
  switch (type.kind) {
    case 'number':
      return '1';
    case 'boolean':
      return 'TRUE';
    case 'list': {
      const item = definitions.stripNullability(type.of).kind;
      if (item === 'boolean') return 'LIST(TRUE)';
      return item === 'number' ? 'LIST(1; 2)' : 'LIST("a b"; "c")';
    }
    case 'callable':
      return '"ISTEXT"';
    default:
      return '"a b"';
  }
}

/** The type with `any`, templates and their lists narrowed to numbers. */
function narrowed(type: definitions.FormulaType): definitions.FormulaType {
  const base = definitions.stripNullability(type);
  if (base.kind === 'any' || base.kind === 'template') return definitions.FormulaTypes.number(true);
  if (base.kind === 'list') return definitions.FormulaTypes.list(narrowed(base.of), true);
  return type;
}

/** A type the built-in's parameter does not take: a list becomes a boolean, the rest a list. */
function disjoint(type: definitions.FormulaType): definitions.FormulaType {
  const base = definitions.stripNullability(type);
  if (base.kind === 'callable') return type;
  return base.kind === 'list'
    ? definitions.FormulaTypes.boolean(true)
    : definitions.FormulaTypes.list(definitions.FormulaTypes.boolean(true), true);
}

/** Parses and runs `source`, recording the signature id of every implementation invoked. */
async function runRecorded(
  registry: definitions.FormulaRegistry,
  implementations: definitions.FunctionImplementationResolver,
  source: string,
) {
  const invoked = new Set<string>();
  const parsed = parser.parseFormula(source, { registry });
  if (parsed.errors.length > 0) return { parsed, invoked };
  const resolver: definitions.FunctionImplementationResolver = {
    get: (signatureId) => {
      const implementation = implementations.get(signatureId);
      if (implementation === undefined) return undefined;
      return {
        estimateCostsInSeconds: implementation.estimateCostsInSeconds,
        evaluateMultiple: (calls, ctx) => {
          invoked.add(signatureId);
          return implementation.evaluateMultiple(calls, ctx);
        },
      };
    },
  };
  const out = await runner.evaluateRuleOutputAsync(definitions.optimizeRule(parsed, { registry }), {
    registry,
    resolver,
    variables: {},
  });
  return { parsed, invoked, value: out.output.value ?? null };
}

describe('a host function under a name 1.1.0 adds, at the head', () => {
  const coreRegistry = () => coreFunctions.createCoreFormulaRuntime().registry;
  const builtIn = (name: string) => {
    const [def] = coreRegistry().listFunctionsByName(name);
    if (def === undefined) throw new Error(`no built-in ${name}`);
    return def;
  };
  /** The host's own definition under the name: its own id and parameters, no templates. */
  const hostDefinition = (
    def: definitions.FunctionDefinition,
    params: definitions.FunctionParamDefinition[],
  ): definitions.FunctionDefinition => {
    const { templates, ...rest } = def;
    void templates;
    return { ...rest, signatureId: `HOST_${def.name}/v1`, category: 'custom', params };
  };

  it('is refused under the built-in’s id, with its parameters, or with its required ones only', () => {
    for (const name of added) {
      const def = builtIn(name);
      const sameId = { ...def, category: 'custom' };
      expect(() => coreRegistry().registerFunction(sameId), name).toThrow(
        `Function already registered: ${def.signatureId}`,
      );
      const sameParams = { ...def, signatureId: `HOST_${name}/v1`, category: 'custom' };
      expect(() => coreRegistry().registerFunction(sameParams), name).toThrow(
        `Ambiguous overload for ${name}`,
      );
      // The simplest host function of the name: the built-in's required parameters, such as a
      // one-argument WORD_COUNT(text).
      const required = hostDefinition(
        def,
        def.params.filter((param) => param.optional !== true),
      );
      expect(() => coreRegistry().registerFunction(required), name).toThrow(
        `Ambiguous overload for ${name}`,
      );
    }
  });

  it.each([
    { shape: 'registered under it', alias: false },
    { shape: 'answering to it only through an alias', alias: true },
  ])(
    'keeps a one-argument host function only where the built-in requires more arguments, $shape',
    ({ alias }) => {
      // The registry keys an alias as a name, so the same overloads collide either way.
      const withName = (def: definitions.FunctionDefinition): definitions.FunctionDefinition =>
        alias ? { ...def, name: `HOST_${def.name}`, aliases: [def.name] } : def;
      let refused = 0;
      let kept = 0;
      for (const name of added) {
        const def = builtIn(name);
        const [first] = def.params;
        if (first === undefined) throw new Error(`${name} takes no argument`);
        const oneArgument = withName(hostDefinition(def, [{ name: first.name, type: first.type }]));
        const registry = coreRegistry();
        if (def.params.filter((param) => param.optional !== true).length === 1) {
          // The built-in takes the same single argument: the overloads are ambiguous.
          expect(() => registry.registerFunction(oneArgument), name).toThrow(
            `Ambiguous overload for ${name}`,
          );
          refused++;
        } else {
          // No one-argument call reaches the built-in, so the host function keeps its calls.
          registry.registerFunction(oneArgument);
          const source = `${name}(${argumentFor(first)})`;
          const parsed = parser.parseFormula(source, { registry });
          expect(parsed.errors, source).toStrictEqual([]);
          expect(parsed.root.signatureId, source).toBe(`HOST_${name}/v1`);
          kept++;
        }
      }
      // WORDS, WORD_COUNT, SENTENCES, LINES, LINE_COUNT, DISTINCT and GROUP_COUNTS take one
      // argument; the other nine require two or more.
      expect([refused, kept]).toStrictEqual([7, 9]);
      // A host function whose one parameter takes a text, or a list of values of any type where the
      // built-in's takes a list, collides with six of the seven: DISTINCT's list parameter is told
      // apart from a list of any values.
      const collides = added.filter((name) => {
        const def = builtIn(name);
        if (def.params.filter((param) => param.optional !== true).length !== 1) return false;
        const list = definitions.stripNullability(
          (def.params[0] as definitions.FunctionParamDefinition).type,
        );
        const type =
          list.kind === 'list'
            ? definitions.FormulaTypes.list(definitions.FormulaTypes.any(true), true)
            : definitions.FormulaTypes.text(true);
        const host = withName(hostDefinition(def, [{ name: 'input', type }]));
        try {
          coreRegistry().registerFunction(host);
          return false;
        } catch (error) {
          expect((error as Error).message, name).toContain(`Ambiguous overload for ${name}`);
          return true;
        }
      });
      expect(collides).toStrictEqual([
        'GROUP_COUNTS',
        'LINES',
        'LINE_COUNT',
        'SENTENCES',
        'WORDS',
        'WORD_COUNT',
      ]);
    },
  );

  it('is shadowed by the built-in for every call it takes, when its parameters are narrower', async () => {
    let narrowable = 0;
    for (const name of added) {
      const def = builtIn(name);
      const required = def.params.filter((param) => param.optional !== true);
      const params = required.map((param) => ({ ...param, type: narrowed(param.type) }));
      // A built-in whose parameters are concrete has no narrower form: that host function has the
      // built-in's parameters, refused above.
      if (JSON.stringify(params) === JSON.stringify(required)) continue;
      narrowable++;
      const { registry, implementations } = coreFunctions.createCoreFormulaRuntime();
      registry.registerFunction(hostDefinition(def, params));
      const source = `${name}(${params.map(argumentFor).join('; ')})`;
      const { parsed, invoked } = await runRecorded(registry, implementations, source);
      expect(parsed.errors, source).toStrictEqual([]);
      expect(parsed.root.signatureId, source).toBe(def.signatureId);
      expect(invoked.has(def.signatureId), source).toBe(true);
    }
    // TAKE, INDEX_OF, FILTER_BY, DISTINCT and GROUP_COUNTS take lists of any type.
    expect(narrowable).toBe(5);
  });

  it('is shadowed by the built-in for a direct call both accept, when its first parameter is wider', async () => {
    for (const name of added) {
      const def = builtIn(name);
      const { registry, implementations } = coreFunctions.createCoreFormulaRuntime();
      // Its first parameter takes anything, the rest as the built-in's.
      registry.registerFunction({
        ...def,
        signatureId: `HOST_${name}/v1`,
        category: 'custom',
        params: def.params.map((param, index) =>
          index === 0 ? { ...param, type: definitions.FormulaTypes.any(true) } : param,
        ),
      });
      const host = implementations.get(def.signatureId);
      if (host) implementations.register(`HOST_${name}/v1`, host);
      const args = def.params.filter((param) => param.optional !== true).map(argumentFor);
      const source = `${name}(${args.join('; ')})`;
      const { parsed, invoked } = await runRecorded(registry, implementations, source);
      expect(parsed.errors, source).toStrictEqual([]);
      expect(parsed.root.signatureId, source).toBe(def.signatureId);
      expect(invoked.has(def.signatureId), source).toBe(true);
      expect(invoked.has(`HOST_${name}/v1`), source).toBe(false);
    }
  });

  it('keeps typed calls of types the built-in does not take, checked under FILTER_BY; any-typed calls bind what takes them', () => {
    // A host function whose parameters are of types the built-in does not take, at every arity up
    // to one past the built-in's parameters (a callable where the built-in takes one).
    const outcomes: Record<'host' | 'builtIn' | 'refused', string[]> = {
      host: [],
      builtIn: [],
      refused: [],
    };
    const typedChecked: string[] = [];
    for (const name of added) {
      const def = builtIn(name);
      const required = def.params.filter((param) => param.optional !== true).length;
      for (let arity = 1; arity <= def.params.length + 1; arity++) {
        const params = Array.from({ length: arity }, (_, index) => {
          const own = def.params[index];
          return own !== undefined && definitions.stripNullability(own.type).kind === 'callable'
            ? own
            : {
                name: `p${index}`,
                type: disjoint(own?.type ?? definitions.FormulaTypes.any(true)),
              };
        });
        const { registry } = coreFunctions.createCoreFormulaRuntime();
        registry.registerVariable({
          name: 'value',
          description: 'Input of any type.',
          type: definitions.FormulaTypes.any(true),
        });
        registry.registerFunction(hostDefinition(def, params));
        const typed = `${name}(${params.map(argumentFor).join('; ')})`;
        const bound = parser.parseFormula(typed, { registry });
        expect(bound.root.signatureId, typed).toBe(`HOST_${name}/v1`);
        // Under a name the parser checks by name, the callable the call names (ISTEXT, which takes
        // one argument) receives what the table's invocation passes it.
        const entry = INVOCATIONS_BY_NAME.get(name);
        const passed =
          entry === undefined
            ? []
            : invokedArguments(
                entry,
                params.map((param) => param.type),
              );
        if (passed.length > 1) {
          expect(
            bound.errors.map((error) => error.code),
            typed,
          ).toStrictEqual(['NO_MATCHING_OVERLOAD']);
          typedChecked.push(`${name}/${arity}`);
        } else {
          expect(bound.errors, typed).toStrictEqual([]);
        }
        // Values typed `any` (an untyped input) satisfy the built-in where it takes that many
        // arguments, and it is registered first.
        const untyped = `${name}(${params
          .map((param) =>
            definitions.stripNullability(param.type).kind === 'callable' ? '"AND"' : 'value',
          )
          .join('; ')})`;
        const rebound = parser.parseFormula(untyped, { registry });
        const label = `${name}/${arity}`;
        const takes = arity >= required && arity <= def.params.length;
        // A literal-only mode of the built-in among the arguments: a value is no literal there.
        const mode = def.params
          .slice(0, arity)
          .some(
            (param) =>
              param.literalOnly === true &&
              definitions.stripNullability(param.type).kind !== 'callable',
          );
        if (!takes) {
          expect(rebound.errors, untyped).toStrictEqual([]);
          expect(rebound.root.signatureId, untyped).toBe(`HOST_${name}/v1`);
          outcomes.host.push(label);
        } else if (mode) {
          expect(
            rebound.errors.map((error) => error.code),
            untyped,
          ).toStrictEqual(['EXPECTED_STRING_LITERAL_REFERENCE']);
          outcomes.refused.push(label);
          // A string literal at each mode instead: the built-in binds when it lists the literal,
          // and the call fails to compile when it does not.
          const withMode = (literal: (param: definitions.FunctionParamDefinition) => string) =>
            `${name}(${params
              .map((param, index) => {
                const own = def.params[index];
                if (own?.literalOnly === true && own.literalValues !== undefined) {
                  return literal(own);
                }
                return definitions.stripNullability(param.type).kind === 'callable'
                  ? '"AND"'
                  : 'value';
              })
              .join('; ')})`;
          const listed = withMode((own) => JSON.stringify(own.literalValues?.[0]));
          const listedParsed = parser.parseFormula(listed, { registry });
          expect(listedParsed.errors, listed).toStrictEqual([]);
          expect(listedParsed.root.signatureId, listed).toBe(def.signatureId);
          const unlisted = withMode(() => '"zzz"');
          expect(
            parser.parseFormula(unlisted, { registry }).errors.map((error) => error.code),
            unlisted,
          ).toStrictEqual(['LITERAL_VALUE_NOT_ALLOWED']);
        } else {
          expect(rebound.errors, untyped).toStrictEqual([]);
          expect(rebound.root.signatureId, untyped).toBe(def.signatureId);
          outcomes.builtIn.push(label);
        }
      }
    }
    // Untyped calls a mode refuses: PLAIN_TEXT and MARKDOWN_BLOCKS at the built-in's required
    // arity, nine more names one argument past it, six of those also two past.
    expect(outcomes.refused.sort()).toStrictEqual(
      [
        'PLAIN_TEXT/2',
        'MARKDOWN_BLOCKS/2',
        'WORDS/2',
        'WORD_COUNT/2',
        'SENTENCES/2',
        'LINES/2',
        'LINE_COUNT/2',
        'LEADING_WORDS/3',
        'FIRST_CONTAINED/3',
        'CONTAINS_ANY/3',
        'MISSING_FROM/3',
        'WORDS/3',
        'WORD_COUNT/3',
        'SENTENCES/3',
        'LEADING_WORDS/4',
        'FIRST_CONTAINED/4',
        'CONTAINS_ANY/4',
      ].sort(),
    );
    expect([outcomes.host.length, outcomes.builtIn.length]).toStrictEqual([26, 16]);
    // A typed call of the host's own FILTER_BY that passes a fourth argument no longer compiles.
    expect(typedChecked).toStrictEqual(['FILTER_BY/4', 'FILTER_BY/5']);
  });

  it.each([
    { shape: 'registered under it', alias: false, aloneRefused: ['FILTER_BY/5'] },
    { shape: 'answering to it only through an alias', alias: true, aloneRefused: [] },
  ])(
    'loses the calls 1.0.0 bound to the name’s only definition whatever their arguments, $shape',
    async ({ alias, aloneRefused }) => {
      // 1.0.0 binds a name's only definition even where the arguments do not fit it, so that its
      // errors name its parameters, and keys an alias as a name: it binds the host's function for
      // every call below either way. With the built-in under the name the host's function is no
      // longer the only definition: a direct call with an argument count it does not declare binds
      // the built-in where the built-in takes the arguments, and otherwise fails to compile. With the
      // new definitions retired the host's function is alone again and takes such a call, but under
      // FILTER_BY, whose invocation checks the call of five arguments of a function named FILTER_BY
      // and of none that answers to it through an alias.
      const atHead: Record<'refused' | 'builtIn', string[]> = { refused: [], builtIn: [] };
      const alone: Record<'refused' | 'host', string[]> = { refused: [], host: [] };
      for (const name of added) {
        for (const count of [2, 3, 5]) {
          const args = ['LIST(1; 2; 3)', '"ISNUMBER"', '1', '2', '3'].slice(0, count);
          const source = `${name}(${args.join('; ')})`;
          const label = `${name}/${count}`;
          const now = coreFunctions.createCoreFormulaRuntime();
          harness.addHostFunction(packages, now.registry, now.implementations, name, { alias });
          const head = await runRecorded(now.registry, now.implementations, source);
          if (head.parsed.errors.length > 0) {
            expect(
              head.parsed.errors.map((error) => error.code),
              source,
            ).toStrictEqual(['NO_MATCHING_OVERLOAD']);
            atHead.refused.push(label);
          } else {
            expect(head.parsed.root.signatureId, source).toBe(builtIn(name).signatureId);
            atHead.builtIn.push(label);
          }
          const retired = coreFunctions.createCoreFormulaRuntime();
          for (const def of retired.registry.listFunctionsByName(name)) {
            retired.registry.retireFunction(def.signatureId);
          }
          harness.addHostFunction(packages, retired.registry, retired.implementations, name, {
            alias,
          });
          const only = await runRecorded(retired.registry, retired.implementations, source);
          if (only.parsed.errors.length > 0) {
            alone.refused.push(label);
          } else {
            expect(only.parsed.root.signatureId, source).toBe(`HOST_${name}/v1`);
            expect(only.value, source).toBe(3);
            alone.host.push(label);
          }
        }
      }
      // The sixteen names at two, three and five arguments, 48 calls: beside the built-in, 47
      // fail to compile and INDEX_OF/2 binds it; alone, the host's function takes all but
      // `aloneRefused`.
      expect(atHead.refused.length).toBe(47);
      expect(atHead.builtIn).toStrictEqual(['INDEX_OF/2']);
      expect(alone.refused).toStrictEqual(aloneRefused);
      expect(alone.host.length).toBe(48 - aloneRefused.length);
    },
  );

  it('keeps its own direct calls, but under FILTER_BY, and through EACH the name reaches the built-in', async () => {
    expect(Object.keys(THROUGH_EACH).sort()).toStrictEqual([...added].sort());
    for (const name of added) {
      const def = builtIn(name);
      const { registry, implementations } = coreFunctions.createCoreFormulaRuntime();
      harness.addHostFunction(packages, registry, implementations, name);
      const host = `HOST_${name}/v1`;

      const direct = `${name}(LIST(1; 2; 3); "ISNUMBER"; 1; 2)`;
      const own = await runRecorded(registry, implementations, direct);
      expect(own.parsed.root.signatureId, direct).toBe(host);
      if (keyedByName.includes(name)) {
        // The parser checks the host's own FILTER_BY by FILTER_BY's invocation, which passes the
        // callable two arguments (the key and the fourth argument) where it takes one.
        expect(
          own.parsed.errors.map((error) => error.code),
          direct,
        ).toStrictEqual(['NO_MATCHING_OVERLOAD', 'NO_MATCHING_OVERLOAD']);
      } else {
        expect(own.parsed.errors, direct).toStrictEqual([]);
        expect(own.value, direct).toBe(3);
        expect(own.invoked.has(def.signatureId), direct).toBe(false);
      }

      const throughEach = `EACH(LIST(LIST(1; 2; 3)); "${name}"; "ISNUMBER"; 1; 2)`;
      const expected = THROUGH_EACH[name];
      const each = await runRecorded(registry, implementations, throughEach);
      if (expected !== undefined && 'refused' in expected) {
        expect(
          each.parsed.errors.map((error) => error.code),
          throughEach,
        ).toStrictEqual([expected.refused]);
      } else {
        expect(each.parsed.errors, throughEach).toStrictEqual([]);
        expect(each.invoked.has(def.signatureId), throughEach).toBe(true);
        expect(each.invoked.has(host), throughEach).toBe(false);
        expect(each.value, throughEach).toStrictEqual(expected?.builtInAnswers);
      }
    }
  });
});

// What a call written in a formula gives for each raw answer of its implementation, on each path
// the runner takes for it: a host function HOST(key) registered with each purity, called with a
// short key, which the runner answers through its cache when the function is pure or run-cached,
// and not when it is uncached, or the key is too long to cache, or the function is control flow.
// Measured on 699d57e (BASELINE_COMMIT) with these answers and these registrations.
const RAW_ANSWERS: Record<string, () => unknown> = {
  false: () => false,
  zero: () => 0,
  empty: () => '',
  nan: () => Number.NaN,
  null: () => null,
  undefined: () => undefined,
  five: () => 5,
  okTrue: () => definitions.makeOkUnknown('HOST', true),
  okFalse: () => definitions.makeOkUnknown('HOST', false),
  error: () =>
    definitions.makeError('HOST', {
      kind: 'runtime',
      code: 'DIVISION_BY_ZERO',
      message: 'host says no',
    }),
};
const ON_1_0_0: Record<
  string,
  {
    purity: definitions.FunctionPurity;
    controlFlow?: boolean;
    key: string;
    outcomes: Record<string, string>;
  }
> = {
  pure: {
    ...{ purity: 'pure', key: '1' },
    outcomes: {
      false: 'null',
      zero: 'null',
      empty: 'null',
      nan: 'null',
      null: 'null',
      undefined: 'null',
      five: 'runtime:EVAL_CRASH',
      okTrue: 'true',
      okFalse: 'false',
      error: 'runtime:EVAL_CRASH',
      missing: 'null',
    },
  },
  runCached: {
    ...{ purity: 'run_cached', key: '1' },
    outcomes: {
      false: 'null',
      zero: 'null',
      empty: 'null',
      nan: 'null',
      null: 'null',
      undefined: 'null',
      five: 'runtime:EVAL_CRASH',
      okTrue: 'true',
      okFalse: 'false',
      error: 'runtime:EVAL_CRASH',
      missing: 'null',
    },
  },
  uncached: {
    ...{ purity: 'uncached', key: '1' },
    outcomes: {
      false: 'runtime:EVAL_CRASH',
      zero: 'runtime:EVAL_CRASH',
      empty: 'runtime:EVAL_CRASH',
      nan: 'runtime:EVAL_CRASH',
      null: 'runtime:EVAL_CRASH',
      undefined: 'runtime:EVAL_CRASH',
      five: 'runtime:EVAL_CRASH',
      okTrue: 'true',
      okFalse: 'false',
      error: 'runtime:EVAL_CRASH',
      missing: 'runtime:EVAL_CRASH',
    },
  },
  pureLongKey: {
    ...{ purity: 'pure', key: 'long' },
    outcomes: {
      false: 'runtime:EVAL_CRASH',
      zero: 'runtime:EVAL_CRASH',
      empty: 'runtime:EVAL_CRASH',
      nan: 'runtime:EVAL_CRASH',
      null: 'runtime:EVAL_CRASH',
      undefined: 'runtime:EVAL_CRASH',
      five: 'runtime:EVAL_CRASH',
      okTrue: 'true',
      okFalse: 'false',
      error: 'runtime:EVAL_CRASH',
      missing: 'runtime:EVAL_CRASH',
    },
  },
  controlFlow: {
    ...{ purity: 'pure', controlFlow: true, key: '1' },
    outcomes: {
      false: 'runtime:EVAL_CRASH',
      zero: 'runtime:EVAL_CRASH',
      empty: 'runtime:EVAL_CRASH',
      nan: 'runtime:EVAL_CRASH',
      null: 'runtime:EVAL_CRASH',
      undefined: 'runtime:EVAL_CRASH',
      five: 'runtime:EVAL_CRASH',
      okTrue: 'true',
      okFalse: 'false',
      error: 'runtime:EVAL_CRASH',
      missing: 'runtime:EVAL_CRASH',
    },
  },
};

describe('a raw answer of a host function', () => {
  it('gives what it gave on 1.0.0, on each path the runner takes', async () => {
    let cells = 0;
    for (const [path, { purity, controlFlow, key, outcomes }] of Object.entries(ON_1_0_0)) {
      expect(Object.keys(outcomes).sort(), path).toStrictEqual(
        [...Object.keys(RAW_ANSWERS), 'missing'].sort(),
      );
      for (const [answer, outcome] of Object.entries(outcomes)) {
        const { registry, implementations } = coreFunctions.createCoreFormulaRuntime();
        registry.registerFunction({
          signatureId: 'HOST/v1',
          name: 'HOST',
          category: 'custom',
          description: 'A host function answering with a raw value.',
          params: [{ name: 'key', type: definitions.FormulaTypes.any(true) }],
          returnType: definitions.FormulaTypes.boolean(true),
          purity,
          ...(controlFlow ? { controlFlow } : {}),
        });
        implementations.register('HOST/v1', {
          estimateCostsInSeconds: () => 0.0001,
          evaluateMultiple: async (calls) =>
            (answer === 'missing'
              ? []
              : calls.map(() => RAW_ANSWERS[answer]())) as definitions.FormulaNodeOutput[],
        });
        const source = `HOST(${key})`;
        const compiled = definitions.optimizeRule(parser.parseFormula(source, { registry }), {
          registry,
        });
        const out = await runner.evaluateRuleOutputAsync(compiled, {
          registry,
          resolver: implementations,
          variables: { long: 'a'.repeat(501) },
        });
        const read = out.errors.length
          ? out.errors.map((error) => `${error.kind}:${error.code}`).join(',')
          : JSON.stringify(out.output.value ?? null);
        expect(read, `${path}, ${answer}`).toBe(outcome);
        cells += 1;
      }
    }
    expect(cells).toBe(55);
  });
});
