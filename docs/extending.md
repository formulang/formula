# Extending Formulang

This guide is for embedders: adding your own functions and operators, exposing host data as typed variables, assembling registries, and wiring parse/evaluate into an application. It ends with a complete worked example — a custom `UPPERCASE_FIRST(text)` function registered and evaluated end to end.

Prerequisite reading: [architecture.md](architecture.md) explains how the four packages fit together; [language.md](language.md) covers the formula syntax itself. Everything below uses public exports of `@formulang/definitions`, `@formulang/parser`, `@formulang/runner`, and `@formulang/core-functions`.

## 1. The extension model

Every function exists as two halves that meet only through a versioned signature id string:

| Half           | Type                     | Package                                         | Contains                                                                                         |
| -------------- | ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Definition     | `FunctionDefinition`     | registered into a `FormulaRegistry`             | Name, parameters, types, purity, flags — plain data, safe to ship to browsers and editor tooling |
| Implementation | `FunctionImplementation` | resolved via a `FunctionImplementationResolver` | The code that executes — backend-only                                                            |

The parser only needs definitions (it type-checks and binds calls to signature ids). The runner needs both: it looks up the bound signature id in the resolver at evaluation time. A definition without an implementation parses fine and fails at run time with a structured `UNBOUND_FUNCTION` error — which is exactly what you want in an editor or validation service that should never hold executable code.

Signature ids must match `NAME/vN` (enforced at registration: `/^[A-Z0-9_]+\/v\d+$/`, e.g. `FILTER/v1`). They are the stable currency of the system — cache keys, `requirements.functionsUsed`, and operator bindings all key off them. When you change a function's behavior, register `NAME/v2` under the same user-facing name instead of mutating `v1`, and retire the old definition as legacy — `registry.retireFunction('NAME/v1')`, or `legacy: true` at registration — so new compiles bind only `v2` while `v1` stays resolvable by its pinned signature id; stored compiled rules and caches stay valid ([best-practices.md §2.3](best-practices.md#23-same-shape-version-bump-retire-the-old-definition-as-legacy-keep-implementations-forever)).

## 2. Defining a function

`registry.registerFunction(def)` takes a `FunctionDefinition` (`definitions/src/registry.ts`). The core registrations in `definitions/src/register-core-definitions.ts` are the reference material; this is `ADD`, verbatim:

```ts
registry.registerFunction({
  signatureId: BuiltinSignatureIds.ADD, // 'ADD/v1'
  name: 'ADD',
  category: 'core',
  description: 'Adds two numbers.',
  params: [
    { name: 'a', type: FormulaTypes.number(true) },
    { name: 'b', type: FormulaTypes.number(true) },
  ],
  returnType: FormulaTypes.number(true),
  purity: 'pure',
});
registry.registerOperator({
  token: '+',
  precedence: 20,
  associativity: 'left',
  functionSignatureId: BuiltinSignatureIds.ADD,
});
```

An operator is nothing more than a token bound to a function signature id — register one and the parser picks it up automatically. The core precedence ladder: comparisons (`=`, `<>`, `>`, `>=`, `<`, `<=`) at 10, additive (`+`, `-`, `&`) at 20, multiplicative (`*`, `/`) at 30, `^` at 40 (right-associative).

Registration is strict and fails fast, at startup rather than mid-evaluation: invalid signature ids, duplicate ids/tokens/variable names, ambiguous overload sets, duplicate or counter-directional `casts`, and a `literalValues` value that is not a non-empty list of texts, or that sits on a parameter without `literalOnly`, all throw.

### 2.1 Parameters

Each `FunctionParamDefinition` supports:

