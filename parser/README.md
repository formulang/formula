# @formulang/parser

Compiles [Formulang](https://github.com/formulang/formula) source text into a typed, validated AST (a `TypedRule`) against a registry of variables, functions, and operators. Parsing does more than build a tree: one call binds types, resolves overloads, enforces security rules, and collects the formula's requirements — without executing anything.

The package has zero third-party runtime dependencies (it depends only on `@formulang/definitions`).

## Highlights

- **Full type checking at compile time.** Every node gets a bound type with nullability tracked, calls are resolved against all registered overloads, and operator tokens (`+`, `&`, `>=`, ...) bind to their backing function signatures — mismatches are reported as structured diagnostics with exact source spans, before anything executes ([architecture §2.4](../docs/architecture.md#24-type-binding-and-overload-resolution)).
- **Return-type analysis for every compile.** `rule.returnType` is the inferred result type of the whole formula, and every AST node carries its bound type, nullability included — `1 + 2 * 3` types as `number?` under the language's empty-in, empty-out convention, `EACH(LIST("a";"bb"); "LEN")` as `List<number?>?` — so editors show result types before execution, and a host that needs, say, a number-returning formula gates on `isAssignable(rule.returnType, FormulaTypes.number(true))` ([the `TypedRule` result](#the-typedrule-result)).
- **Compilation never throws.** `parseFormula` always returns a `TypedRule`: malformed, hostile, or huge input becomes structured `FormulaError` values in `result.errors`, and a formula is valid exactly when that array is empty — safe to wire straight into an editor ([best practices §3](../docs/best-practices.md#3-validating-before-you-save-or-run)).
- **The primary security gate.** Untrusted input is vetted at parse time: property access must be allowlisted by the registry's typed object definitions; `__proto__`, `prototype`, `constructor`, and all `__`-prefixed names are denylisted; and resource limits (source length, token and AST-node counts, nesting depth) are enforced as the DoS defense — every violation a structured `security` error, with eval-time re-checks as defense in depth ([architecture §4](../docs/architecture.md#4-security-model), [best practices §5.3](../docs/best-practices.md#53-resource-limits-are-your-dos-defense)).
- **Configurable syntax for locales.** The argument separator can be `;` or `,` and the decimal separator `.` or `,`; configuring both to the same character is rejected with a `config` error rather than parsed ambiguously ([language reference](../docs/language.md#configurable-punctuation)).
- **Compiles in the browser.** The parser and the definitions it consumes are data-only with no Node-API imports, so editors run full validation and completion client-side while execution stays server-side ([architecture §1.1](../docs/architecture.md#11-why-definitions-and-core-functions-are-separate-packages)).
- **A restricted entry point for accessor paths.** `parseVariableReference` accepts an identifier with property/wildcard segments and rejects full formula syntax — built for variable-picker and field-mapping inputs, returning the same typed AST and requirements as `parseFormula` ([example](#parse-a-variable-reference-only)).
- **Requirements introspection.** Every compiled formula reports the variables it reads (full accessor paths, wildcards included), the exact function versions it uses, and declared external data — enough to prefetch data, gate capabilities, and plan migrations before anything runs ([best practices §3.3](../docs/best-practices.md#33-drive-data-loading-and-authorization-from-requirements)).
- **Static analysis and constant folding.** Rules whose result is fully computable at parse time are flagged `static` — evaluate them once at save time and store the value — and `optimizeRule` folds parser-marked predictable values into literals ([best practices §1.4](../docs/best-practices.md#14-precompute-static-rules)).
- **The foundation of version-pinned persistence.** The parser stamps every call node with a versioned signature id (`IF/v1`), so a stored rule survives JSON round-trips byte for byte and keeps evaluating identically while the function library evolves ([best practices §1](../docs/best-practices.md#1-persisting-formulas-and-idempotent-re-evaluation)).

## Getting started

```sh
npm install @formulang/parser @formulang/core-functions
```

`@formulang/parser` itself needs only `@formulang/definitions` (installed automatically as a dependency), but the parser is useless without a registry describing the variables, functions, and operators a formula may use — so you will typically also install `@formulang/core-functions`, whose `createCoreFormulaRuntime()` hands you a ready registry with the standard library. Building a registry by hand from `@formulang/definitions` alone is shown under [Examples](#examples).

The shortest path from source text to a compiled formula:

```ts
import { createCoreFormulaRuntime } from '@formulang/core-functions';
import { FormulaTypes } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';

const { registry } = createCoreFormulaRuntime(); // IF, CONCAT, +, &, >=, ...
registry.registerVariable({
  name: 'max_length',
  description: 'The maximum length value.',
  type: FormulaTypes.number(true),
});

const rule = parseFormula('IF(max_length > 0; "this"; "that")', { registry });

rule.errors; // [] — the formula is valid
rule.returnType; // { kind: 'text', ... }
rule.static; // false — reads a variable
rule.requirements.variablesRead; // ['max_length']
rule.requirements.functionsUsed; // ['GT/v1', 'IF/v1']
rule.root; // typed AST, ready for @formulang/runner
```

An invalid formula does not throw — inspect the errors instead. The parser keeps going after an error, so one parse reports everything it can find:

```ts
const bad = parseFormula('max_length.__proto__', { registry });
bad.errors.map((e) => `${e.kind}:${e.code}`);
// ['parse:INVALID_PROPERTY_NAME', 'security:DENYLISTED_PROPERTY', 'type:PROPERTY_TARGET_NOT_OBJECT']
bad.errors[0].span; // { start, end } offsets into the source string
```

## The Formulang packages

| Package                                                    | Role                                                                  | You need it when                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [`@formulang/definitions`](../definitions/README.md)       | Types, contracts, and the registry — the shared vocabulary            | You build registries, custom functions/variables, or editor tooling |
| **`@formulang/parser`** (you are here)                     | **Compiles formula source into a typed, validated AST (`TypedRule`)** | **Always — everything starts with a compile**                       |
| [`@formulang/runner`](../runner/README.md)                 | Asynchronously evaluates compiled formulas                            | You execute formulas                                                |
| [`@formulang/core-functions`](../core-functions/README.md) | Built-in function library + `createCoreFormulaRuntime()` wiring       | You want the standard library (most applications)                   |

`createCoreFormulaRuntime()` returns `{ registry, implementations }`: a registry filled with the data-only definitions of the standard library plus the matching executable implementations. `parseFormula` (this package) compiles source against the registry into a `TypedRule`; `evaluateRuleAsync` from `@formulang/runner` then executes that rule using the implementations. Because definitions are data-only, editor-side code can compile and validate formulas without shipping any execution code.

## Examples

Each snippet below continues from [Getting started](#getting-started) (`registry` in scope).

### Compile with a registry you build yourself

If you only compile — an editor, a linter, a service that validates formulas — `@formulang/definitions` alone can provide the registry, with no executable code involved:

```ts
import {
  createRegistry,
  FormulaTypes,
  registerCoreFormulaDefinitions,
} from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';

const registry = createRegistry();
registry.registerVariable({
  name: 'max_length',
  description: 'The maximum length value.',
  type: FormulaTypes.number(true),
});
registerCoreFormulaDefinitions(registry); // definitions of IF, CONCAT, +, &, >=, ...

const rule = parseFormula('IF(max_length > 0; "this"; "that")', { registry });
rule.errors; // []
```

### Adjust the syntax: comma as argument separator

Two separators are configurable to match regional conventions — `argumentSeparator` (`';'` or `','`, default `';'`) and `decimalSeparator` (`'.'` or `','`, default `'.'`). The same formula as above, comma convention:

```ts
const rule = parseFormula('IF(max_length > 0, "this", "that")', {
  registry,
  syntax: { argumentSeparator: ',', decimalSeparator: '.' },
});
rule.errors; // []
```

The two separators must differ; configuring both to the same character yields a `config` error (`INVALID_SYNTAX_CONFIG`) instead of ambiguous parsing. Using the wrong separator in a formula (e.g. `,` while `;` is configured) produces a targeted `parse` error: `Use ';' to separate function arguments.`

### Tighten resource limits

All limits in `DEFAULT_FORMULA_LIMITS` can be overridden per call; overrides are shallow-merged over the defaults. Exceeding a limit is reported as a collected `security` error, not an exception:

```ts
const limited = parseFormula('IF(max_length > 0; "this"; "that")', {
  registry,
  limits: { maxSourceLength: 100, maxAstNodes: 3 },
});
limited.errors[0].kind; // 'security'
limited.errors[0].code; // 'TOO_MANY_AST_NODES' — this formula needs more than 3 AST nodes
```

### Prefetch data from requirements

`rule.requirements` tells you everything a formula needs before you run it — useful to load only the referenced fields, or to authorize function usage:

```ts
registry.registerVariable({
  name: 'user',
  description: 'The current user.',
  type: FormulaTypes.object('User', {
    first_name: FormulaTypes.text(),
    last_name: FormulaTypes.text(),
    email: FormulaTypes.text(),
  }),
});

const rule = parseFormula('CONCAT(user.first_name; " "; user.last_name)', { registry });

rule.requirements.variablesRead; // ['user.first_name', 'user.last_name'] — full paths, not just roots
rule.requirements.functionsUsed; // ['CONCAT/v1'] — versioned signature ids
rule.requirements.externalData; // [] — references collected from static arguments

// Fetch only what the formula actually reads:
const roots = new Set(rule.requirements.variablesRead.map((path) => path.split('.')[0]));
// roots = Set { 'user' }; the full paths name the columns/fields to select
```

### Parse a variable reference only

`parseVariableReference` accepts an accessor path — an identifier with optional property/wildcard segments — and rejects everything else. Use it to validate the input of a variable-picker UI or a field-mapping form:

```ts
import { parseVariableReference } from '@formulang/parser';

registry.registerVariable({
  name: 'items',
  description: 'Line items.',
  type: FormulaTypes.list(FormulaTypes.object('Item', { name: FormulaTypes.text() })),
});

const ref = parseVariableReference('items.*.name', { registry });
ref.errors; // []
ref.root.kind; // 'wildcard'
ref.returnType; // { kind: 'list', ... }
ref.requirements.variablesRead; // ['items.*.name']

// Full formula syntax is rejected — this input is a path, not an expression:
parseVariableReference('1 + 2', { registry }).errors[0].code; // 'UNEXPECTED_TOKEN'
```

## API

### `parseFormula(source, options): TypedRule`

Parses a full formula expression: literals, operators, function calls, grouping, and variable accessor chains.

| Option     | Type                     | Description                                                                           |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------- |
| `registry` | `FormulaRegistry`        | Required. Variables, functions, and operators available to the formula.               |
| `limits`   | `Partial<FormulaLimits>` | Optional overrides for resource limits (see [Security behavior](#security-behavior)). |
| `syntax`   | `Partial<FormulaSyntax>` | Optional separator configuration.                                                     |

### `parseVariableReference(source, options): TypedRule`

Parses a _variable reference only_: an identifier with an optional property/wildcard chain, such as `value`, `value.name`, or `items.*.name`. Operators, literals, function calls, and grouping are rejected with `UNEXPECTED_TOKEN`. It reuses the exact accessor-chain parsing and type binding of `parseFormula`, so the resulting AST, node ids, and `requirements.variablesRead` are identical to parsing the same path as a formula. The registry only needs to resolve variables (`VariableOnlyRegistry`); it takes the same `limits` and `syntax` options.

Also exported: `DEFAULT_FORMULA_SYNTAX`, `resolveFormulaSyntax`, `isDenylistedPropertyName`, and the `FormulaSyntax` type.

## The `TypedRule` result

| Field          | Type                  | Meaning                                                                                                                                                                                                                        |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `root`         | `RuleNode`            | AST root. Nodes are `literal`, `variable`, `property`, `wildcard`, or `call`; each carries its bound `type`, a source `span`, and a stable structural `id` (e.g. `IF-0/GT-0/VAR_MAX_LENGTH-0`) that survives whitespace edits. |
| `returnType`   | `FormulaType`         | Inferred result type of the whole formula, including nullability.                                                                                                                                                              |
| `static`       | `boolean`             | `true` when the result is fully computable at parse time (literals and pure functions of literals — no variables).                                                                                                             |
| `requirements` | `FormulaRequirements` | `variablesRead` (full paths like `list.*.name`), `functionsUsed` (signature ids like `IF/v1`), `externalData`, `estimatedCostUnits`.                                                                                           |
| `errors`       | `FormulaError[]`      | All problems found. Empty means valid.                                                                                                                                                                                         |

Each `FormulaError` has a `kind`, a stable `code`, a human-readable `message`, and usually a `span`. Kinds produced by the parser:

| Kind       | Examples                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `parse`    | `UNEXPECTED_TOKEN`, `EXPECTED_RPAREN`, `INVALID_VARIABLE_NAME` (variables/properties must be `lower_snake_case`, functions `UPPER_SNAKE_CASE`) |
| `type`     | `UNKNOWN_VARIABLE`, `UNKNOWN_FUNCTION`, `NO_MATCHING_OVERLOAD`, `ARGUMENT_TYPE_MISMATCH`, `NULL_NOT_ALLOWED`, `LITERAL_VALUE_NOT_ALLOWED`      |
| `security` | `DENYLISTED_PROPERTY`, `PROPERTY_NOT_ALLOWLISTED`, `SOURCE_TOO_LONG`, `TOO_MANY_TOKENS`, `PARENS_TOO_DEEP`, `TOO_MANY_AST_NODES`               |
| `config`   | `INVALID_SYNTAX_CONFIG`                                                                                                                        |

(`kind: 'runtime'` exists too, but is produced by `@formulang/runner` during evaluation.)

## Security behavior

The parser is the first line of defense for untrusted formula input:

- **Property denylist.** `__proto__`, `prototype`, `constructor`, and any name starting with `__` are rejected (`DENYLISTED_PROPERTY`, kind `security`) in both property and wildcard access — before any evaluation can happen.
- **Allowlisted property access.** Reading `obj.prop` requires the registry to declare `prop` on the object's type. Property access on untyped (`any`) values is refused (`PROPERTY_NOT_ALLOWLISTED`) rather than silently permitted.
- **Resource limits.** Enforced during tokenization and parsing, before types are even considered. Defaults (`DEFAULT_FORMULA_LIMITS` in `@formulang/definitions`, overridable per call via `limits`): `maxSourceLength` 16000, `maxTokens` 500, `maxStringLiteralLength` 8000, `maxIdentifierLength` 64, `maxParenDepth` 16, `maxAstNodes` 500. Exceeding a limit produces a structured `security` error — it does not throw.
- **No crashes.** Unknown characters, malformed input, and even a throwing registry are converted into structured errors (`PARSER_CRASH` at worst); `parseFormula` always returns.
- **Work linear in the formula.** The check of modes that `EACH`, `FILTER`, `FILTER_PROPERTY`, `REDUCE` and `FILTER_BY` pass on through callables named by string literals follows them breadth first across every callable a call names, without recursion, and visits at most 16 × (n + 1) argument positions for a call of n arguments written in the formula; past that it stops following, with no error, and every level shallower than where it stopped has been checked. Each admitted list is read once per parse, so testing a literal against a list is one lookup however long the list is, and a refusal reads the values its message prints. A mode refused when the formula compiles is one written in the call or passed on along those callables within that bound; every other mode reaches the function when the call runs, where a built-in answers one it does not list with `null` and a `TYPE` warning, and a core higher-order function that called it keeps the `null` and drops the warning, as on 1.0.0 ([language reference](../docs/language.md#when-a-mode-is-checked)).

See [SECURITY.md](../SECURITY.md) for the overall security model.

## FAQ

### Why are errors collected instead of thrown?

The parser is built for editors and untrusted input: it recovers where it can and reports everything it finds in one pass, as structured errors with stable `code`s and source `span`s — exactly what you need to underline several problems at once. `parseFormula` always returns a `TypedRule`; treat `rule.errors.length === 0` as valid. Even a throwing registry becomes a collected `PARSER_CRASH` error, never an exception.

### How do I use `,` as the argument separator?

Pass `syntax: { argumentSeparator: ',' }` — see [the syntax example](#adjust-the-syntax-comma-as-argument-separator). The decimal separator must differ from the argument separator, otherwise `LIST(1,5)` would be unreadable (the number `1,5`, or the arguments `1` and `5`?). Same-character configurations are rejected with `INVALID_SYNTAX_CONFIG`; the valid combinations are `;` + `.` (default), `,` + `.`, and `;` + `,`. Details in the [language reference](../docs/language.md#configurable-punctuation).

### How do I find out which variables and functions a formula uses before running it?

Compile it and read `rule.requirements`: `variablesRead` holds full accessor paths (`user.first_name`, `items.*.name`), `functionsUsed` holds versioned signature ids (`IF/v1`), and `externalData` holds references discovered in static arguments. Nothing is evaluated, so this is safe for planning queries, prefetching, or authorization — see [Prefetch data from requirements](#prefetch-data-from-requirements).

### Why do I get `NULL_NOT_ALLOWED` on my argument?

The argument's type is literally `null` — typically a direct `EMPTY()` — and the parameter does not declare `nullable: true`. This mostly appears with custom functions; most core-function parameters are nullable and report `ARGUMENT_TYPE_MISMATCH` (`expected number? but got null`) for a literal null instead. Nullable _values_ like `number?` flow through at parse time; whether an empty value is acceptable at run time is enforced by the runner. See [null handling](../docs/language.md#null-and-empty-values).

### What are the default resource limits and how do I change them?

Defaults live in `DEFAULT_FORMULA_LIMITS` in `@formulang/definitions`. The parser enforces `maxSourceLength` 16000, `maxTokens` 500, `maxStringLiteralLength` 8000, `maxIdentifierLength` 64, `maxParenDepth` 16, and `maxAstNodes` 500; the remaining limits apply during evaluation. Override any subset per call with the `limits` option (shallow-merged over the defaults); violations are collected as `security` errors — see [Tighten resource limits](#tighten-resource-limits).

### What is `parseVariableReference` for?

For inputs that should be a variable path, not a formula: a variable-picker UI, a column-mapping field, a "watch this value" box. It accepts only an identifier with property/wildcard accessors, rejects operators/literals/calls with `UNEXPECTED_TOKEN`, and returns the same typed AST and requirements `parseFormula` would produce for that path. It needs only a `VariableOnlyRegistry` — no function definitions.

### Does parsing execute anything?

No. Parsing tokenizes, builds the AST, and binds types against the registry — the formula never runs and function implementations are never invoked (registry definitions are data-only metadata). Combined with the denylist, allowlist, and resource limits above, that makes `parseFormula` safe to call on untrusted input. Evaluation is a separate, also-sandboxed step in [`@formulang/runner`](../runner/README.md).

## Further reading

- [Language reference](../docs/language.md) — full grammar: literals, operators, precedence, accessor chains, naming rules.
- [Function reference](../docs/functions.md) — the built-in functions registered by `registerCoreFormulaDefinitions` / `@formulang/core-functions`.
- [Architecture](../docs/architecture.md) — how definitions, parser, runner, and core-functions fit together.
- [Extending](../docs/extending.md) — registering your own variables, functions, and operators.
- [`@formulang/runner`](../runner/README.md) — evaluates the `TypedRule` produced here.

## Maintenance

Development of the Formulang packages is sponsored by [Content Sync](https://content-sync.io).

## License

[MIT](LICENSE)
