# @formulang/definitions

Portable contracts, types, and registry primitives for [Formulang](https://github.com/formulang/formula) — the dependency-free vocabulary every other package builds on. It defines what types, compiled formulas, functions, and registries _are_; it contains no parser and no evaluator.

## Highlights

- **An extensible registry with fail-fast contracts.** `createRegistry()` takes custom functions, custom operators, typed custom variables, and same-name overloads with distinguishable shapes; registration validates versioned `NAME/vN` signature ids and rejects duplicates and ambiguous overload sets — misconfiguration surfaces at startup, not mid-evaluation ([registry rules](../docs/best-practices.md#22-what-the-registry-allows-for-same-name-registrations)).
- **Data-only and browser-safe.** The package contains no evaluator and no Node-API imports — definitions are plain data, safe to ship to browsers and editor tooling for completion and validation, while executable implementations stay backend-only ([why the split](../docs/architecture.md#11-why-definitions-and-core-functions-are-separate-packages)).
- **The type system is the security allowlist.** Object types declare exactly which properties formulas may read, `clarifier` tags gate assignability, and nullability is explicit — undeclared or `__`-prefixed access fails as a structured `security` error at parse time and is re-checked at evaluation as defense in depth ([security model](../docs/architecture.md#4-security-model)).
- **Resource limits and the error taxonomy live here.** `FormulaLimits` centralizes the caps parser and runner enforce as DoS defense — source length, token and AST-node counts, nesting depth, evaluation steps, wall time, cost budgets, list sizes, a regex safety guard — and every violation is reported as a structured `security` error coded from the stable `FormulaErrorCodes` set ([DoS defense](../docs/best-practices.md#53-resource-limits-are-your-dos-defense)).
- **The data-type vocabulary of the whole system.** `FormulaType` is a JSON-serializable union of ten kinds — `any`, `null`, `boolean`, `number`, `text`, `template` (per-function generics), `callable` (typed function/operator references), `list`, `object` (a clarifier tag plus a per-property allowlist), and `union` — with explicit nullability on every type; compile-time type binding and overload resolution run on this vocabulary, so `EACH(LIST("a";"bb"); "LEN")` type-checks to `List<number?>?` before anything executes ([types](#types-formulatype-and-formulatypes), [templates and callables](../docs/extending.md#22-templates-generics-and-callable-parameters)).
- **The TypeScript types are the contracts.** Everything the packages exchange — `FormulaType`, `TypedRule`, `FunctionDefinition`, registry and execution contexts — is exported as strict-mode TypeScript with complete `.d.ts` declarations, so hosts get compile-time safety for registrations, compiled rules, and results ([API surface by area](#api-surface-by-area)).
- **Purity is part of the function contract.** Every definition declares `pure`, `run_cached`, or `uncached`, selecting a host-owned cross-run cache with in-flight promise deduplication, a per-run cache, or no caching — caching policy travels with the definition, not the implementation ([choose purity deliberately](../docs/best-practices.md#41-choose-purity-deliberately)).
- **Redaction flags keep secrets out of logs.** Variables and functions marked `redaction: 'mask'` are masked as `{ __redacted: true }` in per-node traces while evaluation itself is unaffected ([redaction](../docs/best-practices.md#55-redaction-log-pernode-not-the-output-tree)).
- **Versioned ids are the stability contract.** Compiled formulas pin the exact function versions they were bound to; behavior changes ship as `NAME/v2` while retired versions stay registered as `legacy` — hidden from authoring, still resolvable by pinned id — so stored formulas keep evaluating identically as the function library evolves ([evolving functions](../docs/best-practices.md#2-evolving-functions-without-breaking-stored-formulas)).

## Getting started

```sh
npm install @formulang/definitions
```

No third-party runtime dependencies. Node >= 22.

The shortest useful flow with this package alone is the compile-side setup used by editors, autocomplete, and validation services: create a registry, load the built-in definitions, and declare — with types — the host data formulas may read.

```ts
import {
  createRegistry,
  registerCoreFormulaDefinitions,
  FormulaTypes,
} from '@formulang/definitions';

const registry = createRegistry();
registerCoreFormulaDefinitions(registry); // built-in definitions + operators: ADD, IF, EACH, ...

registry.registerVariable({
  name: 'deal',
  description: 'The deal being evaluated.',
  type: FormulaTypes.object('Deal', {
    amount: FormulaTypes.number(true),
    owner: FormulaTypes.text(true),
  }),
});
```

Hand this registry to `parseFormula` from [`@formulang/parser`](../parser/README.md) — which you will almost always install alongside — and `IF(deal.amount > 100; UPPER(deal.owner); "unassigned")` compiles into a fully typed `TypedRule`, with no executable code loaded anywhere. To evaluate formulas you additionally need [`@formulang/runner`](../runner/README.md) and implementations of the built-ins: most applications skip the manual assembly above and take the pre-wired registry from `createCoreFormulaRuntime()` in [`@formulang/core-functions`](../core-functions/README.md), which is this same setup plus the matching executable implementations.

## The Formulang packages

| Package                                                    | Role                                                              | You need it when                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **`@formulang/definitions`** (you are here)                | **Types, contracts, and the registry — the shared vocabulary**    | **You build registries, custom functions/variables, or editor tooling** |
| [`@formulang/parser`](../parser/README.md)                 | Compiles formula source into a typed, validated AST (`TypedRule`) | Always — everything starts with a compile                               |
| [`@formulang/runner`](../runner/README.md)                 | Asynchronously evaluates compiled formulas                        | You execute formulas                                                    |
| [`@formulang/core-functions`](../core-functions/README.md) | Built-in function library + `createCoreFormulaRuntime()` wiring   | You want the standard library (most applications)                       |

They compose in three calls: `createCoreFormulaRuntime()` returns the registry of built-in definitions plus their implementations, `parseFormula(source, { registry })` compiles source text into a `TypedRule`, and `evaluateRuleAsync(rule, { registry, resolver, variables })` executes it. Everything those calls exchange — types, rules, definitions, requirements, limits, errors — is defined in this package. [Architecture](../docs/architecture.md) has the full picture.

## Key concepts

### Types: `FormulaType` and `FormulaTypes`

`FormulaType` is a JSON-serializable discriminated union with ten kinds: `any`, `null`, `boolean`, `number`, `text`, `template`, `callable`, `list`, `object`, and `union`. Build instances with the `FormulaTypes` factory:

```ts
import { FormulaTypes } from '@formulang/definitions';

FormulaTypes.number(true); // nullable number, formats as "number?"
FormulaTypes.list(FormulaTypes.text(true), true); // List<text?>?
FormulaTypes.object('date', { iso: FormulaTypes.text(), year: FormulaTypes.number() });
// union() flattens nested unions, de-duplicates, and collapses single-member unions:
FormulaTypes.union([FormulaTypes.boolean(true), FormulaTypes.text(true)], true);
```

Details that matter:

- **Nullability** is explicit (`nullable: true`); the parser rejects passing a possibly-null value where it is not allowed (`NULL_NOT_ALLOWED`).
- **Object clarifiers**: every object type carries a `clarifier` tag (`'date'`, `'Page'`, ...) used for assignability checks, plus an optional `properties` map that allowlists property access in formulas.
- **Templates** (`FormulaTypes.template('T', { constraint })`) are type variables declared per function (`FunctionDefinition.templates`) and bound at call sites — this is how `INDEX` returns the element type of its list argument.
- **Callable references** (`FormulaTypes.callable(reference, options)`) describe arguments that name another function or operator (represented as text at runtime). With `paramTypes`, `returnType`, `minArity`, and `maxArity` set, the parser validates the referenced signature: `EACH(LIST("a";"bb"); "LEN")` type-checks to `List<number?>?`.
- Every type carries an optional one-sentence `description` for non-technical readers; factories fill in defaults.

Helpers in [`type-utils.ts`](src/type-utils.ts): `isAssignable`, `isNullable`, `stripNullability`, `sameTypeKind`, and `formatType` (e.g. `(number | text)?`).

### Compiled formulas: `TypedRule` and `RuleNode`

Parsing produces a `TypedRule` — the portable, validated AST that runners, caches, and UIs consume:

```ts
interface TypedRule {
  root: RuleNode; // literal | variable | call | property | wildcard
  returnType: FormulaType;
  static: boolean; // true when the result is fully predictable at parse time
  requirements: FormulaRequirements;
  errors: FormulaError[]; // parse/type/config problems are reported here, not thrown
}
```

Every `RuleNode` has a stable `id` plus optional `span` (source range), inferred `type`, and `predictableValue` (set only when the value is known at parse time). `call` nodes additionally carry the bound `signatureId`. `optimizeRule(rule, { registry })` is the portable constant-folding pass; it only folds nodes the parser already marked predictable.

`FormulaRequirements` is the parser's static analysis, available before anything runs: `variablesRead` (full accessor paths such as `list.*.name`), `functionsUsed` (signature ids), `externalData` (references discovered while folding), and `estimatedCostUnits` — the raw material for dependency tracking and cache invalidation.

### Registries

A registry defines the world a formula is allowed to see: which functions, operators, and variables exist, and with what types. `createRegistry()` returns an `InMemoryFormulaRegistry` implementing `MutableFormulaRegistry` (`registerFunction` / `registerOperator` / `registerVariable` / `retireFunction`); `registerCoreFormulaDefinitions(registry)` populates it with the built-in definitions and operators, as shown in [Getting started](#getting-started).

Registration is strict and fails fast: signature ids must match `NAME/vN`, duplicate signature ids, operator tokens, and variable names are rejected, overload pairs that accept the same arguments with neither more specific throw `Ambiguous overload` at registration time (among the rest, a call binds the first registered overload that takes it), declared casts must be unique and one-way, and a parameter's `literalValues` must be a non-empty list of texts and sit where the parser checks a literal, on a type a string literal fits: registration reads the parser's own rules, `literalCheckAt(params, position, read)` (where a call checks a literal, and against what), `argumentSelects(argument, param)` (whether an argument lets the parser choose an overload, a template's constraint included) and `argumentFits(argument, param)` (whether an argument passes the check of a bound call's parameter type), all exported with `admittedValues(param)`; a string literal must pass both checks of its type. `retireFunction(signatureId)` marks a registered definition `legacy` — excluded from name/alias lookup, `listFunctions()`, and the ambiguity checks, but still resolvable via `getFunction` so persisted rules keep evaluating; a definition can also be registered as `legacy: true` directly.

`VariableOnlyRegistry` (`getVariable`/`listVariables`) is the minimal read contract for embedders that only need variable resolution; `FormulaRegistry` extends it with function lookup by signature id (`getFunction`), overload listing by name (`listFunctionsByName`), and operator lookup (`getOperator`).

### Function definitions vs implementations

A `FunctionDefinition` is data: name, aliases, params (each with `optional`, `variadic`, `literalOnly`, `literalValues`, `reference`), template declarations, `returnType`, and behavioral flags. `literalValues` enumerates the only literals a `literalOnly` parameter admits — the parser refuses any other with `LITERAL_VALUE_NOT_ALLOWED`, and an editor can offer the list as completions. The executable side is a separate `FunctionImplementation`, resolved by signature id through a `FunctionImplementationResolver` at evaluation time. [Registering your own](#registering-your-own) shows a complete definition.

- **Signature ids** like `'ADD/v1'` (see `BuiltinSignatureIds`) are the stable currency of the system: requirements, caches, and operator bindings key off them, so behavior changes get a new version instead of mutating an existing id.
- **Purity** drives caching: `pure` results may be memoized across evaluations (keyed by signature id + arguments), `run_cached` results are cached only within a single evaluation run, and `uncached` results never are (`NOW`, `TODAY`).
- **`controlFlow: true`** lets an implementation skip evaluating arguments (`IF`, `AND`, `OR`); arguments arrive as memoized, lazy `FormulaValueProvider`s.
- **`redaction: 'mask'`** (available on functions and variables) masks the value in per-node debug output.
- Implementations are **batch-first**: `evaluateMultiple(calls, ctx)` receives many calls at once and returns structured `FormulaNodeOutput`s (value, warnings, error, children) rather than throwing. The helpers in [`execution-helpers.ts`](src/execution-helpers.ts) (`makeOkNumber`, `makeError`, `expectText`, ...) keep implementations small. Optional hooks: `tryStaticEvaluate` for parse-time folding and `estimateCostsInSeconds` for cost limits.

### Limits and errors

`FormulaLimits` centralizes the resource caps enforced by parser and runner: source length, token and AST-node counts, parenthesis depth, evaluation steps, cost units, wall time, list/regex sizes, and debug-log sizes. `resolveFormulaLimits(overrides)` shallow-merges partial overrides onto the conservative `DEFAULT_FORMULA_LIMITS`.

Errors are structured values, not strings: `FormulaError { kind, code, message, span?, path? }`, where `kind` is `parse | type | runtime | security | config` and `code` comes from the stable `FormulaErrorCodes` set (`UNKNOWN_VARIABLE`, `NO_MATCHING_OVERLOAD`, `DENYLISTED_PROPERTY`, `EVAL_LIMIT_EXCEEDED`, ...). For enforcement inside implementations there are the `FormulaLimitError` and `FormulaRuntimeError` exception classes and the step-counting `FormulaEvaluationBudget`.

## Registering your own

Two registration examples on the definitions side, continuing with the `registry` from [Getting started](#getting-started). For the executable half of a custom function — the `FunctionImplementation` — see [`@formulang/core-functions`](../core-functions/README.md) and the step-by-step walkthrough in [docs/extending.md](../docs/extending.md).

### A variable with a typed, allowlisted object

Variables are the boundary where host data enters a formula. The object type's `properties` map is an allowlist — formulas can only reach the paths you declare:

```ts
registry.registerVariable({
  name: 'contacts',
  description: 'Contacts attached to the current record.',
  type: FormulaTypes.list(
    FormulaTypes.object('Contact', {
      email: FormulaTypes.text(true),
      opens: FormulaTypes.number(true),
    }),
    true,
  ),
});
```

Compiled against this registry, `contacts.*.email` types as `List<text?>?`, while `contacts.*.password` fails at parse time with `PROPERTY_NOT_ALLOWLISTED` (kind `security`) — even if the runtime objects happen to carry that key — and `contacts.*.__proto__` is rejected with `DENYLISTED_PROPERTY`. The runner re-checks the same rules per node at evaluation time.

### A function definition (the data half)

```ts
registry.registerFunction({
  signatureId: 'SLUGIFY/v1', // stable NAME/vN id; changed semantics => SLUGIFY/v2
  name: 'SLUGIFY',
  description: 'Converts text into a URL-friendly slug.',
  params: [{ name: 'text', type: FormulaTypes.text(true) }],
  returnType: FormulaTypes.text(true),
  purity: 'pure', // deterministic + side-effect free => cacheable
});
```

The parser now binds `SLUGIFY("Hello World")`, types it as `text?`, and records `'SLUGIFY/v1'` in `requirements.functionsUsed` — which is everything an editor or validation service needs. Evaluating additionally requires a `FunctionImplementation` registered under the same signature id wherever you run formulas; without one, evaluation fails with a structured `UNBOUND_FUNCTION` error. The implementation half is covered in [docs/extending.md](../docs/extending.md#3-implementing-a-function).

## API surface by area

Everything is exported flat from the package root. This table maps areas to source modules; see the source for full signatures.

| Area                 | Source                                                                                                                                                                                                 | Key exports                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Type system          | [`types.ts`](src/types.ts), [`type-utils.ts`](src/type-utils.ts)                                                                                                                                       | `FormulaType`, `FormulaTypes`, `isAssignable`, `formatType`                                         |
| Compiled rules       | [`ast.ts`](src/ast.ts), [`rule.ts`](src/rule.ts), [`span.ts`](src/span.ts), [`optimize.ts`](src/optimize.ts)                                                                                           | `RuleNode`, `TypedRule`, `SourceSpan`, `optimizeRule`                                               |
| Registry contracts   | [`registry.ts`](src/registry.ts), [`registry-impl.ts`](src/registry-impl.ts)                                                                                                                           | `FormulaRegistry`, `VariableOnlyRegistry`, `MutableFormulaRegistry`, `createRegistry`               |
| Built-in definitions | [`register-core-definitions.ts`](src/register-core-definitions.ts), [`builtin-signature-ids.ts`](src/builtin-signature-ids.ts)                                                                         | `registerCoreFormulaDefinitions`, `BuiltinSignatureIds`                                             |
| Function contracts   | [`registry.ts`](src/registry.ts), [`function-implementation-class.ts`](src/function-implementation-class.ts)                                                                                           | `FunctionDefinition`, `FunctionImplementation`, `FunctionImplementationResolver`                    |
| Execution contracts  | [`execution-context.ts`](src/execution-context.ts), [`execution-output.ts`](src/execution-output.ts), [`value-provider.ts`](src/value-provider.ts), [`execution-helpers.ts`](src/execution-helpers.ts) | `FormulaExecutionContext`, `FormulaNodeOutput`, `FormulaValueProvider`, `makeOk*`/`expect*` helpers |
| Static analysis      | [`requirements.ts`](src/requirements.ts)                                                                                                                                                               | `FormulaRequirements`, `emptyRequirements`                                                          |
| Limits               | [`limits.ts`](src/limits.ts)                                                                                                                                                                           | `FormulaLimits`, `DEFAULT_FORMULA_LIMITS`, `resolveFormulaLimits`                                   |
| Errors               | [`errors.ts`](src/errors.ts), [`exceptions.ts`](src/exceptions.ts)                                                                                                                                     | `FormulaError`, `FormulaErrorCodes`, `FormulaRuntimeError`, `FormulaEvaluationBudget`               |
| Type seeds           | [`rule-types-core.ts`](src/rule-types-core.ts)                                                                                                                                                         | `createDefaultRuleTypes`                                                                            |

## FAQ

### When do I depend on this package directly?

Whenever you import from it: assembling registries with `createRegistry`, declaring types with `FormulaTypes`, authoring function or variable definitions, or building editor tooling on `listFunctions()` / `formatType` / `isAssignable`. If you only parse and run formulas, `@formulang/parser`, `@formulang/runner`, and `@formulang/core-functions` all declare it as a dependency, so it arrives transitively — but the moment you register your first variable you will import `FormulaTypes`, so most hosts end up depending on it directly anyway.

### Why can't formulas read arbitrary object properties?

Formula source is untrusted, and runtime objects often carry more than a formula should see. The `properties` map on an object type is the allowlist: `deal.amount` binds only because `amount` is declared; undeclared names fail at parse time with `PROPERTY_NOT_ALLOWLISTED`, and `__proto__`, `prototype`, `constructor`, and any `__`-prefixed name are rejected with `DENYLISTED_PROPERTY`. The runner re-checks both rules per node (the denylist by name, the allowlist against the type metadata the AST carries) and reads own properties only — defense in depth for parsed formulas; stored compiled rules must additionally be protected from tampering ([best-practices.md §1.5](../docs/best-practices.md#15-treat-stored-compiled-rules-as-trusted-artifacts)). See [extending.md](../docs/extending.md#41-how-property-allowlisting-protects-untrusted-input).

### What is a `signatureId` and why is it versioned?

The `NAME/vN` string (enforced at registration: `/^[A-Z0-9_]+\/v\d+$/`) through which the two halves of a function meet, and the stable key everything durable hangs off: `requirements.functionsUsed`, cross-run caches, and operator bindings. When behavior changes, register `NAME/v2` under the same user-facing name, retire the `v1` definition as `legacy` (`retireFunction`, or the `legacy` flag at registration) so it leaves authoring but keeps resolving by pinned id, and keep `v1` implemented — stored compiled rules and caches stay valid instead of silently changing meaning. The full rollout recipe is in **[docs/best-practices.md §2](../docs/best-practices.md#2-evolving-functions-without-breaking-stored-formulas)**.

### What do the purity levels mean for caching?

`purity` is a required promise about the implementation. `'pure'` results may be cached across runs (when the host passes shared `cache`/`pending` maps to the runner), and calls over literal arguments can be folded and marked `static` at parse time. `'run_cached'` results are memoized only within a single evaluation run, never shared across runs. `'uncached'` functions re-execute on every call (`NOW`, `TODAY`). Declare `'pure'` only for genuinely deterministic, side-effect-free functions — the cache will happily serve stale results otherwise. Details in [extending.md](../docs/extending.md#23-purity-and-its-caching-consequences).

### What is the `clarifier` on object types?

The tag that names an object shape: the first argument of `FormulaTypes.object('Deal', { ... })`. Assignability requires matching clarifiers (`Object(Contact)` is not assignable to `Object(Deal)`), `formatType` renders it, error messages cite it, and evaluation outputs report it as `valueObjectKind`. The clarifier identifies the shape; the separate `properties` map allowlists what formulas may access on it.

### Can this package run in a browser or an editor?

Yes — that is the point of the split. It is data-only: no evaluator, no I/O, zero third-party dependencies. A browser-based formula editor or a validation service loads definitions plus `@formulang/parser` to type-check formulas, list functions, and render signatures without holding any code that could execute a formula. Only evaluation (via `@formulang/runner`, typically backend-side) needs implementations.

### Why do the built-in definitions live here but their implementations in `@formulang/core-functions`?

Because the built-ins' signatures are portable metadata while their implementations are executable objects. `registerCoreFormulaDefinitions(registry)` gives a parse-only host the complete built-in surface with nothing that can run; `createCoreFormulaRuntime()` in [`@formulang/core-functions`](../core-functions/README.md) calls the same function and registers the executable half alongside. See [architecture.md](../docs/architecture.md#11-why-definitions-and-core-functions-are-separate-packages).

## Further reading

- [Architecture](../docs/architecture.md) — how definitions, parser, runner, and core-functions fit together.
- [Extending Formulang](../docs/extending.md) — step-by-step guide to custom functions, variables, and registries.
- [Language reference](../docs/language.md) and [function reference](../docs/functions.md).

## Maintenance

Development of the Formulang packages is sponsored by [Content Sync](https://content-sync.io).

## License

[MIT](LICENSE)