| Field           | Effect                                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`          | Bound and checked at parse time (`ARGUMENT_TYPE_MISMATCH`); nullability is enforced at run time (`NULL_NOT_ALLOWED`) when a `nullable: false` parameter receives null.                                              |
| `optional`      | May be omitted at the call site.                                                                                                                                                                                    |
| `variadic`      | The last parameter may repeat (`AND(values...)`).                                                                                                                                                                   |
| `literalOnly`   | The argument must be a string literal in the source, validated at parse time — no dynamic values.                                                                                                                   |
| `literalValues` | With `literalOnly`: the only literals the parameter admits, a non-empty list of texts. Any other literal is a parse-time `LITERAL_VALUE_NOT_ALLOWED` error whose message names the list. `null` stands for no list. |
| `reference`     | `'function' \| 'operator' \| 'function_or_operator'` — the literal is validated against the registry (`UNKNOWN_FUNCTION_REFERENCE`).                                                                                |

A mode switch is the typical use of `literalValues`: the parser refuses a misspelt mode at compile time — also when core higher-order functions pass the mode on, at any depth of callables named by string literals that its bounded walk reaches, as in `EACH(list; "SHOUT"; "uper")` or `EACH(lists; "EACH"; "SHOUT"; "uper")` — and editors read the list from the definition to offer completions. An implementation still validates the value it receives, because it can receive values the parser does not see: through a callable that a nested higher-order call names by a variable or an expression, which is resolved when the call runs (`EACH(lists; "EACH"; name; mode)`), from a custom higher-order function under a name of its own, through a callable a host function takes after the first argument of a variadic callable parameter that lists no admitted values, or past the bound of the parser's walk through nested callables (§2.2). The built-in functions answer a mode they do not list with `null` and a `TYPE` warning (through a core higher-order call that item is `null`: the core higher-order functions keep a callee's value, not its warnings); give a custom implementation the same check:

```ts
registry.registerFunction({
  signatureId: 'SHOUT/v1',
  name: 'SHOUT',
  description: 'Changes the case of a text.',
  params: [
    { name: 'text', type: FormulaTypes.text(true) },
    {
      name: 'mode',
      type: FormulaTypes.text(false),
      optional: true,
      literalOnly: true,
      literalValues: ['upper', 'lower'],
    },
  ],
  returnType: FormulaTypes.text(true),
  purity: 'pure',
});
// SHOUT(name; "uper") -> LITERAL_VALUE_NOT_ALLOWED:
//   Parameter 'mode' must be one of "upper", "lower"; got "uper"
```

Overloads are supported: register multiple definitions under the same `name` with different signature ids (see `COUNT/v1` vs `COUNT_VALUES/v1`, or the two `STARTS_WITH` variants). The registry rejects overload pairs that accept the same arguments with neither more specific; among the overloads it accepts, a call binds the first one registered that takes it, so register a narrower overload before a wider one (the core definitions are registered before yours). `aliases` lets one definition answer to several names.

### 2.2 Templates (generics) and callable parameters

Definitions can declare type variables in `templates` and use `FormulaTypes.template('T')` in params and the return type. Combined with `callable` parameter types, this is how higher-order functions are typed. `EACH`, verbatim from the core definitions:

```ts
registry.registerFunction({
  signatureId: BuiltinSignatureIds.EACH,
  name: 'EACH',
  category: 'core',
  description: 'Transform a list of items.',
  templates: [
    { name: 'T', description: 'The type of each item in the input list.' },
    { name: 'R', description: 'The type of each item in the output list.' },
  ],
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
    { name: 'args', type: FormulaTypes.any(true), variadic: true, optional: true },
  ],
  returnType: FormulaTypes.list(FormulaTypes.template('R', { nullable: true }), true),
  purity: 'pure',
});
```

At parse time the template `T` is inferred from the argument list's element type, the referenced callable is resolved against the registry and validated (arity, parameter types, return type), and `R` is bound from its return type — so `EACH(value; "LEN")` over a `List<text>` types as `List<number?>?`. There are no closures in the language: a callable is a reference by name to a registered function or operator, so a formula reaches the registry's functions and never code of its own. The callable a call writes is a string literal (`literalOnly`), resolved and checked when the formula parses; one that a higher-order call passes on can also be named by a variable or an expression, resolved when the call runs (below), so which registered functions a formula reaches is not always readable from its text.

The parser knows how each core higher-order function invokes its callable: `EACH`, `FILTER`, `FILTER_PROPERTY`, `REDUCE` and `FILTER_BY`, in one table keyed by function name (`parser/src/callable-invocations.ts`), as 1.0.0 keyed the first four. Every function whose `name` is one of these gets the table's entry, in any letter case: the core one re-registered under another signature id — the way to change a function, section 1 — keeps its checks, and a function of your own under one of these names is checked as the built-in is. A name in `aliases` does not count, as on 1.0.0: a definition that answers to `EACH` only through its aliases is a plain function. That includes `FILTER_BY`, a name 1.1.0 adds: a function of your own named `FILTER_BY` has its callable checked as receiving an item of the call's second argument and, when the call has one, the call's fourth argument, as the built-in's does. A copy under any other name is a plain function, as a copy of `EACH` is on 1.0.0, and a definition cannot declare an invocation of its own. With the invocation, the parser checks the referenced function's arity, overload and result type against the arguments it receives, and holds each of them to the referenced parameter's enumerated-literal rule: an argument reaching a parameter that lists its admitted `literalValues` must be a string literal naming one of them, and a value the function supplies when it runs cannot reach such a parameter. The core higher-order functions call the function behind an operator token, otherwise the first definition of the name that has an implementation, which the parser cannot see and which need not be the overload the argument types choose; so when you register several overloads of a name that list admitted values at the same position, a literal a core higher-order function passes on must be one every one of them lists there, and the refusal names the overloads that do not list it. A call written directly binds the overload its types choose and is checked against that overload's list. When the referenced function is itself one of these higher-order functions and the name it is passed is a string literal, the parser follows that name into its invocation as well, for every definition of the name, so a custom function whose parameter lists admitted values is protected however deeply the core higher-order functions nest, as long as each callable is named by a string literal and the walk's bound reaches it: the parser visits at most 16 × (n + 1) argument positions for a call of n arguments written in the formula, breadth first across every callable the call names, and a level visits no more positions than the widest definition of the function it names has parameters, or every argument it receives where a variadic last parameter lists its admitted values, so a host overload with a long parameter list under one of these names can spend the bound before the end of a long chain ([language.md](language.md#when-a-mode-is-checked)). A definition is followed at each callable parameter of its own list and, of a variadic callable parameter, at every further argument when the parameter lists its admitted values and only at the first when it lists none, as where the call is written. A callable that such a call passes on can also be named by a variable or an expression; as in 1.0.0 it is resolved when the call runs, and the parser does not check the arguments it receives. For a custom function with a callable parameter under any other name, the parser checks that the reference written in the call names a registered function or operator; the arguments the custom function then passes are checked at run time by the implementation that receives them.

### 2.3 Purity and its caching consequences

`purity` is a required choice with concrete consequences in the runner (`runner/src/internal/invoke.ts`):

| `purity`       | Consequence                                                                                                                                                                                                                                                                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'pure'`       | Results may be cached across runs. If the host passes shared `cache`/`pending` maps in the evaluate context, identical calls (same signature id + argument values + expected cast) are answered from cache and concurrent identical calls are deduplicated to one execution. Purity `'pure'` is also what lets a formula of literals be marked `static` at parse time (section 7). |
| `'run_cached'` | Memoized only within a single `evaluateRuleAsync` run — deterministic per run, never shared. Use for functions that must be stable inside one evaluation but not across evaluations.                                                                                                                                                                                               |
| `'uncached'`   | Invoked every time. The core datetime functions (`NOW`, `TODAY`, ...) use this.                                                                                                                                                                                                                                                                                                    |

