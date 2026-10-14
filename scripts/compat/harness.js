'use strict';

/**
 * Compatibility harness. It parses and evaluates formulas under registry shapes and returns
 * outcomes that compare across versions: the parse error codes or, for each variable environment,
 * the value with its warning and error codes and the value (or error code) of every node, with
 * the clock frozen, and whether the formula named a function the current source adds.
 *
 * `generate-baseline.js` ran it against the built packages of 1.0.0 to write
 * `baseline-1.0.0.json`; `runner/src/compat.spec.ts` runs it against the source and requires the
 * same outcomes. The packages are passed in, so one harness serves both, and so are the names the
 * current source adds to 1.0.0's: each gets a shape in which the host registered its own function
 * under that name, probe formulas that name it, and the first one is data in one environment.
 *
 * @typedef {{ definitions: any, parser: any, runner: any, coreFunctions: any }} Packages
 */

/** Two variable environments of plain data (`environmentsFor` adds one holding an added name). */
const ENVIRONMENTS = [
  { value: [3, 1, 2], other: 'a b' },
  { value: 'Hello, world. Bye!', other: [1, 'x'] },
];

/** The registry shapes an embedder builds by hand on top of the core registry. */
const BASE_SHAPES = [
  'core',
  'reversioned-higher-order',
  'host-overloads',
  'custom-higher-order',
  'combined',
];

const HOST_FUNCTION_SHAPE = 'host-function:';

/**
 * Every registry shape: the base shapes, then, for each name in `addedNames`, the shape in which
 * the host registered its own function under that name.
 * @param {readonly string[]} addedNames
 */
function shapeNames(addedNames) {
  return [...BASE_SHAPES, ...addedNames.map((name) => `${HOST_FUNCTION_SHAPE}${name}`)];
}

/** The distinct function names of the core registry (upper case), sorted. */
function coreFunctionNames(packages) {
  const { registry } = packages.coreFunctions.createCoreFormulaRuntime();
  return [...new Set(registry.listFunctions().map((def) => def.name.toUpperCase()))].sort();
}

/**
 * The function names the core registry of `packages` has and `names` lacks, sorted.
 * @param {Packages} packages
 * @param {readonly string[]} names
 */
function addedFunctionNames(packages, names) {
  return coreFunctionNames(packages).filter((name) => !names.includes(name));
}

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

/**
 * The implementation a host's higher-order function calls for `name`: the function behind an
 * operator token, otherwise the first definition of the name that has an implementation, as the
 * core higher-order functions resolve it.
 */
function resolveCallable(ctx, name) {
  if (typeof name !== 'string') return undefined;
  const operator = ctx.registry.getOperator(name);
  const signatureId = operator
    ? operator.functionSignatureId
    : ctx.registry.listFunctionsByName(name).find((c) => ctx.resolver.get(c.signatureId))
        ?.signatureId;
  return signatureId ? ctx.resolver.get(signatureId) : undefined;
}

/** A value provider for an argument a host's higher-order function passes on. */
function constant(packages, value) {
  const out = packages.definitions.makeOkUnknown('const', value);
  return { output: async () => out, value: async () => value ?? null };
}

