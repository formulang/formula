'use strict';

/**
 * Compatibility harness. It parses and evaluates each corpus formula under each registry shape and
 * returns outcomes that compare across versions: the parse error codes, or, for each variable
 * environment, the value with its warning and error codes.
 *
 * `generate-baseline.js` ran it once against the built packages of 1.0.0 to write
 * `baseline-1.0.0.json`; `runner/src/compat.spec.ts` runs it against the source and requires the
 * same outcomes. The packages are passed in, so one harness serves both.
 *
 * @typedef {{ definitions: any, parser: any, runner: any, coreFunctions: any }} Packages
 */

/** The variable environments every formula that compiles is evaluated in. */
const ENVIRONMENTS = [
  { value: [3, 1, 2], other: 'a b' },
  { value: 'Hello, world. Bye!', other: [1, 'x'] },
];

/** The registry shapes an embedder can build on top of the core registry. */
const SHAPE_NAMES = [
  'core',
  'reversioned-higher-order',
  'host-overloads',
  'custom-higher-order',
  'combined',
];

function hasCallableParam(definitions, def) {
  return def.params.some((param) => definitions.stripNullability(param.type).kind === 'callable');
}

/**
 * Every core definition with a callable parameter retired and re-registered under `NAME/v2`, the
 * documented way to change a function's behaviour, with the same implementation.
 */
function reversionHigherOrder(packages, registry, implementations) {
  const higherOrder = registry
    .listFunctions()
    .filter((def) => hasCallableParam(packages.definitions, def));
  for (const def of higherOrder) {
    const next = `${def.signatureId.split('/')[0]}/v2`;
    registry.retireFunction(def.signatureId);
    registry.registerFunction({ ...def, signatureId: next });
    implementations.register(next, implementations.get(def.signatureId));
  }
}

function simpleImplementation(evaluate) {
  return {
    estimateCostsInSeconds: () => 0.0001,
    evaluateMultiple: async (calls) => {
      const outs = [];
      for (const call of calls) {
        const args = [];
        for (const provider of call.args) args.push(await provider.value());
        outs.push(evaluate(args));
      }
      return outs;
    },
  };
}

/** Overloads an embedder adds to names formulas reference as callables. */
function addHostOverloads(packages, registry, implementations) {
  const { FormulaTypes, makeOkNumber, makeOkNull, makeOkList } = packages.definitions;
  registry.registerFunction({
    signatureId: 'LEN_NUMBER/v1',
    name: 'LEN',
    category: 'custom',
    description: 'Compatibility shape: the digit count of a number.',
    params: [{ name: 'number', type: FormulaTypes.number(true) }],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });
  implementations.register(
    'LEN_NUMBER/v1',
    simpleImplementation(([n]) =>
      typeof n === 'number'
        ? makeOkNumber('LEN', String(Math.trunc(Math.abs(n))).length)
        : makeOkNull('LEN'),
    ),
  );
  registry.registerFunction({
    signatureId: 'UPPER_LIST/v1',
    name: 'UPPER',
    category: 'custom',
    description: 'Compatibility shape: each text of a list in upper case.',
    params: [{ name: 'texts', type: FormulaTypes.list(FormulaTypes.text(true), true) }],
    returnType: FormulaTypes.list(FormulaTypes.text(true), true),
    purity: 'pure',
  });
  implementations.register(
    'UPPER_LIST/v1',
    simpleImplementation(([texts]) =>
      Array.isArray(texts)
        ? makeOkList(
            'UPPER',
            texts.map((t) => (typeof t === 'string' ? t.toUpperCase() : null)),
          )
        : makeOkNull('UPPER'),
    ),
  );
}