Only declare `'pure'` if the function is genuinely deterministic in its arguments and side-effect free — the cache will happily serve stale results otherwise. Additional guard rails, regardless of purity: control-flow functions are never cached, calls with any string argument longer than `limits.maxCacheableStringLength` skip caching, outputs that carry warnings are not stored (so cache hits never lose warning evidence), and errors are never cached.

### 2.4 Redaction

`redaction: 'mask'` (available on both function and variable definitions) masks values in the per-node debug trace: the entry becomes `{ __redacted: true }` with `redacted: true`. Masking is scoped precisely — a masked _variable_ masks the variable/property/wildcard nodes rooted at it, but a call node computed _from_ it still logs its own output; to also mask a function's result, set `redaction: 'mask'` on the function definition. The computed value itself flows through evaluation normally either way; redaction affects only what gets logged (see section 8).

### 2.5 Control flow (lazy arguments)

By default the runner evaluates all arguments before invoking an implementation. `controlFlow: true` hands the implementation _unevaluated_, memoized argument providers instead, so it can decide what to pull — this is how `IF`, `AND`, `OR`, `NOT`, and `SWITCH` short-circuit. Arguments that were never pulled are recorded as `skipped` in the output. Control-flow functions opt out of caching and are charged a flat cost. Section 3.3 shows the implementation side.

### 2.6 Casts

A definition may declare explicit casts, e.g. `COUNT` doubles as a cast from `List<Any>` to `Number`:

```ts
casts: [
  { from: FormulaTypes.list(FormulaTypes.any(true), true), to: FormulaTypes.number(true) },
],
```

The registry enforces cast uniqueness (and rejects counter-casts) among active definitions at registration — `legacy` definitions never claim cast slots, and `retireFunction` releases the retired definition's slots so a same-cast successor can redeclare them; the runner uses the declaration to propagate `expectedCast` hints into single-argument calls. Most custom functions do not need this.

## 3. Implementing a function

The execution contract (`definitions/src/registry.ts`) is batch-first:

```ts
export interface FunctionImplementation {
  evaluateMultiple: (
    calls: BatchEvaluationCall[],
    ctx: FormulaExecutionContext,
  ) => Array<FormulaNodeOutput> | Promise<Array<FormulaNodeOutput>>;
  estimateCostsInSeconds?: (args: unknown[]) => number;
  tryStaticEvaluate?: (ctx: StaticEvaluationContext) => StaticEvaluationResult | null;
}
```

