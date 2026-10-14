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

type Outcome = unknown;
type BaselineFormula = { source: string; outcome: Outcome; byShape?: Record<string, Outcome> };
type ByShape = Record<string, Outcome[]>;

const formulas: BaselineFormula[] = baseline.formulas;
const shapes: string[] = baseline.shapes;

/** The function names the core registry adds to those of 1.0.0, from the live registry. */
const added: string[] = harness.addedFunctionNames(packages, baseline.functionNames);

/** A formula that calls a function 1.1.0 adds, or names it as a callable. */
const namesAnAddedFunction = new RegExp(`\\b(${added.join('|')})\\s*\\(|"(${added.join('|')})"`);

function wanted(formula: BaselineFormula, shape: string): Outcome {
  return formula.byShape?.[shape] ?? formula.outcome;
}

function differencesFrom1_0_0(byShape: ByShape, selected: (source: string) => boolean) {
  const differences: Array<{ shape: string; source: string; want: Outcome; got: Outcome }> = [];
  formulas.forEach((formula, index) => {
    if (!selected(formula.source)) return;
    for (const shape of shapes) {
      const want = wanted(formula, shape);
      const got = byShape[shape]?.[index];
      if (JSON.stringify(got) !== JSON.stringify(want)) {
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
    // that hold the value of every node, and runs of the formulas that read the clock.
    expect(sources.length).toBeGreaterThan(400);
    expect(formulas.filter((f) => f.byShape).length).toBeGreaterThan(0);
    const stored = JSON.stringify(formulas);
    expect(stored).toContain('"nodes"');
    expect(stored).toContain('"clockRun');
  });

  it('derives a host-function shape for every name 1.1.0 adds, and for no other name', () => {
    expect(added.length).toBeGreaterThan(0);
    expect(baseline.addedFunctionNames).toStrictEqual(added);
    for (const name of baseline.addedFunctionNames) {
      expect(baseline.functionNames).not.toContain(name);
    }
    expect(shapes.filter((shape) => shape.startsWith(harness.HOST_FUNCTION_SHAPE))).toStrictEqual(
      added.map((name) => `${harness.HOST_FUNCTION_SHAPE}${name}`),
    );
  });

  it('gives every formula that names no function 1.1.0 adds its 1.0.0 outcome under every shape', () => {
    const differences = differencesFrom1_0_0(
      atHead,
      (source) => !namesAnAddedFunction.test(source),
    );
    expect(differences.slice(0, 20)).toStrictEqual([]);
    expect(differences.length).toBe(0);
    // Not vacuous: the corpus formulas name no function 1.1.0 adds.
    expect(formulas.filter((f) => !namesAnAddedFunction.test(f.source)).length).toBeGreaterThan(
      400,
    );
  });

  it('gives every formula its 1.0.0 outcome once the definitions 1.1.0 adds are retired', async () => {
    // What 1.1.0 adds is keyed by signature id, never by a name a host may have used as well, so
    // with the new definitions retired the head behaves as 1.0.0 did: also for a function a host
    // registered under one of the new names, and for every formula that names one.
    const retired = await harness.runCorpus(packages, corpus, baseline.addedFunctionNames, added);
    const differences = differencesFrom1_0_0(retired, () => true);
    expect(differences.slice(0, 20)).toStrictEqual([]);
    expect(differences.length).toBe(0);
  }, 120_000);

  it('changes a formula that names a function 1.1.0 adds only in that it now calls the function', () => {
    // With the core registry, such a formula either failed to compile on 1.0.0, the name being
    // unknown, or named the function as the callable of a nested higher-order call, which resolves
    // the name when it runs and so yielded null there. At the head it calls the new function; with
    // the new definitions retired it gives the 1.0.0 outcome again (the test above), so that call
    // is the whole change.
    const unknownName = ['UNKNOWN_FUNCTION', 'UNKNOWN_FUNCTION_REFERENCE'];
    let failedToCompile = 0;
    let yieldedNull = 0;
    let changed = 0;
    formulas.forEach((formula, index) => {
      if (!namesAnAddedFunction.test(formula.source)) return;
      const before = wanted(formula, 'core') as {
        parse?: string[];
        run?: { value: unknown };
        runs?: Array<{ value: unknown }>;
      };
      if (before.parse !== undefined) {
        expect(
          before.parse.every((code) => unknownName.includes(code)),
          formula.source,
        ).toBe(true);
        failedToCompile++;
      } else {
        const values = before.run ? [before.run.value] : (before.runs ?? []).map((r) => r.value);
        expect(values.length, formula.source).toBeGreaterThan(0);
        for (const value of values) {
          expect(value, formula.source).toStrictEqual([null]);
        }
        yieldedNull++;
      }
      if (JSON.stringify(atHead.core?.[index]) !== JSON.stringify(before)) changed++;
    });
    expect(failedToCompile).toBeGreaterThan(0);
    expect(yieldedNull).toBeGreaterThan(0);
    expect(changed).toBe(failedToCompile + yieldedNull);
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

/** A literal argument of the parameter's type: what a call the built-in accepts passes. */
function argumentFor(param: definitions.FunctionParamDefinition): string {
  if (param.literalValues !== undefined) return JSON.stringify(param.literalValues[0]);
  switch (definitions.stripNullability(param.type).kind) {
    case 'number':
      return '1';
    case 'boolean':
      return 'TRUE';
    case 'list':
      return 'LIST("a b"; "c")';
    case 'callable':
      return '"ISTEXT"';
    default:
      return '"a b"';
  }
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

  it('is refused under the built-in’s signature id, and with its parameters under another', () => {
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
    }
  });

  it('is shadowed by the built-in for a direct call both accept', async () => {
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

  it('keeps its own direct calls, and through EACH the name reaches the built-in', async () => {
    expect(Object.keys(THROUGH_EACH).sort()).toStrictEqual([...added].sort());
    for (const name of added) {
      const def = builtIn(name);
      const { registry, implementations } = coreFunctions.createCoreFormulaRuntime();
      harness.addHostFunction(packages, registry, implementations, name);
      const host = `HOST_${name}/v1`;

      const direct = `${name}(LIST(1; 2; 3); "ISNUMBER"; 1; 2)`;
      const own = await runRecorded(registry, implementations, direct);
      expect(own.parsed.errors, direct).toStrictEqual([]);
      expect(own.parsed.root.signatureId, direct).toBe(host);
      expect(own.value, direct).toBe(3);
      expect(own.invoked.has(def.signatureId), direct).toBe(false);

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
