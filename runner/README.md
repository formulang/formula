# @formulang/runner

Asynchronous evaluation engine for compiled Formulang formulas. It takes a `TypedRule` produced by
[`@formulang/parser`](../parser/README.md) and evaluates it against runtime variables and a set of
function implementations, with purity-based caching, batched calls, resource limits, and a
per-node execution trace.

The runner never executes source text: parsing/type-checking and evaluation are separate steps, and
function _definitions_ (portable metadata) are resolved to executable _implementations_ only at
evaluation time. See [architecture](../docs/architecture.md) for how the packages fit together.

## Highlights

- **Structured failures, never rejections.** Evaluation always resolves — formula problems land in
  `errors` as structured `FormulaError`s and on the failing node, so hosts route on data, not
  exceptions ([best practices §6.3](../docs/best-practices.md#63-handle-structured-failures--and-do-not-mistake-empty-for-failure)).
- **Defense in depth at eval time.** The parse-time property allowlist and denylist are re-checked
  per node, and every runtime limit — steps, wall time, cost, list sizes — resolves as a structured
  `security` error ([architecture §4](../docs/architecture.md#4-security-model),
  [best practices §5.3](../docs/best-practices.md#53-resource-limits-are-your-dos-defense)).
- **Purity-driven caching.** Declared purity selects a host-owned cross-run cache with in-flight
  promise deduplication (`pure`), a per-run cache (`run_cached`), or no caching (`uncached`), and
  cache keys are version-scoped ([best practices §4.1](../docs/best-practices.md#41-choose-purity-deliberately)).
- **Cost budgets charged before invocation.** Implementations declare cost estimators and the
  estimate is charged against per-call and per-run budgets up front, so runaway calls are rejected
  instead of executed ([best practices §4.3](../docs/best-practices.md#43-cost-estimators-reject-expensive-calls-before-they-run)).
- **Wall-time guards on calls and resolvers.** Per-call wall time covers function implementations
  and variable resolvers alike, and a whole-run cap backs both — a slow fetch ends as a structured
  error, not a hung request ([best practices §4.4](../docs/best-practices.md#44-wall-time-limits-catch-what-estimates-miss)).
- **Lazy variable resolution.** Root variables and individual properties may be sync or async
  resolver functions that run only when evaluation reaches them — untaken branches never trigger
  fetches ([best practices §4.5](../docs/best-practices.md#45-lazy-variable-resolvers-skip-work-on-untaken-branches)).
- **Per-node execution tracing.** Every run yields a full output tree plus a flat map keyed by
  structure-stable node ids with source spans and skipped-branch markers — everything a debugging
  UI needs ([best practices §6](../docs/best-practices.md#6-observability-and-debugging)).
- **Redaction in traces.** Variables and functions registered with `redaction: 'mask'` appear in
  the trace as `{ __redacted: true }`, keeping secrets out of logs
  ([best practices §5.5](../docs/best-practices.md#55-redaction-log-pernode-not-the-output-tree)).
- **Deep-frozen inputs.** The `variables` object and everything reachable from it are best-effort
  frozen at the start of a run — formulas and their implementations cannot mutate host data
  ([best practices §4.2](../docs/best-practices.md#42-share-a-cross-run-cache-correctly)).
- **Evaluation by pinned signature id.** Calls resolve implementations by the exact `NAME/vN`
  version the compile bound — never by name re-resolution — so stored formulas keep evaluating
  identically while the library evolves ([best practices §2](../docs/best-practices.md#2-evolving-functions-without-breaking-stored-formulas)).

## Getting started

```sh
npm install @formulang/runner @formulang/parser @formulang/core-functions
```

You will usually also need `@formulang/parser` (everything starts with a compile) and
`@formulang/core-functions` (the built-in function library plus ready-made runtime wiring);
`@formulang/definitions` comes along as a dependency. There are no third-party runtime
dependencies. The shortest path to a value — compile once, then evaluate with variables:

```ts
import { createCoreFormulaRuntime } from '@formulang/core-functions';
import { FormulaTypes } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleAsync } from '@formulang/runner';

const { registry, implementations } = createCoreFormulaRuntime();

registry.registerVariable({
  name: 'value',
  description: 'A test input value.',
  type: FormulaTypes.object('Obj', { a: FormulaTypes.number(false) }, true),
});

const rule = parseFormula('value.a + 1', { registry });
if (rule.errors.length > 0) throw new Error(rule.errors[0].message);

const result = await evaluateRuleAsync(rule, {
  registry,
  resolver: implementations,
  variables: { value: { a: 123 } },
});

result.value; // 124
result.errors; // [] — structured FormulaError[], never thrown
result.perNode; // per-node trace keyed by AST node id
```

Optionally run `optimizeRule(rule, { registry })` (from `@formulang/definitions`) first to fold static subtrees.

## The Formulang packages

| Package                                                    | Role                                                              | You need it when                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| [`@formulang/definitions`](../definitions/README.md)       | Types, contracts, and the registry — the shared vocabulary        | You build registries, custom functions/variables, or editor tooling |
| [`@formulang/parser`](../parser/README.md)                 | Compiles formula source into a typed, validated AST (`TypedRule`) | Always — everything starts with a compile                           |
| **`@formulang/runner`** (you are here)                     | **Asynchronously evaluates compiled formulas**                    | **You execute formulas**                                            |
| [`@formulang/core-functions`](../core-functions/README.md) | Built-in function library + `createCoreFormulaRuntime()` wiring   | You want the standard library (most applications)                   |

`createCoreFormulaRuntime()` returns `{ registry, implementations }` — the data-only definitions
plus the matching executable implementations. `parseFormula(source, { registry })` compiles and
type-checks against that registry, and `evaluateRuleAsync` (this package) executes the result.

## Entry points

```ts
function evaluateRuleAsync(
  rule: TypedRule,
  ctx: EvaluateContext & { expectedReturnType?: FormulaType },
): Promise<EvaluateResultAsync>; // { value, errors, perNode }

function evaluateRuleOutputAsync(
  rule: TypedRule,
  ctx: EvaluateContext & { expectedReturnType?: FormulaType },
): Promise<EvaluateResultOutputAsync>; // { output: FormulaNodeOutput, errors, perNode }
```

- `evaluateRuleAsync` — the standard entry point. `value` is the root result (`null` when absent).
- `evaluateRuleOutputAsync` — same evaluation, but returns the full `FormulaNodeOutput` tree
  (`ok`, `value`, `valueKind`, `error`, `warnings`, ordered `children`, `skipped`, `span`), which is
  the source-of-truth representation for auditing a run.
- `evaluateVariableOutputAsync` — evaluates a variable-only AST (e.g. from
  `parseVariableReference`) against a `VariableOnlyRegistry`; no function resolver required.
- `evaluateRule` — synchronous evaluation is not supported; this always throws (see FAQ).

If `expectedReturnType` is set and the final value does not satisfy it, the run reports
`OUTPUT_TYPE_NOT_ALLOWED`.

## EvaluateContext

| Field       | Type                             | Purpose                                                                                                                                               |
| ----------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `registry`  | `FormulaRegistry`                | Definitions the rule was compiled against (functions, operators, variables).                                                                          |
| `resolver`  | `FunctionImplementationResolver` | Maps signature ids to executable implementations, e.g. `implementations` from `createCoreFormulaRuntime()`.                                           |
| `variables` | `Record<string, unknown>`        | Runtime values. A root value or object property may be a function; it is invoked lazily with `{ registry, limits, budget }` and may return a promise. |
| `limits?`   | `Partial<FormulaLimits>`         | Merged over `DEFAULT_FORMULA_LIMITS`.                                                                                                                 |
| `budget?`   | `FormulaEvaluationBudget`        | Shared step budget, for batching several runs under one allowance.                                                                                    |
| `cache?`    | `Map<string, unknown>`           | Shared cross-run result cache for `pure` calls.                                                                                                       |
| `pending?`  | `Map<string, Promise<unknown>>`  | Shared in-flight promise map for `pure` calls; concurrent identical calls are deduplicated to a single execution.                                     |

## Adjusting a run

### Lazy and async variables

Any root variable value — or any property of a variable object — may be a resolver function instead
of plain data. Resolvers may be sync or async, receive `{ registry, limits, budget }`, and run only
if evaluation reaches them, so data behind an untaken `IF` branch is never fetched:

```ts
const result = await evaluateRuleAsync(rule, {
  registry,
  resolver: implementations,
  variables: {
    value: { a: async () => 123 }, // per-property resolver
    // value: async () => ({ a: 123 }),  // ...or resolve the whole root lazily
  },
});
result.value; // 124
```

### Runtime limits and structured failures

Override any `FormulaLimits` field per run; violations end the affected subtree with a structured
`security` error instead of an exception. A variable resolver slower than the per-call cap:

```ts
const result = await evaluateRuleAsync(rule, {
  registry,
  resolver: implementations,
  variables: { value: () => new Promise((r) => setTimeout(() => r(1), 50)) }, // a slow fetch
  limits: { maxFunctionWallTimeMs: 10 },
});

result.value; // null
result.errors[0]; // { kind: 'security', code: 'WALL_TIME_LIMIT_EXCEEDED',
//   message: 'Variable resolver wall time exceeded', span: { start: 0, end: 5 } }
```

The cost budget works the same way: estimates come from implementations' `estimateCostsInSeconds`;
calls without an estimator, and every call of a control-flow function such as `IF`, count 0.05
units, so
`limits: { maxTotalCostUnits: 0.04 }` fails any formula containing `IF` with `COST_LIMIT_EXCEEDED`.
An implementation that calls another implementation itself, as a higher-order function does, can
have each such call charged the same way through the execution context's
`chargeCall(signatureId, args)`, which the runner provides and which charges by the same rule, a
control-flow callee 0.05 included: `FILTER_BY` charges each call of its operator so, while `EACH`,
`FILTER`, `FILTER_PROPERTY` and `REDUCE`, as in 1.0.0, are charged only their own call, the
estimate of the first three and the flat 0.05 of `REDUCE`, a control-flow function.

### Tracing a run with the per-node output tree

`evaluateRuleOutputAsync` returns the full `FormulaNodeOutput` tree; both entry points return
`perNode`, a flat map from stable AST node ids to what each node produced, with masking applied:

```ts
registry.registerVariable({
  name: 'api_key',
  description: 'A secret credential.',
  type: FormulaTypes.text(false),
  redaction: 'mask',
});

const rule = parseFormula('IF(STARTS_WITH(api_key; "sk-"); "live"; "test")', { registry });
const { output, perNode } = await evaluateRuleOutputAsync(rule, {
  registry,
  resolver: implementations,
  variables: { api_key: 'sk-12345' },
});

output.value; // 'live'
output.children[2].skipped; // true — the "test" branch was never evaluated
perNode;
// {
//   'IF-0/STARTS_WITH-0/VAR_API_KEY-0': { span: …, value: { __redacted: true }, redacted: true },
//   'IF-0/STARTS_WITH-0/TEXT-0':        { span: …, value: 'sk-' },
//   'IF-0/STARTS_WITH-0':               { span: …, value: true },
//   'IF-0/TEXT-0':                      { span: …, value: 'live' },
//   'IF-0/TEXT-1':                      { span: …, skipped: true },
//   'IF-0':                             { span: …, value: 'live' },
// }
```

Masking applies to the trace only: the raw value still flows through evaluation and appears in the
`output` tree (`'sk-12345'` above) — log `perNode`, not the output tree, where secrets are
involved. Values _derived_ from a masked variable by non-redacted functions (the `true` above) are
logged normally; mark such functions with `redaction: 'mask'` too if their outputs are sensitive.

### Reusing the cache across runs

Results of `pure` functions can outlive a single evaluation: pass your own `cache` and `pending`
maps and reuse them. Concurrent identical calls are deduplicated through `pending`:

```ts
// rule compiles UPPER(name); variables is { name: 'ada' }
const cache = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();

await evaluateRuleAsync(rule, { registry, resolver: implementations, variables, cache, pending });
cache; // Map(1) { 'UPPER/v1|s:"ada"' => 'ADA' }

// Later runs passing the same maps serve identical pure calls from the cache.
await evaluateRuleAsync(rule, { registry, resolver: implementations, variables, cache, pending });
```

The maps are plain `Map`s owned by you — size bounds and eviction are the host's responsibility.
Only `pure` results are shared; see the FAQ for what is never cached.

## Evaluation model

**Async tree walk.** The runner walks the typed AST (`literal`, `variable`, `property`, `wildcard`,
`call`); every node consumes step budget and checks the wall clock, and variable resolvers are
awaited as reached.

**Eager batch vs. lazy short-circuit.** Arguments are wrapped in lazy value providers; ordinary
functions get them all evaluated eagerly (preserving null checks against declared parameter types)
before the implementation's `evaluateMultiple(calls, ctx)` is invoked. Functions declared with
`controlFlow: true` (`AND`, `OR`, `NOT`, `IF`, `SWITCH`, `REDUCE` in the core definitions) pull
only the arguments they need — untaken branches are marked `skipped: true`. List operations batch
their callee: `FILTER(value; "PRED")` over `[1, 2, 3]` is a single `evaluateMultiple` call with
three `BatchEvaluationCall`s, so implementations can fan out I/O.

**Purity-based caching.** Declared per function definition: `pure` results go to the cross-run
`cache`/`pending` maps from the context (per-run maps are created when omitted), `run_cached`
results die with the run, and `uncached` functions are invoked every time. Cache keys combine the
signature id, argument values (stable keys for primitives and small primitive arrays, identity
keys for objects), and the expected cast; the FAQ lists what is never cached.

**Per-node trace.** `perNode` maps AST node ids to
`{ span?, value?, error?, skipped?, redacted?, truncated? }`. Logged values are bounded by the
`maxLogged*` limits: long strings, lists, and objects are replaced with `{ __truncated: true, ... }`
previews (with lengths and hashes) and flagged `truncated`.

**Failure semantics.** Evaluation does not throw: problems are appended to `errors` as structured
`FormulaError`s (`kind`, `code`, `message`, `span`) and mirrored on the failing node (`ok: false`
in the output tree, `error` in `perNode`). Typical codes: `UNBOUND_FUNCTION`, `NULL_NOT_ALLOWED`,
`EVAL_CRASH` (an implementation threw), `DENYLISTED_PROPERTY` / `PROPERTY_NOT_ALLOWLISTED`
(re-checked at runtime), and the limit codes below. Non-finite numbers normalize to `null`.

## Resource limits at evaluation time

All limits live in `FormulaLimits` (`@formulang/definitions`) and can be overridden per run via
`ctx.limits`. The eval-time controls:

| Limit                                                                                                                                                                  | Error code                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `maxEvaluationSteps` (step budget, also consumed per list item)                                                                                                        | `EVAL_LIMIT_EXCEEDED`                                  |
| `maxWallTimeMs` (whole run)                                                                                                                                            | `WALL_TIME_LIMIT_EXCEEDED`                             |
| `maxFunctionWallTimeMs` (per call, incl. variable resolvers)                                                                                                           | `WALL_TIME_LIMIT_EXCEEDED`                             |
| `maxFunctionCostUnits` / `maxTotalCostUnits` (from implementations' `estimateCostsInSeconds`; a call without an estimator, or of a control-flow function, counts 0.05) | `FUNCTION_COST_LIMIT_EXCEEDED` / `COST_LIMIT_EXCEEDED` |
| `maxListLength` (wildcard / `EACH` / `FILTER` inputs)                                                                                                                  | `LIST_TOO_LARGE`                                       |
| `maxWildcardOutputLength` (flattened `list.*.prop` output)                                                                                                             | `WILDCARD_OUTPUT_TOO_LARGE`                            |

Cost and function-wall-time overruns surface as `security`-kind errors; a call that exceeds its
estimated cost cap is rejected before it runs.

## FAQ

**Why is evaluation async-only? What does `evaluateRule` do?**
`evaluateRule` always throws (`Synchronous formula execution is deprecated; use evaluateRuleAsync`).
Variable resolvers and implementations may return promises, and deduplicating concurrent identical
`pure` calls requires sharing in-flight promises — so the engine is async end to end.

**What actually persists across runs?**
Nothing, unless you pass it in: only `pure` results, in the `cache`/`pending` maps you supply
(see [Reusing the cache](#reusing-the-cache-across-runs)). Errors, warning-carrying outputs,
control-flow calls, and calls with strings over `maxCacheableStringLength` are never cached.

**How do I debug what a formula did?**
Read `result.perNode`; for the nested view (children, warnings, value kinds) use
`evaluateRuleOutputAsync` — see [Tracing a run](#tracing-a-run-with-the-per-node-output-tree).

**How do I keep secrets out of logs?**
Register the variable or function with `redaction: 'mask'` and log `perNode`, never the raw output
tree — see [Tracing a run](#tracing-a-run-with-the-per-node-output-tree).

**What happens when a formula fails at runtime?**
You still get a resolved result: failures land in `errors`, the failing node is `ok: false` with
unevaluated children marked `skipped`, and `value` is `null` — see
[Failure semantics](#evaluation-model) for the typical codes.

**Are runtime limits different from parse limits?**
Same `FormulaLimits` object (defaulting to `DEFAULT_FORMULA_LIMITS`), different subsets:
`parseFormula` enforces source-shape limits (source length, tokens, paren depth, AST nodes), the
runner execution limits (steps, wall time, cost, list sizes, logging caps). If you customize
limits, pass the same overrides to both calls.

**Can I cap a batch of evaluations as a whole?**
Yes. Pass one `FormulaEvaluationBudget` (from `@formulang/definitions`) as `ctx.budget` to several
evaluations and they draw steps from a single allowance.

## See also

- [Architecture](../docs/architecture.md) — how definitions, parser, runner, and core-functions interact.
- [Extending](../docs/extending.md) — registering your own functions, variables, and implementations.
- [Built-in functions](../docs/functions.md) — what `createCoreFormulaRuntime()` provides.

## Maintenance

Development of the Formulang packages is sponsored by [Content Sync](https://content-sync.io).

## License

[MIT](LICENSE)