Each `BatchEvaluationCall` is `{ args, expectedCast?, callId? }`, where `args` are lazy, memoized `FormulaValueProvider`s:

```ts
export interface FormulaValueProvider {
  output(): Promise<FormulaNodeOutput>; // full child output incl. errors/warnings
  value(): Promise<unknown>; // unwrapped value convenience
}
```

The runner invokes with one call per AST node, but list built-ins fan out through the same interface: `FILTER(value; "MY_PREDICATE")` over a 3-item list delivers a single `evaluateMultiple` with three calls, so an implementation that talks to an external service can batch all items into one round trip.

Return `FormulaNodeOutput`s instead of throwing. Build them with the helpers from `@formulang/definitions` (`execution-helpers.ts`): `makeOkText`, `makeOkNumber`, `makeOkBoolean`, `makeOkList`, `makeOkObject`, `makeOkNull`, `makeOkUnknown`, `makeError`, `withWarnings`, plus the `expectText`/`expectNumber`/... validators. Two conventions worth copying from the core functions:

- **Soft failures are warnings, not errors.** A type mismatch inside a formula (e.g. `ADD("x"; 1)`) returns an ok `null` output _with_ a `TYPE` warning, so one bad cell does not take down the whole formula. Reserve `makeError` for hard failures.
- **Never emit `NaN`/`Infinity`** — `makeOkNumber` already downgrades them to null.

For hard resource stops, throw `FormulaRuntimeError(code, message, 'security')` (see `FilterImplementation` enforcing `ctx.limits.maxListLength`); the runner converts any throw into a structured error output at the node boundary.

### 3.1 The eager batch pattern

Almost every core function follows the same shape: resolve all argument providers, then compute per call. The core functions share this via a small internal base class (`core-functions/src/functions/abstract-eager-batch-implementation.ts`, verbatim):

```ts
export abstract class AbstractEagerBatchImplementation<
  TConfig extends BaseFunctionConfig = BaseFunctionConfig,
> implements FunctionImplementation {
  protected constructor(protected readonly config: TConfig) {}

  async evaluateMultiple(
    calls: BatchEvaluationCall[],
    ctx: FormulaExecutionContext,
  ): Promise<FormulaNodeOutput[]> {
    const outs: FormulaNodeOutput[] = [];
    for (const call of calls) {
      const argValues = await Promise.all(call.args.map((p) => p.value()));
      outs.push(await this.evaluate(argValues, ctx));
    }
    return outs;
  }

  protected abstract evaluate(
    args: unknown[],
    ctx: FormulaExecutionContext,
  ): FormulaNodeOutput | Promise<FormulaNodeOutput>;
}
```

A subclass then only writes `evaluate`. `UpperImplementation` (`core-functions/src/functions/upper.ts`), verbatim:

```ts
export class UpperImplementation extends AbstractEagerBatchImplementation {
  constructor(config: BaseFunctionConfig) {
    super(config);
  }

  estimateCostsInSeconds(args: unknown[]): number {
    return Math.min(0.002, 0.000001 * assumedTextLength(args[0]));
  }

  protected evaluate(args: unknown[], _ctx: FormulaExecutionContext) {
    const raw = args[0];
    const t = asText(raw);
    if (t == null) {
      if (!isEmptyValue(raw)) {
        return withWarnings(makeOkNull('UPPER'), [{ code: 'TYPE', message: 'UPPER expects text' }]);
      }
      return makeOkNull('UPPER');
    }
    return makeOkText('UPPER', t.toUpperCase());
  }
}
```

Note that `@formulang/core-functions` publicly exports only `createCoreFormulaRuntime` (and the `FormulaRuntime` type) — the base class and per-function helpers (`asText`, `assumedTextLength`, ...) are internal. For custom functions in your own codebase, either copy the ~20-line base class or implement `evaluateMultiple` directly, as the worked example in section 9 does. `BaseFunctionConfig` (`{ signatureId: string }`) and `FunctionImplementationClass` from `@formulang/definitions` give you the class-shaped contract.

### 3.2 Cost estimation

`estimateCostsInSeconds(argValues)` is called before each invocation; the estimate is charged against `limits.maxFunctionCostUnits` (per call) and `limits.maxTotalCostUnits` (per run). An implementation without an estimator is charged a conservative 0.05 units per call — with the default limits (`maxTotalCostUnits: 5`) that allows about 100 such calls per evaluation, so cheap functions should declare cheap estimates (`ADD` returns `0.00001`). Estimate generously for functions that do I/O; the point of the mechanism is that expensive calls are rejected _before_ they run.