/** A higher-order function an embedder registers: MAP_ALL(list; "OP") calls OP(item). */
function addCustomHigherOrder(packages, registry, implementations) {
  const { FormulaTypes, makeOkList, makeOkNull, makeOkUnknown } = packages.definitions;
  registry.registerFunction({
    signatureId: 'MAP_ALL/v1',
    name: 'MAP_ALL',
    category: 'custom',
    description: 'Compatibility shape: a higher-order function an embedder registers.',
    templates: [{ name: 'T' }, { name: 'R' }],
    params: [
      {
        name: 'target',
        type: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
      },
      {
        name: 'operator',
        type: FormulaTypes.callable('function_or_operator', {
          paramTypes: [FormulaTypes.template('T', { nullable: true })],
          returnType: FormulaTypes.template('R', { nullable: true }),
          minArity: 1,
        }),
        literalOnly: true,
      },
    ],
    returnType: FormulaTypes.list(FormulaTypes.template('R', { nullable: true }), true),
    purity: 'pure',
  });
  implementations.register('MAP_ALL/v1', {
    estimateCostsInSeconds: () => 0.0001,
    evaluateMultiple: async (calls, ctx) => {
      const outs = [];
      for (const call of calls) {
        const target = await call.args[0].value();
        const name = await call.args[1].value();
        const operator = typeof name === 'string' ? ctx.registry.getOperator(name) : undefined;
        const candidates =
          typeof name === 'string' && !operator ? ctx.registry.listFunctionsByName(name) : [];
        const signatureId = operator
          ? operator.functionSignatureId
          : candidates.find((c) => ctx.resolver.get(c.signatureId))?.signatureId;
        const impl = signatureId ? ctx.resolver.get(signatureId) : undefined;
        if (!Array.isArray(target) || !impl) {
          outs.push(makeOkNull('MAP_ALL'));
          continue;
        }
        const constant = (value) => {
          const out = makeOkUnknown('const', value);
          return { output: async () => out, value: async () => value ?? null };
        };
        const results = await impl.evaluateMultiple(
          target.map((item, index) => ({ args: [constant(item)], callId: `${index}` })),
          ctx,
        );
        outs.push(
          makeOkList(
            'MAP_ALL',
            results.map((r) => r.value ?? null),
          ),
        );
      }
      return outs;
    },
  });
}

function applyShape(packages, name, registry, implementations) {
  if (name === 'reversioned-higher-order' || name === 'combined') {
    reversionHigherOrder(packages, registry, implementations);
  }
  if (name === 'host-overloads' || name === 'combined') {
    addHostOverloads(packages, registry, implementations);
  }
  if (name === 'custom-higher-order' || name === 'combined') {
    addCustomHigherOrder(packages, registry, implementations);
  }
}

function runtimeFor(packages, shape) {
  const { registry, implementations } = packages.coreFunctions.createCoreFormulaRuntime();
  const { FormulaTypes } = packages.definitions;
  registry.registerVariable({
    name: 'value',
    description: 'Compatibility input.',
    type: FormulaTypes.any(true),
  });
  registry.registerVariable({
    name: 'other',
    description: 'Compatibility input.',
    type: FormulaTypes.any(true),
  });
  applyShape(packages, shape, registry, implementations);
  return { registry, implementations };
}

/** Names whose result depends on the clock: a call to one of them with no arguments. */
function clockCalls(registry) {
  const names = new Set(
    registry
      .listFunctions()
      .filter((def) => def.purity === 'uncached')
      .map((def) => def.name.toUpperCase()),
  );
  return new RegExp(`\\b(${[...names].join('|')})\\s*\\(\\s*\\)`, 'i');
}

/** A JSON round trip, so outcomes compare the way the committed baseline stores them. */
function plain(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

async function outcomeOf(packages, runtime, clock, source) {
  const { parser, definitions, runner } = packages;
  try {
    const parsed = parser.parseFormula(source, { registry: runtime.registry });
    if (parsed.errors.length > 0) return { parse: parsed.errors.map((e) => e.code) };
    const compiled = definitions.optimizeRule(parsed, { registry: runtime.registry });
    if (compiled.errors.length > 0) return { optimize: compiled.errors.map((e) => e.code) };
    // A formula reading the clock compiles the same way but answers differently on every run.
    if (clock.test(source)) return { compiles: true };
    const runs = [];
    for (const variables of ENVIRONMENTS) {
      const out = await runner.evaluateRuleOutputAsync(compiled, {
        registry: runtime.registry,
        resolver: runtime.implementations,
        variables,
      });
      runs.push({
        value: plain(out.output.value),
        warnings: (out.output.warnings ?? []).map((w) => w.code),
        errors: out.errors.map((e) => e.code),
      });
    }
    return { runs };
  } catch (error) {
    return { threw: error instanceof Error ? error.name : 'unknown' };
  }
}

/**
 * Outcomes of every corpus formula under every registry shape, as `{ [shape]: outcome[] }` aligned
 * with `corpus.formulas`.
 * @param {Packages} packages
 * @param {{ formulas: Array<{ source: string }> }} corpus
 */
async function runCorpus(packages, corpus) {
  const byShape = {};
  for (const shape of SHAPE_NAMES) {
    const runtime = runtimeFor(packages, shape);
    const clock = clockCalls(runtime.registry);
    const outcomes = [];
    for (const { source } of corpus.formulas) {
      outcomes.push(await outcomeOf(packages, runtime, clock, source));
    }
    byShape[shape] = outcomes;
  }
  return byShape;
}

/** The distinct function names of the core registry (upper case), sorted. */
function coreFunctionNames(packages) {
  const { registry } = packages.coreFunctions.createCoreFormulaRuntime();
  return [...new Set(registry.listFunctions().map((def) => def.name.toUpperCase()))].sort();
}

module.exports = { ENVIRONMENTS, SHAPE_NAMES, runCorpus, coreFunctionNames };