/** A higher-order function an embedder registers: MAP_ALL(list; "OP") calls OP(item). */
function addCustomHigherOrder(packages, registry, implementations) {
  const { FormulaTypes, makeOkList, makeOkNull } = packages.definitions;
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
        const impl = resolveCallable(ctx, await call.args[1].value());
        if (!Array.isArray(target) || !impl) {
          outs.push(makeOkNull('MAP_ALL'));
          continue;
        }
        const results = await impl.evaluateMultiple(
          target.map((item, index) => ({ args: [constant(packages, item)], callId: `${index}` })),
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

/**
 * The host's own function under `name`: `name(target; "OP"; extra; more)` counts the items of
 * `target` for which `OP(item)` is true. A higher-order function that answers a number and whose
 * callable takes exactly one argument while two more arguments follow it, so a version that gave
 * the name a built-in's invocation (passing the callable a second argument) or a built-in's result
 * type (a list) would change what its calls compile to. No built-in takes four arguments of these
 * types, so its own calls still reach it.
 */
function addHostFunction(packages, registry, implementations, name) {
  const { FormulaTypes, makeOkNull, makeOkNumber } = packages.definitions;
  const signatureId = `HOST_${name}/v1`;
  registry.registerFunction({
    signatureId,
    name,
    category: 'custom',
    description: 'Compatibility shape: a function the host registered under this name.',
    templates: [{ name: 'T' }],
    params: [
      {
        name: 'target',
        type: FormulaTypes.list(FormulaTypes.template('T', { nullable: true }), true),
      },
      {
        name: 'operator',
        type: FormulaTypes.callable('function_or_operator', {
          paramTypes: [FormulaTypes.template('T', { nullable: true })],
          returnType: FormulaTypes.boolean(true),
          minArity: 1,
          maxArity: 1,
        }),
        literalOnly: true,
      },
      { name: 'extra', type: FormulaTypes.any(true) },
      { name: 'more', type: FormulaTypes.any(true) },
    ],
    returnType: FormulaTypes.number(true),
    purity: 'pure',
  });
  implementations.register(signatureId, {
    estimateCostsInSeconds: () => 0.0001,
    evaluateMultiple: async (calls, ctx) => {
      const outs = [];
      for (const call of calls) {
        const target = await call.args[0].value();
        const impl = resolveCallable(ctx, await call.args[1].value());
        if (!Array.isArray(target) || !impl) {
          outs.push(makeOkNull(name));
          continue;
        }
        const results = await impl.evaluateMultiple(
          target.map((item, index) => ({ args: [constant(packages, item)], callId: `${index}` })),
          ctx,
        );
        outs.push(makeOkNumber(name, results.filter((r) => r.value === true).length));
      }
      return outs;
    },
  });
}

/**
 * Formulas that name `name`: calls of the host's function of that name (directly, on a list typed
 * when the formula compiles, in arithmetic, and through core higher-order functions), and calls of
 * the name with one argument and with two, and as the callable of a higher-order call at the first
 * level (also written in lower case) and at the second.
 * @param {string} name
 */
function probesFor(name) {
  const reference = JSON.stringify(name);
  return [
    `${name}(value; "ISNUMBER"; 1; 2)`,
    `${name}(LIST(1; 2; 3); "ISNUMBER"; 1; 2) + 1`,
    `${name}(LIST("a"; "bb"); "ISTEXT"; other; value)`,
    `EACH(LIST(value); ${reference}; "ISNUMBER"; 1; 2)`,
    `EACH(LIST(LIST(value)); "EACH"; ${reference}; "ISNUMBER"; 1; 2)`,
    `${name}(value)`,
    `${name}(value; 1)`,
    `${name}(other; value)`,
    `EACH(LIST(value); ${reference})`,
    `EACH(LIST(value); ${JSON.stringify(name.toLowerCase())})`,
    `EACH(LIST(value); "FILTER"; ${reference})`,
    `EACH(LIST(LIST(value)); "EACH"; ${reference})`,
    `EACH(LIST(LIST(value)); "EACH"; ${reference}; 1)`,
  ];
}

/**
 * Formulas whose nested higher-order call takes its callable's name from a value or an expression
 * when it runs: in the last environment, `other` holds an added name.
 */
const RUN_TIME_NAMES = [
  'EACH(LIST(LIST(value)); "EACH"; other)',
  'EACH(LIST(LIST(value)); "EACH"; UPPER(other))',
];

/**
 * The formulas the harness evaluates: the corpus, the probes of every added name, and the formulas
 * that take a callable's name from a value or an expression.
 * @param {{ formulas: Array<{ source: string }> }} corpus
 * @param {readonly string[]} addedNames
 */
function formulasFor(corpus, addedNames) {
  return [
    ...corpus.formulas.map((f) => f.source),
    ...addedNames.flatMap(probesFor),
    ...RUN_TIME_NAMES,
  ];
}

/**
 * The variable environments every formula that compiles is evaluated in: two of plain data, and
 * one whose `other` holds the first added name in lower case, a name a formula can pass on as data.
 * @param {readonly string[]} addedNames
 */
function environmentsFor(addedNames) {
  const [name] = addedNames;
  return name === undefined
    ? ENVIRONMENTS
    : [...ENVIRONMENTS, { value: [3, 1, 2], other: name.toLowerCase() }];
}

function applyShape(packages, shape, registry, implementations) {
  if (shape === 'reversioned-higher-order' || shape === 'combined') {
    reversionHigherOrder(packages, registry, implementations);
  }
  if (shape === 'host-overloads' || shape === 'combined') {
    addHostOverloads(packages, registry, implementations);
  }
  if (shape === 'custom-higher-order' || shape === 'combined') {
    addCustomHigherOrder(packages, registry, implementations);
  }
  if (shape.startsWith(HOST_FUNCTION_SHAPE)) {
    addHostFunction(packages, registry, implementations, shape.slice(HOST_FUNCTION_SHAPE.length));
  }
}

/**
 * The core runtime with every definition of a name in `retired` retired, the two variables, and
 * the shape applied.
 */
function runtimeFor(packages, shape, retired) {
  const { registry, implementations } = packages.coreFunctions.createCoreFormulaRuntime();
  for (const def of registry.listFunctions()) {
    if (retired.includes(def.name.toUpperCase())) registry.retireFunction(def.signatureId);
  }
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

/** The instant the clock reads while the harness evaluates, so formulas that read it compare. */
const FROZEN_CLOCK = Date.UTC(2024, 4, 15, 13, 45, 30);

/** Runs `run` with `Date` reading `FROZEN_CLOCK` when built without arguments. */
async function withFrozenClock(run) {
  const RealDate = globalThis.Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(FROZEN_CLOCK);
      else super(...args);
    }

    static now() {
      return FROZEN_CLOCK;
    }
  }
  globalThis.Date = FrozenDate;
  try {
    return await run();
  } finally {
    globalThis.Date = RealDate;
  }
}

/**
 * `registry`, recording every function name it is asked for: a formula names a function when the
 * parser or a higher-order function looks the name up, whether the formula writes it, in any letter
 * case, or a value or an expression produces it when the call runs.
 */
function recordingLookups(registry, asked) {
  return new Proxy(registry, {
    get(target, property) {
      const member = Reflect.get(target, property, target);
      if (typeof member !== 'function') return member;
      if (property !== 'listFunctionsByName') return member.bind(target);
      return (name, ...rest) => {
        asked.add(String(name).toUpperCase());
        return member.call(target, name, ...rest);
      };
    },
  });
}

/** A JSON round trip, so outcomes compare the way the committed baseline stores them. */
function plain(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function codes(entries) {
  return (entries ?? []).map((entry) => entry.code);
}

/**
 * Every node of a run by node id: its value, its error code, and whether it was skipped, redacted
 * or truncated. A node with a value and nothing else is stored as `[value]`, any other as an object
 * of those fields.
 */
function nodesOf(perNode) {
  const nodes = {};
  for (const id of Object.keys(perNode).sort()) {
    const entry = perNode[id];
    const node = {};
    if ('value' in entry) node.value = plain(entry.value);
    if (entry.error) node.error = entry.error.code;
    if (entry.skipped) node.skipped = true;
    if (entry.redacted) node.redacted = true;
    if (entry.truncated) node.truncated = true;
    const keys = Object.keys(node);
    nodes[id] = keys.length === 1 && keys[0] === 'value' ? [node.value] : node;
  }
  return nodes;
}

function runOf(out) {
  return {
    value: plain(out.output.value),
    warnings: codes(out.output.warnings),
    errors: codes(out.errors),
    nodes: nodesOf(out.perNode),
  };
}

/** The outcome of `source`, without whether it names an added function. */
async function evaluationOf(packages, registry, implementations, environments, source) {
  const { parser, definitions, runner } = packages;
  const parsed = parser.parseFormula(source, { registry });
  if (parsed.errors.length > 0) return { parse: codes(parsed.errors) };
  const compiled = definitions.optimizeRule(parsed, { registry });
  if (compiled.errors.length > 0) return { optimize: codes(compiled.errors) };
  const runs = [];
  for (const variables of environments) {
    const out = await runner.evaluateRuleOutputAsync(compiled, {
      registry,
      resolver: implementations,
      variables,
    });
    runs.push(runOf(out));
  }
  // Runs alike in every environment (a formula that reads no variable) are stored once.
  const first = JSON.stringify(runs[0]);
  return runs.every((run) => JSON.stringify(run) === first) ? { run: runs[0] } : { runs };
}

/**
 * The outcome of `source`: its parse errors or its runs, and `namesAdded: true` when parsing or
 * running it asked the registry for a name in `addedNames`.
 */
async function outcomeOf(packages, runtime, environments, addedNames, source) {
  const asked = new Set();
  const registry = recordingLookups(runtime.registry, asked);
  let outcome;
  try {
    outcome = await evaluationOf(packages, registry, runtime.implementations, environments, source);
  } catch (error) {
    outcome = { threw: error instanceof Error ? error.name : 'unknown' };
  }
  return addedNames.some((name) => asked.has(name)) ? { ...outcome, namesAdded: true } : outcome;
}

/**
 * Outcomes of every formula of `formulasFor(corpus, addedNames)` under every shape of
 * `shapeNames(addedNames)`, in the environments of `environmentsFor(addedNames)` and with the clock
 * at `FROZEN_CLOCK`, as `{ [shape]: outcome[] }` aligned with the formulas. With `retired`, every
 * definition of those names is retired from the core registry before the shape is built.
 * @param {Packages} packages
 * @param {{ formulas: Array<{ source: string }> }} corpus
 * @param {readonly string[]} addedNames
 * @param {readonly string[]} [retired]
 */
async function runCorpus(packages, corpus, addedNames, retired = []) {
  const formulas = formulasFor(corpus, addedNames);
  const environments = environmentsFor(addedNames);
  return withFrozenClock(async () => {
    const byShape = {};
    for (const shape of shapeNames(addedNames)) {
      const runtime = runtimeFor(packages, shape, retired);
      const outcomes = [];
      for (const source of formulas) {
        outcomes.push(await outcomeOf(packages, runtime, environments, addedNames, source));
      }
      byShape[shape] = outcomes;
    }
    return byShape;
  });
}

module.exports = {
  ENVIRONMENTS,
  FROZEN_CLOCK,
  RUN_TIME_NAMES,
  BASE_SHAPES,
  HOST_FUNCTION_SHAPE,
  environmentsFor,
  shapeNames,
  coreFunctionNames,
  addedFunctionNames,
  addHostFunction,
  probesFor,
  formulasFor,
  runCorpus,
};