### 3.3 The lazy pattern: control flow with argument providers

For a `controlFlow: true` definition, implement `evaluateMultiple` manually and pull only what you need. `IfImplementation` (`core-functions/src/functions/if.ts`), condensed to the essential loop:

```ts
export class IfImplementation implements FunctionImplementation {
  constructor(private readonly config: BaseFunctionConfig) {}

  async evaluateMultiple(calls: BatchEvaluationCall[], _ctx: FormulaExecutionContext) {
    const outs = [];
    for (const call of calls) {
      const condProvider = call.args[0];
      const thenProvider = call.args[1];
      const elseProvider = call.args[2];

      const condOut = condProvider ? await condProvider.output() : null;
      const cond = normalizeBooleanLike(condOut?.value);
      if (cond === null) {
        outs.push(
          makeError('IF', {
            kind: 'runtime',
            code: 'TYPE',
            message: 'Expected boolean-like condition',
            signatureId: this.config.signatureId,
          }),
        );
        continue;
      }

      const chosen = cond ? thenProvider : elseProvider;
      const chosenOut = chosen ? await chosen.output() : null;
      outs.push(
        makeOkUnknown('IF', chosenOut?.value ?? null, { signatureId: this.config.signatureId }),
      );
    }
    return outs;
  }
}
```

The branch that is never awaited is never evaluated — its subtree appears with `skipped: true` in the output tree and the per-node trace. Providers are memoized, so pulling the same argument twice does not re-evaluate it. Use `output()` when you need the child's warnings/errors; `value()` when you only need the value.

### 3.4 Parse-time folding

`tryStaticEvaluate({ args })` is an optional hook for implementation-assisted constant folding when all arguments are static literals; it can return a replacement `value`, a refined `returnType`, and `externalData` references discovered from literal arguments (which `optimizeRule` merges into `TypedRule.requirements.externalData`). The shipped optimizer folds only parser-computed predictable values, so treat this as an advanced integration point.

## 4. Registering variables

Variables are the boundary where host data enters the formula. Declaring types precisely is what makes the boundary safe.

```ts
import { FormulaTypes } from '@formulang/definitions';

registry.registerVariable({
  name: 'deal',
  description: 'The deal being evaluated.',
  type: FormulaTypes.object('Deal', {
    amount: FormulaTypes.number(true),
    owner: FormulaTypes.text(true),
  }),
});
```

Names must be `lower_snake_case`. The object type's first argument is the _clarifier_ — a tag (`'Deal'`, `'date'`, `'Row'`) that names the object shape for assignability checks, error messages, and `valueObjectKind` in outputs. The `properties` map is the **allowlist**.

### 4.1 How property allowlisting protects untrusted input

Formula source is untrusted; the values you pass at evaluation time often contain more than a formula should see. Allowlisting closes that gap twice:

