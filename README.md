# Formulang

An open-source, safe, embeddable, strongly-typed formula language for TypeScript and JavaScript.

[![CI](https://github.com/formulang/formula/actions/workflows/ci.yml/badge.svg)](https://github.com/formulang/formula/actions/workflows/ci.yml)
[![@formulang/definitions](https://img.shields.io/npm/v/@formulang%2Fdefinitions?label=%40formulang%2Fdefinitions)](https://www.npmjs.com/package/@formulang/definitions)
[![@formulang/parser](https://img.shields.io/npm/v/@formulang%2Fparser?label=%40formulang%2Fparser)](https://www.npmjs.com/package/@formulang/parser)
[![@formulang/runner](https://img.shields.io/npm/v/@formulang%2Frunner?label=%40formulang%2Frunner)](https://www.npmjs.com/package/@formulang/runner)
[![@formulang/core-functions](https://img.shields.io/npm/v/@formulang%2Fcore-functions?label=%40formulang%2Fcore-functions)](https://www.npmjs.com/package/@formulang/core-functions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Formulang lets your users write spreadsheet-style formulas — `IF(order.price * order.quantity >= 100; "bulk"; "retail")` — and lets you compile, type-check, and evaluate them inside your application without trusting the input.

<a id="why"></a>

## Why Formulang

Thirteen capabilities every embedder gets out of the box, and thirteen more for operating formulas at scale.

### Core capabilities

- **Spreadsheet-style formula language.** 113 built-in functions covering math, aggregation, logic and comparison, text (including word, sentence and line segmentation, phrase matching, and the text of HTML and markdown), lists (including slicing, keyed filtering and grouping), date and time, control flow, and type and empty ([function reference](docs/functions.md)).
- **Strong static typing.** Every literal, variable, property, and call is bound to a type at compile time; argument type mismatches, unresolvable overloads, and nullability violations are compile errors (`ARGUMENT_TYPE_MISMATCH`, `NO_MATCHING_OVERLOAD`, `NULL_NOT_ALLOWED`), reported as structured diagnostics with exact source spans — before anything executes ([architecture §2.4](docs/architecture.md#24-type-binding-and-overload-resolution)).
- **Return-type analysis.** Every compiled formula reports its result type, and every AST node its bound type, nullability included — `1 + 2 * 3` compiles to `number?`, `EACH(LIST("a";"bb"); "LEN")` to `List<number?>?` — so editors can show result types before execution and hosts can require, say, a number-returning formula by checking `isAssignable` against `rule.returnType` ([parser README](parser/README.md#the-typedrule-result)).
- **Rich data-type vocabulary.** `FormulaType` is a JSON-serializable union of ten kinds — `any`, `null`, `boolean`, `number`, `text`, `template` (per-function generics), `callable` (typed function and operator references), `list`, `object` (a clarifier tag plus a per-property type allowlist), and `union` — with explicit nullability on every type, declared as plain data ([definitions README](definitions/README.md#types-formulatype-and-formulatypes)).
- **Compiling reports errors instead of throwing.** Malformed, hostile, or huge input yields structured parse, type, security, and config errors — safe to expose directly in editors; what still throws (a registry that fails while the parser binds, and a tree too deep to bind under limits raised far past the defaults) is in the [parser README](parser/README.md#why-are-errors-collected-instead-of-thrown).
- **Asynchronous evaluation with structured results.** Formula failures resolve as data — per-node errors and warnings — and never reject or crash the host ([runner README](runner/README.md#evaluation-model)).
- **Security-first evaluation of untrusted input.** Property access is allowlisted through typed object definitions; `__proto__`/`prototype`/`constructor` and all `__`-prefixed names are denylisted; both guards are enforced at parse time and re-checked at evaluation time as defense in depth ([architecture §4](docs/architecture.md#4-security-model)).
- **Resource limits as DoS defense.** Source length, token and AST-node counts, nesting depth, evaluation steps, wall time, cost budgets, list sizes, a regex safety guard, and a fixed bound of 250 code units on a phrase the phrase functions search for — every violation is a structured `security` error ([best practices §5.3](docs/best-practices.md#53-resource-limits-are-your-dos-defense)).
- **Zero third-party runtime dependencies.** Every published package depends only on the other Formulang packages — nothing else enters your dependency tree ([packages](#the-formulang-packages)).
- **First-class TypeScript.** All packages are written in strict-mode TypeScript and ship complete `.d.ts` declarations with declaration maps; the embedding API — `TypedRule`, `FormulaType`, registries, evaluation contexts — is fully typed, and the published CommonJS builds work from plain JavaScript just as well ([CONTRIBUTING.md](CONTRIBUTING.md#code-style)).
- **Configurable syntax for locales.** Argument separator `;` or `,`, decimal separator `.` or `,` — match your users' regional convention ([language guide](docs/language.md#configurable-punctuation)).
- **Extensible registry.** Custom functions under versioned `NAME/vN` signature ids, custom operators, same-name overloads with distinguishable shapes, and typed custom variables ([extending guide](docs/extending.md)).
- **Portable, data-only definitions.** Definitions and parser contain no Node-API imports and run in browsers and editors for completion and validation; execution lives server-side ([architecture §1.1](docs/architecture.md#11-why-definitions-and-core-functions-are-separate-packages)).

### Advanced capabilities

- **Idempotent re-evaluation and version pinning.** Compiled formulas pin exact function versions (signature ids) and survive JSON round-trips byte for byte — store the source, compiled rule, and syntax config, and stored formulas keep evaluating identically while the function library evolves, with retired definitions marked `legacy` and their implementations staying registered ([best practices §1–2](docs/best-practices.md#1-persisting-formulas-and-idempotent-re-evaluation)).
- **Requirements introspection.** Every compiled formula reports the variables it reads (full accessor paths, wildcards included), the exact function versions it uses, and declared external data — enabling data prefetch, capability gating, and proactive migration ([best practices §3.3–3.4](docs/best-practices.md#33-drive-data-loading-and-authorization-from-requirements)).
- **Static analysis and constant folding.** Rules flagged `static` can be precomputed at save time; `optimizeRule` folds parser-marked predictable values ([best practices §1.4](docs/best-practices.md#14-precompute-static-rules)).
- **Purity-driven caching.** Per-function purity (`pure` / `run_cached` / `uncached`) selects between a host-owned cross-run cache with in-flight promise deduplication, a per-run cache, or no caching; cache keys are version-scoped ([best practices §4.1–4.2](docs/best-practices.md#41-choose-purity-deliberately)).
- **Cost accounting.** Implementations declare cost estimators, and budgets are charged before invocation — runaway formulas are rejected instead of executed ([best practices §4.3](docs/best-practices.md#43-cost-estimators-reject-expensive-calls-before-they-run)).
- **Wall-time guards.** Per-call limits cover both function implementations and variable resolvers, with a separate limit for the whole run ([best practices §4.4](docs/best-practices.md#44-wall-time-limits-catch-what-estimates-miss)).
- **Lazy async variable resolution.** Root- and property-level resolvers run only when evaluation actually reaches them — untaken branches never trigger fetches ([best practices §4.5](docs/best-practices.md#45-lazy-variable-resolvers-skip-work-on-untaken-branches)).
- **Per-node execution tracing.** A full output tree plus a flat per-node map keyed by structure-stable node ids with source spans, skipped branches marked — ready for debugging UIs ([best practices §6](docs/best-practices.md#6-observability-and-debugging)).
- **Redaction.** Variables and functions marked `redaction: 'mask'` are masked in traces (`{ __redacted: true }`), keeping secrets out of logs ([best practices §5.5](docs/best-practices.md#55-redaction-log-pernode-not-the-output-tree)).
- **Multi-tenant isolation.** Registries are instances — per-tenant function and variable sets, and tenant-scoped caches with no cross-tenant bleed ([best practices §5.4](docs/best-practices.md#54-per-tenant-registries--and-per-tenant-caches)).
- **Override and wrap built-ins.** Implementation registration is last-wins, so hosts can wrap any function with metrics, audit logging, or replacements ([core-functions README](core-functions/README.md#overriding-a-built-in-implementation)).
- **Batch-oriented function implementations.** `evaluateMultiple` receives grouped argument sets — the eager-batch pattern the built-ins use — so implementations can fan out I/O ([extending §3.1](docs/extending.md#31-the-eager-batch-pattern)).
- **Frozen inputs.** Variable data is deep-frozen during evaluation — formulas cannot mutate host data ([best practices §4.2](docs/best-practices.md#42-share-a-cross-run-cache-correctly)).

## Getting started

**Which packages do I need?** For an application that evaluates formulas, all four below — they share one version and have zero third-party runtime dependencies. Slimmer setups (parse-only editor tooling, custom function libraries) are covered in [The Formulang packages](#the-formulang-packages).

```sh
npm install @formulang/core-functions @formulang/definitions @formulang/parser @formulang/runner
```

### Quickstart

```ts
import { createCoreFormulaRuntime } from '@formulang/core-functions';
import { FormulaTypes, optimizeRule } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleAsync } from '@formulang/runner';

// 1. Create a runtime: a registry of definitions plus executable implementations.
const { registry, implementations } = createCoreFormulaRuntime();

// 2. Declare the variables formulas may read. Only declared variables and
//    allow-listed properties are accessible.
registry.registerVariable({
  name: 'order',
  description: 'The order being classified.',
  type: FormulaTypes.object('Order', {
    price: FormulaTypes.number(),
    quantity: FormulaTypes.number(),
  }),
});

// 3. Compile: parse + type-check against the registry, then optimize.
const source = 'IF(order.price * order.quantity >= 100; "bulk"; "retail")';
const parsed = parseFormula(source, { registry });
const compiled = optimizeRule(parsed, { registry });
// parsed.errors and compiled.errors hold structured parse/type errors (both empty here).

// 4. Evaluate asynchronously with concrete variable values.
const result = await evaluateRuleAsync(compiled, {
  registry,
  resolver: implementations,
  variables: { order: { price: 25, quantity: 4 } },
});

console.log(result.value); // "bulk"
```

The example uses top-level `await`; run it as an ES module or wrap it in an async function. None of the three calls throws on a bad formula under the default limits — parse, type, security, and runtime problems all surface as structured errors on `parsed.errors`, `compiled.errors`, and `result.errors`.

Where to go next:

- Compile options (argument/decimal separators, parse-time limits): [parser/README.md](parser/README.md).
- Evaluation options (limits, caching, budgets, lazy variables): [runner/README.md](runner/README.md).
- Registering your own functions and implementations: [core-functions/README.md](core-functions/README.md) and [docs/extending.md](docs/extending.md).

## The Formulang packages

| Package                                                 | Role                                                              | You need it when                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| [`@formulang/definitions`](definitions/README.md)       | Types, contracts, and the registry — the shared vocabulary        | You build registries, custom functions/variables, or editor tooling |
| [`@formulang/parser`](parser/README.md)                 | Compiles formula source into a typed, validated AST (`TypedRule`) | Always — everything starts with a compile                           |
| [`@formulang/runner`](runner/README.md)                 | Asynchronously evaluates compiled formulas                        | You execute formulas                                                |
| [`@formulang/core-functions`](core-functions/README.md) | Built-in function library + `createCoreFormulaRuntime()` wiring   | You want the standard library (most applications)                   |

They compose exactly as in the quickstart: `createCoreFormulaRuntime()` (core-functions) returns a `registry` of definitions plus the matching executable `implementations`; `parseFormula` (parser) compiles source text against that registry into a `TypedRule`; `evaluateRuleAsync` (runner) executes the compiled rule using the implementations. Everything the packages share — types, AST shapes, registry contracts, limits, error codes — lives in definitions, which is why the other three depend on it.

## How it works

A formula moves through a fixed pipeline: source text is tokenized and parsed into an AST; every node is then type-bound against a registry of variable, function, and operator definitions, including overload resolution. The result is a `TypedRule` — the AST plus its return type, requirements (variables read, functions used), and any structured errors. `optimizeRule` folds predictable subtrees, and the runner evaluates the compiled rule asynchronously, resolving function implementations by signature id and enforcing resource limits along the way. See [docs/architecture.md](docs/architecture.md) for the full picture.

## Documentation

- [docs/language.md](docs/language.md) — formula language reference: syntax, types, operators, separators.
- [docs/functions.md](docs/functions.md) — built-in function reference.
- [docs/architecture.md](docs/architecture.md) — package boundaries, compile/evaluate pipeline, security model.
- [docs/extending.md](docs/extending.md) — adding built-in functions and custom registry entries.
- [docs/best-practices.md](docs/best-practices.md) — patterns for embedders: persisting formulas, versioning functions, caching, security, testing.
- [docs/releasing.md](docs/releasing.md) — how versions are set and releases are published.
- [CONTRIBUTING.md](CONTRIBUTING.md) — development setup, testing, code style.
- [SECURITY.md](SECURITY.md) — reporting vulnerabilities and the security model in brief.
- Package READMEs: [definitions](definitions/README.md), [parser](parser/README.md), [runner](runner/README.md), [core-functions](core-functions/README.md).

## FAQ

### Do I need all four packages?

For an application that evaluates formulas, effectively yes — the quickstart imports from all four, and together they still have zero third-party runtime dependencies. If you only parse and validate (an editor backend, a lint endpoint), `@formulang/definitions` plus `@formulang/parser` suffice. See [The Formulang packages](#the-formulang-packages).

### Can I use Formulang in the browser or an editor frontend?

For parsing and validation, yes: `@formulang/definitions` is data-only and `@formulang/parser` needs nothing but a registry of definitions, so a browser-based editor can compile, type-check, and lint formulas without loading any code that can execute them. The built-ins' definitions ship in definitions (`registerCoreFormulaDefinitions`), so completion and validation cover the standard library too. The execution half — `@formulang/runner` plus the implementations in `@formulang/core-functions` — is backend-oriented. See [docs/architecture.md](docs/architecture.md#11-why-definitions-and-core-functions-are-separate-packages).

### Is there a synchronous evaluate?

No. The exported `evaluateRule` is deprecated and throws immediately; use `evaluateRuleAsync` (or `evaluateRuleOutputAsync` for the per-node output tree). Evaluation is asynchronous by design: variables can be async resolver functions, implementations may perform I/O, and wall-time limits are enforced during the run.

### How do I switch the argument separator to `,`?

Pass a `syntax` option when compiling: `parseFormula(source, { registry, syntax: { argumentSeparator: ',' } })`. The default is `;` arguments with `.` decimals; for comma-decimal locales keep `;` and set `decimalSeparator: ','`. The two separators must differ, or parsing reports `INVALID_SYNTAX_CONFIG`. See [parser/README.md](parser/README.md) and [docs/language.md](docs/language.md).

### Is it safe to evaluate formulas written by untrusted users?

That is the design goal. The guards — allowlisted property access, the prototype-pollution denylist, resource limits, frozen inputs — are summarized under [Why Formulang](#why-formulang); violations surface as structured `security` errors, never exceptions. For the full two-layer model (parse-time rejection plus eval-time re-checks) see [SECURITY.md](SECURITY.md) and [docs/architecture.md](docs/architecture.md#4-security-model).

### How do I add my own functions?

Register a data-only `FunctionDefinition` under a versioned signature id (`MY_FN/v1`) with `registry.registerFunction`, then register a matching `FunctionImplementation` with `implementations.register`. The full walkthrough is in [docs/extending.md](docs/extending.md); [core-functions/README.md](core-functions/README.md) shows how the built-ins are wired the same way.

### Why do result types show up as nullable (`number?`) so often?

The language convention is "empty in, empty out": built-ins return `null` instead of erroring when a required input is empty — `1 / 0` is `null`, and the empty propagates through `ADD(1/0; 2)`. Most built-in parameters and return types are therefore declared nullable. Test for it with `IS_EMPTY(...)` rather than comparing against `EMPTY()`. The `?` is the return-type analysis from [Core capabilities](#core-capabilities) making that convention visible in every inferred type. See [docs/language.md](docs/language.md#null-and-empty-values).

### Where is the full list of built-in functions?

[docs/functions.md](docs/functions.md) documents all 113 functions registered by `createCoreFormulaRuntime()`, grouped by category as in [Core capabilities](#core-capabilities), with signatures and examples for each.

## Development

Requires Node >= 22 and [pnpm](https://pnpm.io) (the repo pins the version via `packageManager`).

```sh
git clone https://github.com/formulang/formula.git
cd formula
corepack enable   # activates the pinned pnpm version
pnpm install
```

| Command                   | Purpose                                                                      |
| ------------------------- | ---------------------------------------------------------------------------- |
| `pnpm run build`          | Compile all packages to `dist/`.                                             |
| `pnpm run lint`           | Type-check all packages (`tsc --noEmit`); requires a prior `pnpm run build`. |
| `pnpm run test`           | Run all tests (vitest).                                                      |
| `pnpm run test:coverage`  | Run all tests with coverage.                                                 |
| `pnpm run prettier`       | Format the repo.                                                             |
| `pnpm run prettier:check` | Verify formatting.                                                           |
| `pnpm run clean`          | Remove build outputs.                                                        |

Tests need no build: vitest resolves `@formulang/*` imports directly to package sources, so `pnpm run test` works on a fresh checkout. See [CONTRIBUTING.md](CONTRIBUTING.md) for the details.

## Versioning & releases

All packages share a single version and are always published together. A maintainer sets the version with `pnpm run set-version X.Y.Z` (which keeps every `package.json` in lockstep), commits with any message, and merges to `main`; the release workflow then builds, tests, publishes every package to npm with provenance, tags `v<version>`, and creates a GitHub release with auto-generated notes. If the version on `main` is already published, the workflow is a no-op. Release notes live on the [GitHub Releases page](https://github.com/formulang/formula/releases) — there is no `CHANGELOG.md`. See [docs/releasing.md](docs/releasing.md).

## Maintenance

Development of the Formulang packages is sponsored by [Content Sync](https://content-sync.io).

## License

[MIT](LICENSE)
