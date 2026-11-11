import * as coreFunctions from '@formulang/core-functions';
import * as definitions from '@formulang/definitions';
import * as parser from '@formulang/parser';
import { createHash } from 'node:crypto';
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
 * FILTER_PROPERTY and REDUCE: a host function registered under one gets the same checks.
 */
const keyedByName: string[] = added.filter((name) => name === 'FILTER_BY');

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
  }, 30_000);

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
  }, 30_000);
});

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
  okNaN: () => definitions.makeOkUnknown('HOST', Number.NaN),
  okInfinity: () => definitions.makeOkUnknown('HOST', Number.POSITIVE_INFINITY),
  okMinusInfinity: () => definitions.makeOkUnknown('HOST', Number.NEGATIVE_INFINITY),
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
      okNaN: 'null',
      okInfinity: 'null',
      okMinusInfinity: 'null',
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
      okNaN: 'null',
      okInfinity: 'null',
      okMinusInfinity: 'null',
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
      okNaN: 'null',
      okInfinity: 'null',
      okMinusInfinity: 'null',
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
      okNaN: 'null',
      okInfinity: 'null',
      okMinusInfinity: 'null',
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
      okNaN: 'null',
      okInfinity: 'null',
      okMinusInfinity: 'null',
      error: 'runtime:EVAL_CRASH',
      missing: 'runtime:EVAL_CRASH',
    },
  },
};

// How a test reads what a call gives: its errors' kinds and codes, or else its value as JSON, with
// a number that is not finite written as itself.
function readOutcome(out: {
  output: { value: unknown };
  errors: { kind: string; code: string }[];
}) {
  if (out.errors.length) return out.errors.map((error) => `${error.kind}:${error.code}`).join(',');
  const value = out.output.value;
  return typeof value === 'number' && !Number.isFinite(value)
    ? String(value)
    : JSON.stringify(value ?? null);
}

describe('a raw answer of a host function gives what it gave on 1.0.0, on each path the runner takes', () => {
  it('has a cell for each raw answer, and for no answer at all, on each of the five paths', () => {
    expect(Object.keys(ON_1_0_0)).toStrictEqual([
      'pure',
      'runCached',
      'uncached',
      'pureLongKey',
      'controlFlow',
    ]);
    for (const [path, { outcomes }] of Object.entries(ON_1_0_0)) {
      expect(Object.keys(outcomes).sort(), path).toStrictEqual(
        [...Object.keys(RAW_ANSWERS), 'missing'].sort(),
      );
    }
  });

  for (const [path, { purity, controlFlow, key, outcomes }] of Object.entries(ON_1_0_0)) {
    for (const [answer, outcome] of Object.entries(outcomes)) {
      it(`${path}, ${answer}`, async () => {
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
        expect(readOutcome(out), source).toBe(outcome);
      });
    }
  }
});
