# @formulang/core-functions

Built-in functions for [Formulang](https://github.com/formulang/formula) — an
open-source, safe, embeddable, strongly-typed formula language for TypeScript
and JavaScript.

This package ships the standard library — the built-in functions, the operators
that back them (`+`, `-`, `*`, `/`, `^`, `&`, and the comparison operators),
and the one-call wiring that makes them executable.

## Highlights

- **A standard library of 113 functions.** Math, aggregation, logic &
  comparison, text, lists, date & time, control flow, and type & empty — each
  documented with its signature, edge-case behavior, and a runnable example
  ([docs/functions.md](../docs/functions.md)).
- **Typed signatures for every built-in.** Each function definition declares
  its parameter and return types, nullability included — the raw material of
  return-type analysis: the parser types `1 + 2 * 3` as `number?` before
  anything runs
  ([Definitions vs. implementations](#definitions-vs-implementations)).
- **One call wires the runtime.** `createCoreFormulaRuntime()` returns a
  ready-to-use registry (function definitions + operators + types) and an
  implementation resolver you hand straight to the parser and runner
  ([Getting started](#getting-started)).
- **Zero third-party runtime dependencies.** The full standard library depends
  only on `@formulang/definitions` — like every published Formulang package, it
  adds nothing else to your dependency tree ([root README](../README.md#why-formulang)).
- **No side effects in any built-in.** Implementations compute results purely
  from their arguments: nothing in this package touches the network,
  filesystem, or process state, and `ISURL`/`ENCODEURL` only inspect or encode
  strings without making requests ([SECURITY.md](../SECURITY.md)).
- **Register your own functions alongside the built-ins.** A data-only
  definition plus an implementation under a versioned signature id (`NAME/v1`)
  is all it takes — the parser type-checks your calls and the runner executes
  them exactly like the built-ins
  ([Register your own handlers](#register-your-own-handlers)).
- **Override or wrap any built-in.** Implementation registration is last-wins
  and the previous entry stays retrievable for delegation, so you can add
  metrics or audit logging around — or replace — a built-in behind its
  unchanged definition
  ([Overriding a built-in implementation](#overriding-a-built-in-implementation)).
- **Purity classifications drive caching.** Every built-in declares its purity:
  all are `pure` — results cacheable across runs — except the clock functions
  (`NOW`, `TODAY`, and the argument-less current-date/time variants), which are
  `uncached` so current-time results are never reused
  ([docs/best-practices.md §4.1](../docs/best-practices.md#41-choose-purity-deliberately)).
- **Cost budgets work out of the box.** Built-in implementations declare cost
  estimators, and the runner charges the estimate _before_ invoking — runaway
  formulas are rejected instead of executed
  ([docs/best-practices.md §4.3](../docs/best-practices.md#43-cost-estimators-reject-expensive-calls-before-they-run)).
- **Batch-oriented implementations.** `evaluateMultiple` receives grouped
  argument sets — the eager-batch pattern the built-ins are written with — so a
  function backed by an external service can turn a whole list operation into
  one round trip
  ([docs/extending.md §3.1](../docs/extending.md#31-the-eager-batch-pattern)).

## Getting started

```sh
npm install @formulang/core-functions @formulang/definitions @formulang/parser @formulang/runner
```

You will usually install all four packages — they share one version and are
designed to be used together: `definitions` supplies the registry and types,
`parser` compiles source text, `runner` evaluates the compiled rule, and this
package provides the functions. Requires Node >= 22.

`createCoreFormulaRuntime()` gives you a `registry` and `implementations`. Add
any variables your formulas reference, parse, optimize, then evaluate:

```ts
import { createCoreFormulaRuntime } from '@formulang/core-functions';
import { FormulaTypes, optimizeRule } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleAsync } from '@formulang/runner';

const { registry, implementations } = createCoreFormulaRuntime();

// Declare the variables a formula is allowed to read.
registry.registerVariable({
  name: 'value',
  description: 'A test input value.',
  type: FormulaTypes.any(true),
});

const parsed = parseFormula('1 + 2 * 3', { registry });
const compiled = optimizeRule(parsed, { registry });
const result = await evaluateRuleAsync(compiled, {
  registry,
  resolver: implementations,
  variables: { value: 42 },
});

result.errors; // []
result.value; // 7  (operator precedence: * binds tighter than +)
```

Under the default limits, parsing and evaluation do not throw on bad formulas:
type problems surface as structured entries in `parsed.errors` /
`result.errors`, and runtime edge cases (division by zero, an out-of-range
index) resolve to `null`. Formulas use `;` to separate arguments by default;
pass `syntax: { argumentSeparator: ',' }` to `parseFormula` to switch to `,`.

## The Formulang packages

| Package                                              | Role                                                                | You need it when                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [`@formulang/definitions`](../definitions/README.md) | Types, contracts, and the registry — the shared vocabulary          | You build registries, custom functions/variables, or editor tooling |
| [`@formulang/parser`](../parser/README.md)           | Compiles formula source into a typed, validated AST (`TypedRule`)   | Always — everything starts with a compile                           |
| [`@formulang/runner`](../runner/README.md)           | Asynchronously evaluates compiled formulas                          | You execute formulas                                                |
| **`@formulang/core-functions`** (you are here)       | **Built-in function library + `createCoreFormulaRuntime()` wiring** | **You want the standard library (most applications)**               |

`createCoreFormulaRuntime()` (this package) assembles both halves of the
standard library: a registry carrying the portable definitions and operators,
and a resolver carrying the executable implementations. `parseFormula` from
[`@formulang/parser`](../parser/README.md) compiles source against that
registry into a `TypedRule`, and `evaluateRuleAsync` from
[`@formulang/runner`](../runner/README.md) executes the rule with the registry,
the resolver, and your variables. Everything rests on the contracts defined in
[`@formulang/definitions`](../definitions/README.md).

## Definitions vs. implementations

Each function has two halves, registered separately:

- **Definitions** (portable, data-only) live in
  [`@formulang/definitions`](../definitions/README.md) and describe the
  function's name, parameters, return type, overloads, and any backing operator.
  They contain no executable code, so they are safe to ship to a browser-based
  editor for autocomplete, type checking, and validation.
- **Implementations** (backend-only) live in this package and contain the actual
  evaluation logic. They are keyed by a stable signature id (e.g. `ADD/v1`) and
  resolved at evaluation time via the `implementations` registry.

This split lets an editor parse and type-check a formula against the portable
definitions without pulling in — or exposing — the execution code.
`createCoreFormulaRuntime()` wires both halves for a backend that needs to run
formulas; `registerCoreFormulaDefinitions()` from `@formulang/definitions`
registers just the definitions when you only need to parse and validate.

## Function categories

Overview:

| Category           | Functions                                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Math               | `ADD` `SUB` `MUL` `DIV` `POW` `SUM` `PRODUCT` `MOD` `ROUND` `ROUNDDOWN` `ROUNDUP` `CEILING` `FLOOR` `SQRT` `EXP` `LOG` `LOG10` `PI` `SIN` `COS` `TAN` `ASIN` `ACOS` `ATAN` `ISEVEN` `ISODD` `RANGE_SCORE`                                                                                                                                                                |
| Aggregation        | `AVG` `MIN` `MAX` `MEDIAN` `COUNT` `COUNT_UNIQUE`                                                                                                                                                                                                                                                                                                                        |
| Logic & comparison | `EQ` `NEQ` `GT` `GTE` `LT` `LTE` `AND` `OR` `NOT`                                                                                                                                                                                                                                                                                                                        |
| Text               | `CONCAT` `JOIN` `LEN` `LOWER` `UPPER` `TRIM` `LEFT` `RIGHT` `MID` `REPLACE` `SUBSTITUTE` `CHAR` `TO_TEXT` `STARTS_WITH` `ENDS_WITH` `CONTAINS` `MATCH_EXPRESSION` `REGEXEXTRACT` `REGEXREPLACE` `ENCODEURL` `ISURL` `WORDS` `WORD_COUNT` `LEADING_WORDS` `SENTENCES` `LINES` `LINE_COUNT` `FIRST_CONTAINED` `CONTAINS_ANY` `MISSING_FROM` `PLAIN_TEXT` `MARKDOWN_BLOCKS` |
| Lists              | `LIST` `INDEX` `FLAT` `SORT` `SORT_BY_PROPERTY` `FILTER` `FILTER_PROPERTY` `EACH` `REDUCE` `INCLUDES` `TAKE` `INDEX_OF` `FILTER_BY` `DISTINCT` `GROUP_COUNTS`                                                                                                                                                                                                            |
| Date & time        | `DATE` `DATEVALUE` `TIME` `TIMEVALUE` `NOW` `TODAY` `DAY` `MONTH` `YEAR` `HOUR` `MINUTE` `SECOND` `DAYS` `DATEDIF` `WEEKDAY` `WEEKNUM` `ISOWEEKNUM`                                                                                                                                                                                                                      |
| Control flow       | `IF` `SWITCH`                                                                                                                                                                                                                                                                                                                                                            |
| Type & empty       | `IS_EMPTY` `EMPTY` `ISNUMBER` `ISTEXT` `ISDATE`                                                                                                                                                                                                                                                                                                                          |

The full reference — signatures, edge cases, and a runnable example per
function — is in **[docs/functions.md](../docs/functions.md)**. The sections of
the functions added since 1.0.0 state each function as rules, one rule of one
sentence per bullet with at least two examples that give different results,
share the rules under _Shared rules_, and close with one sentence naming the
inputs they leave unspecified. `src/functions/shared-rules.spec.ts` runs each
shared rule against every added function and every parameter the rule
governs, read from the live registry.

`core-functions/src/functions/function-docs.spec.ts` checks exactly these in `docs/functions.md`:

- No two headings of the page, at any level, read the same once NFKC-normalised, with every whitespace character read as one space and the ends trimmed.
- Each function the 1.0.0 baseline does not name has one section, under a line `### NAME` of its name as written, which runs to the next heading of level one to three.
- Such a section opens with its signature line, the whole line as the live registry renders it.
- A line of the page that, read with every whitespace character as one space, starts with `Unspecified:` is the closing line of such a section.
- Read line by line after NFKC normalisation, with every whitespace character as one space and format characters dropped, each line of such a section after its signature line, and of the shared rules after their opening sentence, up to its closing line is blank, a top-level bullet or a line of the code block that follows a bullet.
- Read so, no line but a blank one follows the closing line of such a section, up to the next heading of level one to three.
- Each bullet is followed, after blank lines only, by a code block that opens with two spaces, three or more backticks and `ts`.
- Each code block closes with a line of its own fence inside its section.
- Every line of a code block belongs to an example statement, `await evalOk(` or `await evalErrors(`, the call and `);`, with what it gives after `// `, on one line or across several.
- Such a section, and the shared rules, have at least one bullet.
- Such a section has a closing line, one that starts with `Unspecified:`.
- With its code spans taken out, the target of each link that a `[` opens taken out with it, every whitespace character read as one space and after NFKC normalisation, a bullet or a closing line holds only letters, marks, numbers, spaces, `,`, `(`, `)`, `[`, `]`, a hyphen-minus, an apostrophe or an underscore after a letter, mark or number and before a letter or number, a `+` inside a `U+` code point in capitals, a final `.` and, in a closing line, the colon of `Unspecified:` at its start.
- Read so, a bullet or a closing line ends with `.`.
- Read so, no bullet or closing line holds a `](` that no `[` opens.
- Read with each code span and each link as its text, after NFKC normalisation and with every whitespace character as one space, no bullet holds a comma followed, after any whitespace or none, by "and", "or", "but", "nor", "so", "yet" or "then".
- Read with the target of each link that a `[` opens taken out, after NFKC normalisation, with format characters and the marks `` ` ``, `*`, `_` and `~` dropped, every other punctuation mark or symbol read as a space and case folded by upper then lower case, no bullet of a section holds all the words of a shared rule in a row.
- Read so, no bullet of a section has all its words in a row inside a shared rule.
- Read so, no bullet of a section starts with the same four words as a shared rule.
- Read so, no shared rule holds all the words of another in a row.
- One heading of the page, and no other, stands at level two and reads `Shared rules` once NFKC-normalised, with every whitespace character read as one space and the ends trimmed.
- The shared rules open with their one sentence, the one this spec states.
- Each bullet has at least two examples.
- The parser, reading each example against the live registry, finds a call of the function of its section in it, or in the shared rules a call of a function the baseline does not name, and a name inside a string literal is no call.
- Each example of a bullet, run with the variables it gives, gives what its comment states, the value and the warning for `evalOk` and the error codes for `evalErrors`.
- At least two of the examples of a bullet state different results, compared as values in which the keys of an object may stand in any order.
- No code block shows one call twice, the same source with the same variables, compared as values in which the keys of an object may stand in any order, under either helper.
- Every line of the page that, with its code spans taken out, calls `evalOk` or `evalErrors` belongs to an example statement read in the section of a function or in the shared rules.
- Every example statement of a function the baseline names gives the value its comment states, read as JSON less a note in brackets after it, but six statements this spec names, each as a whole.
- Each of those six statements stands on the page once: two whose value is the current date, three that name a variable they do not give and one whose comment marks its value with `~`.

It cannot decide these, which the reviewer decides:

- Whether a bullet states one condition and its outcome.
- Whether a rule holds beyond its examples.
- Whether the examples of a rule sit on either side of its condition.
- Whether a bullet restates a shared rule in other words.

### The text tokenisers outside a formula

`WORDS`, `WORD_COUNT`, `LEADING_WORDS` and `SENTENCES` split text with
tokenisers this package also exports, so code that counts words or sentences
outside a formula counts exactly what a formula counts:

```ts
import { splitSentences, splitWords } from '@formulang/core-functions';

splitWords('  Kennst du   das? '); // ['Kennst', 'du', 'das?']
splitWords('Für 3,5 Mio. Kund:innen', 'letters'); // ['Für', '3,5', 'Mio', 'Kund', 'innen']
splitSentences('Wir helfen z. B. Handwerkern.', 'punctuation', ['z. B.']); // ['Wir helfen z. B. Handwerkern.']
```

Both take the modes of the formula functions (`WordSplitMode`,
`SentenceSplitMode`; see [docs/functions.md](../docs/functions.md#text)). Where
a formula answers `null` with a `TYPE` or `REGEX` warning — an option outside
the `locale` and `pattern` modes, an unsupported language tag, a refused
pattern — they throw a `TypeError`; `pattern` mode applies the default
safe-regex limits. Their results are not bounded by `maxWildcardOutputLength`.

### What the text functions cost

[docs/functions.md](../docs/functions.md#text) (_Text_, **Work**) gives, for
each text function, the work it does on its input, read from its code, and
what bounds the input: a text the formula computes is bounded only by what the
runtime bounds, as no formula limit applies to its length.
`src/functions/work-bounds.spec.ts` counts the work of the loops that walk
each function's input through a meter they feed only while a spec observes an evaluation
(`src/functions/work-meter.ts`, not part of the entry point) and holds it in
proportion to the input on inputs built to make each loop work hardest
(`src/test-helpers/work-corpus.ts`), each observed with its bound as the
meter's limit, so a loop that works past it stops at once; each code unit of
text handed to the runtime's substring search counts one unit, and a call
that refuses a phrase longer than 250 code units counts none; the
work inside the runtime's regular expressions, substring search and
`Intl.Segmenter` is not counted, and review owns the claim that the fixed
patterns run in linear time. What a call charges against the cost and step
budgets is in the reference's _Charges_ table and the conditions under it (a
call answered from the cache, the cache's keys and bounds, and a call that
`EACH`, `FILTER`, `FILTER_PROPERTY` or `REDUCE` makes, which charges nothing of
its own, as in 1.0.0), which `src/functions/charges.spec.ts` holds each
function to, under each condition.
`docs/functions.md` also records, measured, the four patterns of 1.0.0 code
that read their input in more than linear time, among them the formula's own
pattern in `"pattern"` mode, whose safe-regex rules, inherited from 1.0.0,
accept some patterns that backtrack exponentially.

## Register your own handlers

A custom function is the same two halves the built-ins use: a
`FunctionDefinition` on `runtime.registry` (so the parser can type-check calls)
and a `FunctionImplementation` under the same signature id on
`runtime.implementations` (so the runner can execute them). Complete and
runnable:

```ts
import { createCoreFormulaRuntime } from '@formulang/core-functions';
import type { FunctionImplementation } from '@formulang/definitions';
import { FormulaTypes, makeOkNull, makeOkText } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleAsync } from '@formulang/runner';

const { registry, implementations } = createCoreFormulaRuntime();

// 1. The definition — portable data the parser type-checks against.
registry.registerFunction({
  signatureId: 'UPPERCASE_FIRST/v1',
  name: 'UPPERCASE_FIRST',
  description: 'Uppercases the first character of the text.',
  params: [{ name: 'text', type: FormulaTypes.text(true) }],
  returnType: FormulaTypes.text(true),
  purity: 'pure', // deterministic + side-effect free, so results may be cached
});

// 2. The implementation — backend-only code, resolved by signature id at run time.
const uppercaseFirst: FunctionImplementation = {
  async evaluateMultiple(calls) {
    return Promise.all(
      calls.map(async ({ args }) => {
        const raw = await args[0]?.value();
        if (typeof raw !== 'string') return makeOkNull('UPPERCASE_FIRST');
        return makeOkText('UPPERCASE_FIRST', raw.charAt(0).toUpperCase() + raw.slice(1));
      }),
    );
  },
};
implementations.register('UPPERCASE_FIRST/v1', uppercaseFirst);

// 3. Use it like any built-in.
registry.registerVariable({ name: 'name', type: FormulaTypes.text(true) });

const rule = parseFormula('UPPERCASE_FIRST(name) & "!"', { registry });
const result = await evaluateRuleAsync(rule, {
  registry,
  resolver: implementations,
  variables: { name: 'ada' },
});

result.value; // 'Ada!'
```

This is the whole public contract — for purity and caching, templates
(generics), callable parameters for higher-order functions, lazy control-flow
implementations, and cost estimation, see
**[docs/extending.md](../docs/extending.md)**.

### Overriding a built-in implementation

The `implementations` resolver is a plain map from signature id to
implementation: registering an existing id replaces the previous entry (last
registration wins), and `implementations.get()` returns the current entry, so a
wrapper can delegate to the original. Continuing with the runtime from above:

```ts
let upperCalls = 0;
const original = implementations.get('UPPER/v1')!;

implementations.register('UPPER/v1', {
  evaluateMultiple: (calls, ctx) => {
    upperCalls += calls.length; // your instrumentation here
    return original.evaluateMultiple(calls, ctx);
  },
  estimateCostsInSeconds: original.estimateCostsInSeconds?.bind(original),
});
```

Evaluating `UPPER(name)` with `{ name: 'ada' }` still yields `'ADA'` — and now
increments the counter. Definitions are the opposite:
`registry.registerFunction` throws on a duplicate signature id, so a built-in's
declared name, types, and purity cannot change underneath already-parsed rules.
A replacement implementation must honor the definition's declared purity —
`UPPER/v1` is `pure`, so it must stay deterministic and side-effect free (a
logging counter like the one above is fine for diagnostics, but do not let a
`pure` wrapper change results, or caching will serve stale values).

## FAQ

### How do I add my own function?

Register a data-only `FunctionDefinition` on `runtime.registry` and a
`FunctionImplementation` under the same `NAME/v1` signature id on
`runtime.implementations` — [Register your own handlers](#register-your-own-handlers)
above is the complete flow. [docs/extending.md](../docs/extending.md) covers
the rest of the contract: purity and caching, templates (generics), callable
parameters, control-flow (lazy) implementations, and cost estimation.

### Can I replace or wrap a built-in?

Its implementation, yes — `implementations.register()` on an existing signature
id replaces the entry, as shown
[above](#overriding-a-built-in-implementation). Its definition, no —
`registry.registerFunction` throws `Function already registered` for a
duplicate signature id, so declared types and purity stay stable. Behavior
changes to your own functions ship as a new `NAME/v2` id instead; see
[docs/extending.md §1](../docs/extending.md#1-the-extension-model), and
**[docs/best-practices.md §2](../docs/best-practices.md#2-evolving-functions-without-breaking-stored-formulas)**
for rolling out a new version without breaking stored formulas.

### Can I ship only a subset of the built-ins?

Not with a flag: `createCoreFormulaRuntime()` always registers the complete
set, and registries have no unregister. Two supported patterns: build a minimal
registry (`createRegistry()` from `@formulang/definitions`) containing only the
definitions you allow — they are plain data you can copy from a full runtime
via `registry.getFunction('ADD/v1')` — so everything else already fails at
parse time, and reuse the matching core implementations via
`implementations.get('ADD/v1')`; or keep the full runtime and reject stored
rules whose `rule.requirements.functionsUsed` strays outside your allowlist.
[docs/extending.md §5.2](../docs/extending.md#52-minimal-and-custom-registries)
shows both.

### Why is this package backend-only when `@formulang/definitions` runs anywhere?

Because this is where the executable code lives. A definition is plain data
(name, parameter types, return type, purity) that an editor can safely load in
a browser for autocomplete and validation; an implementation is code and
belongs only where formulas actually run. A registry without implementations
parses everything normally — evaluating a call that has no registered
implementation fails with a structured `UNBOUND_FUNCTION` error instead of
executing anything. See
[Definitions vs. implementations](#definitions-vs-implementations) above and
[docs/architecture.md §1.1](../docs/architecture.md#11-why-definitions-and-core-functions-are-separate-packages).

### Where is the full function reference?

[docs/functions.md](../docs/functions.md) documents every built-in with its
signature, edge-case behavior, and a runnable example; the category table above
is the short map. The registry is also introspectable at run time —
`registry.listFunctions()` returns every active `FunctionDefinition` (retired
`legacy` definitions are excluded) — so you can generate autocomplete entries
or docs from the runtime you actually assembled.

## Maintenance

Development of the Formulang packages is sponsored by [Content Sync](https://content-sync.io).

## License

[MIT](LICENSE)
