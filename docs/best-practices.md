# Patterns & best practices

This guide is for developers embedding Formulang in an application: how to persist formulas, evolve your function library without breaking what users saved, and run untrusted formulas in production — validated, budgeted, cached, observable, and tested. It assumes you know the basics from [architecture.md](architecture.md) (how the pipeline works) and [extending.md](extending.md) (the extension API); every code example below runs against the current packages exactly as shown.

| #   | Pattern                                                                                                       | Use it when                                                    |
| --- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | [Persisting formulas and idempotent re-evaluation](#1-persisting-formulas-and-idempotent-re-evaluation)       | Formulas are saved once and evaluated many times               |
| 2   | [Evolving functions without breaking stored formulas](#2-evolving-functions-without-breaking-stored-formulas) | Your function library changes after formulas were saved        |
| 3   | [Validating before you save or run](#3-validating-before-you-save-or-run)                                     | You accept formula input from users or migrate stored formulas |
| 4   | [Performance: caching, cost, and laziness](#4-performance-caching-cost-and-laziness)                          | Formulas call expensive functions or run at volume             |
| 5   | [Security and multi-tenancy](#5-security-and-multi-tenancy)                                                   | Formula authors are untrusted, or tenants share infrastructure |
| 6   | [Observability and debugging](#6-observability-and-debugging)                                                 | You need to explain or trace what a formula did                |
| 7   | [Testing your integration](#7-testing-your-integration)                                                       | You register custom functions or variables                     |

## 1. Persisting formulas and idempotent re-evaluation

### 1.1 Store three things: the source, the compiled rule, and the syntax config

A saved formula that will be evaluated later needs three parts, each for a different reason:

- **The source string** — the only representation you can re-compile (for [migrations](#34-migration-re-compile-everything-then-decide)) and the only one you should show back to the user.
- **The compiled `TypedRule`** — the evaluation artifact. Its call nodes carry pinned, versioned signature ids (`ADD/v1`), so evaluating the stored rule never re-runs name or overload resolution: it means today exactly what it meant when it was compiled, even after you register new versions or overloads ([section 2](#2-evolving-functions-without-breaking-stored-formulas) shows the same source re-compiling to different behavior).
- **The syntax config (`FormulaSyntax`)** — the source is ambiguous without it. `COUNT(LIST(1,5))` is `2` under `{ argumentSeparator: ',', decimalSeparator: '.' }` and `1` under `{ argumentSeparator: ';', decimalSeparator: ',' }` (the list has one item, `1.5`). Both parse without errors; only the stored syntax tells you which one the author meant.

**Do this:**

```ts
import { createCoreFormulaRuntime } from '@formulang/core-functions';
import { optimizeRule, type TypedRule } from '@formulang/definitions';
import { DEFAULT_FORMULA_SYNTAX, parseFormula, type FormulaSyntax } from '@formulang/parser';
import { evaluateRuleAsync } from '@formulang/runner';

interface StoredFormula {
  source: string; // for display and re-compilation
  syntax: FormulaSyntax; // the separators it was written with
  rule: TypedRule; // the compiled artifact with pinned signature ids
}

const { registry, implementations } = createCoreFormulaRuntime();
// ...registry.registerVariable({ name: 'order', ... }) as in the quickstart

const source = 'IF(order.price * order.quantity >= 100; "bulk"; "retail")';
const syntax = DEFAULT_FORMULA_SYNTAX;
const parsed = parseFormula(source, { registry, syntax });
if (parsed.errors.length > 0) throw new Error('refuse to save an invalid formula');

const stored: StoredFormula = { source, syntax, rule: optimizeRule(parsed, { registry }) };
const payload = JSON.stringify(stored); // -> your database

// Later, in another process:
const revived = JSON.parse(payload) as StoredFormula;
const result = await evaluateRuleAsync(revived.rule, {
  registry,
  resolver: implementations,
  variables: { order: { price: 25, quantity: 4 } },
});
result.value; // 'bulk' — identical to evaluating the never-serialized rule
```

### 1.2 JSON round-trip rules

A `TypedRule` is plain data: five node kinds (`literal`, `variable`, `call`, `property`, `wildcard`), primitive literal values, and JSON-serializable types and requirements. The round-trip is stable — `JSON.stringify(JSON.parse(stored))` reproduces `stored` byte for byte — and the revived rule evaluates to the same value as the original, run after run, for formulas built from deterministic functions. (Formulas containing `uncached` functions such as `NOW()` are nondeterministic by design; see [purity](#41-choose-purity-deliberately).)

**Pitfalls**

- Do not expect `optimizeRule` to shrink every constant expression before you store it: `1 + 2 * 3` compiles with `static: true` but its root remains a `call` node — folding is conservative and only rewrites nodes the parser already marked predictable. Use `rule.static` (below), not the node shape, to detect constants.
- Do not edit the stored JSON (see [1.5](#15-treat-stored-compiled-rules-as-trusted-artifacts)).

### 1.3 Gate stored rules on `requirements.functionsUsed` before running

A stored rule can outlive parts of your runtime. Both halves of every referenced function must still be registered where you evaluate — the definition in the registry and the implementation in the resolver. Missing pieces do not throw, but they fail the run with structured errors: a missing definition yields `UNKNOWN_FUNCTION` (kind `runtime`), a missing implementation `UNBOUND_FUNCTION` (kind `runtime`), and `value` is `null`.

**Do this** — a pre-flight check answers the question without evaluating anything:

```ts
function canEvaluate(rule: TypedRule): boolean {
  return rule.requirements.functionsUsed.every(
    (id) => registry.getFunction(id) !== undefined && implementations.get(id) !== undefined,
  );
}
```

### 1.4 Precompute static rules

`rule.static === true` is the parser's guarantee that the result can never change (no variables, only `pure` functions of predictable inputs — see [architecture.md §2.6](architecture.md#26-static-and-predictable-value-analysis)). Evaluate such a rule once at save time and store the value alongside it; skip evaluation on every future read.

```ts
const rule = parseFormula('1 + 2 * 3', { registry });
rule.static; // true — evaluate once (7), store the value, never evaluate again
```

### 1.5 Treat stored compiled rules as trusted artifacts

The runner re-checks the security guards per node at evaluation time, so _some_ tampering with a stored AST is caught: renaming a property node to an undeclared name fails with `PROPERTY_NOT_ALLOWLISTED` (kind `security`), and `__proto__` (or any `__`-prefixed name) fails with `DENYLISTED_PROPERTY` — the denylist is name-based and holds even when the tampered AST also fakes its type metadata.

The allowlist re-check, however, reads the **type metadata embedded in the AST itself**. All three of the following are verified against the current runner:

- Widening `node.object.type.properties` in a tampered AST lets it read a property you never declared — the run returns the hidden value with **zero errors**.
- Changing a literal (`100` → `0` in a threshold) silently changes the result; no guard fires, because the AST _is_ the program.
- Call nodes execute whatever registered signature id they carry — the resolver is looked up purely by the id string embedded in the rule.

**Do this:** store compiled rules where formula authors cannot write — treat their integrity like the integrity of your code. If your storage cannot guarantee that, evaluate from a fresh `parseFormula(source)` instead of the stored AST; the parse-time checks run against the real registry, not against metadata an attacker controls. Note the bounded blast radius either way: a tampered AST can only reach the `variables` you pass to that evaluation and the functions registered in that registry/resolver.

**See also:** [architecture.md §4](architecture.md#4-security-model), [runner README](../runner/README.md), [parser README](../parser/README.md).

## 2. Evolving functions without breaking stored formulas

### 2.1 One signature id, one meaning — forever

Stored rules, cross-run caches, and `requirements.functionsUsed` all key off `NAME/vN` signature ids. Never change what a shipped id does; ship changed behavior as `NAME/v2`. The registry enforces the format (`/^[A-Z0-9_]+\/v\d+$/`) and uniqueness at registration:

```ts
registry.registerFunction({ signatureId: 'TAX/v1', ... });
registry.registerFunction({ signatureId: 'TAX/v1', ... });
// throws: 'Function already registered: TAX/v1'
```

### 2.2 What the registry allows for same-name registrations

Two definitions may share a `name` only when they are distinguishable overloads — different arity, parameter types that don't overlap (core `LEN` ships text and list overloads under one name), or parameter lists where one is strictly more specific. Registering `TAX/v2` with the **same parameter shape** as `TAX/v1` throws at registration time:

```ts
// TAX/v1: params [x: number?]         — registered
// TAX/v2: params [x: number?]         — same shape:
registry.registerFunction(taxV2SameShape);
// throws: 'Ambiguous overload for TAX: TAX/v1 vs TAX/v2'

// TAX/v2: params [x: number?, rate: number?] (rate required) — different arity: OK
registry.registerFunction(taxV2WithRate);
parseFormula('TAX(10)', { registry }).requirements.functionsUsed; // ['TAX/v1']
parseFormula('TAX(10; 2)', { registry }).requirements.functionsUsed; // ['TAX/v2']
```

So: **adding a new call shape** is an overload — both versions coexist in one registry and the call shape picks the binding. **Changing behavior for an existing shape** is a version bump — the old and new definition cannot both be _active_ in the same registry, which leads to the next pattern.

### 2.3 Same-shape version bump: retire the old definition as legacy, keep implementations forever

For a behavior change under an unchanged shape, keep every version you ever shipped registered — and mark retired definitions **legacy**. A legacy definition is retired from authoring: name/alias resolution and `listFunctions()` no longer see it, and the same-name ambiguity check from [2.2](#22-what-the-registry-allows-for-same-name-registrations) skips it — but it stays resolvable via `getFunction(signatureId)`, which is exactly the lookup the runner uses for a stored rule's pinned ids. One registry serves authoring and evaluation, and the rollout is two visible steps:

1. **Retire the old definition and register the new one.** On a live registry call `registry.retireFunction('MY_CALC/v1')` (idempotent for already-legacy ids; unknown ids throw `Function not registered: <id>`; the registry swaps in a legacy-marked copy — the definition object you registered is not mutated). When assembling a registry from scratch, register the old definition with `legacy: true` instead. Either way, a same-shape `MY_CALC/v2` now registers cleanly.
2. **Keep every version's implementation registered** — the resolver is a plain map from signature id to implementation, so old and new coexist without conflict.

```ts
// MY_CALC/v1 is live; stored rules pin 'MY_CALC/v1'. Ship the same-shape v2:
registry.retireFunction('MY_CALC/v1'); // v1 leaves the name space, stays id-resolvable
registry.registerFunction(myCalcV2Def); // same parameter shape — registers cleanly now
implementations.register('MY_CALC/v2', currentImpl); // v1's implementation stays registered — forever

// Assembling the registry from scratch (fresh process) instead? Same effect, either order:
//   registry.registerFunction({ ...myCalcV1Def, legacy: true });
//   registry.registerFunction(myCalcV2Def);

// Verified outcomes, one registry for both authoring and evaluation:
(await evaluateRuleAsync(storedV1Rule, ctx)).value; // v1 behavior — the pinned 'MY_CALC/v1' resolves
parseFormula(source, { registry }).requirements.functionsUsed; // ['MY_CALC/v2'] — new compiles bind v2
```

With this in place (verified end to end): the stored v1 rule evaluates with v1 behavior; a _re-compile_ of the same source binds `MY_CALC/v2` and produces the new behavior — so re-compiling is a semantic migration, to be done deliberately ([3.4](#34-migration-re-compile-everything-then-decide)); the [1.3 pre-flight gate](#13-gate-stored-rules-on-requirementsfunctionsused-before-running) keeps passing for stored rules, because `getFunction` resolves legacy ids; and cross-run cache entries never collide, because cache keys start with the signature id (`MY_CALC/v1|n:2` vs `MY_CALC/v2|n:2`).

**Pitfalls**

- Keeping the legacy _implementation_ registered is not enough — the _definition_ must stay registered too, as legacy. Evaluating a stored `MY_CALC/v1` rule against a registry that dropped v1 entirely fails with `UNKNOWN_FUNCTION: MY_CALC/v1` _even though the v1 implementation is still registered_ (verified) — the runner needs the definition (purity, control flow, parameters) as well as the code. Retire; don't remove.
- Marking a definition legacy retires its **name**, not its **operator token** (verified): after `retireFunction('ADD/v1')`, `ADD(1; 2)` no longer parses (`UNKNOWN_FUNCTION`), yet `getOperator('+')` still resolves, `1 + 2` parses with zero errors, binds the pinned `ADD/v1`, and evaluates to `3` — and operator string references behave the same (`EACH(LIST(1; 2); "+"; 1)` still evaluates to `[2, 3]`), because operator tokens and references resolve via `getOperator` → `getFunction`, both legacy-inclusive. Moving an operator to a same-shape new version is a separate follow-up: assemble a registry that binds the token to the new id ([2.4](#24-operators-are-pinned-at-parse-time-and-version-the-same-way)).
- Name-string callable references are **not** pinned (verified): `EACH(items; "MY_HELPER")` stores the string `"MY_HELPER"`, late-binds it by _name_ at evaluation time, and does not record it in `requirements.functionsUsed` — so the [1.3 pre-flight gate](#13-gate-stored-rules-on-requirementsfunctionsused-before-running) cannot see it. Retiring the only active version of such a name silently turns those calls into `null` results, and registering a new active version silently rebinds them to it. Before retiring a function that stored rules reference by name-string, migrate or re-compile those rules first.
- Re-registering an implementation id replaces the previous entry (last registration wins) — deploying a changed implementation under an unchanged id silently changes stored rules' behavior _and_ keeps serving stale `pure` cache entries recorded by the old code. Bump the version instead.

### 2.4 Operators are pinned at parse time and version the same way

Operators are aliases for function signature ids. `1 + 2` compiles to a `call` node with `signatureId: 'ADD/v1'` and records `ADD/v1` in `functionsUsed` — stored rules are therefore immune to later operator re-mapping. Operator tokens are unique per registry (`registry.registerOperator({ token: '+', ... })` throws `Operator already registered: +` on a duplicate), so the operator→function mapping is a decision you make when assembling a registry, and moving an operator to a new function version means assembling a registry that binds it there — existing stored rules keep their pinned ids either way.

**See also:** [extending.md §1](extending.md#1-the-extension-model), [definitions README](../definitions/README.md), [core-functions README](../core-functions/README.md#overriding-a-built-in-implementation).

## 3. Validating before you save or run

### 3.1 `parseFormula` never throws — gate on `errors.length`

Feed it anything — `IF((((`, `#@!`, calls to unknown functions, unknown variables — and you get a `TypedRule` back, never an exception. All problems are collected as structured `FormulaError`s with stable codes: `UNEXPECTED_TOKEN` and `PARSER_CRASH` for mangled input, `UNKNOWN_FUNCTION`, `UNKNOWN_VARIABLE`, `NO_MATCHING_OVERLOAD` (e.g. `LEN(1)` — `LEN` exists, but not for numbers). The contract for saving:

```ts
const rule = parseFormula(userInput, { registry, syntax });
if (rule.errors.length > 0) {
  // refuse to save; render rule.errors — a formula is valid iff this array is empty
}
```

### 3.2 Use spans for editor feedback

Errors carry character offsets into the source you passed — precise enough to underline:

```ts
const source = 'missing_var + 1';
const bad = parseFormula(source, { registry });
bad.errors[0].code; // 'UNKNOWN_VARIABLE'
const { start, end } = bad.errors[0].span!;
source.slice(start, end); // 'missing_var' — underline exactly this range
```

One parse reports everything it can find, so you can render multiple diagnostics from a single call.

### 3.3 Drive data loading and authorization from `requirements`

Compilation is also static analysis — use it _before_ evaluating:

```ts
const rule = parseFormula('IF(deal.amount > 100; UPPER("x"); "small")', { registry });
rule.requirements.variablesRead; // ['deal.amount'] — full accessor paths, not roots
rule.requirements.functionsUsed; // ['GT/v1', 'UPPER/v1', 'IF/v1']
```

Fetch or authorize exactly the paths in `variablesRead` (wildcard paths like `contacts.*.email` name the per-element property to load), and check `functionsUsed` against a capability allowlist ([5.1](#51-model-capabilities-as-registry-contents)) plus the runnability gate from [1.3](#13-gate-stored-rules-on-requirementsfunctionsused-before-running).

### 3.4 Migration: re-compile everything, then decide

When registry contents change (functions retired, versions bumped, variables renamed), re-compile every stored source and triage — nothing throws, so one pass classifies the whole corpus:

```ts
const report = storedFormulas.map(({ id, source, syntax }) => {
  const rule = parseFormula(source, { registry: nextRegistry, syntax });
  return { id, ok: rule.errors.length === 0, errors: rule.errors, rule };
});
// ok:     persist the re-compiled rule — it now binds current versions
// broken: surface to the formula's owner; errors carry codes and spans (e.g. 'UNKNOWN_FUNCTION')
```

**Pitfall:** re-compiling rebinds names to the _current_ registry — under a version bump the same source can legitimately produce different results ([2.3](#23-same-shape-version-bump-retire-the-old-definition-as-legacy-keep-implementations-forever)). Diff old vs new `requirements.functionsUsed` per formula to see exactly which bindings moved before you overwrite the stored rule.

**See also:** [parser README](../parser/README.md), [extending.md §7](extending.md#7-consuming-typedrulerequirements-to-prefetch-data).

## 4. Performance: caching, cost, and laziness

### 4.1 Choose purity deliberately

`purity` on a `FunctionDefinition` is a promise with measured consequences (each verified with a call-counting implementation):

| Purity       | Verified behavior                                                                                                                    | Declare it when                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `pure`       | `F(7) + F(7)` executes the implementation **once** per run; with shared `cache`/`pending` maps, later runs execute it **zero** times | Deterministic in its arguments and side-effect free — across runs            |
| `run_cached` | Once per run; re-executed on the next run even when shared maps are passed (they serve `pure` only)                                  | Stable within one evaluation, fresh per evaluation (e.g. a per-run snapshot) |
| `uncached`   | Every call executes                                                                                                                  | Clock, randomness, side effects (`NOW`, `TODAY` are the core precedent)      |

**Pitfall:** `pure` + a behavior change under the same signature id = stale cache hits (verified: a shared cache kept serving the old implementation's result — see the tenant experiment in [5.4](#54-per-tenant-registries--and-per-tenant-caches)). `pure` and [version bumps](#2-evolving-functions-without-breaking-stored-formulas) belong together.

### 4.2 Share a cross-run cache correctly

Pass your own `cache` and `pending` maps to make `pure` results outlive a run; `pending` also deduplicates concurrent identical calls to a single execution.

```ts
const cache = new Map<string, unknown>();
const pending = new Map<string, Promise<unknown>>();
// pass BOTH to every run that should share results
await evaluateRuleAsync(rule, { registry, resolver, variables, cache, pending });
```

What is actually in the map (verified by inspection):

- Keys are `signatureId | expected-cast | argument-keys` and values are the raw results: `'UPPER/v1|s:"ada"' -> 'ADA'`. There is **no tenant, resolver, registry, or formula component** in the key — scope the maps accordingly ([5.4](#54-per-tenant-registries--and-per-tenant-caches)).
- Keys are version-scoped: bumping to `NAME/v2` never reuses `NAME/v1` entries.
- The same logical call can occupy more than one key depending on its position: `UPPER("ada")` at the root caches as `'UPPER/v1|s:"ada"'`, but as an argument of `LEN(...)` it caches as `'UPPER/v1|cast:text:1|s:"ada"'` (the expected-cast hint is part of the key).
- **Object arguments are keyed by identity, not content** (verified): passing an equal-but-freshly-built object is a cache miss; passing the same reference again is a hit. Cross-run hits for object-taking functions require reusing the same variable object references; with per-request objects, expect misses for those calls — primitives and small primitive lists hit by value.
- **Reuse has a catch** (verified): the runner best-effort-`Object.freeze`s the `variables` object and the objects reachable from it on every run, so a previously-passed object cannot be mutated in place to refresh its data (strict-mode writes throw, sloppy-mode writes vanish silently). When values change, build a fresh object and accept the one-time miss.

The maps are plain `Map`s you own: the runner adds entries and nothing expires, so size-bound them and drop them wholesale when implementation behavior changes outside a version bump. What is never stored (errors, warning-carrying outputs, control-flow calls, oversized strings) is listed in the [runner README](../runner/README.md#faq).

### 4.3 Cost estimators reject expensive calls before they run

Give every implementation that does real work an `estimateCostsInSeconds`; the runner charges the estimate _before_ invoking. Verified: an estimator returning `3` against the default `maxFunctionCostUnits: 2` fails the call with `FUNCTION_COST_LIMIT_EXCEEDED` (kind `security`) and the implementation is **never executed**; estimator-less calls (including control flow like `IF`) charge a flat `0.05` units, so `limits: { maxTotalCostUnits: 0.04 }` fails any formula containing `IF` with `COST_LIMIT_EXCEEDED`.

```ts
implementations.register('FETCH_SCORE/v1', {
  estimateCostsInSeconds: () => 0.5, // charged against maxFunctionCostUnits / maxTotalCostUnits
  async evaluateMultiple(calls, ctx) {
    /* ... I/O ... */
  },
});
```

Set `maxTotalCostUnits` per surface (interactive vs batch) — it is the per-evaluation budget the individual estimates draw from.

### 4.4 Wall-time limits catch what estimates miss

Estimates are predictions; wall time is enforcement. Both function calls and variable resolvers are checked against `maxFunctionWallTimeMs`, the whole run against `maxWallTimeMs`. Verified: a resolver that takes 50 ms under `limits: { maxFunctionWallTimeMs: 10 }` ends the run with a structured `WALL_TIME_LIMIT_EXCEEDED` (kind `security`) and `value: null` — no exception, no hung request.

### 4.5 Lazy variable resolvers skip work on untaken branches

Supply expensive data as resolver functions instead of values — they run only if evaluation reaches them, and control-flow functions (`IF`, `AND`, `OR`, `SWITCH`) do not evaluate untaken branches:

```ts
const { output, perNode } = await evaluateRuleOutputAsync(rule, {
  registry,
  resolver: implementations,
  variables: {
    flag: false,
    expensive: async () => fetchFromRemote(), // IF(flag; expensive; "fallback")
  },
});
output.value; // 'fallback' — and fetchFromRemote was never called (verified: 0 invocations)
perNode['IF-0/VAR_EXPENSIVE-0'].skipped; // true — the trace records the skip
```

Resolvers run under `maxFunctionWallTimeMs` (see 4.4) and receive `{ registry, limits, budget }`.

**See also:** [runner README](../runner/README.md), [extending.md §2.3](extending.md#23-purity-and-its-caching-consequences), [extending.md §3.2](extending.md#32-cost-estimation).

## 5. Security and multi-tenancy

### 5.1 Model capabilities as registry contents

The registry _is_ the capability policy: what is not registered does not exist, and fails at parse time. Two verified patterns, composable:

```ts
// A. Minimal registry: register only what this surface allows.
const core = createCoreFormulaRuntime(); // full built-in set to copy definitions from
const minimal = createRegistry();
minimal.registerFunction(core.registry.getFunction('ADD/v1')!); // definitions are data — copy them
parseFormula('UPPER("x")', { registry: minimal }).errors[0].code; // 'UNKNOWN_FUNCTION'
// 'ADD(1; 2)' parses clean and evaluates fine against the full core implementations resolver —
// the parse-time gate already guarantees nothing else is reachable.

// B. Capability check over a full registry: gate stored rules on functionsUsed.
const allowed = new Set(['ADD/v1', 'MUL/v1', 'IF/v1', 'GTE/v1']);
const denied = rule.requirements.functionsUsed.filter((id) => !allowed.has(id));
// denied.length > 0 -> reject without evaluating anything
```

Variables work the same way: only declared variables and allowlisted object properties bind ([extending.md §4.1](extending.md#41-how-property-allowlisting-protects-untrusted-input)). Undeclared property access fails at parse time with `PROPERTY_NOT_ALLOWLISTED` (kind `security`); `__proto__`, `prototype`, `constructor`, and all `__`-prefixed names fail with `DENYLISTED_PROPERTY`.

### 5.2 Parse-time vs eval-time enforcement — what each actually guarantees

Verified boundaries of the two layers:

| Scenario                                                            | Outcome                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Formula source tries an undeclared or denylisted property           | Rejected at **parse time** (`security` errors; nothing evaluates)           |
| Stored AST tampered: property renamed, type metadata left honest    | Rejected at **eval time** (`PROPERTY_NOT_ALLOWLISTED`)                      |
| Stored AST tampered: denylisted name, even with faked type metadata | Rejected at **eval time** (`DENYLISTED_PROPERTY` — the check is name-based) |
| Stored AST tampered: property renamed **and** type metadata widened | **Not rejected** — the undeclared value is returned with zero errors        |

The eval-time re-checks are defense in depth against honest-but-stale artifacts, not a substitute for artifact integrity: the allowlist re-check trusts the type metadata inside the AST. Conclusion (same as [1.5](#15-treat-stored-compiled-rules-as-trusted-artifacts)): parse-time enforcement is the real gate for untrusted _authors_; storage integrity is the gate for untrusted _storage_.

Modes split the same way, and the parser is not the only check. The parser refuses a mode literal a parameter does not list where it sees the literal reach the parameter: written in the call, or passed on by `EACH`, `FILTER`, `FILTER_PROPERTY`, `REDUCE` or `FILTER_BY` through callables named by string literals, as far as its bounded walk follows them. A mode the parser does not see — one a callable named by a value receives, one a host's own higher-order function passes on, one past the walk's bound — reaches the function when the call runs, and the formula compiles. A built-in function answers an unlisted mode with `null` and a `TYPE` warning, and a core higher-order function that called it keeps the `null` and drops the warning, as on 1.0.0: through `EACH` that item is `null`, with no error and no warning. Give a custom implementation the same check ([extending.md §2.1](extending.md#21-parameters)), and do not treat a compiled formula as proof that every mode in it is listed. The exact split is in [language.md](language.md#when-a-mode-is-checked).

### 5.3 Resource limits are your DoS defense

Every limit violation resolves to a structured `security` error — the host never catches exceptions or hangs. Verified: `limits: { maxEvaluationSteps: 5 }` fails a ten-term sum with `EVAL_LIMIT_EXCEEDED`; cost and wall-time overruns behave the same ([4.3](#43-cost-estimators-reject-expensive-calls-before-they-run), [4.4](#44-wall-time-limits-catch-what-estimates-miss)). Set per-surface `limits` at both parse time (source shape: `maxSourceLength`, `maxTokens`, `maxAstNodes`, ...) and eval time (work: steps, wall time, cost, list sizes), and pass the same overrides to both calls. Defaults live in `DEFAULT_FORMULA_LIMITS` ([definitions README](../definitions/README.md#limits-and-errors)). For a given registry, the parse's work follows its size: the check of modes passed on through callables visits at most 16 × (n + 1) argument positions for a call of n arguments, then stops without an error ([5.2](#52-parse-time-vs-eval-time-enforcement--what-each-actually-guarantees)), and each admitted list is read once per parse, so testing a literal against a list is one lookup however long the list is, and a refusal reads the values its message prints; and a call that binds no definition is told apart as unknown or as matching no overload with one lookup in an index of the errors the parse has reported, each error read once. Raising `maxTokens` or `maxAstNodes` raises the parse's work in proportion.

### 5.4 Per-tenant registries — and per-tenant caches

Build a registry per tenant/security context rather than mutating a global one ([extending.md §5.1](extending.md#51-extending-the-core-runtime)) — variables, allowed functions, and redaction rules differ per tenant, and the registry is the policy object.

The part that is easy to miss: **cache and `pending` maps must be scoped exactly as narrowly as resolver behavior.** Cache keys contain the signature id and arguments — nothing identifying the tenant or resolver — so two tenants resolving the same signature id to different implementations must not share maps. Verified leak:

```ts
// Tenants A and B bind different implementations for TENANT_SECRET/v1.
const shared = { cache: new Map<string, unknown>(), pending: new Map<string, Promise<unknown>>() };
await evaluateRuleAsync(rule, { registry, resolver: resolverA, variables: {}, ...shared });
// -> 'value-of-tenant-A'
await evaluateRuleAsync(rule, { registry, resolver: resolverB, variables: {}, ...shared });
// -> 'value-of-tenant-A'   LEAKED: tenant B was served tenant A's cached result
```

With per-tenant maps, tenant B correctly computes `'value-of-tenant-B'`. Share maps across runs and users — but only within one implementation universe, and only within one process: object arguments are keyed by per-process identity ([4.2](#42-share-a-cross-run-cache-correctly)), so entries shipped between processes can collide two different objects under one key.

### 5.5 Redaction: log `perNode`, not the output tree

Mark sensitive variables (and functions whose _outputs_ are sensitive) with `redaction: 'mask'`. Masking applies to the `perNode` trace only — the output tree deliberately carries raw values so evaluation still works:

```ts
registry.registerVariable({
  name: 'api_key',
  description: 'A secret credential.',
  type: FormulaTypes.text(false),
  redaction: 'mask',
});
const { output, perNode } = await evaluateRuleOutputAsync(rule, ctx);
perNode['IF-0/STARTS_WITH-0/VAR_API_KEY-0']; // { value: { __redacted: true }, redacted: true, ... }
output.children[0].children[0].value; // 'sk-12345' — RAW. Never log the output tree.
```

Verified scope: values _derived_ from a masked variable log normally (`perNode['IF-0/STARTS_WITH-0'].value === true` above) — if a function's result would reveal the secret, set `redaction: 'mask'` on that function definition too.

**See also:** [architecture.md §4](architecture.md#4-security-model), [SECURITY.md](../SECURITY.md), [runner README](../runner/README.md#tracing-a-run-with-the-per-node-output-tree).

## 6. Observability and debugging

### 6.1 Two views of a run

`evaluateRuleOutputAsync` returns both: `output`, the full `FormulaNodeOutput` **tree** (per node: `ok`, `value`, `valueKind`, `warnings`, `error`, ordered `children`, `skipped`) — the source of truth for auditing, with raw values — and `perNode`, a **flat map** from stable node ids to log-sized entries (`{ span, value | error, skipped?, redacted?, truncated? }`) with redaction and truncation applied. Store `perNode` in logs and evidence trails; reserve the output tree for in-process decisions ([5.5](#55-redaction-log-pernode-not-the-output-tree)).

### 6.2 Stable node ids and spans are the contract for tracing UIs

Node ids are structural (`IF-0/GT-0/PROP_AMOUNT-0/VAR_DEAL-0`) and — verified — identical across whitespace-only edits of the source, so results, errors, and skip markers can be attached to editor positions that survive reformatting. Every node and error also carries a `span` into the exact source string you parsed ([3.2](#32-use-spans-for-editor-feedback)). A debugging UI needs nothing else: map `nodeId` → annotation, `span` → highlight, `skipped` → grey out untaken branches.

### 6.3 Handle structured failures — and do not mistake empty for failure

Evaluation resolves; it does not reject. Route on the structured channels:

```ts
const res = await evaluateRuleAsync(rule, ctx);
if (res.errors.length > 0) {
  // kind 'security' -> limits/guards fired; kind 'runtime' -> e.g. UNBOUND_FUNCTION, EVAL_CRASH
}
```

Verified semantics worth wiring into your handler:

- A **throwing implementation** becomes `EVAL_CRASH` with the original message (`res.errors[0].message === 'implementation bug'`), `value: null` — the host never sees the exception.
- **`1 / 0` evaluates to `null` with zero errors** — "empty in, empty out" is a value, not a failure ([language.md](language.md#null-and-empty-values)). Formulas test it with `IS_EMPTY(...)`; hosts must not treat `value === null` as an error signal.
- Soft failures are **warnings** on the node output (`ok: true`, `value: null`, `warnings: [{ code: 'TYPE', ... }]`), not run errors — inspect the output tree where you need them ([7.2](#72-test-custom-functions-through-the-public-pipeline)).

**See also:** [extending.md §8](extending.md#8-reading-per-node-output-for-tracing-and-debugging-uis), [architecture.md §3.4](architecture.md#34-per-node-execution-output-and-redaction).

## 7. Testing your integration

### 7.1 A reusable eval helper

Test through the public pipeline — parse, optimize, evaluate — exactly as production does. This helper (the pattern the repository's own suites use) returns everything a test needs, including a combined error list so happy-path tests can assert one empty array:

```ts
import { createCoreFormulaRuntime, type FormulaRuntime } from '@formulang/core-functions';
import { optimizeRule } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleOutputAsync } from '@formulang/runner';

export async function evalFormula(
  source: string,
  variables: Record<string, unknown> = {},
  setup?: (registry: FormulaRuntime['registry'], impls: FormulaRuntime['implementations']) => void,
) {
  const { registry, implementations } = createCoreFormulaRuntime();
  setup?.(registry, implementations);
  const parsed = parseFormula(source, { registry });
  const compiled = optimizeRule(parsed, { registry });
  const result = await evaluateRuleOutputAsync(compiled, {
    registry,
    resolver: implementations,
    variables,
  });
  return {
    parsed,
    compiled,
    ...result,
    value: result.output.value ?? null,
    allErrors: [...parsed.errors, ...compiled.errors, ...result.errors],
  };
}
```

A fresh runtime per call keeps tests independent (registries are cheap in-memory objects); the `setup` hook registers the custom functions and variables under test.

### 7.2 Test custom functions through the public pipeline

Cover the four behaviors every implementation has — all four assertions below are verified against a `SLUGIFY/v1` sample:

```ts
// 1. Happy path — assert the combined error list is empty, then the value.
const ok = await evalFormula('SLUGIFY("Hello World") & "!"', {}, registerSlugify);
expect(ok.allErrors).toStrictEqual([]);
expect(ok.value).toBe('hello-world!');

// 2. Empty in, empty out — null input is not an error.
const empty = await evalFormula('SLUGIFY(name)', { name: null }, withNameVar);
expect(empty.allErrors).toStrictEqual([]);
expect(empty.value).toBeNull();

// 3. Wrong type — soft failure: ok null + TYPE warning on the node, run errors stay empty.
const soft = await evalFormula('SLUGIFY(name)', { name: 42 }, withAnyNameVar);
expect(soft.errors).toStrictEqual([]);
expect(soft.output.warnings?.[0]?.code).toBe('TYPE');

// 4. Hard failure — the implementation returned makeError(...):
const hard = await evalFormula('SLUGIFY("x")', {}, withFailingSlugify);
expect(hard.output.ok).toBe(false);
expect(hard.output.error?.code).toBe('SLUG_BACKEND_DOWN'); // your code, preserved on the node
expect(hard.errors[0]?.code).toBe('EVAL_CRASH'); // run level normalizes unknown codes
expect(hard.errors[0]?.message).toBe('slug service unavailable'); // message survives
```

**Pitfall:** custom error codes from `makeError` are preserved on the node output (`output.error.code`) but the run-level `errors` array normalizes codes outside `FormulaErrorCodes` to `EVAL_CRASH` (the message is kept). Assert node-level codes via `evaluateRuleOutputAsync`, or use codes from `FormulaErrorCodes` when you want them to surface at run level.

**See also:** [extending.md §9](extending.md#9-worked-example-uppercase_first-end-to-end) (worked custom function), [CONTRIBUTING.md](../CONTRIBUTING.md) (how this repository runs its own suites), any `*.spec.ts` under `core-functions/src/functions/` for real-world examples.