- **At parse time**, `deal.amount` binds because `amount` is declared. `deal.internal_notes` fails with `PROPERTY_NOT_ALLOWLISTED` (kind `security`), even though the runtime object may well carry that key. Property access on an `any`-typed value is refused outright rather than silently permitted, and `deal.__proto__` (or any `__`-prefixed, `prototype`, `constructor` name) is rejected with `DENYLISTED_PROPERTY`.
- **At evaluation time**, the runner re-checks both rules per node and reads only _own_ properties (`Object.prototype.hasOwnProperty`), never the prototype chain. The denylist re-check is name-based and holds even against a tampered AST; the allowlist re-check reads the type metadata embedded in the AST, so it is defense in depth against stale artifacts, not a substitute for keeping stored compiled rules tamper-proof ([best-practices.md §1.5](best-practices.md#15-treat-stored-compiled-rules-as-trusted-artifacts)).

So the contract is: whatever object you hand the runner, formulas can only reach the paths you declared. Lists of objects work the same way per element:

```ts
registry.registerVariable({
  name: 'value',
  description: 'A test list of items.',
  type: FormulaTypes.list(FormulaTypes.object('Row', { id: FormulaTypes.number(false) }), true),
});
// value.*.id     -> types as a list of numbers
// value.*.secret -> PROPERTY_NOT_ALLOWLISTED at parse time
```

### 4.2 Redaction and lazy values

Sensitive variables can be masked in the debug trace:

```ts
registry.registerVariable({
  name: 'api_key',
  description: 'Secret credential for the deployment.',
  type: FormulaTypes.text(true),
  redaction: 'mask',
});
```

At evaluation time, values are plain data — or resolver functions. If a root variable value (or an object property reached during accessor evaluation) is a function, the runner calls it with `{ registry, limits, budget }`, awaits the result, and applies the per-call wall-time limit. This is how lazy or remote data is injected without teaching the runner about your data sources:

```ts
await evaluateRuleAsync(rule, {
  registry,
  resolver: implementations,
  variables: { name: async () => 'from the database' },
});
```

## 5. Assembling a registry and resolver

### 5.1 Extending the core runtime

The common case: take everything `@formulang/core-functions` ships and add your own entries on top.

```ts
import { createCoreFormulaRuntime } from '@formulang/core-functions';

const { registry, implementations } = createCoreFormulaRuntime();
// registry:        MutableFormulaRegistry with all core definitions + operators
// implementations: resolver with all core implementations, and .register() for your own

registry.registerFunction({/* your FunctionDefinition */});
implementations.register('YOUR_FN/v1', new YourFnImplementation({ signatureId: 'YOUR_FN/v1' }));
registry.registerVariable({/* your VariableDefinition */});
```

Registries are cheap in-memory objects. Build one per tenant/document type/security context rather than mutating a global one — the registry _is_ your capability policy.

### 5.2 Minimal and custom registries

For a parse-only embedding (editor, autocomplete, validation service), definitions are all you need — no executable code is loaded:

```ts
import { createRegistry, registerCoreFormulaDefinitions } from '@formulang/definitions';

const registry = createRegistry();
registerCoreFormulaDefinitions(registry); // optional: the built-in definitions + operators
registry.registerVariable({/* ... */});
// parseFormula(source, { registry }) now type-checks formulas; nothing can execute.
```

For a locked-down evaluating runtime, skip `registerCoreFormulaDefinitions` and register only the functions you allow. The resolver contract is a single method, so a `Map` wrapper satisfies it:

```ts
import {
  createRegistry,
  type FunctionImplementation,
  type FunctionImplementationResolver,
} from '@formulang/definitions';

const registry = createRegistry();
const impls = new Map<string, FunctionImplementation>();
const resolver: FunctionImplementationResolver = {
  get: (signatureId) => impls.get(signatureId),
};
```

Two rules keep the halves consistent:

- Every definition you expect to _evaluate_ needs an implementation registered under the same signature id, or calls fail with `UNBOUND_FUNCTION`. The core implementations are only available through `createCoreFormulaRuntime()` — if you want core functions in a custom runtime, start from that factory.
- The registry used at parse time and the registry used at evaluate time should be the same (or equivalent): the runner consults it for definitions, purity, and redaction.

## 6. Supplying variables, limits, and syntax

At parse time (`@formulang/parser`):

```ts
import { parseFormula } from '@formulang/parser';

const rule = parseFormula('IF(deal.amount > 100, "big", "small")', {
  registry,
  syntax: { argumentSeparator: ',' }, // default ';'; decimalSeparator: '.' | ',' (default '.')
  limits: { maxSourceLength: 2_000 }, // merged over DEFAULT_FORMULA_LIMITS
});
if (rule.errors.length > 0) {
  // structured FormulaError[] with spans — never thrown
}
```

At evaluation time (`@formulang/runner`):

```ts
import { evaluateRuleAsync } from '@formulang/runner';

const sharedCache = new Map<string, unknown>();
const sharedPending = new Map<string, Promise<unknown>>();

const result = await evaluateRuleAsync(rule, {
  registry,
  resolver: implementations,
  variables: { deal: { amount: 250, owner: 'ada' } }, // values or resolver functions
  limits: { maxWallTimeMs: 2_000 }, // per-run override
  cache: sharedCache, // optional: cross-run cache for `pure` calls
  pending: sharedPending, // optional: in-flight dedup for `pure` calls
});
result.value; // 'ADA' ... the root value (null when absent)
result.errors; // FormulaError[] — evaluation never throws
result.perNode; // trace, see section 8
```

`limits` accepts `Partial<FormulaLimits>` in both places and is merged over the conservative `DEFAULT_FORMULA_LIMITS` (`@formulang/definitions`). Parse-time limits bound input size (source length, tokens, AST nodes, nesting); eval-time limits bound work (steps, wall time, cost units, list sizes). You can also pass a shared `FormulaEvaluationBudget` as `budget` to cap a whole batch of evaluations under one step allowance. See [`@formulang/runner`](../runner/README.md) for the full context reference.

If you configure `syntax`, use the same configuration for every parse of the same stored formula — the separators are part of the source's meaning.

## 7. Consuming `TypedRule.requirements` to prefetch data

Parsing is also static analysis. `rule.requirements` tells you everything a formula needs _before_ you run it:

```ts
const rule = parseFormula('IF(deal.amount > 100; UPPER(deal.owner); "unassigned")', { registry });

rule.requirements.variablesRead; // ['deal.amount', 'deal.owner'] — full accessor paths
rule.requirements.functionsUsed; // ['GT/v1', 'UPPER/v1', 'IF/v1'] — bound signature ids
rule.requirements.externalData; // [{ kind, value }] — references found while folding
rule.static; // false — reads variables
```

Typical host patterns:

- **Prefetch.** `variablesRead` contains full paths (`deal.amount`, `contacts.*.email`), not just root names — fetch or authorize exactly those columns/relations from your store, then evaluate with the loaded data. Wildcard paths (`list.*.prop`) tell you a per-element property is needed.
- **Capability checks.** Gate stored formulas on `functionsUsed` — e.g. reject rules using signature ids outside a tenant's allowed set without evaluating anything.
- **Cache invalidation.** A stored rule's result depends only on `variablesRead` + `functionsUsed`; recompute when those inputs change, and use signature id versions (`/v1` vs `/v2`) to invalidate when implementations change behavior.
- **Compute-once.** If `rule.static` is true (literals and `pure` functions of literals only), the result never changes — evaluate once and store the value. `optimizeRule(rule, { registry })` from `@formulang/definitions` additionally folds subtrees the parser already marked predictable into literals.
- **External data.** `externalData` is the channel by which `tryStaticEvaluate` (section 3.4) reports references discovered inside literal arguments — e.g. a custom `LOOKUP("customer:123")` can surface `{ kind: 'customer', value: '123' }` at optimize time so the host can prefetch the record.

`estimatedCostUnits` exists on the type for parse-time cost accounting but is currently left at `0`; cost enforcement happens at run time via `estimateCostsInSeconds` (section 3.2).

## 8. Reading per-node output for tracing and debugging UIs

Evaluation returns two views of what happened, both keyed by stable node ids that survive whitespace edits (see [architecture.md](architecture.md#23-stable-node-ids)):

- `evaluateRuleOutputAsync` returns the full `FormulaNodeOutput` **tree** — per node: `ok`, `name`, `signatureId?`, `value`, `valueKind`, `warnings?`, `error?`, ordered `children`, `nodeId`, `span`, and `skipped?: true` for short-circuited subtrees. This is the source-of-truth evidence for auditing a run.
- Both entrypoints return `perNode`: a flat `Record<nodeId, PerNodeEntry>` where each entry is `{ span?, value?, error?, skipped?, redacted?, truncated? }` — sized for logging and UI display.

For `UPPERCASE_FIRST(name)` with `{ name: 'ada' }` (from the worked example below), `perNode` looks like:

```jsonc
{
  "UPPERCASE_FIRST-0/VAR_NAME-0": { "span": { "start": 16, "end": 20 }, "value": "ada" },
  "UPPERCASE_FIRST-0": { "span": { "start": 0, "end": 21 }, "value": "Ada" },
}
```

Everything a debugging UI needs is here: map `nodeId` to the AST, use `span` to highlight the source range, render `value` per subexpression, show `error` entries inline, and grey out `skipped` branches (`IF(false; THEN; ELSE)` marks the `THEN` subtree skipped). Logged values are bounded by the `maxLogged*` limits — long strings/lists/objects become `{ __truncated: true, ... }` previews with lengths and hashes, flagged `truncated` — and `redaction: 'mask'` entries appear as `{ "__redacted": true }` with `redacted: true`. The output _tree_ carries raw values; the host chooses which view to expose to whom.

## 9. Worked example: `UPPERCASE_FIRST` end to end

A complete, self-contained program: define a custom text function, implement it, register both halves on top of the core runtime, and evaluate a formula that uses it. The structure mirrors the core functions exactly (`UPPER`'s definition and implementation, wired the same way `register-primitive-implementations.ts` does it).

```ts
import { createCoreFormulaRuntime } from '@formulang/core-functions';
import type {
  BaseFunctionConfig,
  BatchEvaluationCall,
  FormulaExecutionContext,
  FormulaNodeOutput,
  FunctionImplementation,
} from '@formulang/definitions';
import { FormulaTypes, makeOkNull, makeOkText, withWarnings } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleAsync } from '@formulang/runner';

// --- 1. Implementation (backend-only code) --------------------------------

class UppercaseFirstImplementation implements FunctionImplementation {
  constructor(private readonly config: BaseFunctionConfig) {}

  estimateCostsInSeconds(): number {
    return 0.00001;
  }

  async evaluateMultiple(
    calls: BatchEvaluationCall[],
    _ctx: FormulaExecutionContext,
  ): Promise<FormulaNodeOutput[]> {
    const outs: FormulaNodeOutput[] = [];
    for (const call of calls) {
      const raw = await call.args[0]?.value();
      if (typeof raw !== 'string') {
        // Convention from the core functions: empty input -> ok null;
        // wrong type -> ok null with a TYPE warning (soft failure).
        const out = makeOkNull('UPPERCASE_FIRST', { signatureId: this.config.signatureId });
        outs.push(
          raw == null
            ? out
            : withWarnings(out, [{ code: 'TYPE', message: 'UPPERCASE_FIRST expects text' }]),
        );
        continue;
      }
      outs.push(
        makeOkText('UPPERCASE_FIRST', raw.charAt(0).toUpperCase() + raw.slice(1), {
          signatureId: this.config.signatureId,
        }),
      );
    }
    return outs;
  }
}

// --- 2. Runtime assembly: definition + implementation + variable ----------

const { registry, implementations } = createCoreFormulaRuntime();

registry.registerFunction({
  signatureId: 'UPPERCASE_FIRST/v1',
  name: 'UPPERCASE_FIRST',
  description: 'Uppercases the first character of the text.',
  params: [{ name: 'text', type: FormulaTypes.text(true) }],
  returnType: FormulaTypes.text(true),
  purity: 'pure', // deterministic + side-effect free => cacheable; static over literal args
});

implementations.register(
  'UPPERCASE_FIRST/v1',
  new UppercaseFirstImplementation({ signatureId: 'UPPERCASE_FIRST/v1' }),
);

registry.registerVariable({
  name: 'name',
  description: 'The name to format.',
  type: FormulaTypes.text(true),
});

// --- 3. Parse ---------------------------------------------------------------

const rule = parseFormula('UPPERCASE_FIRST(name)', { registry });
rule.errors; // []
rule.returnType; // { kind: 'text', nullable: true, ... }
rule.requirements.functionsUsed; // ['UPPERCASE_FIRST/v1']
rule.requirements.variablesRead; // ['name']

// --- 4. Evaluate ------------------------------------------------------------

const result = await evaluateRuleAsync(rule, {
  registry,
  resolver: implementations,
  variables: { name: 'ada lovelace' },
});
result.errors; // []
result.value; // 'Ada lovelace'
```

The function composes with everything else in the registry — `UPPERCASE_FIRST(name) & "!"` evaluates to `'Ada!'` (with `name = 'ada'`), and because the definition is `pure`, `UPPERCASE_FIRST("ada")` parses with `rule.static === true`, so a host can evaluate it once and reuse the result. Passing `{ name: null }` yields `null` without errors (the parameter is nullable); passing a number yields `null` plus a `TYPE` warning on the node's output.

Behavior changes later? Retire the old definition with `registry.retireFunction('UPPERCASE_FIRST/v1')` — it leaves the authoring name but stays resolvable by its pinned signature id — then register `UPPERCASE_FIRST/v2` with the new semantics and keep `v1` implemented for stored rules that still reference it ([best-practices.md §2.3](best-practices.md#23-same-shape-version-bump-retire-the-old-definition-as-legacy-keep-implementations-forever)).

## Checklist for a new function

1. Pick a stable signature id: `NAME/v1`.
2. Register the `FunctionDefinition` (types, `purity`, flags) — in a shared module if editors also need it; it is data-only.
3. Implement `FunctionImplementation` (eager loop, or lazy providers for `controlFlow`); return outputs via the `makeOk*`/`makeError` helpers, use warnings for soft failures.
4. Provide `estimateCostsInSeconds` — mandatory in spirit for anything doing I/O.
5. Register the implementation under the same signature id where you evaluate.
6. Add tests through the public pipeline (`parseFormula` → `evaluateRuleAsync`), including null/wrong-type inputs — see any `*.spec.ts` in `core-functions/src/functions/` for the pattern.
7. Never change the behavior of a shipped signature id; version it, and retire the old definition as legacy (`retireFunction`) so only the new version is authorable.

## See also

- [best-practices.md](best-practices.md) — patterns for embedders: persisting compiled rules, versioning functions, caching, security, testing.
- [architecture.md](architecture.md) — the full parse/evaluate pipeline these hooks plug into.
- [functions.md](functions.md) — reference for the built-ins you are extending alongside.
- [language.md](language.md) — the syntax formula authors write.
- [`@formulang/definitions` README](../definitions/README.md) — the contracts used on this page.
- [SECURITY.md](../SECURITY.md) — the threat model that allowlisting, limits, and purity fit into.
