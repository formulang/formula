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

/** A formula whose text calls a function 1.1.0 adds, or names it as a callable, in any case. */
const writesAnAddedName = new RegExp(`\\b(${added.join('|')})\\s*\\(|"(${added.join('|')})"`, 'i');

function wanted(formula: BaselineFormula, shape: string): Outcome {
  return formula.byShape?.[shape] ?? formula.outcome;
}

/**
 * Whether the formula names a function 1.1.0 adds: written in its text, in any letter case, or
 * produced when the call runs by a value or an expression. The harness records it from the names
 * the formula asked the registry for on 1.0.0.
 */
function namesAnAddedFunction(formula: BaselineFormula, shape: string): boolean {
  return wanted(formula, shape).namesAdded === true;
}

function differencesFrom1_0_0(
  byShape: ByShape,
  selected: (f: BaselineFormula, s: string) => boolean,
) {
  const differences: Array<{ shape: string; source: string; want: Outcome; got: unknown }> = [];
  formulas.forEach((formula, index) => {
    for (const shape of shapes) {
      if (!selected(formula, shape)) continue;
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
    // that hold the value of every node, and the formulas that read the clock compared by value.
    expect(sources.length).toBeGreaterThan(400);
    expect(formulas.filter((f) => f.byShape).length).toBeGreaterThan(0);
    expect(JSON.stringify(formulas)).toContain('"nodes"');
    const day = formulas.find((f) => f.source === 'DAY()');
    expect(day?.outcome.run?.value).toBe(new Date(harness.FROZEN_CLOCK).getUTCDate());
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
      (formula, shape) => !namesAnAddedFunction(formula, shape),
    );
    expect(differences.slice(0, 20)).toStrictEqual([]);
    expect(differences.length).toBe(0);
    // Not vacuous: the corpus formulas name no function 1.1.0 adds.
    expect(formulas.filter((f) => !namesAnAddedFunction(f, 'core')).length).toBeGreaterThan(400);
  });

  it('gives every formula its 1.0.0 outcome once the definitions 1.1.0 adds are retired', async () => {
    // What 1.1.0 adds is never keyed by a name a host may have used as well, so with the new
    // definitions retired the head behaves as 1.0.0 did: also for a function a host registered
    // under one of the new names, and for every formula that names one.
    const retired = await harness.runCorpus(packages, corpus, baseline.addedFunctionNames, added);
    const differences = differencesFrom1_0_0(retired, () => true);
    expect(differences.slice(0, 20)).toStrictEqual([]);
    expect(differences.length).toBe(0);
  }, 120_000);

  it('changes a formula that names a function 1.1.0 adds only in that it now calls the function', () => {
    // Such a formula writes the name, in any letter case, or a value or an expression produces it
    // when the call runs. With the core registry it either failed to compile on 1.0.0, the name
    // being unknown, or named the function as the callable of a nested higher-order call, which
    // resolves the name when it runs and yielded null there. At the head it calls the new
    // function; with the new definitions retired it gives the 1.0.0 outcome again (the test
    // above), so that call is the whole change.
    const unknownName = ['UNKNOWN_FUNCTION', 'UNKNOWN_FUNCTION_REFERENCE'];
    let failedToCompile = 0;
    let yieldedNull = 0;
    let fromData = 0;
    let changed = 0;
    formulas.forEach((formula, index) => {
      // Every formula that writes an added name is in the class.
      if (writesAnAddedName.test(formula.source)) {
        expect(namesAnAddedFunction(formula, 'core'), formula.source).toBe(true);
      }
      if (!namesAnAddedFunction(formula, 'core')) return;
      if (!writesAnAddedName.test(formula.source)) fromData++;
      const before = wanted(formula, 'core');
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
    // Not vacuous: names written in lower case, and names a value or an expression produces.
    const lowerCase = formulas.filter(
      (f) =>
        added.some((name) => f.source.includes(JSON.stringify(name.toLowerCase()))) &&
        namesAnAddedFunction(f, 'core'),
    );
    expect(lowerCase.length).toBe(added.length);
    expect(fromData).toBeGreaterThanOrEqual(harness.RUN_TIME_NAMES.length);
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
  /** The host's own definition under the name: its own id, no declared invocation. */
  const hostDefinition = (
    def: definitions.FunctionDefinition,
    params: definitions.FunctionParamDefinition[],
  ): definitions.FunctionDefinition => {
    const { callableInvocation, templates, ...rest } = def;
    void callableInvocation;
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

  it('keeps a one-argument host function only where the built-in requires more arguments', () => {
    let refused = 0;
    let kept = 0;
    for (const name of added) {
      const def = builtIn(name);
      const [first] = def.params;
      if (first === undefined) throw new Error(`${name} takes no argument`);
      const oneArgument = hostDefinition(def, [{ name: first.name, type: first.type }]);
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
  });

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

  it('keeps a typed direct call of types the built-in does not take, not one of any-typed values', () => {
    let refused = 0;
    for (const name of added) {
      const def = builtIn(name);
      const required = def.params.filter((param) => param.optional !== true);
      const params = required.map((param) =>
        definitions.stripNullability(param.type).kind === 'callable'
          ? param
          : { name: param.name, type: disjoint(param.type) },
      );
      const { registry } = coreFunctions.createCoreFormulaRuntime();
      registry.registerVariable({
        name: 'value',
        description: 'Input of any type.',
        type: definitions.FormulaTypes.any(true),
      });
      registry.registerFunction(hostDefinition(def, params));
      const typed = `${name}(${params.map(argumentFor).join('; ')})`;
      const bound = parser.parseFormula(typed, { registry });
      expect(bound.errors, typed).toStrictEqual([]);
      expect(bound.root.signatureId, typed).toBe(`HOST_${name}/v1`);
      // Values typed `any` (an untyped input) satisfy the built-in, which is registered first.
      const untyped = `${name}(${params
        .map((param) =>
          definitions.stripNullability(param.type).kind === 'callable' ? '"ISTEXT"' : 'value',
        )
        .join('; ')})`;
      const rebound = parser.parseFormula(untyped, { registry });
      const literalOnly = required.some(
        (param) =>
          param.literalOnly === true &&
          definitions.stripNullability(param.type).kind !== 'callable',
      );
      if (literalOnly) {
        // The built-in takes a literal there, which a value is not: the call no longer compiles.
        expect(
          rebound.errors.map((error) => error.code),
          untyped,
        ).toStrictEqual(['EXPECTED_STRING_LITERAL_REFERENCE']);
        refused++;
      } else {
        expect(rebound.errors, untyped).toStrictEqual([]);
        expect(rebound.root.signatureId, untyped).toBe(def.signatureId);
      }
    }
    // PLAIN_TEXT and MARKDOWN_BLOCKS require their mode.
    expect(refused).toBe(2);
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
