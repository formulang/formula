# Built-in function reference

This is the complete reference for the functions shipped by
[`@formulang/core-functions`](../core-functions/README.md). Wiring
`createCoreFormulaRuntime()` registers every function and operator listed here.

Formula-language names are case-sensitive and written in `UPPER_CASE`. Examples
use the default syntax (argument separator `;`, decimal separator `.`). If you
configure the parser with `syntax: { argumentSeparator: ',' }`, separate
arguments with `,` instead.

## Conventions

- **Nullable types.** Most parameters and return types are nullable — an empty
  cell, an out-of-range list index, or an upstream `null` propagates as `null`
  rather than raising. Descriptions call out where `null` is produced.
- **Empty values.** A value is _empty_ when it is `null`, an empty text `""`, or
  an empty list. Many functions skip empty items or short-circuit to `null` on
  empty input. The functions whose sections state them as rules read only
  `null` as absent, and `""` and `[]` as values, as
  [Shared rules](#shared-rules) says.
- **Warnings vs. errors.** Type mismatches that the parser can catch (for
  example `POW("x"; 2)`) are compile-time errors with code
  `ARGUMENT_TYPE_MISMATCH`. Type problems only visible at runtime usually return
  `null` and attach a non-fatal warning to the node output (visible via
  `output.warnings`), rather than throwing. `AND`/`OR`/`NOT`/`IF` are the
  exception: a non-boolean-like runtime value is a runtime error. A warning's
  or an error's code is part of what a function does, and the wording of its
  message is not.
- **Budgets.** Each call adds steps to the evaluation's step budget and charges
  a cost estimate against `maxFunctionCostUnits` and `maxTotalCostUnits`
  ([Resource limiting](architecture.md#36-resource-limiting-during-evaluation));
  how many steps and how much cost a call of a given function takes is not part
  of what it does.
- **Modes.** A parameter that lists the values it admits (a `mode`, `match`,
  `normalise`, `format` or `kind`) takes a string literal naming one of them; a
  misspelt one is a compile-time `LITERAL_VALUE_NOT_ALLOWED` error, also when
  higher-order calls pass it on through callables named by string literals
  (see [When a mode is checked](language.md#when-a-mode-is-checked)). A mode
  can still reach a function when the call runs, passed to a callable that a
  higher-order call names by a variable or an expression
  (`EACH(lists; "EACH"; name; mode)`) or along a path the parser does not
  follow, so each function also checks the mode
  it receives, wherever it comes from: a value it does not list, the empty
  text included, returns `null` with a `TYPE` warning, and `null` counts as an
  omitted mode, which selects the default of an optional mode and is refused
  in that way for a required one. Through
  a higher-order call that item is `null`, as for any callee that fails: the
  higher-order functions keep a callee's value, not its warnings.
- **Operators.** Where an operator backs a function, the operator and the named
  call compile to the same signature. `1 + 2` and `ADD(1; 2)` are identical.
- **Examples.** The `evalOk(source, variables?)` calls in the examples are the
  repository's test helper (`core-functions/src/test-helpers/eval-formula.ts`):
  it wires `createCoreFormulaRuntime()`, parses, optimizes, and evaluates the
  formula, asserts that no errors were produced, and returns the result value.
  The comment after each call shows that value.
  `evalErrors(source, variables?)`, from the same file, returns instead the
  codes of the errors the formula reports, and its comment shows them.
  `core-functions/src/functions/function-docs.spec.ts` runs the examples on
  this page and compares each result with its comment, read as JSON less a note
  in brackets after it, except six it names: two whose value is the current
  date, three that name a variable they do not give, and one whose comment
  marks its value with `~`.
- **Rules.** Some sections state their function as rules. Each bullet states
  one condition and its outcome in one sentence, and its examples include one
  where the condition holds and one, on the nearest input, where it does not.
  Such a section closes with one sentence naming the inputs whose result its
  rules leave unspecified, and the [shared rules](#shared-rules) hold in each
  of them. In those sections the comment of an `evalOk` call also names the
  warning the call attaches (`null with a TYPE warning`), and a comment that
  names none states that the call attaches none. The spec that runs the
  examples also fails a bullet of more than one sentence, a bullet with fewer
  than two examples or with examples that all give one result, and an example
  that does not call the section's function.

## Shared rules

These rules hold in every section that states its function as rules, for each argument but a mode and the operator of `FILTER_BY`, which a formula writes as literals.

- A `null` given for an argument the function requires returns `null`.

  ```ts
  await evalOk('WORDS(value)', { value: null }); // null
  await evalOk('WORDS(value)', { value: 'a b' }); // ["a", "b"]
  await evalOk('WORD_COUNT(value)', { value: null }); // null
  await evalOk('WORD_COUNT(value)', { value: 'a b' }); // 2
  await evalOk('LEADING_WORDS(value; 1)', { value: null }); // null
  await evalOk('LEADING_WORDS("a b"; value)', { value: null }); // null
  await evalOk('LEADING_WORDS("a b"; value)', { value: 1 }); // "a"
  await evalOk('SENTENCES(value)', { value: null }); // null
  await evalOk('SENTENCES(value)', { value: 'a. b' }); // ["a.", "b"]
  await evalOk('LINES(value)', { value: null }); // null
  await evalOk('LINES(value)', { value: 'a' }); // ["a"]
  await evalOk('LINE_COUNT(value)', { value: null }); // null
  await evalOk('LINE_COUNT(value)', { value: 'a' }); // 1
  await evalOk('FIRST_CONTAINED(value; LIST("a"))', { value: null }); // null
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: null }); // null
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: ['b'] }); // "b"
  await evalOk('CONTAINS_ANY(value; LIST("a"))', { value: null }); // null
  await evalOk('CONTAINS_ANY("abc"; value)', { value: null }); // null
  await evalOk('CONTAINS_ANY("abc"; value)', { value: ['b'] }); // true
  await evalOk('MISSING_FROM(value; "abc")', { value: null }); // null
  await evalOk('MISSING_FROM(LIST("a"); value)', { value: null }); // null
  await evalOk('MISSING_FROM(LIST("a"); value)', { value: 'b' }); // ["a"]
  await evalOk('PLAIN_TEXT(value; "html")', { value: null }); // null
  await evalOk('PLAIN_TEXT(value; "html")', { value: 'a' }); // "a"
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: null }); // null
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a' }); // ["a"]
  await evalOk('TAKE(value; 1)', { value: null }); // null
  await evalOk('TAKE(LIST(1; 2); value)', { value: null }); // null
  await evalOk('TAKE(LIST(1; 2); value)', { value: 1 }); // [1]
  await evalOk('INDEX_OF(value; 1)', { value: null }); // null
  await evalOk('INDEX_OF(LIST(1; 2); value)', { value: null }); // null
  await evalOk('INDEX_OF(LIST(1; 2); value)', { value: 2 }); // 2
  await evalOk('FILTER_BY(value; LIST(1); ">"; 0)', { value: null }); // null
  await evalOk('FILTER_BY(LIST(1); value; ">"; 0)', { value: null }); // null
  await evalOk('FILTER_BY(LIST(1); value; ">"; 0)', { value: [1] }); // [1]
  await evalOk('DISTINCT(value)', { value: null }); // null
  await evalOk('DISTINCT(value)', { value: [1, 1] }); // [1]
  await evalOk('GROUP_COUNTS(value)', { value: null }); // null
  await evalOk('GROUP_COUNTS(value)', { value: [1, 1] }); // [2]
  ```

- A `null` given for an optional argument is taken as if the argument were omitted.

  ```ts
  await evalOk('WORDS("a b"; "whitespace"; value)', { value: null }); // ["a", "b"]
  await evalOk('WORDS("a b"; "whitespace"; value)', { value: 'de' }); // null with a TYPE warning
  await evalOk('WORDS("a b"; "locale"; value)', { value: null }); // null with a TYPE warning
  await evalOk('WORDS("a b"; "locale"; value)', { value: 'en' }); // ["a", "b"]
  await evalOk('SENTENCES("a. b"; "punctuation"; value)', { value: null }); // ["a.", "b"]
  await evalOk('SENTENCES("a. b"; "punctuation"; value)', { value: ['a.'] }); // ["a. b"]
  await evalOk('FIRST_CONTAINED("ABC"; LIST("b"); "substring"; value)', { value: null }); // null
  await evalOk('FIRST_CONTAINED("ABC"; LIST("b"); "substring"; value)', { value: true }); // "b"
  await evalOk('CONTAINS_ANY("ABC"; LIST("b"); "substring"; value)', { value: null }); // false
  await evalOk('CONTAINS_ANY("ABC"; LIST("b"); "substring"; value)', { value: true }); // true
  await evalOk('TAKE(LIST(1; 2; 3); 1; value)', { value: null }); // [1]
  await evalOk('TAKE(LIST(1; 2; 3); 1; value)', { value: 2 }); // [2]
  ```

- A value of another type than the argument takes, the empty text `""` and the empty list `[]` included, returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('WORDS(value)', { value: [] }); // null with a TYPE warning
  await evalOk('WORDS(value)', { value: '' }); // []
  await evalOk('WORDS("a b"; "pattern"; value)', { value: 5 }); // null with a TYPE warning
  await evalOk('WORDS("a b"; "pattern"; value)', { value: 'a' }); // ["a"]
  await evalOk('WORD_COUNT(value)', { value: [] }); // null with a TYPE warning
  await evalOk('WORD_COUNT(value)', { value: '' }); // 0
  await evalOk('LEADING_WORDS(value; 1)', { value: 5 }); // null with a TYPE warning
  await evalOk('LEADING_WORDS("a b"; value)', { value: '' }); // null with a TYPE warning
  await evalOk('LEADING_WORDS("a b"; value)', { value: [] }); // null with a TYPE warning
  await evalOk('LEADING_WORDS("a b"; value)', { value: 2 }); // "a b"
  await evalOk('SENTENCES(value)', { value: [] }); // null with a TYPE warning
  await evalOk('SENTENCES(value)', { value: '' }); // []
  await evalOk('SENTENCES("a. b"; "punctuation"; value)', { value: '' }); // null with a TYPE warning
  await evalOk('SENTENCES("a. b"; "punctuation"; value)', { value: 'a.' }); // null with a TYPE warning
  await evalOk('SENTENCES("a. b"; "punctuation"; value)', { value: [] }); // ["a.", "b"]
  await evalOk('LINES(value)', { value: [] }); // null with a TYPE warning
  await evalOk('LINES(value)', { value: '' }); // []
  await evalOk('LINE_COUNT(value)', { value: 5 }); // null with a TYPE warning
  await evalOk('LINE_COUNT(value)', { value: '' }); // 0
  await evalOk('FIRST_CONTAINED(value; LIST("a"))', { value: [] }); // null with a TYPE warning
  await evalOk('FIRST_CONTAINED(value; LIST("a"))', { value: '' }); // null
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: '' }); // null with a TYPE warning
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: 'b' }); // null with a TYPE warning
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: [] }); // null
  await evalOk('FIRST_CONTAINED("abc"; LIST("b"); "substring"; value)', { value: 'yes' }); // null with a TYPE warning
  await evalOk('FIRST_CONTAINED("abc"; LIST("b"); "substring"; value)', { value: false }); // "b"
  await evalOk('CONTAINS_ANY(value; LIST("a"))', { value: 5 }); // null with a TYPE warning
  await evalOk('CONTAINS_ANY("abc"; value)', { value: 'b' }); // null with a TYPE warning
  await evalOk('CONTAINS_ANY("abc"; value)', { value: ['b'] }); // true
  await evalOk('MISSING_FROM(value; "abc")', { value: 'x' }); // null with a TYPE warning
  await evalOk('MISSING_FROM(value; "abc")', { value: ['x'] }); // ["x"]
  await evalOk('MISSING_FROM(LIST("x"); value)', { value: [] }); // null with a TYPE warning
  await evalOk('MISSING_FROM(LIST("x"); value)', { value: '' }); // ["x"]
  await evalOk('PLAIN_TEXT(value; "html")', { value: [] }); // null with a TYPE warning
  await evalOk('PLAIN_TEXT(value; "html")', { value: '' }); // ""
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 5 }); // null with a TYPE warning
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: '' }); // []
  await evalOk('TAKE(value; 1)', { value: '' }); // null with a TYPE warning
  await evalOk('TAKE(value; 1)', { value: [] }); // []
  await evalOk('TAKE(LIST(1; 2); value)', { value: '' }); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2); value)', { value: [] }); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2); value)', { value: '1' }); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2); 1; value)', { value: '' }); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2); 1; value)', { value: [] }); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2); 1; value)', { value: 'x' }); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2); 1; value)', { value: true }); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2); 1; value)', { value: 2 }); // [2]
  await evalOk('INDEX_OF(value; 1)', { value: '' }); // null with a TYPE warning
  await evalOk('INDEX_OF(value; 1)', { value: [1] }); // 1
  await evalOk('FILTER_BY(value; LIST(1); ">"; 0)', { value: '' }); // null with a TYPE warning
  await evalOk('FILTER_BY(value; LIST(1); ">"; 0)', { value: [1] }); // [1]
  await evalOk('FILTER_BY(LIST(1); value; ">"; 0)', { value: '1' }); // null with a TYPE warning
  await evalOk('FILTER_BY(LIST(1); value; ">"; 0)', { value: [1] }); // [1]
  await evalOk('DISTINCT(value)', { value: '' }); // null with a TYPE warning
  await evalOk('DISTINCT(value)', { value: [] }); // []
  await evalOk('GROUP_COUNTS(value)', { value: 'a' }); // null with a TYPE warning
  await evalOk('GROUP_COUNTS(value)', { value: ['a'] }); // [1]
  ```

- A member of a list of texts that is `null` or `""` is skipped.

  ```ts
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: ['', 'b'] }); // "b"
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: ['a', 'b'] }); // "a"
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: [null] }); // null
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: ['c'] }); // "c"
  await evalOk('CONTAINS_ANY("abc"; value)', { value: [null, ''] }); // false
  await evalOk('CONTAINS_ANY("abc"; value)', { value: ['a'] }); // true
  await evalOk('MISSING_FROM(value; "abc"; "exact")', { value: ['', null, 'x'] }); // ["x"]
  await evalOk('MISSING_FROM(value; "abc"; "exact")', { value: ['y', 'x'] }); // ["y", "x"]
  await evalOk('SENTENCES("a. b"; "punctuation"; value)', { value: ['', null] }); // ["a.", "b"]
  await evalOk('SENTENCES("a. b"; "punctuation"; value)', { value: ['a.'] }); // ["a. b"]
  ```

- A member of a list of texts that is neither text nor `null`, the empty list included, returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: ['b', []] }); // null with a TYPE warning
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: ['b', 1] }); // null with a TYPE warning
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: ['b', ''] }); // "b"
  await evalOk('CONTAINS_ANY("abc"; value)', { value: [true] }); // null with a TYPE warning
  await evalOk('CONTAINS_ANY("abc"; value)', { value: ['c'] }); // true
  await evalOk('MISSING_FROM(value; "abc")', { value: ['x', 2] }); // null with a TYPE warning
  await evalOk('MISSING_FROM(value; "abc")', { value: ['x', null] }); // ["x"]
  await evalOk('SENTENCES("a. b"; "punctuation"; value)', { value: [[]] }); // null with a TYPE warning
  await evalOk('SENTENCES("a. b"; "punctuation"; value)', { value: [null] }); // ["a.", "b"]
  ```

- A list argument of more than `maxListLength` (1,000) members raises `LIST_TOO_LARGE`.

  ```ts
  await evalErrors('FIRST_CONTAINED("abc"; value)', { value: Array(1001).fill('x') }); // ["LIST_TOO_LARGE"]
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: Array(1000).fill('x') }); // null
  await evalErrors('CONTAINS_ANY("abc"; value)', { value: Array(1001).fill('x') }); // ["LIST_TOO_LARGE"]
  await evalOk('CONTAINS_ANY("abc"; value)', { value: Array(1000).fill('x') }); // false
  await evalErrors('MISSING_FROM(value; "x")', { value: Array(1001).fill('x') }); // ["LIST_TOO_LARGE"]
  await evalOk('MISSING_FROM(value; "x")', { value: Array(1000).fill('x') }); // []
  await evalErrors('SENTENCES("a. b"; "punctuation"; value)', { value: Array(1001).fill('x') }); // ["LIST_TOO_LARGE"]
  await evalOk('SENTENCES("a. b"; "punctuation"; value)', { value: Array(1000).fill('x') }); // ["a.", "b"]
  await evalErrors('TAKE(value; 1)', { value: Array(1001).fill(1) }); // ["LIST_TOO_LARGE"]
  await evalOk('TAKE(value; 1)', { value: Array(1000).fill(1) }); // [1]
  await evalErrors('INDEX_OF(value; 1)', { value: Array(1001).fill(1) }); // ["LIST_TOO_LARGE"]
  await evalOk('INDEX_OF(value; 1)', { value: Array(1000).fill(1) }); // 1
  await evalErrors('FILTER_BY(value; LIST(1); ">"; 0)', { value: Array(1001).fill(1) }); // ["LIST_TOO_LARGE"]
  await evalErrors('FILTER_BY(LIST(1); value; ">"; 0)', { value: Array(1001).fill(1) }); // ["LIST_TOO_LARGE"]
  await evalOk('COUNT(FILTER_BY(value; value; ">"; 0))', { value: Array(1000).fill(1) }); // 1000
  await evalErrors('DISTINCT(value)', { value: Array(1001).fill(1) }); // ["LIST_TOO_LARGE"]
  await evalOk('DISTINCT(value)', { value: Array(1000).fill(1) }); // [1]
  await evalErrors('GROUP_COUNTS(value)', { value: Array(1001).fill(1) }); // ["LIST_TOO_LARGE"]
  await evalOk('GROUP_COUNTS(value)', { value: Array(1000).fill(1) }); // [1000]
  ```

- The arguments are checked one after another from left to right, and the first that fails decides the result.

  ```ts
  await evalOk('WORDS(value; "whitespace"; "de")', { value: null }); // null
  await evalOk('WORDS(value; "whitespace"; "de")', { value: 'a' }); // null with a TYPE warning
  await evalOk('LEADING_WORDS(value; 0)', { value: null }); // null
  await evalOk('LEADING_WORDS(value; 0)', { value: 'a b' }); // null with a TYPE warning
  await evalOk('TAKE(value; -1)', { value: null }); // null
  await evalOk('TAKE(value; -1)', { value: [1] }); // null with a TYPE warning
  await evalErrors('TAKE(value; -1)', { value: Array(1001).fill(1) }); // ["LIST_TOO_LARGE"]
  await evalOk('INDEX_OF(value; LIST(1))', { value: null }); // null
  await evalOk('INDEX_OF(value; LIST(1))', { value: [1] }); // null with a TYPE warning
  await evalOk('FILTER_BY(value; LIST(1; 2); ">"; 0)', { value: null }); // null
  await evalOk('FILTER_BY(value; LIST(1; 2); ">"; 0)', { value: [1] }); // null with a TYPE warning
  ```

- A list argument's length is checked before its members.

  ```ts
  await evalErrors('FIRST_CONTAINED("abc"; value)', { value: Array(1001).fill(1) }); // ["LIST_TOO_LARGE"]
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: [1] }); // null with a TYPE warning
  await evalErrors('MISSING_FROM(value; "abc")', { value: Array(1001).fill(2) }); // ["LIST_TOO_LARGE"]
  await evalOk('MISSING_FROM(value; "abc")', { value: [2] }); // null with a TYPE warning
  await evalErrors('INDEX_OF(value; 1)', { value: Array(1001).fill([1]) }); // ["LIST_TOO_LARGE"]
  await evalOk('INDEX_OF(value; 1)', { value: [[1]] }); // null with a TYPE warning
  await evalErrors('DISTINCT(value)', { value: Array(1001).fill([]) }); // ["LIST_TOO_LARGE"]
  await evalOk('DISTINCT(value)', { value: [[]] }); // null with a TYPE warning
  ```

- A check that needs more than one argument comes after every argument is checked.

  ```ts
  await evalErrors('FILTER_BY(LIST(1); value; ">"; 0)', { value: Array(1001).fill(1) }); // ["LIST_TOO_LARGE"]
  await evalOk('FILTER_BY(LIST(1); value; ">"; 0)', { value: [1, 2] }); // null with a TYPE warning
  await evalOk('FIRST_CONTAINED("a"; value)', { value: ['a'.repeat(251), 1] }); // null with a TYPE warning
  await evalErrors('FIRST_CONTAINED("a"; value)', { value: ['a'.repeat(251), 'a'] }); // ["PHRASE_TOO_LONG"]
  await evalOk('MISSING_FROM(value; "a")', { value: ['a'.repeat(251), 2] }); // null with a TYPE warning
  await evalErrors('MISSING_FROM(value; "a")', { value: ['a'.repeat(251)] }); // ["PHRASE_TOO_LONG"]
  ```

- The result is computed only once every check has passed.

  ```ts
  await evalOk('TAKE(LIST(1; 2; 3); 0; value)', { value: 0 }); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2; 3); 0; value)', { value: 1 }); // []
  await evalOk('FIRST_CONTAINED("abc"; LIST(); "substring"; value)', { value: 'yes' }); // null with a TYPE warning
  await evalOk('FIRST_CONTAINED("abc"; LIST(); "substring"; value)', { value: true }); // null
  await evalOk('LEADING_WORDS(""; value)', { value: 0 }); // null with a TYPE warning
  await evalOk('LEADING_WORDS(""; value)', { value: 1 }); // null
  await evalOk('WORDS(value; "whitespace"; "de")', { value: 'w '.repeat(5001) }); // null with a TYPE warning
  await evalErrors('WORDS(value)', { value: 'w '.repeat(5001) }); // ["LIST_TOO_LARGE"]
  ```

## Operator aliases

| Operator | Function | Precedence | Associativity |
| -------- | -------- | ---------- | ------------- |
| `+`      | `ADD`    | 20         | left          |
| `-`      | `SUB`    | 20         | left          |
| `*`      | `MUL`    | 30         | left          |
| `/`      | `DIV`    | 30         | left          |
| `^`      | `POW`    | 40         | right         |
| `&`      | `CONCAT` | 20         | left          |
| `=`      | `EQ`     | 10         | left          |
| `<>`     | `NEQ`    | 10         | left          |
| `>`      | `GT`     | 10         | left          |
| `>=`     | `GTE`    | 10         | left          |
| `<`      | `LT`     | 10         | left          |
| `<=`     | `LTE`    | 10         | left          |

## Contents

- **Math:** [ADD](#add) · [SUB](#sub) · [MUL](#mul) · [DIV](#div) · [POW](#pow) · [SUM](#sum) · [PRODUCT](#product) · [MOD](#mod) · [ROUND](#round) · [ROUNDDOWN](#rounddown) · [ROUNDUP](#roundup) · [CEILING](#ceiling) · [FLOOR](#floor) · [SQRT](#sqrt) · [EXP](#exp) · [LOG](#log) · [LOG10](#log10) · [PI](#pi) · [SIN](#sin) · [COS](#cos) · [TAN](#tan) · [ASIN](#asin) · [ACOS](#acos) · [ATAN](#atan) · [ISEVEN](#iseven) · [ISODD](#isodd) · [RANGE_SCORE](#range_score)
- **Aggregation:** [AVG](#avg) · [MIN](#min) · [MAX](#max) · [MEDIAN](#median) · [COUNT](#count) · [COUNT_UNIQUE](#count_unique)
- **Logic & comparison:** [EQ](#eq) · [NEQ](#neq) · [GT](#gt) · [GTE](#gte) · [LT](#lt) · [LTE](#lte) · [AND](#and) · [OR](#or) · [NOT](#not)
- **Text:** [CONCAT](#concat) · [JOIN](#join) · [LEN](#len) · [LOWER](#lower) · [UPPER](#upper) · [TRIM](#trim) · [LEFT](#left) · [RIGHT](#right) · [MID](#mid) · [REPLACE](#replace) · [SUBSTITUTE](#substitute) · [CHAR](#char) · [TO_TEXT](#to_text) · [STARTS_WITH](#starts_with) · [ENDS_WITH](#ends_with) · [CONTAINS](#contains) · [MATCH_EXPRESSION](#match_expression) · [REGEXEXTRACT](#regexextract) · [REGEXREPLACE](#regexreplace) · [ENCODEURL](#encodeurl) · [ISURL](#isurl) · [WORDS](#words) · [WORD_COUNT](#word_count) · [LEADING_WORDS](#leading_words) · [SENTENCES](#sentences) · [LINES](#lines) · [LINE_COUNT](#line_count) · [FIRST_CONTAINED](#first_contained) · [CONTAINS_ANY](#contains_any) · [MISSING_FROM](#missing_from) · [PLAIN_TEXT](#plain_text) · [MARKDOWN_BLOCKS](#markdown_blocks)
- **Lists:** [LIST](#list) · [INDEX](#index) · [FLAT](#flat) · [SORT](#sort) · [SORT_BY_PROPERTY](#sort_by_property) · [FILTER](#filter) · [FILTER_PROPERTY](#filter_property) · [EACH](#each) · [REDUCE](#reduce) · [INCLUDES](#includes) · [TAKE](#take) · [INDEX_OF](#index_of) · [FILTER_BY](#filter_by) · [DISTINCT](#distinct) · [GROUP_COUNTS](#group_counts)
- **Date & time:** [DATE](#date) · [DATEVALUE](#datevalue) · [TIME](#time) · [TIMEVALUE](#timevalue) · [NOW](#now) · [TODAY](#today) · [DAY](#day) · [MONTH](#month) · [YEAR](#year) · [HOUR](#hour) · [MINUTE](#minute) · [SECOND](#second) · [DAYS](#days) · [DATEDIF](#datedif) · [WEEKDAY](#weekday) · [WEEKNUM](#weeknum) · [ISOWEEKNUM](#isoweeknum)
- **Control flow:** [IF](#if) · [SWITCH](#switch)
- **Type predicates & empty:** [IS_EMPTY](#is_empty) · [EMPTY](#empty) · [ISNUMBER](#isnumber) · [ISTEXT](#istext) · [ISDATE](#isdate)

---

## Math

### ADD

`ADD(a: number, b: number) -> number` · operator `+`

Adds two numbers. If either argument is empty, returns `null`; a non-empty,
non-numeric argument returns `null` with a `TYPE` warning. A non-finite result
(overflow) returns `null`.

```ts
// ADD(1; 2) — equivalently 1 + 2
await evalOk('1 + 2'); // 3
```

### SUB

`SUB(a: number, b: number) -> number` · operator `-`

Subtracts `b` from `a`. Same empty/`null`/type handling as `ADD`.

```ts
await evalOk('6 - 2'); // 4
```

### MUL

`MUL(a: number, b: number) -> number` · operator `*`

Multiplies two numbers. Same empty/`null`/type handling as `ADD`.

```ts
await evalOk('2 * 3'); // 6
```

### DIV

`DIV(a: number, b: number) -> number` · operator `/`

Divides `a` by `b`. Division by zero returns `null` with a `DOMAIN` warning
(it is not an error), so `IS_EMPTY(1/0)` is `true`.

```ts
await evalOk('6 / 2'); // 3
await evalOk('1 / 0'); // null
```

### POW

`POW(base: number, exponent: number) -> number` · operator `^`

Raises `base` to `exponent` (`Math.pow`). Supports fractional and negative
exponents. `^` is right-associative and binds tighter than `*` and `+`. Empty
input returns `null`.

```ts
await evalOk('POW(9; 0.5)'); // 3
await evalOk('2 ^ 3 ^ 2'); // 512  (right-associative)
```

### SUM

`SUM(values: list<number>) -> number`

Sums a list of numbers, skipping empty items. An empty list (or a list with only
empty items) returns `null` with an `EMPTY` warning. A non-numeric item returns
`null` with a `TYPE` warning.

```ts
await evalOk('SUM(LIST(1; 1/0; 3))'); // 4  (empty item skipped)
```

### PRODUCT

`PRODUCT(...factors: number) -> number`

Multiplies the provided factors (variadic), skipping empty ones. With no
non-empty factors returns `null` with an `EMPTY` warning. A non-numeric factor
returns `null` with a `TYPE` warning.

```ts
await evalOk('PRODUCT(2; 3; 4)'); // 24
await evalOk('PRODUCT()'); // null
```

### MOD

`MOD(dividend: number, divisor: number) -> number`

Remainder after dividing, using floored (Euclidean) modulo, so the result takes
the sign of the divisor. Divisor `0` returns `null`.

```ts
await evalOk('MOD(-10; 3)'); // 2
await evalOk('MOD(1; 0)'); // null
```

### ROUND

`ROUND(value: number, digits?: number) -> number`

Rounds to `digits` decimal places (default `0`), rounding halves away from zero.
`digits` is clamped to the range −15…15.

```ts
await evalOk('ROUND(1.5; 0)'); // 2
await evalOk('ROUND(-1.5; 0)'); // -2
```

### ROUNDDOWN

`ROUNDDOWN(value: number, digits?: number) -> number`

Rounds toward zero at `digits` decimal places (default `0`).

```ts
await evalOk('ROUNDDOWN(1.29; 1)'); // 1.2
```

### ROUNDUP

`ROUNDUP(value: number, digits?: number) -> number`

Rounds away from zero at `digits` decimal places (default `0`).

```ts
await evalOk('ROUNDUP(1.21; 1)'); // 1.3
```

### CEILING

`CEILING(value: number) -> number`

Rounds up to the nearest integer (`Math.ceil`).

```ts
await evalOk('CEILING(1.2)'); // 2
```

### FLOOR

`FLOOR(value: number) -> number`

Rounds down to the nearest integer (`Math.floor`).

```ts
await evalOk('FLOOR(1.8)'); // 1
```

### SQRT

`SQRT(value: number) -> number`

Square root. A negative argument is a domain error and returns `null`.

```ts
await evalOk('SQRT(9)'); // 3
await evalOk('SQRT(-1)'); // null
```

### EXP

`EXP(value: number) -> number`

`e` raised to `value` (`Math.exp`).

```ts
await evalOk('ROUND(EXP(1); 8)'); // ~2.71828183 (≈ e)
```

### LOG

`LOG(value: number, base?: number) -> number`

Logarithm of `value`, base `10` by default. Returns `null` when `value <= 0`,
`base <= 0`, or `base == 1`.

```ts
await evalOk('LOG(8; 2)'); // 3
await evalOk('LOG(100)'); // 2
```

### LOG10

`LOG10(value: number) -> number`

Base-10 logarithm (`Math.log10`). A non-positive argument returns `null`.

```ts
await evalOk('LOG10(1000)'); // 3
```

### PI

`PI() -> number`

The constant π (`Math.PI`). Return type is non-nullable.

```ts
await evalOk('PI()'); // 3.141592653589793
```

### SIN

`SIN(value: number) -> number`

Sine of `value` in radians. Empty input returns `null`; non-empty non-numeric
input is a compile-time type error.

```ts
await evalOk('ROUND(SIN(0); 8)'); // 0
```

### COS

`COS(value: number) -> number`

Cosine of `value` in radians.

```ts
await evalOk('ROUND(COS(0); 8)'); // 1
```

### TAN

`TAN(value: number) -> number`

Tangent of `value` in radians.

```ts
await evalOk('ROUND(TAN(0); 8)'); // 0
```

### ASIN

`ASIN(value: number) -> number`

Arcsine, in radians. An argument outside −1…1 is a domain error and returns
`null`.

```ts
await evalOk('ROUND(ASIN(0); 8)'); // 0
await evalOk('ASIN(2)'); // null
```

### ACOS

`ACOS(value: number) -> number`

Arccosine, in radians. An argument outside −1…1 returns `null`.

```ts
await evalOk('ROUND(ACOS(1); 8)'); // 0
await evalOk('ACOS(-2)'); // null
```

### ATAN

`ATAN(value: number) -> number`

Arctangent, in radians.

```ts
await evalOk('ROUND(ATAN(0); 8)'); // 0
```

### ISEVEN

`ISEVEN(value: number) -> boolean`

Whether `value` is an even integer. Non-integers and empty/`null` values return
`false` (never `null`).

```ts
await evalOk('ISEVEN(-2)'); // true
await evalOk('ISEVEN(2.2)'); // false
```

### ISODD

`ISODD(value: number) -> boolean`

Whether `value` is an odd integer. Non-integers and empty/`null` values return
`false`.

```ts
await evalOk('ISODD(-3)'); // true
```

### RANGE_SCORE

`RANGE_SCORE(value, bad_min, warn_min, warn_max, bad_max: number) -> number`

Maps `value` onto a 0…1 score given a warning band and a bad band. Requires
`bad_min <= warn_min <= warn_max <= bad_max`, otherwise returns `null` with a
`RANGE` warning. Inside the warning band the score is `1`; at or beyond the bad
bounds it is `0`; between a bad bound and the warning band it interpolates
linearly. Non-numeric arguments produce `null` with a `TYPE` warning.

```ts
await evalOk('RANGE_SCORE(5; 0; 3; 7; 10)'); // 1  (inside warn band)
await evalOk('RANGE_SCORE(-1; 0; 3; 7; 10)'); // 0  (outside bad bound)
```

---

## Aggregation

### AVG

`AVG(values: list<number>) -> number` · alias `AVERAGE`

Arithmetic mean of a list of numbers, skipping empty items. An empty list
returns `null` with an `EMPTY` warning; a non-numeric item returns `null` with a
`TYPE` warning.

```ts
await evalOk('AVG(LIST(1; 1/0; 3))'); // 2  (empty item skipped)
```

### MIN

`MIN(values: list<number>) -> number`

Smallest number in a list, skipping empty items. Empty list → `null` + `EMPTY`
warning.

```ts
await evalOk('MIN(LIST(3; 1/0; 2))'); // 2
```

### MAX

`MAX(values: list<number>) -> number`

Largest number in a list, skipping empty items. Empty list → `null` + `EMPTY`
warning.

```ts
await evalOk('MAX(LIST(3; 1; 2))'); // 3
```

### MEDIAN

`MEDIAN(values: list<number>) -> number`

Median of a list of numbers, skipping empty items. For an even count returns the
mean of the two middle values. Empty list → `null` + `EMPTY` warning.

```ts
await evalOk('MEDIAN(LIST(1; 2; 3; 4))'); // 2.5
```

### COUNT

`COUNT(list: list<any>) -> number`
`COUNT(...values: any) -> number`

Two overloads. Given a single list, counts its non-empty items. Given multiple
arguments, counts the non-empty ones. Empty items (`null`, `""`, empty list) are
never counted. A non-list, non-empty single argument returns `null` with a
`TYPE` warning.

```ts
await evalOk('COUNT(LIST(1; 1/0; 2))'); // 2  (list overload)
await evalOk('COUNT(1; ""; 1/0; "x")'); // 2  (variadic overload)
```

### COUNT_UNIQUE

`COUNT_UNIQUE(...values: any) -> number`

Counts distinct non-empty values (variadic). Equality is by value for
primitives and by structural key for other values.

```ts
await evalOk('COUNT_UNIQUE("a"; "a"; "b"; ""; 1/0)'); // 2
```

---

## Logic & comparison

Comparison operators coerce their operands before comparing (see
[`coerceComparisonPair`](../core-functions/src/functions/helpers.ts)):
empty text `""` becomes `null`; numeric-looking text is parsed to a number;
`"true"`/`"false"` become booleans when the other side is boolean; and when one
side is a list and the other a number, the list is compared by its length.

### EQ

`EQ(a: any, b: any) -> boolean` · operator `=`

Equality after coercion. Returns `null` when either side is empty after
coercion (so `"" = 0` is `null`, not `false`). Numeric strings compare equal to
numbers, and the texts `true` and `false`, in any case, to booleans
(`"TRUE" = TRUE` is `true`). Two objects, such as dates, are equal only as the
same value object.

```ts
await evalOk('1 = "1"'); // true
await evalOk('"" = 0'); // null
```

### NEQ

`NEQ(a: any, b: any) -> boolean` · operator `<>`

Logical negation of `EQ`. Returns `null` whenever `EQ` would.

```ts
await evalOk('1 <> 2'); // true
```

### GT

`GT(a, b: number | text | list) -> boolean` · operator `>`

Greater-than. After coercion, compares two numbers or two texts; a list is
compared by its length against a number. Empty operand → `null`. Two
non-comparable values → `null` with a `TYPE` warning.

```ts
await evalOk('2 > 1'); // true
await evalOk('value > 0', { value: [null] }); // true  (length 1 > 0)
```

### GTE

`GTE(a, b: number | text | list) -> boolean` · operator `>=`

Greater-than-or-equal, same coercion rules as `GT`.

```ts
await evalOk('2 >= 2'); // true
```

### LT

`LT(a, b: number | text | list) -> boolean` · operator `<`

Less-than, same coercion rules as `GT`.

```ts
await evalOk('1 < 2'); // true
await evalOk('value < 2', { value: [1, 2] }); // false (length 2 < 2 is false)
```

### LTE

`LTE(a, b: number | text | list) -> boolean` · operator `<=`

Less-than-or-equal, same coercion rules as `GT`.

```ts
await evalOk('2 <= 2'); // true
```

### AND

`AND(...values: boolean | text) -> boolean` · control flow

Returns `true` when every argument is truthy. Short-circuits: evaluation stops at
the first `false`, and later arguments are skipped (`output.children[i].skipped`).
`"true"`/`"false"` (any case, trimmed) are accepted. A value that is not
boolean-like at runtime is a runtime error. `AND()` with no arguments is `true`.

```ts
await evalOk('AND(TRUE; "true")'); // true
```

### OR

`OR(...values: boolean | text) -> boolean` · control flow

Returns `true` when any argument is truthy. Short-circuits at the first `true`.
`OR()` with no arguments is `false`. Non-boolean-like runtime values are errors.

```ts
await evalOk('OR(FALSE; "false")'); // false
```

### NOT

`NOT(value: any) -> boolean` · control flow

Negates a boolean-like value. A non-boolean-like value (for example a number) is
a runtime error, not `null`.

```ts
await evalOk('NOT("false")'); // true
```

---

## Text

Most text functions return `null` (often with a `TYPE` warning) when given a
non-empty, non-text value, and plain `null` when the input is empty; those
whose sections state them as rules follow [Shared rules](#shared-rules)
instead.

**Text segmentation.** `WORDS`, `WORD_COUNT` and `LEADING_WORDS` share one
tokeniser, chosen by `mode` ([WORDS](#words) gives the modes); `SENTENCES` has
modes of its own and a `keep` list of tokens that end no sentence. There is no
locale sentence mode: `Intl.Segmenter` has no abbreviation data for sentences
and splits German `"Wir helfen z. B. Handwerkern."` after `z.` and after `B.`.
Embedders that count outside a formula import the same tokenisers from
`@formulang/core-functions`: `splitWords(text, mode?, option?)` and
`splitSentences(text, mode?, keep?)`.

**Bounds.** Each function's section states where it bounds a list it returns
by `maxWildcardOutputLength` (5,000), and [Shared rules](#shared-rules) bound
every list a function reads by `maxListLength` (1,000), both raising
`LIST_TOO_LARGE` as `FLAT` does. A
phrase of `FIRST_CONTAINED` or `CONTAINS_ANY`, and an item of `MISSING_FROM`,
is at most 250 code units long as it is searched for, and a longer one raises
`PHRASE_TOO_LONG`: in `"substring"` mode, and in `MISSING_FROM`, it goes to the
runtime's own substring search, whose tables V8 builds over a needle's last 250
code units, so that up to that length they cover the whole phrase, while a
longer phrase whose mismatch lies before them would be compared afresh at
almost every place in the text. In `"word"` mode a phrase, and in `SENTENCES`
a `keep` token, is found with one Knuth-Morris-Pratt search, in time linear in
the lengths of the text and of the phrase or token however often their
occurrences overlap. Measured on Node 22.23.3 under the default limits, best of
three: on 1,000,000 code units of prose (random letters and spaces),
`FIRST_CONTAINED` with 1,000 absent phrases of 250 code units takes 20 ms, and
`MISSING_FROM` with `"exact"` 21 ms; on 5,000 entries of 300 code units that
each end with the same 250-unit note, 1,000 absent items of 250 code units that
end with all of the note but its first unit take 29 ms; on 1,000,000 code units
of `a`, 1,000 phrases of `"b"` and 249 `a`s take 19 ms, and 1,000 phrases of
249 `a`s and `"b"` 5.1 s, the text's length times the number of phrases; in
`"word"` mode, 1,000 phrases of 250 `a`s, each found at every place of that
text, run 54 s and report `WALL_TIME_LIMIT_EXCEEDED`.

**Work.** What each text function does with its input, read from its code,
and what bounds the input:

| Function                                       | Work                                                                                                                                                                                                                  | Bounded by                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORDS`, `WORD_COUNT`, `LEADING_WORDS`         | one fixed expression over the text (`"whitespace"`, `"letters"`), the runtime's `Intl.Segmenter` (`"locale"`), or the formula's own expression (`"pattern"`)                                                          | `"pattern"`: the [MATCH_EXPRESSION](#match_expression) rules and the text at most `maxRegexTextLength` (8,000), which do not bound the time (below) |
| `SENTENCES`                                    | one fixed expression over the text (in `"terminators"` mode a second on each piece), and one Knuth-Morris-Pratt search per `keep` token, linear in the text and the token                                             | `keep` at most `maxListLength`; the result at most `maxWildcardOutputLength`                                                                        |
| `LINES`, `LINE_COUNT`                          | one scan for the line breaks with a fixed expression, each line trimmed in `"non-blank"` mode; `LINE_COUNT` counts the lines as it finds them                                                                         | `LINES`: the result at most `maxWildcardOutputLength`                                                                                               |
| `FIRST_CONTAINED`, `CONTAINS_ANY`              | per phrase in list order, the runtime's own substring search (`"substring"`) or one Knuth-Morris-Pratt search (`"word"`): the text's length times the number of phrases, plus the phrases' lengths, in the worst case | `phrases` at most `maxListLength`, each at most 250 code units as searched for                                                                      |
| `MISSING_FROM`                                 | the text normalised once, then per item its normalisation and the runtime's own substring search: the text's length times the number of items, plus the items' lengths, in the worst case                             | `items` at most `maxListLength`, each at most 250 code units once normalised                                                                        |
| `PLAIN_TEXT` (`"html"`)                        | one forward scan of the markup, tags, comments and dropped elements included, and fixed expressions on each piece of text                                                                                             | the length of `markup`                                                                                                                              |
| `PLAIN_TEXT` (`"markdown"`), `MARKDOWN_BLOCKS` | one pass over the lines, fixed expressions on each, then one scan of each block's inline text                                                                                                                         | the length of `markup`; `MARKDOWN_BLOCKS`: the result at most `maxWildcardOutputLength`                                                             |

This is read from the code: it is what the code claims for its own loops and
for the patterns it runs, and review owns those claims. No spec measures the
time or the work of these functions, and none checks the complexity of a loop
or of a pattern. Each cost but that of the formula's own pattern (below) is
linear in the length of the text or list the function reads, and that length is
bounded only by what the runtime bounds:
`maxStringLiteralLength` bounds literals, not a text the formula computes, so a
`SUBSTITUTE` of a `SUBSTITUTE` of a 1,000-unit literal, 1,394 characters of
source, makes 25,000,000 code units: building them alone, `LEN`, takes 0.19 s,
and `FIRST_CONTAINED` on them with 43 phrases of 249 `a`s and `"b"`, in a
12,339-character formula, 5.6 s, and with 43 phrases of 250 `b`s, whose first
character the text lacks, 0.25 s.

Four patterns of 1.0.0 code read their input in more than linear time. Each was
measured on Node 22.23.3 on an input built against it, as the best of three
runs where no single run is named:

- `regex.ts`'s nested-quantifier check, `\([^)]*[+*{][^)]*\)[+*{]`, on `(+`
  repeated: 0.06 ms at 100 code units, 19 ms at 800. It is cubic in the length
  of the formula's own pattern, which it reads after the length check
  (`maxRegexPatternLength`, 100 by default).
- The alternation check beside it, `\([^)]*\|[^)]*\)[+*{]`, on `(|` repeated:
  0.05 ms at 100 code units, 17 ms at 800; cubic in the same way.
- The formula's own pattern, which the regex functions and the `"pattern"`
  mode compile through 1.0.0's `compileSafeRegex`, inherits its rules, and
  they accept some patterns that backtrack exponentially: its nested-quantifier
  check reads `[^)]*`, so it misses a quantifier outside a nested group, as in
  `((a+))+$` and `(?:(a+))+$`. `MATCH_EXPRESSION` in 1.0.0 accepts them too.
  Under the default limits, `WORD_COUNT(value; "pattern"; "((a+))+$")` on `a`s
  followed by one `b`, once the same pattern has run before in the process,
  takes 14 ms at 21 code units, 220 ms at 25, 1.8 s at 28 and 3.5 s at 29 (one
  run each): each character doubles it. The first run of such a pattern in a
  process goes through V8's regular-expression interpreter and is six to
  seven times slower: at 29 code units it takes 24 s and then reports
  `WALL_TIME_LIMIT_EXCEEDED`. `MATCH_EXPRESSION(value; "((a+))+$")` takes the
  same (3.5 s, and 24 s on a first run), and so does a formula of literals
  alone, `WORD_COUNT("aaaaaaaaaaaaaaaaaaaaaaaaaaaab"; "pattern"; "(?:(a+))+$")`
  (3.6 s, and 22 s on a first run). The rules also accept patterns that take
  polynomial time:
  `WORD_COUNT(value; "pattern"; "\\s*\\s*!")` on a run of spaces takes 0.14 s
  at 1,000 spaces, 1.1 s at 2,000, 8.9 s at 4,000 and 76 s at 8,000 (one
  run). `maxRegexPatternLength` (100) and `maxRegexTextLength` (8,000) bound
  neither, and the function wall-time limit, `maxFunctionWallTimeMs` (10 s),
  is read when the call returns, so it reports such a call only after the
  call has run.
- `ISURL`'s check of a `mailto:` address, `^[^\s@]+@[^\s@]+\.[^\s@]+$`, on `a@`
  followed by a run of dots and `@`, which no split fits: 2.5 ms at 2,000 code
  units, 162 ms at 16,000. It is quadratic in the address, which `ISURL` does
  not bound: a literal carries at most `maxStringLiteralLength` (8,000) code
  units, but two literals joined with `&`, a variable's value or a `JOIN`
  carry more.

The split of `/source/flags`, `^\/(.*)\/([a-z]*)$`, is linear: 2.6 ms at
640,000 code units.

### CONCAT

`CONCAT(...values: any) -> text` · operator `&`

Concatenates values into one text. A non-text value produces `null` with a
`TYPE` warning; an empty value short-circuits the whole call to `null`.

```ts
await evalOk('CONCAT("a"; "b")'); // "ab"
// "Issues:" & CHAR(10) & "A"  ->  "Issues:\nA"
```

### JOIN

`JOIN(values: list<text>, separator: text) -> text`

Joins a list of texts with `separator`. An empty list yields `""`. A non-list
first argument, a non-text separator, or a non-text list item each return `null`
with a `TYPE` warning.

```ts
await evalOk('JOIN(LIST("a"; "b"; "c"); "-")'); // "a-b-c"
await evalOk('JOIN(LIST(); "-")'); // ""
```

### LEN

`LEN(text: text) -> number` · alias `LENGTH`
`LEN(list: list<any>) -> number` · alias `LENGTH`

Number of characters in a text, or number of items in a list (two overloads
resolved by argument type). Unlike `COUNT`, the list overload does **not** skip
empty items.

```ts
await evalOk('LEN("abc")'); // 3
await evalOk('LEN(LIST(1; 2))'); // 2
```

### LOWER

`LOWER(text: text) -> text`

Lowercases text.

```ts
await evalOk('LOWER("AbC")'); // "abc"
```

### UPPER

`UPPER(text: text) -> text`

Uppercases text.

```ts
await evalOk('UPPER("AbC")'); // "ABC"
```

### TRIM

`TRIM(text: text) -> text`

Trims leading/trailing whitespace and collapses internal runs of spaces, tabs,
carriage returns, and newlines into single spaces.

```ts
await evalOk('TRIM("  a   b  ")'); // "a b"
```

### LEFT

`LEFT(string: text, number_of_characters?: number) -> text`

The leftmost `number_of_characters` characters (default `1`). A count `<= 0`
yields `""`.

```ts
await evalOk('LEFT("hello"; 2)'); // "he"
await evalOk('LEFT("hello")'); // "h"
```

### RIGHT

`RIGHT(string: text, number_of_characters?: number) -> text`

The rightmost `number_of_characters` characters (default `1`). A count `<= 0`
yields `""`.

```ts
await evalOk('RIGHT("hello"; 2)'); // "lo"
```

### MID

`MID(string: text, starting_at: number, extract_length: number) -> text`

Substring of `extract_length` characters starting at 1-based position
`starting_at`. A start past the end yields `""`.

```ts
await evalOk('MID("hello"; 2; 2)'); // "el"
```

### REPLACE

`REPLACE(text: text, position: number, length: number, new_text: text) -> text`

Replaces `length` characters at 1-based `position` with `new_text`. A position
past the end appends `new_text`.

```ts
await evalOk('REPLACE("hello"; 2; 2; "xx")'); // "hxxlo"
await evalOk('REPLACE("hi"; 10; 2; "X")'); // "hiX"
```

### SUBSTITUTE

`SUBSTITUTE(text_to_search, search_for, replace_with: text, occurrence_number?: number) -> text`

Replaces occurrences of `search_for` with `replace_with`. Without
`occurrence_number`, all occurrences are replaced; with it, only that 1-based
occurrence. An empty `search_for` returns the text unchanged; an
`occurrence_number <= 0` or non-integer returns `null`.

```ts
await evalOk('SUBSTITUTE("a a a"; "a"; "b")'); // "b b b"
await evalOk('SUBSTITUTE("a a a"; "a"; "b"; 2)'); // "a b a"
```

### CHAR

`CHAR(table_number: number) -> text`

The Unicode character for a code point. Code points `<= 0` or above
`0x10FFFF` return `null`. `table_number` is a decimal literal.

```ts
await evalOk('CHAR(65)'); // "A"
await evalOk('CHAR(128512)'); // "😀"
await evalOk('CHAR(0)'); // null
```

### TO_TEXT

`TO_TEXT(value: any) -> text`

Converts a value to text. Numbers and booleans stringify; date/time/datetime
values yield their `iso` string; `null` stays `null`. Lists and plain objects
are not convertible and return `null`.

```ts
await evalOk('TO_TEXT(123)'); // "123"
await evalOk('TO_TEXT(DATE(2024; 2; 29))'); // "2024-02-29"
await evalOk('TO_TEXT(LIST(1; 2; 3))'); // null
```

### STARTS_WITH

`STARTS_WITH(text: text, needle: text) -> boolean`
`STARTS_WITH(text: text, needles: list<text>) -> boolean`

Whether `text` starts with `needle`, or with any needle in a list (two
overloads). Non-text `text` returns `null` with a `TYPE` warning.

```ts
await evalOk('STARTS_WITH("abc"; "a")'); // true
await evalOk('STARTS_WITH("xyz123"; LIST("abc"; "xyz"))'); // true
```

### ENDS_WITH

`ENDS_WITH(text: text, needle: text) -> boolean`

Whether `text` ends with `needle`.

```ts
await evalOk('ENDS_WITH("abc"; "bc")'); // true
```

### CONTAINS

`CONTAINS(text: text, needle: text) -> boolean`

Whether `text` contains `needle` as a substring. Non-text input returns `null`
with a `TYPE` warning.

```ts
await evalOk('CONTAINS("abc"; "b")'); // true
```

### MATCH_EXPRESSION

`MATCH_EXPRESSION(text: text, pattern: text) -> boolean`

Whether `text` matches the regular-expression `pattern`. Patterns are compiled
under safety limits: overly long text/patterns are security errors; unsafe
patterns (nested quantifiers such as `(a+)+`) are rejected; backreferences and
lookbehind are disallowed and yield `null` with a `REGEX` warning. Invalid
patterns also return `null` + `REGEX` warning. Allowed flags: `imsu` (no `g`).

```ts
await evalOk('MATCH_EXPRESSION("abc123"; "^abc")'); // true
```

### REGEXEXTRACT

`REGEXEXTRACT(text: text, regular_expression: text) -> text`

Returns the first capture group, or the whole match if there is no group, or
`null` if nothing matches. Accepts `/pattern/flags` syntax. Subject to the same
safety limits as `MATCH_EXPRESSION`; allowed flags include `g`.

```ts
await evalOk('REGEXEXTRACT("abc123"; "([0-9]+)")'); // "123"
await evalOk('REGEXEXTRACT("nope"; "([0-9]+)")'); // null
```

### REGEXREPLACE

`REGEXREPLACE(text: text, regular_expression: text, replacement: text) -> text`

Replaces every match with `replacement` (matching is forced global). Accepts
`/pattern/flags` syntax and the same safety limits as `MATCH_EXPRESSION`.

```ts
await evalOk('REGEXREPLACE("a1a2a3"; "a"; "X")'); // "X1X2X3"
```

### ENCODEURL

`ENCODEURL(text: text) -> text`

URL-encodes text with `encodeURIComponent`.

```ts
await evalOk('ENCODEURL("a b")'); // "a%20b"
```

### ISURL

`ISURL(value: any) -> boolean`

Whether `value` is a valid URL. Accepts an allowlist of schemes
(`http`, `https`, `ftp`, `gopher`, `mailto`, `news`, `telnet`, `aim`) and
scheme-less host names with a valid public-style TLD. `localhost` and
single-label hosts are rejected. Return type is non-nullable; non-text input is
`false`.

```ts
await evalOk('ISURL("https://example.com")'); // true
await evalOk('ISURL("localhost")'); // false
```

### WORDS

`WORDS(text: text, mode?: text, option?: text) -> list<text>`

- In `"whitespace"` mode, the default, the words are the pieces of the text between runs of whitespace, in order.

  ```ts
  await evalOk('WORDS("  Kennst du   das? ")'); // ["Kennst", "du", "das?"]
  await evalOk('WORDS("  Kennst du   das? "; "whitespace")'); // ["Kennst", "du", "das?"]
  await evalOk('WORDS("Kennst-du-das?")'); // ["Kennst-du-das?"]
  ```

- Whitespace is JavaScript's `\s`, which takes in the no-break space U+00A0 and the byte order mark U+FEFF but not U+0085 or U+001C to U+001F, at which Python's `str.split()` also splits.

  ```ts
  await evalOk('WORDS(value)', { value: 'a\tb\nc\u00A0d\uFEFFe' }); // ["a", "b", "c", "d", "e"]
  await evalOk('WORDS(value)', { value: 'a\u001Cb\u0085c' }); // ["a\u001cb\u0085c"]
  await evalOk('WORDS(value)', { value: 'a\u200Bb' }); // ["a\u200bb"]
  ```

- A text of nothing but whitespace, `""` included, has no words.

  ```ts
  await evalOk('WORDS("")'); // []
  await evalOk('WORDS("  ")'); // []
  await evalOk('WORDS(" a ")'); // ["a"]
  ```

- In `"letters"` mode, the words are the runs of letters, marks and numbers, Unicode's `\p{L}`, `\p{M}` and `\p{N}`.

  ```ts
  await evalOk('WORDS("Für 3 Mio.!Kund"; "letters")'); // ["Für", "3", "Mio", "Kund"]
  await evalOk('WORDS(value; "letters")', { value: 'a\u00B2e\u0301b' }); // ["a\u00b2e\u0301b"]
  await evalOk('WORDS("a§b"; "letters")'); // ["a", "b"]
  ```

- One apostrophe, `'` or `’`, between two runs joins them into one word.

  ```ts
  await evalOk('WORDS("Don\'t"; "letters")'); // ["Don't"]
  await evalOk('WORDS(value; "letters")', { value: 'it\u2019s' }); // ["it\u2019s"]
  await evalOk('WORDS("Don\'\'t \'zitiert\'"; "letters")'); // ["Don", "t", "zitiert"]
  ```

- One hyphen, `-`, U+2010, U+2011 or the soft hyphen U+00AD, between two runs joins them into one word.

  ```ts
  await evalOk('WORDS("Don\'t re-enter the e-mail, oder?"; "letters")'); // ["Don't", "re-enter", "the", "e-mail", "oder"]
  await evalOk('WORDS(value; "letters")', {
    value: 'E\u2010Mail Ge\u2011biet Silben\u00ADtrennung',
  }); // ["E\u2010Mail", "Ge\u2011biet", "Silben\u00adtrennung"]
  await evalOk('WORDS(value; "letters")', { value: 'a--b a\u2012b a\u2013b' }); // ["a", "b", "a", "b", "a", "b"]
  ```

- One `.` or `,` between two decimal digits, Unicode's `\p{Nd}`, joins them into one word.

  ```ts
  await evalOk('WORDS("Für 3,5 Mio. 1.2.3"; "letters")'); // ["Für", "3,5", "Mio", "1.2.3"]
  await evalOk('WORDS("3.a a,3 3.5."; "letters")'); // ["3", "a", "a", "3", "3.5"]
  await evalOk('WORDS(value; "letters")', { value: '\u0663,\u0665 \u00B9,\u00B2' }); // ["\u0663,\u0665", "\u00b9", "\u00b2"]
  ```

- In `"locale"` mode, the words are the segments that `Intl.Segmenter` marks word-like for the BCP 47 language tag in `option`, as the runtime's ICU data segment the text.

  ```ts
  await evalOk('WORDS("Kund:innen"; "locale"; "de")'); // ["Kund:innen"]
  await evalOk('WORDS("Kund:innen"; "letters")'); // ["Kund", "innen"]
  await evalOk('WORDS("Don\'t stop"; "locale"; "en-GB")'); // ["Don't", "stop"]
  ```

- A language tag that is malformed, or that the runtime holds no segmentation data for, returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('WORDS("a b"; "locale"; "x-invalid-")'); // null with a TYPE warning
  await evalOk('WORDS("a b"; "locale"; "zz")'); // null with a TYPE warning
  await evalOk('WORDS("a b"; "locale"; "en")'); // ["a", "b"]
  ```

- In the `"whitespace"` and `"letters"` modes, any option, `""` included, returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('WORDS("a b"; "whitespace"; "de")'); // null with a TYPE warning
  await evalOk('WORDS("a b"; "letters"; "")'); // null with a TYPE warning
  await evalOk('WORDS("a b"; "letters")'); // ["a", "b"]
  ```

- In the `"locale"` and `"pattern"` modes, an omitted option, or `""`, returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('WORDS("a b"; "locale")'); // null with a TYPE warning
  await evalOk('WORDS("a b"; "locale"; "")'); // null with a TYPE warning
  await evalOk('WORDS("a b"; "pattern")'); // null with a TYPE warning
  await evalOk('WORDS("a b"; "pattern"; "")'); // null with a TYPE warning
  await evalOk('WORDS("a b"; "pattern"; "a")'); // ["a"]
  ```

- In `"pattern"` mode, the words are the non-empty matches of the regular expression in `option`, from left to right.

  ```ts
  await evalOk('WORDS(LOWER("Für 50$ – sofort!"); "pattern"; "[A-Za-z0-9$\']+")'); // ["f", "r", "50$", "sofort"]
  await evalOk('WORDS("abc"; "pattern"; "x*")'); // []
  await evalOk('WORDS("abc"; "pattern"; "b*")'); // ["b"]
  ```

- An option that holds no line terminator, starts with `/` and ends with `/` and ASCII lower-case letters, or none, is read as `/pattern/flags`, split at its last `/`.

  ```ts
  await evalOk('WORDS("Ab ab"; "pattern"; "/ab/i")'); // ["Ab", "ab"]
  await evalOk('WORDS("a/b"; "pattern"; "/a/b/")'); // ["a/b"]
  await evalOk('WORDS("/ab/I"; "pattern"; "/ab/I")'); // ["/ab/I"]
  ```

- In `"pattern"` mode, a text of more than `maxRegexTextLength` (8,000) code units raises `REGEX_INPUT_TOO_LONG`.

  ```ts
  await evalErrors('WORDS(value; "pattern"; "a+")', { value: 'a'.repeat(8001) }); // ["REGEX_INPUT_TOO_LONG"]
  await evalOk('LEN(INDEX(WORDS(value; "pattern"; "a+"); 1))', { value: 'a'.repeat(8000) }); // 8000
  ```

- A pattern of more than `maxRegexPatternLength` (100) code units, counted as the option is written, raises `REGEX_UNSAFE`.

  ```ts
  await evalErrors('WORDS("aa"; "pattern"; value)', { value: 'a'.repeat(101) }); // ["REGEX_UNSAFE"]
  await evalOk('WORDS("aa"; "pattern"; value)', { value: 'a'.repeat(100) }); // []
  ```

- A flag other than `i`, `m`, `s` and `u`, `g` included, returns `null` with a `REGEX` warning.

  ```ts
  await evalOk('WORDS("Ab"; "pattern"; "/ab/g")'); // null with a REGEX warning
  await evalOk('WORDS("Ab"; "pattern"; "/ab/x")'); // null with a REGEX warning
  await evalOk('WORDS("Ab"; "pattern"; "/ab/is")'); // ["Ab"]
  ```

- A pattern that holds a backslash followed by a digit from 1 to 9, as a back-reference does, returns `null` with a `REGEX` warning.

  ```ts
  await evalOk('WORDS("aa"; "pattern"; value)', { value: '(a)\\1' }); // null with a REGEX warning
  await evalOk('WORDS("a1"; "pattern"; value)', { value: '(a)1' }); // ["a1"]
  await evalOk('WORDS("a0"; "pattern"; value)', { value: 'a\\x30' }); // ["a0"]
  ```

- A pattern that holds `(?<=` or `(?<!`, as a look-behind does, returns `null` with a `REGEX` warning.

  ```ts
  await evalOk('WORDS("ab"; "pattern"; "(?<=a)b")'); // null with a REGEX warning
  await evalOk('WORDS("ab"; "pattern"; "(?<!a)b")'); // null with a REGEX warning
  await evalOk('WORDS("ab"; "pattern"; "a(?=b)")'); // ["a"]
  ```

- A pattern in which a `(` is followed by characters other than `)`, at least one of them `+`, `*`, `{` or `|`, and then by `)` and `+`, `*` or `{`, raises `REGEX_UNSAFE`, as in [MATCH_EXPRESSION](#match_expression).

  ```ts
  await evalErrors('WORDS("aaa"; "pattern"; "(a+)+")'); // ["REGEX_UNSAFE"]
  await evalErrors('WORDS("aaa"; "pattern"; "(a|aa)+")'); // ["REGEX_UNSAFE"]
  await evalErrors('WORDS("aaa"; "pattern"; "(a{1,2})*")'); // ["REGEX_UNSAFE"]
  await evalOk('WORDS("aaa"; "pattern"; "(a+)?")'); // ["aaa"]
  await evalOk('WORDS("aaa"; "pattern"; "((a+))+")'); // ["aaa"]
  ```

- A pattern that JavaScript cannot compile, a flag written twice included, returns `null` with a `REGEX` warning.

  ```ts
  await evalOk('WORDS("a(b"; "pattern"; "(")'); // null with a REGEX warning
  await evalOk('WORDS("a"; "pattern"; "/a/ii")'); // null with a REGEX warning
  await evalOk('WORDS("a(b"; "pattern"; value)', { value: '\\(' }); // ["("]
  ```

- The rules of `"pattern"` mode apply in the order they are listed here, and the first that fails decides the result.

  ```ts
  await evalErrors('WORDS(value; "pattern"; "(a+)+")', { value: 'a'.repeat(8001) }); // ["REGEX_INPUT_TOO_LONG"]
  await evalOk('WORDS("aa"; "pattern"; "/(a+)+/x")'); // null with a REGEX warning
  await evalOk('WORDS("aa"; "pattern"; value)', { value: '(a+)+\\1' }); // null with a REGEX warning
  await evalOk('WORDS("aa"; "pattern"; "(?<=a)(a+)+")'); // null with a REGEX warning
  await evalErrors('WORDS("aa"; "pattern"; "(a+)+(")'); // ["REGEX_UNSAFE"]
  await evalErrors('WORDS("aa"; "pattern"; "/(a+)+/ii")'); // ["REGEX_UNSAFE"]
  ```

- A result of more than `maxWildcardOutputLength` (5,000) words raises `LIST_TOO_LARGE`.

  ```ts
  await evalErrors('WORDS(value)', { value: 'w '.repeat(5001) }); // ["LIST_TOO_LARGE"]
  await evalOk('COUNT(WORDS(value))', { value: 'w '.repeat(5000) }); // 5000
  ```

Unspecified: in `"pattern"` mode, an option that holds a line terminator.

### WORD_COUNT

`WORD_COUNT(text: text, mode?: text, option?: text) -> number`

- The result is the number of words [WORDS](#words) finds with the same arguments.

  ```ts
  await evalOk('WORD_COUNT("  Kennst du   das? ")'); // 3
  await evalOk('WORD_COUNT("Kennst-du-das?")'); // 1
  await evalOk('WORD_COUNT("Don\'t re-enter the e-mail, oder?"; "letters")'); // 5
  await evalOk('WORD_COUNT("a1b22"; "pattern"; "[0-9]+")'); // 2
  await evalOk('WORD_COUNT("")'); // 0
  ```

- Where `WORDS` returns `null` with a warning, `WORD_COUNT` returns `null` with the same warning.

  ```ts
  await evalOk('WORD_COUNT("a b"; "whitespace"; "de")'); // null with a TYPE warning
  await evalOk('WORD_COUNT("a b"; "locale"; "zz")'); // null with a TYPE warning
  await evalOk('WORD_COUNT("ab"; "pattern"; "(?<=a)b")'); // null with a REGEX warning
  await evalOk('WORD_COUNT("a b"; "whitespace")'); // 2
  ```

- Where `WORDS` raises an error other than `LIST_TOO_LARGE`, `WORD_COUNT` raises the same error.

  ```ts
  await evalErrors('WORD_COUNT("aaa"; "pattern"; "(a+)+")'); // ["REGEX_UNSAFE"]
  await evalErrors('WORD_COUNT(value; "pattern"; "a")', { value: 'a'.repeat(8001) }); // ["REGEX_INPUT_TOO_LONG"]
  await evalOk('WORD_COUNT("aaa"; "pattern"; "(a+)")'); // 1
  ```

- A text of more than 5,000 words, for which `WORDS` raises `LIST_TOO_LARGE`, is counted.

  ```ts
  await evalOk('WORD_COUNT(value)', { value: 'w '.repeat(5001) }); // 5001
  await evalOk('WORD_COUNT(value)', { value: 'w '.repeat(5000) }); // 5000
  ```

Unspecified: what [WORDS](#words) leaves unspecified.

### LEADING_WORDS

`LEADING_WORDS(text: text, count: number, mode?: text, option?: text) -> text`

- The result is the first `count` words that [WORDS](#words) finds with `mode` and `option`, joined by one space.

  ```ts
  await evalOk('LEADING_WORDS("eins zwei  drei vier"; 2)'); // "eins zwei"
  await evalOk('LEADING_WORDS("eins zwei  drei vier"; 3)'); // "eins zwei drei"
  await evalOk('LEADING_WORDS("Don\'t re-enter it"; 2; "letters")'); // "Don't re-enter"
  await evalOk('EACH(LIST("a b"; "c d e"); "LEADING_WORDS"; 2)'); // ["a b", "c d"]
  ```

- A text with fewer than `count` words returns `null`.

  ```ts
  await evalOk('LEADING_WORDS("eins zwei"; 3)'); // null
  await evalOk('LEADING_WORDS("eins zwei"; 2)'); // "eins zwei"
  await evalOk('LEADING_WORDS(""; 1)'); // null
  ```

- A `count` that is not a whole number of 1 or more returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('LEADING_WORDS("a b"; 0)'); // null with a TYPE warning
  await evalOk('LEADING_WORDS("a b"; 1)'); // "a"
  await evalOk('LEADING_WORDS("a b"; 2.5)'); // null with a TYPE warning
  await evalOk('LEADING_WORDS("a b"; -1)'); // null with a TYPE warning
  ```

- Where `WORDS` returns `null` with a warning for `text`, `mode` and `option`, `LEADING_WORDS` returns `null` with the same warning.

  ```ts
  await evalOk('LEADING_WORDS("a b"; 1; "whitespace"; "de")'); // null with a TYPE warning
  await evalOk('LEADING_WORDS("ab"; 1; "pattern"; "(?<=a)b")'); // null with a REGEX warning
  await evalOk('LEADING_WORDS("a b"; 1; "whitespace")'); // "a"
  ```

- Where `WORDS` raises an error other than `LIST_TOO_LARGE` for `text`, `mode` and `option`, `LEADING_WORDS` raises the same error.

  ```ts
  await evalErrors('LEADING_WORDS("aaa"; 1; "pattern"; "(a+)+")'); // ["REGEX_UNSAFE"]
  await evalOk('LEADING_WORDS("aaa"; 1; "pattern"; "(a+)")'); // "aaa"
  ```

- Only the first `count` words are read, so a text of more than 5,000 words gives them.

  ```ts
  await evalOk('LEN(LEADING_WORDS(value; 5001))', { value: 'w '.repeat(5001) }); // 10001
  await evalOk('LEN(LEADING_WORDS(value; 5001))', { value: 'w '.repeat(5000) }); // null
  ```

Unspecified: what [WORDS](#words) leaves unspecified.

### SENTENCES

`SENTENCES(text: text, mode?: text, keep?: list<text>) -> list<text>`

- In `"punctuation"` mode, the default, a sentence ends at each run of whitespace directly after `.`, `!` or `?`, as Python's `re.split(r"(?<=[.!?])\s+", text.strip())` splits.

  ```ts
  await evalOk('SENTENCES("Hi. Ok!  Next? end")'); // ["Hi.", "Ok!", "Next?", "end"]
  await evalOk('SENTENCES("Hi. Ok!  Next? end"; "punctuation")'); // ["Hi.", "Ok!", "Next?", "end"]
  await evalOk('SENTENCES("3.5 Uhr.Gut")'); // ["3.5 Uhr.Gut"]
  await evalOk('SENTENCES("Na ja… Gut.")'); // ["Na ja… Gut."]
  ```

- Whitespace is JavaScript's `\s`, which takes in the no-break space U+00A0 and the byte order mark U+FEFF but not U+0085 or U+001C to U+001F.

  ```ts
  await evalOk('SENTENCES(value)', { value: 'Ja.\u00A0Nein.\uFEFFDoch.' }); // ["Ja.", "Nein.", "Doch."]
  await evalOk('SENTENCES(value)', { value: 'Ja.\u0085Nein.\u001CDoch.' }); // ["Ja.\u0085Nein.\u001cDoch."]
  ```

- In `"terminators"` mode, a sentence ends after each run of `.`, `!`, `?`, `。`, `！` and `？`, which stays with it.

  ```ts
  await evalOk('SENTENCES("3.5 Uhr. Gut."; "terminators")'); // ["3.", "5 Uhr.", "Gut."]
  await evalOk('SENTENCES("Wirklich?! Ja。 Nein！"; "terminators")'); // ["Wirklich?!", "Ja。", "Nein！"]
  await evalOk('SENTENCES("a;b"; "terminators")'); // ["a;b"]
  ```

- In `"terminators"` mode, a piece that holds nothing but terminators and whitespace is no sentence.

  ```ts
  await evalOk('SENTENCES("Hm. ... Ja."; "terminators")'); // ["Hm.", "Ja."]
  await evalOk('SENTENCES("Hm. x... Ja."; "terminators")'); // ["Hm.", "x...", "Ja."]
  await evalOk('SENTENCES("!? ..."; "terminators")'); // []
  ```

- Each sentence is trimmed of whitespace.

  ```ts
  await evalOk('SENTENCES(" Ja. ")'); // ["Ja."]
  await evalOk('SENTENCES(" Ja. Nein "; "terminators")'); // ["Ja.", "Nein"]
  ```

- In `"punctuation"` mode, a piece that is empty once trimmed is no sentence.

  ```ts
  await evalOk('SENTENCES("")'); // []
  await evalOk('SENTENCES("  ")'); // []
  await evalOk('SENTENCES(" . ")'); // ["."]
  ```

- An omitted `keep` lists no tokens.

  ```ts
  await evalOk('SENTENCES("z. B. x")'); // ["z.", "B.", "x"]
  await evalOk('SENTENCES("z. B. x"; "punctuation"; LIST("z. B."))'); // ["z. B. x"]
  ```

- A split that falls inside an occurrence of a `keep` token that neither starts nor ends with whitespace, or at its end, does not happen.

  ```ts
  await evalOk('SENTENCES("Wir helfen z. B. Handwerkern.")'); // ["Wir helfen z.", "B.", "Handwerkern."]
  await evalOk('SENTENCES("Wir helfen z. B. Handwerkern."; "punctuation"; LIST("z. B."))'); // ["Wir helfen z. B. Handwerkern."]
  await evalOk('SENTENCES("Dr. Smith agreed. Done."; "punctuation"; LIST("Dr."))'); // ["Dr. Smith agreed.", "Done."]
  await evalOk('SENTENCES("Ja. B. x"; "punctuation"; LIST("B."))'); // ["Ja.", "B. x"]
  await evalOk('SENTENCES("Na ja... Gut."; "terminators"; LIST("..."))'); // ["Na ja... Gut."]
  await evalOk('SENTENCES("Na ja... Gut."; "terminators")'); // ["Na ja...", "Gut."]
  ```

- Every token of `keep` protects its occurrences, however they overlap with those of the others.

  ```ts
  await evalOk('SENTENCES("Das ist z. B. gut."; "punctuation"; LIST("z. B."; "z."))'); // ["Das ist z. B. gut."]
  await evalOk('SENTENCES("Dr. Smith kam z. B. heute."; "punctuation"; LIST("Dr."; "z. B."))'); // ["Dr. Smith kam z. B. heute."]
  await evalOk('SENTENCES("Dr. Smith kam z. B. heute."; "punctuation"; LIST("Dr."))'); // ["Dr. Smith kam z.", "B.", "heute."]
  ```

- A token that starts with a letter, mark or number counts only where no letter, mark or number directly precedes it.

  ```ts
  await evalOk('SENTENCES("Africa. Ok."; "punctuation"; LIST("ca."))'); // ["Africa.", "Ok."]
  await evalOk('SENTENCES("(ca. 5) Ok."; "punctuation"; LIST("ca."))'); // ["(ca. 5) Ok."]
  ```

- A token that starts with any other character counts wherever it occurs.

  ```ts
  await evalOk('SENTENCES("Na ja... Gut."; "terminators"; LIST("..."))'); // ["Na ja... Gut."]
  await evalOk('SENTENCES("Na ja... Gut."; "terminators"; LIST("a..."))'); // ["Na ja...", "Gut."]
  ```

- Tokens match case-sensitively.

  ```ts
  await evalOk('SENTENCES("Dr. Who"; "punctuation"; LIST("dr."))'); // ["Dr.", "Who"]
  await evalOk('SENTENCES("Dr. Who"; "punctuation"; LIST("Dr."))'); // ["Dr. Who"]
  ```

- A result of more than `maxWildcardOutputLength` (5,000) sentences raises `LIST_TOO_LARGE`.

  ```ts
  await evalErrors('SENTENCES(value)', { value: 'Ja. '.repeat(5001) }); // ["LIST_TOO_LARGE"]
  await evalOk('COUNT(SENTENCES(value))', { value: 'Ja. '.repeat(5000) }); // 5000
  ```

Unspecified: a `keep` token that starts or ends with whitespace.

### LINES

`LINES(text: text, mode?: text) -> list<text>`

- A line ends at `\r\n`, `\n`, `\r`, U+000B, U+000C, U+0085, U+2028 or U+2029.

  ```ts
  await evalOk('LINES(value)', { value: 'a\r\nb\rc\u000Bd\u000Ce\u0085f\u2028g\u2029h' }); // ["a", "b", "c", "d", "e", "f", "g", "h"]
  await evalOk('LINES(value)', { value: 'a\u001Cb\u00A0c' }); // ["a\u001cb\u00a0c"]
  ```

- Each line is returned as written, not trimmed.

  ```ts
  await evalOk('LINES(value)', { value: ' a \n\tb' }); // [" a ", "\tb"]
  await evalOk('LINES(value)', { value: 'a\nb' }); // ["a", "b"]
  ```

- A final line break ends the last line instead of starting an empty one.

  ```ts
  await evalOk('LINES(value; "all")', { value: 'a\n' }); // ["a"]
  await evalOk('LINES(value; "all")', { value: 'a\n\n' }); // ["a", ""]
  await evalOk('LINES(value; "all")', { value: '\n' }); // [""]
  ```

- `""` has no lines.

  ```ts
  await evalOk('LINES(""; "all")'); // []
  await evalOk('LINES(" "; "all")'); // [" "]
  ```

- In `"non-blank"` mode, the default, a line that is empty once trimmed of whitespace, JavaScript's `\s`, is dropped.

  ```ts
  await evalOk('LINES(value)', { value: 'a\n\n \t\u00A0\nb' }); // ["a", "b"]
  await evalOk('LINES(value; "non-blank")', { value: 'a\n\n \t\u00A0\nb' }); // ["a", "b"]
  await evalOk('LINES(value)', { value: 'a\n x \nb' }); // ["a", " x ", "b"]
  ```

- In `"all"` mode, every line is kept.

  ```ts
  await evalOk('LINES(value; "all")', { value: 'a\n\n \t\u00A0\nb' }); // ["a", "", " \t\u00a0", "b"]
  await evalOk('LINES(value)', { value: 'a\n\n \t\u00A0\nb' }); // ["a", "b"]
  ```

- A result of more than `maxWildcardOutputLength` (5,000) lines raises `LIST_TOO_LARGE`.

  ```ts
  await evalErrors('LINES(value)', { value: 'x\n'.repeat(5001) }); // ["LIST_TOO_LARGE"]
  await evalOk('COUNT(LINES(value))', { value: 'x\n'.repeat(5000) }); // 5000
  ```

Unspecified: nothing.

### LINE_COUNT

`LINE_COUNT(text: text, mode?: text) -> number`

- The result is the number of lines [LINES](#lines) returns with the same arguments.

  ```ts
  await evalOk('LINE_COUNT(value)', { value: 'a\r\nb\rc' }); // 3
  await evalOk('LINE_COUNT(value)', { value: 'a\n\n b' }); // 2
  await evalOk('LINE_COUNT(value; "all")', { value: 'a\n\n b' }); // 3
  await evalOk('LINE_COUNT("")'); // 0
  ```

- A text of more than 5,000 lines, for which `LINES` raises `LIST_TOO_LARGE`, is counted.

  ```ts
  await evalOk('LINE_COUNT(value)', { value: 'x\n'.repeat(5001) }); // 5001
  await evalOk('LINE_COUNT(value)', { value: 'x\n'.repeat(5000) }); // 5000
  ```

Unspecified: nothing.

### FIRST_CONTAINED

`FIRST_CONTAINED(text: text, phrases: list<text>, match?: text, ignoreCase?: boolean) -> text`

- The result is the first phrase of `phrases`, in list order, that occurs in `text`.

  ```ts
  await evalOk('FIRST_CONTAINED("Gut, oder? Richtig?"; LIST("Richtig?"; "oder?"))'); // "Richtig?"
  await evalOk('FIRST_CONTAINED("Gut, oder? Richtig?"; LIST("oder?"; "Richtig?"))'); // "oder?"
  await evalOk('FIRST_CONTAINED("ab"; LIST("abc"; "b"))'); // "b"
  ```

- When no phrase occurs in the text, an empty list of phrases included, the result is `null`.

  ```ts
  await evalOk('FIRST_CONTAINED("abc"; LIST("x"; "y"))'); // null
  await evalOk('FIRST_CONTAINED("abc"; LIST("x"; "c"))'); // "c"
  await evalOk('FIRST_CONTAINED("abc"; LIST())'); // null
  ```

- The result is the phrase as the list holds it.

  ```ts
  await evalOk('FIRST_CONTAINED("ABC"; LIST("b"); "substring"; TRUE)'); // "b"
  await evalOk('FIRST_CONTAINED("ABC"; LIST("B"); "substring"; TRUE)'); // "B"
  ```

- In `"substring"` mode, the default, a phrase occurs where the text holds it code unit for code unit.

  ```ts
  await evalOk('FIRST_CONTAINED("the homeowner"; LIST("owner"))'); // "owner"
  await evalOk('FIRST_CONTAINED("the homeowner"; LIST("owner"); "substring")'); // "owner"
  await evalOk('FIRST_CONTAINED("Der Geschäftsführer"; LIST("führer"))'); // "führer"
  await evalOk('FIRST_CONTAINED("the Owner"; LIST("owner"))'); // null
  await evalOk('FIRST_CONTAINED(value; LIST("\u00E9"))', { value: 'e\u0301' }); // null
  ```

- In `"word"` mode, an occurrence counts only where the characters directly before and after it are no letters, marks or numbers, or are the text's edges.

  ```ts
  await evalOk('FIRST_CONTAINED("Der Geschäftsführer"; LIST("führer"); "word")'); // null
  await evalOk('FIRST_CONTAINED("owner"; LIST("owner"); "word")'); // "owner"
  await evalOk('FIRST_CONTAINED("(owner)"; LIST("owner"); "word")'); // "owner"
  await evalOk('FIRST_CONTAINED("owner2"; LIST("owner"); "word")'); // null
  await evalOk('FIRST_CONTAINED(value; LIST("owner"); "word")', { value: 'owner\u0301' }); // null
  ```

- In `"word"` mode, a character is a code point, so a surrogate pair is one character, and a lone surrogate is a character that is no letter, mark or number.

  ```ts
  await evalOk('FIRST_CONTAINED(value; LIST("owner"); "word")', { value: '\uD800\uDC00owner' }); // null
  await evalOk('FIRST_CONTAINED(value; LIST("owner"); "word")', { value: '\uD835\uDFFFowner' }); // null
  await evalOk('FIRST_CONTAINED(value; LIST("owner"); "word")', { value: 'owner\uD835\uDC00' }); // null
  await evalOk('FIRST_CONTAINED(value; LIST("owner"); "word")', { value: '\uD83D\uDE00owner' }); // "owner"
  await evalOk('FIRST_CONTAINED(value; LIST("owner"); "word")', { value: '\uDC00owner' }); // "owner"
  await evalOk('FIRST_CONTAINED(value; LIST("owner"); "word")', { value: '\uD835aowner' }); // null
  await evalOk('FIRST_CONTAINED(value; LIST("owner"); "word")', { value: '\uD835\uFF21owner' }); // null
  ```

- In `"word"` mode, any occurrence of the phrase can be the one that counts.

  ```ts
  await evalOk('FIRST_CONTAINED("the homeowner, the owner"; LIST("owner"); "word")'); // "owner"
  await evalOk('FIRST_CONTAINED("the homeowner, the owners"; LIST("owner"); "word")'); // null
  ```

- An omitted `ignoreCase` is `FALSE`.

  ```ts
  await evalOk('FIRST_CONTAINED("ABC"; LIST("b"))'); // null
  await evalOk('FIRST_CONTAINED("ABC"; LIST("b"); "substring"; TRUE)'); // "b"
  ```

- With `ignoreCase` `TRUE`, both sides are lower-cased as [LOWER](#lower) does before they are compared.

  ```ts
  await evalOk('FIRST_CONTAINED("KENNST DU DAS?"; LIST("kennst du das?"); "substring"; TRUE)'); // "kennst du das?"
  await evalOk('FIRST_CONTAINED("KENNST DU DAS?"; LIST("kennst du das?"); "substring"; FALSE)'); // null
  await evalOk('FIRST_CONTAINED("Product Owner,"; LIST("product owner"); "word"; TRUE)'); // "product owner"
  await evalOk('FIRST_CONTAINED("STRASSE"; LIST("straße"); "substring"; TRUE)'); // null
  ```

- A phrase longer than 250 code units as it is searched for, lower-cased when `ignoreCase` is `TRUE`, raises `PHRASE_TOO_LONG`.

  ```ts
  await evalOk('LEN(FIRST_CONTAINED(value; LIST(value)))', { value: 'a'.repeat(250) }); // 250
  await evalErrors('FIRST_CONTAINED(value; LIST(value))', { value: 'a'.repeat(251) }); // ["PHRASE_TOO_LONG"]
  await evalErrors('FIRST_CONTAINED("a"; LIST("a"; value))', { value: 'a'.repeat(251) }); // ["PHRASE_TOO_LONG"]
  await evalErrors('FIRST_CONTAINED("x"; LIST(value); "word")', { value: 'a'.repeat(251) }); // ["PHRASE_TOO_LONG"]
  await evalOk('FIRST_CONTAINED("x"; LIST(value); "substring"; TRUE)', {
    value: '\u0130'.repeat(125),
  }); // null
  await evalErrors('FIRST_CONTAINED("x"; LIST(value); "substring"; TRUE)', {
    value: '\u0130'.repeat(126),
  }); // ["PHRASE_TOO_LONG"]
  await evalOk('FIRST_CONTAINED("x"; LIST(value); "substring"; FALSE)', {
    value: '\u0130'.repeat(126),
  }); // null
  ```

Unspecified: nothing.

### CONTAINS_ANY

`CONTAINS_ANY(text: text, phrases: list<text>, match?: text, ignoreCase?: boolean) -> boolean`

- The result is whether [FIRST_CONTAINED](#first_contained) finds a phrase with the same arguments.

  ```ts
  await evalOk('CONTAINS_ANY("the homeowner"; LIST("owner"))'); // true
  await evalOk('CONTAINS_ANY("the homeowner"; LIST("owner"); "word")'); // false
  await evalOk('CONTAINS_ANY("ABC"; LIST("b"); "substring"; TRUE)'); // true
  await evalOk('CONTAINS_ANY("ABC"; LIST("b"))'); // false
  await evalOk('CONTAINS_ANY("abc"; LIST())'); // false
  await evalOk('CONTAINS_ANY("abc"; LIST(""))'); // false
  ```

- A phrase longer than 250 code units as it is searched for raises `PHRASE_TOO_LONG`, as in `FIRST_CONTAINED`.

  ```ts
  await evalOk('CONTAINS_ANY(value; LIST(value))', { value: 'a'.repeat(250) }); // true
  await evalErrors('CONTAINS_ANY(value; LIST(value))', { value: 'a'.repeat(251) }); // ["PHRASE_TOO_LONG"]
  await evalErrors('CONTAINS_ANY("x"; LIST(value); "substring"; TRUE)', {
    value: '\u0130'.repeat(126),
  }); // ["PHRASE_TOO_LONG"]
  ```

Unspecified: nothing.

### MISSING_FROM

`MISSING_FROM(items: list<text>, text: text, normalise?: text) -> list<text>`

- The result is the items, in order and as listed, that `text` does not contain once both are normalised as `normalise` says.

  ```ts
  await evalOk('MISSING_FROM(LIST("b"; "x"; "a"); "abc"; "exact")'); // ["x"]
  await evalOk('MISSING_FROM(LIST("b"; "x"; "a"); "abcx"; "exact")'); // []
  await evalOk('MISSING_FROM(LIST(" x "; "y"); "abc")'); // [" x ", "y"]
  ```

- In `"whitespace"` mode, the default, both sides are trimmed and each run of whitespace, JavaScript's `\s`, becomes one space.

  ```ts
  await evalOk('MISSING_FROM(LIST("liefern schnell"; "billig"); value)', {
    value: 'Wir liefern\n  schnell.',
  }); // ["billig"]
  await evalOk('MISSING_FROM(LIST("liefern schnell"); value; "whitespace")', {
    value: 'Wir liefern\u00A0schnell.',
  }); // []
  await evalOk('MISSING_FROM(LIST(" billig "); "billig")'); // []
  await evalOk('MISSING_FROM(LIST("ab"); "a b")'); // ["ab"]
  await evalOk('MISSING_FROM(LIST("liefern schnell"); value; "exact")', {
    value: 'Wir liefern\n  schnell.',
  }); // ["liefern schnell"]
  ```

- In `"exact"` mode, both sides are compared as written.

  ```ts
  await evalOk('MISSING_FROM(LIST("Liefern"); "liefern"; "exact")'); // ["Liefern"]
  await evalOk('MISSING_FROM(LIST("liefern"); "liefern"; "exact")'); // []
  await evalOk('MISSING_FROM(LIST(" billig "); "billig"; "exact")'); // [" billig "]
  ```

- In `"loose"` mode, both sides are normalised as in `"whitespace"` mode and lower-cased as [LOWER](#lower) does.

  ```ts
  await evalOk('MISSING_FROM(LIST("Liefern  Schnell"); value; "loose")', {
    value: 'LIEFERN\nSCHNELL',
  }); // []
  await evalOk('MISSING_FROM(LIST("Liefern  Schnell"); value; "whitespace")', {
    value: 'LIEFERN\nSCHNELL',
  }); // ["Liefern  Schnell"]
  ```

- In `"loose"` mode, the quotes `‘ ’ ‚ ‛ ‹ ›` become `'`.

  ```ts
  await evalOk('MISSING_FROM(LIST("it\'s"); value; "loose")', { value: 'IT\u2019S' }); // []
  await evalOk("MISSING_FROM(LIST(\"'a' 'b' 'c'\"); value; \"loose\")", {
    value: '\u2018a\u2019 \u201Ab\u201B \u2039c\u203A',
  }); // []
  await evalOk('MISSING_FROM(LIST("it\'s"); value; "whitespace")', { value: 'it\u2019s' }); // ["it's"]
  ```

- In `"loose"` mode, the quotes `“ ” „ ‟ « »` become `"`.

  ```ts
  await evalOk('MISSING_FROM(LIST("\\"hallo\\""); value; "loose")', {
    value: 'Er sagte \u201EHallo\u201C.',
  }); // []
  await evalOk('MISSING_FROM(LIST("\\"a\\" \\"b\\" \\"c\\""); value; "loose")', {
    value: '\u201Ca\u201D \u201Eb\u201F \u00ABc\u00BB',
  }); // []
  await evalOk('MISSING_FROM(LIST("\\"hallo\\""); value; "whitespace")', {
    value: 'Er sagte \u201Ehallo\u201C.',
  }); // ["\"hallo\""]
  ```

- In `"loose"` mode, the dashes U+2010 to U+2015 and the minus sign U+2212 become `-`.

  ```ts
  await evalOk('MISSING_FROM(LIST("a-b c-d e-f"); value; "loose")', {
    value: 'A\u2010B C\u2015D E\u2212F',
  }); // []
  await evalOk('MISSING_FROM(LIST("a-b"); value; "loose")', { value: 'A\u2013B' }); // []
  await evalOk('MISSING_FROM(LIST("a-b"); value; "loose")', { value: 'A\u2016B' }); // ["a-b"]
  ```

- In `"loose"` mode, no other character is folded, so a composed and a decomposed letter stay apart.

  ```ts
  await evalOk('MISSING_FROM(LIST("\u00E9"); value; "loose")', { value: 'e\u0301' }); // ["\u00e9"]
  await evalOk('MISSING_FROM(LIST("\u00E9"); value; "loose")', { value: '\u00C9' }); // []
  ```

- An item that is empty once normalised is skipped.

  ```ts
  await evalOk('MISSING_FROM(LIST("  "; "x"); "abc")'); // ["x"]
  await evalOk('MISSING_FROM(LIST("  "; "x"); "abc"; "exact")'); // ["  ", "x"]
  ```

- An item longer than 250 code units once normalised raises `PHRASE_TOO_LONG`.

  ```ts
  await evalOk('MISSING_FROM(LIST(value); value; "exact")', { value: 'a'.repeat(250) }); // []
  await evalErrors('MISSING_FROM(LIST(value); value; "exact")', { value: 'a'.repeat(251) }); // ["PHRASE_TOO_LONG"]
  await evalOk('MISSING_FROM(LIST(value); "a b")', { value: 'a' + ' '.repeat(300) + 'b' }); // []
  await evalErrors('MISSING_FROM(LIST(value); "a b"; "exact")', {
    value: 'a' + ' '.repeat(300) + 'b',
  }); // ["PHRASE_TOO_LONG"]
  ```

Unspecified: nothing.

### PLAIN_TEXT

`PLAIN_TEXT(markup: text, format: text) -> text`

- The result is the text of `markup`, read as `format` says, one line for each block.

  ```ts
  await evalOk('PLAIN_TEXT("<p>A&amp;B</p><p>C&nbsp;D</p>"; "html")'); // "A&B\nC D"
  await evalOk('PLAIN_TEXT("<span>A&amp;B</span><span>C&nbsp;D</span>"; "html")'); // "A&BC D"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '# Titel\n\nZeile  eins\nZeile zwei' }); // "Titel\nZeile eins Zeile zwei"
  ```

- Within each line, each run of whitespace, JavaScript's `\s`, becomes one space, and the line is trimmed.

  ```ts
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<p> a \t b\u00A0 </p>' }); // "a b"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<pre> a\n b </pre>' }); // "a\nb"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '  a \t b  ' }); // "a b"
  ```

- A line that is empty once trimmed is dropped.

  ```ts
  await evalOk('PLAIN_TEXT("<div>  </div>x"; "html")'); // "x"
  await evalOk('PLAIN_TEXT("<div>w</div>x"; "html")'); // "w\nx"
  await evalOk('PLAIN_TEXT(""; "html")'); // ""
  ```

- In `"html"`, a tag runs from `<` followed by an ASCII letter, or `</` followed by one, to the first `>` outside a quoted attribute value, and is removed.

  ```ts
  await evalOk('PLAIN_TEXT("<b>bold</b> x"; "html")'); // "bold x"
  await evalOk('PLAIN_TEXT("<1>x"; "html")'); // "<1>x"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<a href="x" title="a > b">link</a>' }); // "link"
  await evalOk('PLAIN_TEXT("<a b=>x"; "html")'); // "x"
  ```

- In `"html"`, a quoted attribute value is one in double or single quotes that directly follows an attribute name and `=`, with spaces, tabs, line breaks or form feeds allowed around the `=`.

  ```ts
  await evalOk('PLAIN_TEXT(value; "html")', { value: "<a title='a > b'>x</a>" }); // "x"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<a title = "a > b">x</a>' }); // "x"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<a title\t=\n"a > b">x</a>' }); // "x"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<a b=c d="x>y">z' }); // "z"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<a "b>c">d' }); // "c\">d"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<a b=="x>y">z' }); // "y\">z"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<a /="x>y">z' }); // "y\">z"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<a b/="x>y">z' }); // "y\">z"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<a title="it\'s > b">x</a>' }); // "x"
  ```

- In `"html"`, tag names are read in either letter case.

  ```ts
  await evalOk('PLAIN_TEXT("<P>a</P>b"; "html")'); // "a\nb"
  await evalOk('PLAIN_TEXT("<Q>a</Q>b"; "html")'); // "ab"
  await evalOk('PLAIN_TEXT("a<SCRIPT>x</SCRIPT>b"; "html")'); // "ab"
  ```

- In `"html"`, a `<` followed by anything but an ASCII letter, `/`, `!` or `?`, or at the end of the markup, is text.

  ```ts
  await evalOk('PLAIN_TEXT("1 < 2 and a <3 <"; "html")'); // "1 < 2 and a <3 <"
  await evalOk('PLAIN_TEXT("1 <b 2"; "html")'); // "1"
  ```

- In `"html"`, a comment, from `<!--` to the next `-->` or `--!>` after it, is dropped.

  ```ts
  await evalOk('PLAIN_TEXT("a<!-- <p>x</p> -->b"; "html")'); // "ab"
  await evalOk('PLAIN_TEXT("a<p>x</p>b"; "html")'); // "a\nx\nb"
  await evalOk('PLAIN_TEXT("a<!-- x --->b"; "html")'); // "ab"
  await evalOk('PLAIN_TEXT("a<!-- x --!>b<!-- y --!z -->c"; "html")'); // "abc"
  await evalOk('PLAIN_TEXT("a<!---!>b"; "html")'); // "a"
  ```

- In `"html"`, `<!-->` and `<!--->` are whole comments.

  ```ts
  await evalOk('PLAIN_TEXT("a<!-->b-->c"; "html")'); // "ab-->c"
  await evalOk('PLAIN_TEXT("a<!--->b-->c"; "html")'); // "ab-->c"
  await evalOk('PLAIN_TEXT("a<!-- >b-->c"; "html")'); // "ac"
  ```

- In `"html"`, any other `<!` or `<?` is dropped up to the next `>`, as a document type or a processing instruction is.

  ```ts
  await evalOk('PLAIN_TEXT(value; "html")', {
    value: "<!DOCTYPE html><?xml version='1.0'?><p>x</p>",
  }); // "x"
  await evalOk('PLAIN_TEXT("a<!b>c"; "html")'); // "ac"
  await evalOk('PLAIN_TEXT("a<!>b>c"; "html")'); // "ab>c"
  await evalOk('PLAIN_TEXT("a!b>c"; "html")'); // "a!b>c"
  ```

- In `"html"`, the content of `script`, `style` and `title` is dropped up to the element's end tag, written in any letter case.

  ```ts
  await evalOk(
    'PLAIN_TEXT("a<script>if (x < 1) {}</script>b<style>p{}</style>c<title>T</title>d"; "html")',
  ); // "abcd"
  await evalOk('PLAIN_TEXT("a<span>x</span>b"; "html")'); // "axb"
  await evalOk('PLAIN_TEXT("a<SCRIPT>x</ScRiPt>b"; "html")'); // "ab"
  ```

- In `"html"`, nothing but the element's own end tag, its name followed by a space, a tab, a line break, a form feed, `/` or `>`, ends that content.

  ```ts
  await evalOk('PLAIN_TEXT(value; "html")', { value: 'a<style></script>x</style>b' }); // "ab"
  await evalOk('PLAIN_TEXT(value; "html")', { value: 'a<style></style>x</style>b' }); // "axb"
  await evalOk('PLAIN_TEXT(value; "html")', { value: 'a<script></scripts>x</script >b' }); // "ab"
  await evalOk('PLAIN_TEXT(value; "html")', { value: 'a<script>x</script\f>b<title>t</title/>c' }); // "abc"
  await evalOk('PLAIN_TEXT(value; "html")', { value: "a<script>'</p>'</script>b" }); // "ab"
  await evalOk('PLAIN_TEXT("a<script><!--<script></script>-->b</script>c"; "html")'); // "a-->bc"
  ```

- In `"html"`, while the document is in its head, the content of `noscript`, `noframes` and `template` is dropped up to the element's end tag, as for `script`.

  ```ts
  await evalOk('PLAIN_TEXT(value; "html")', {
    value: '<head><noscript>N</noscript><noframes>F</noframes><template>T</template></head>x',
  }); // "x"
  await evalOk('PLAIN_TEXT("<p>a</p><noscript>N</noscript>"; "html")'); // "a\nN"
  ```

- In `"html"`, the document is in its head from its start.

  ```ts
  await evalOk('PLAIN_TEXT("<noscript>N</noscript>x"; "html")'); // "x"
  await evalOk('PLAIN_TEXT("x<noscript>N</noscript>"; "html")'); // "xN"
  ```

- In `"html"`, text other than spaces, tabs, line breaks and form feeds, a character reference included, ends the head.

  ```ts
  await evalOk('PLAIN_TEXT(value; "html")', { value: ' \t\n\f<noscript>N</noscript>x' }); // "x"
  await evalOk('PLAIN_TEXT("<head>x<noscript>N</noscript></head>"; "html")'); // "xN"
  await evalOk('PLAIN_TEXT("&nbsp;<head><noscript>N</noscript></head>x"; "html")'); // "Nx"
  ```

- In `"html"`, the start tag of an element other than `html`, `head` and those that belong in a head, `base`, `basefont`, `bgsound`, `link`, `meta`, `noframes`, `noscript`, `script`, `style`, `template` and `title`, ends the head.

  ```ts
  await evalOk('PLAIN_TEXT("<span></span><noscript>N</noscript>"; "html")'); // "N"
  await evalOk('PLAIN_TEXT(value; "html")', {
    value:
      '<html><head><base><basefont><bgsound><link><meta><noframes></noframes><script></script><style></style><template></template><title></title><noscript>N</noscript></head><body><p>B</p></body></html>',
  }); // "B"
  ```

- In `"html"`, the end tags `</head>`, `</body>`, `</html>` and `</br>` end the head, and no other end tag does.

  ```ts
  await evalOk('PLAIN_TEXT("<head></head><noscript>N</noscript>"; "html")'); // "N"
  await evalOk('PLAIN_TEXT("</body><noscript>N</noscript>"; "html")'); // "N"
  await evalOk('PLAIN_TEXT("</html><noscript>N</noscript>"; "html")'); // "N"
  await evalOk('PLAIN_TEXT("</br><noscript>N</noscript>"; "html")'); // "N"
  await evalOk('PLAIN_TEXT("</p><noscript>N</noscript>x"; "html")'); // "x"
  ```

- In `"html"`, once the head has ended, it does not open again.

  ```ts
  await evalOk('PLAIN_TEXT("<p>a</p><head><noscript>N</noscript>"; "html")'); // "a\nN"
  await evalOk('PLAIN_TEXT("<head><noscript>N</noscript>"; "html")'); // ""
  ```

- In `"html"`, `address`, `article`, `aside`, `blockquote`, `br`, `dd`, `div`, `dl`, `dt`, `figcaption`, `figure`, `footer`, `h1` to `h6`, `header`, `hr`, `li`, `main`, `nav`, `ol`, `p`, `pre`, `section`, `table`, `td`, `th`, `tr` and `ul` end a line where they open and where they close, and no other tag does.

  ```ts
  await evalOk('PLAIN_TEXT("<ul><li>a</li><li>b</li></ul>x<br>y<hr>z"; "html")'); // "a\nb\nx\ny\nz"
  await evalOk('PLAIN_TEXT("<table><tr><td>1</td><td>2</td></tr></table>"; "html")'); // "1\n2"
  await evalOk('LINE_COUNT(PLAIN_TEXT(value; "html"))', {
    value:
      'address article aside blockquote dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header li main nav ol p pre section table td th tr ul'
        .split(' ')
        .map((name) => `x<${name}>y</${name}>`)
        .join('') + 'x<br>x<hr>x',
  }); // 63
  await evalOk('LINE_COUNT(PLAIN_TEXT(value; "html"))', { value: 'x<span>y</span>x<b>y</b>x' }); // 1
  ```

- In `"html"`, outside `pre`, a line break in the markup is whitespace.

  ```ts
  await evalOk('PLAIN_TEXT(value; "html")', { value: 'a\n  b\t c' }); // "a b c"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<pre>a\nb</pre>' }); // "a\nb"
  ```

- In `"html"`, inside `pre`, a nested one included, each line break, `\n`, `\r` or `\r\n`, written in the markup or given by a character reference, ends a line.

  ```ts
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<pre>a\nb</pre>c\nd' }); // "a\nb\nc d"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<pre>a\r\nb\rc</pre>' }); // "a\nb\nc"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<pre><pre>a</pre>b\nc</pre>d\ne' }); // "a\nb\nc\nd e"
  await evalOk('PLAIN_TEXT("<pre>a&#10;b&#13;c</pre>d&#10;e"; "html")'); // "a\nb\nc\nd e"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '</pre>a\nb' }); // "a b"
  ```

- In `"html"`, a numeric reference, decimal or hexadecimal with `x` or `X`, of one digit or more, leading zeros included, and its closing `;`, gives its code point.

  ```ts
  await evalOk('PLAIN_TEXT("&#65;&#x42;&#X43;&#0067;"; "html")'); // "ABCC"
  await evalOk('PLAIN_TEXT("&#65 &#x41 &#; &#x;"; "html")'); // "&#65 &#x41 &#; &#x;"
  ```

- In `"html"`, a numeric reference to zero, to a surrogate or past U+10FFFF gives U+FFFD.

  ```ts
  await evalOk('PLAIN_TEXT("&#0;&#xD800;&#xDFFF;&#x110000;&#99999999999;"; "html")'); // "\ufffd\ufffd\ufffd\ufffd\ufffd"
  await evalOk('PLAIN_TEXT("&#1;&#xD7FF;&#xE000;&#x10FFFF;"; "html")'); // "\u0001\ud7ff\ue000\udbff\udfff"
  ```

- In `"html"`, a numeric reference from 128 to 159 gives the windows-1252 character where that encoding has one, and the C1 control otherwise.

  ```ts
  await evalOk('PLAIN_TEXT(value; "html")', {
    value: Array.from({ length: 32 }, (_, index) => `&#${128 + index};`).join(''),
  }); // "\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178"
  await evalOk('PLAIN_TEXT("&#127;&#161;"; "html")'); // "\u007f\u00a1"
  ```

- In `"html"`, the 252 named references of HTML 4 give the characters the HTML standard's table maps them to, `&lang;` and `&rang;` U+27E8 and U+27E9.

  ```ts
  await evalOk('PLAIN_TEXT("&auml;&euro;&lang;x&rang;"; "html")'); // "ä€\u27e8x\u27e9"
  await evalOk('PLAIN_TEXT("&Auml;&EURO;"; "html")'); // "Ä&EURO;"
  ```

- In `"html"`, a named reference without its closing `;` stays as written.

  ```ts
  await evalOk('PLAIN_TEXT("&amp &auml"; "html")'); // "&amp &auml"
  await evalOk('PLAIN_TEXT("&amp; &auml;"; "html")'); // "& ä"
  ```

- In `"html"`, a name that is no HTML 4 name stays as written.

  ```ts
  await evalOk('PLAIN_TEXT("&foo; &AMP; &apos;"; "html")'); // "&foo; &AMP; &apos;"
  await evalOk('PLAIN_TEXT("&quot; &amp;"; "html")'); // "\" &"
  ```

- In `"html"`, each reference is decoded once.

  ```ts
  await evalOk('PLAIN_TEXT("&amp;amp; &amp;#65;"; "html")'); // "&amp; &#65;"
  await evalOk('PLAIN_TEXT("&amp; &#65;"; "html")'); // "& A"
  ```

- In `"html"`, markup that ends inside a tag, a comment, a `<!` or `<?`, or dropped content loses that unfinished part.

  ```ts
  await evalOk('PLAIN_TEXT("Hello <b x"; "html")'); // "Hello"
  await evalOk('PLAIN_TEXT("Hello <b> x"; "html")'); // "Hello x"
  await evalOk('PLAIN_TEXT("a<!-- x"; "html")'); // "a"
  await evalOk('PLAIN_TEXT("a<!DOCTYPE"; "html")'); // "a"
  await evalOk('PLAIN_TEXT("a<?x"; "html")'); // "a"
  await evalOk('PLAIN_TEXT("a<script>x"; "html")'); // "a"
  await evalOk('PLAIN_TEXT(value; "html")', { value: 'a<script>x</script b="y' }); // "a"
  ```

- In `"html"`, the result is plain text, so a reference to `<` gives `<`.

  ```ts
  await evalOk('PLAIN_TEXT("&lt;b&gt;"; "html")'); // "<b>"
  await evalOk('PLAIN_TEXT("<b>"; "html")'); // ""
  ```

- In `"markdown"`, each block that [MARKDOWN_BLOCKS](#markdown_blocks) reads, but a fenced code block, gives one line, in document order.

  ```ts
  await evalOk('PLAIN_TEXT("## Titel"; "markdown")'); // "Titel"
  await evalOk('PLAIN_TEXT("> zitat"; "markdown")'); // "zitat"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '- a\n1. b\n2) c' }); // "a\nb\nc"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '| A | B |\n|---|---|\n| 1 | 2 |' }); // "A B\n1 2"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: 'p\n| A |\n|---|\n| 1 |' }); // "p\nA\n1"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: 'a\nb' }); // "a b"
  ```

- In `"markdown"`, each line of a fenced code block is a line of its own.

  ````ts
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '```\na\nb\n```' }); // "a\nb"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '```\na\n\nb\n```' }); // "a\nb"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: 'a\nb' }); // "a b"
  ````

- In `"markdown"`, no inline rule applies to the lines of a fenced code block.

  ````ts
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '```\n\\*a\\* `c` [t](u)\n```' }); // "\\*a\\* `c` [t](u)"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '\\*a\\* `c` [t](u)' }); // "*a* c t"
  ````

- In `"markdown"`, a run of `*` or `_` is left-flanking when the character after it is not whitespace, and is not punctuation unless the character before the run is whitespace or punctuation.

  ```ts
  await evalOk('PLAIN_TEXT("*a*"; "markdown")'); // "a"
  await evalOk('PLAIN_TEXT("x * a*"; "markdown")'); // "x * a*"
  await evalOk('PLAIN_TEXT("a*(b)*"; "markdown")'); // "a*(b)*"
  await evalOk('PLAIN_TEXT(" *(b)*"; "markdown")'); // "(b)"
  ```

- In `"markdown"`, a run of `*` or `_` is right-flanking when the character before it is not whitespace, and is not punctuation unless the character after the run is whitespace or punctuation.

  ```ts
  await evalOk('PLAIN_TEXT("*a *"; "markdown")'); // "*a *"
  await evalOk('PLAIN_TEXT("*(b)*a"; "markdown")'); // "*(b)*a"
  await evalOk('PLAIN_TEXT("*(b)* "; "markdown")'); // "(b)"
  ```

- In `"markdown"`, whitespace is JavaScript's `\s` or the edge of the text, and punctuation a character of Unicode's P or S categories.

  ```ts
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '*\u00A0a*' }); // "* a*"
  await evalOk('PLAIN_TEXT("a*€b€*c"; "markdown")'); // "a*€b€*c"
  await evalOk('PLAIN_TEXT("a*b*c"; "markdown")'); // "abc"
  ```

- In `"markdown"`, a `*` run can open emphasis when it is left-flanking and close it when it is right-flanking.

  ```ts
  await evalOk('PLAIN_TEXT("2*3*4"; "markdown")'); // "234"
  await evalOk('PLAIN_TEXT("2 * 3 * 4"; "markdown")'); // "2 * 3 * 4"
  ```

- In `"markdown"`, a `_` run can open emphasis when it is left-flanking and either not right-flanking or after punctuation.

  ```ts
  await evalOk('PLAIN_TEXT("_a_"; "markdown")'); // "a"
  await evalOk('PLAIN_TEXT("snake_case_x"; "markdown")'); // "snake_case_x"
  await evalOk('PLAIN_TEXT("(_(a)_)"; "markdown")'); // "((a))"
  await evalOk('PLAIN_TEXT("a_(a)_a"; "markdown")'); // "a_(a)_a"
  await evalOk('PLAIN_TEXT("_ a_"; "markdown")'); // "_ a_"
  ```

- In `"markdown"`, a `_` run can close emphasis when it is right-flanking and either not left-flanking or before punctuation.

  ```ts
  await evalOk('PLAIN_TEXT("_a_."; "markdown")'); // "a."
  await evalOk('PLAIN_TEXT("_a_b"; "markdown")'); // "_a_b"
  await evalOk('PLAIN_TEXT("_a _"; "markdown")'); // "_a _"
  ```

- In `"markdown"`, a run that can close is removed with the nearest earlier run of the same character that can open, whatever their lengths.

  ```ts
  await evalOk('PLAIN_TEXT("**bold** and __b__"; "markdown")'); // "bold and b"
  await evalOk('PLAIN_TEXT("**a*"; "markdown")'); // "a"
  await evalOk('PLAIN_TEXT("**a_"; "markdown")'); // "**a_"
  ```

- In `"markdown"`, the runs of the other character opened between the two pair no more.

  ```ts
  await evalOk('PLAIN_TEXT("*a _b* c_"; "markdown")'); // "a _b c_"
  await evalOk('PLAIN_TEXT("*a _b_ c*"; "markdown")'); // "a b c"
  await evalOk('PLAIN_TEXT("_a *b* c_"; "markdown")'); // "a b c"
  ```

- In `"markdown"`, a run that pairs with none stays.

  ```ts
  await evalOk('PLAIN_TEXT("snake_case * x **a"; "markdown")'); // "snake_case * x **a"
  await evalOk('PLAIN_TEXT("**a**"; "markdown")'); // "a"
  ```

- In `"markdown"`, a run of backticks pairs with the next run of exactly as many, and the code span between them keeps its text as written.

  ```ts
  await evalOk('PLAIN_TEXT("Use `a*b*c` here"; "markdown")'); // "Use a*b*c here"
  await evalOk('PLAIN_TEXT("Use a*b*c here"; "markdown")'); // "Use abc here"
  await evalOk('PLAIN_TEXT("`` a ` b ``"; "markdown")'); // "a ` b"
  ```

- In `"markdown"`, a code span that starts and ends with a space and holds more than whitespace loses one space at each end.

  ```ts
  await evalOk('PLAIN_TEXT("x` a `y"; "markdown")'); // "xay"
  await evalOk('PLAIN_TEXT("x`a `y"; "markdown")'); // "xa y"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: 'x` \t `y' }); // "x y"
  ```

- In `"markdown"`, other whitespace at the ends of a code span, a tab or a no-break space, stays.

  ```ts
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: 'a`\tx\t`b c`\u00A0y\u00A0`d' }); // "a x b c y d"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: 'a` x `b' }); // "axb"
  ```

- In `"markdown"`, a run of backticks with no partner stays.

  ```ts
  await evalOk('PLAIN_TEXT("`x"; "markdown")'); // "`x"
  await evalOk('PLAIN_TEXT("``x`"; "markdown")'); // "``x`"
  await evalOk('PLAIN_TEXT("`x`"; "markdown")'); // "x"
  ```

- In `"markdown"`, a backslash before an ASCII punctuation character is removed.

  ```ts
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '\\*a\\* \\\\' }); // "*a* \\"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: 'a\\b \\\u00E4' }); // "a\\b \\\u00e4"
  ```

- In `"markdown"`, a backtick that a backslash escapes is text and takes no part in a run of backticks.

  ```ts
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '\\``x`' }); // "`x"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '\\``x' }); // "``x"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '``x`' }); // "``x`"
  ```

- In `"markdown"`, inside a code span or an autolink, a backslash stays.

  ```ts
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '`\\*`' }); // "\\*"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '<https://x.de/a\\_b>' }); // "https://x.de/a\\_b"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '\\*' }); // "*"
  ```

- In `"markdown"`, an inline link `[text](url)` gives `text`, and an image `![alt](url)` gives `alt`, for text of at most 1,000 code units and a destination of at most 2,000.

  ```ts
  await evalOk('PLAIN_TEXT("[Link](https://x) and ![Bild](b.png)"; "markdown")'); // "Link and Bild"
  await evalOk('PLAIN_TEXT("[Link] (https://x)"; "markdown")'); // "[Link] (https://x)"
  await evalOk('LEN(PLAIN_TEXT(value; "markdown"))', { value: '[' + 'a'.repeat(1000) + '](u)' }); // 1000
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '[a](' + 'u'.repeat(2000) + ')' }); // "a"
  ```

- In `"markdown"`, link text may hold brackets nested one level deep, in pairs of at most 500 code units.

  ```ts
  await evalOk('PLAIN_TEXT("[a [b] c](u)"; "markdown")'); // "a [b] c"
  await evalOk('PLAIN_TEXT("[a [b [c]] d](u)"; "markdown")'); // "[a [b [c]] d](u)"
  await evalOk('LEN(PLAIN_TEXT(value; "markdown"))', { value: '[[' + 'b'.repeat(500) + ']](u)' }); // 502
  ```

- In `"markdown"`, a destination may hold parentheses nested one level deep, in pairs of at most 500 code units.

  ```ts
  await evalOk('PLAIN_TEXT("[x](u (v))"; "markdown")'); // "x"
  await evalOk('PLAIN_TEXT("[x](u (v (w)))"; "markdown")'); // "[x](u (v (w)))"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '[x](u(' + 'v'.repeat(500) + '))' }); // "x"
  ```

- In `"markdown"`, an escaped bracket in link text is a bracket all the same.

  ```ts
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '[a \\[b] c](u)' }); // "a [b] c"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '[a \\[b c](u)' }); // "[a [b c](u)"
  ```

- In `"markdown"`, `[text][ref]` and a `[ref]: url` line are no links and stay as text, brackets included.

  ```ts
  await evalOk('PLAIN_TEXT("[t][r]"; "markdown")'); // "[t][r]"
  await evalOk('PLAIN_TEXT("[*a*][r]"; "markdown")'); // "[a][r]"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '[r]: https://x' }); // "[r]: https://x"
  await evalOk('PLAIN_TEXT("[t](r)"; "markdown")'); // "t"
  ```

- In `"markdown"`, `<url>` gives `url` when its scheme is a letter followed by letters, digits, `+`, `.` or `-`, 2 to 32 characters in all, and the rest after its `:`, at most 2,000 code units, holds no whitespace, `<` or `>`.

  ```ts
  await evalOk('PLAIN_TEXT("<https://x.de> <HTTP://y.de> <a+b.c-d:x>"; "markdown")'); // "https://x.de HTTP://y.de a+b.c-d:x"
  await evalOk('PLAIN_TEXT("<x:y> <ab:c d> <1a:b>"; "markdown")'); // "<x:y> <ab:c d> <1a:b>"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '<ab:c\td>' }); // "<ab:c d>"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '<' + 'a'.repeat(32) + ':x>' }); // "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:x"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '<' + 'a'.repeat(33) + ':x>' }); // "<aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:x>"
  await evalOk('LEN(PLAIN_TEXT(value; "markdown"))', { value: '<ab:' + 'x'.repeat(2000) + '>' }); // 2003
  ```

- In `"markdown"`, `<name@host>` gives `name@host` when neither side, at most 256 code units, holds whitespace, `<`, `>` or `@`.

  ```ts
  await evalOk('PLAIN_TEXT("<a@b.de>"; "markdown")'); // "a@b.de"
  await evalOk('PLAIN_TEXT("<a b@c.de> <a@b@c>"; "markdown")'); // "<a b@c.de> <a@b@c>"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '<a\tb@c.de>' }); // "<a b@c.de>"
  await evalOk('LEN(PLAIN_TEXT(value; "markdown"))', { value: '<' + 'a'.repeat(256) + '@b>' }); // 258
  ```

- In `"markdown"`, text outside the markup these rules name, and outside raw HTML and character references, stays as written.

  ```ts
  await evalOk('PLAIN_TEXT("a + b = c! ~ ^ % $"; "markdown")'); // "a + b = c! ~ ^ % $"
  await evalOk('PLAIN_TEXT("a + *b* = c!"; "markdown")'); // "a + b = c!"
  ```

Unspecified: in `"html"`, `</` followed by anything but an ASCII letter, and in `"markdown"`, raw HTML and character references, link text of more than 1,000 code units, a destination of more than 2,000, a nested pair of more than 500, and an autolink of more than 2,000 code units after its scheme's `:` or of more than 256 on a side of an address's `@`.

### MARKDOWN_BLOCKS

`MARKDOWN_BLOCKS(text: text, kind: text) -> list<text>`

- The result is the blocks of `kind`, in document order, each without its markers.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "heading-2")', { value: '# A\n## B\n## C' }); // ["B", "C"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading-3")', { value: '# A\n## B\n## C' }); // []
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '- a\n\ntext\n\n- b' }); // ["a", "b"]
  ```

- `"heading"` selects the headings of every level, and `"heading-1"` to `"heading-6"` those of one level.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', {
    value: '# 1\n## 2\n### 3\n#### 4\n##### 5\n###### 6',
  }); // ["1", "2", "3", "4", "5", "6"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading-1")', {
    value: '# 1\n## 2\n### 3\n#### 4\n##### 5\n###### 6',
  }); // ["1"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading-2")', {
    value: '# 1\n## 2\n### 3\n#### 4\n##### 5\n###### 6',
  }); // ["2"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading-3")', {
    value: '# 1\n## 2\n### 3\n#### 4\n##### 5\n###### 6',
  }); // ["3"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading-4")', {
    value: '# 1\n## 2\n### 3\n#### 4\n##### 5\n###### 6',
  }); // ["4"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading-5")', {
    value: '# 1\n## 2\n### 3\n#### 4\n##### 5\n###### 6',
  }); // ["5"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading-6")', {
    value: '# 1\n## 2\n### 3\n#### 4\n##### 5\n###### 6',
  }); // ["6"]
  ```

- Each block but a code block has its inline markup removed as [PLAIN_TEXT](#plain_text) removes it.

  ````ts
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '- **bold** [l](u)' }); // ["bold l"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '```\n**bold** [l](u)\n```' }); // ["**bold** [l](u)"]
  ````

- In each block but a code block, each run of whitespace, JavaScript's `\s`, becomes one space, and the text is trimmed.

  ````ts
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', { value: '#  a\u00A0\t b  ' }); // ["a b"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '```\n a\u00A0\t b \n```' }); // [" a\u00a0\t b "]
  ````

- A line ends at `\n`, `\r` or `\r\n`, and U+2028 and U+2029 end none.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\r\rb\r\nc\n\nd' }); // ["a", "b c", "d"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\u2028\u2028b\u2029\u2029c' }); // ["a b c"]
  ```

- A blank line, empty or of whitespace only, ends the open block.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\n \t\nb' }); // ["a", "b"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\n \tb' }); // ["a b"]
  ```

- Each line outside a fenced block is read as the first of these that it is, a blank line, an opening fence, a thematic break, a heading, a list item, a row of an open table, the header row of a table, and otherwise text of the open paragraph or list item.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '- - -' }); // []
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '- - x' }); // ["- x"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', { value: '# - a' }); // ["- a"]
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '- # a' }); // ["# a"]
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: '| a |\n|---|\n---\n| b |' }); // ["a"]
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: '| a |\n|---|\n--\n| b |' }); // ["a", "--", "b"]
  ```

- Outside a fenced block, a line that starts with a quote marker, up to three spaces, `>` and one optional space, is read without it, again for each level of nesting.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: '> > zitat\n>weiter' }); // ["zitat weiter"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', { value: '   > # h' }); // ["h"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: '    > x' }); // ["> x"]
  ```

- A tab after `>` is no part of the quote marker and stays in the line.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '>~~~\n>\tcode\n>~~~' }); // ["\tcode"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '>~~~\n> code\n>~~~' }); // ["code"]
  ```

- Inside a fenced block, a line loses only as many quote markers as the line of its opening fence had.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '> ~~~\n> > x\n> ~~~' }); // ["> x"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '> ~~~\n> x\n> ~~~' }); // ["x"]
  ```

- A heading is one to six `#` after at most three spaces, followed by a space, a tab or the end of the line.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', { value: '# Titel\n   ### drei\n#\n#\tTab' }); // ["Titel", "drei", "", "Tab"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', { value: '# ' }); // [""]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', {
    value: '#x\n####### x\n    # vier\n\t# tab',
  }); // ["#x ####### x # vier # tab"]
  ```

- A heading's text is the rest of its line less a closing run of `#` that follows a space or a tab, together with the spaces and tabs before that run.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', { value: '# Titel #\n# a ##  \n# #' }); // ["Titel", "a", ""]
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', { value: '# Titel#\n# C#' }); // ["Titel#", "C#"]
  ```

- There are no headings underlined with `===` or `---`.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', { value: 'Titel\n===' }); // []
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'Titel\n===' }); // ["Titel ==="]
  ```

- A code fence opens at three or more backticks or tildes after any number of spaces or tabs.

  ````ts
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '```js\nconst a = 1;\n```' }); // ["const a = 1;"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '      ~~~\nx\n~~~' }); // ["x"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '\t~~~\nx\n~~~' }); // ["x"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '``\nx\n``' }); // []
  ````

- A backtick fence opens only where the rest of its line holds no backtick.

  ````ts
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: '``` a`b\nx' }); // ["``` a`b x"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '``` ab\nx' }); // ["x"]
  ````

- A fenced block runs to a closing line of at least as many of the opening fence's character, with only spaces or tabs around them.

  `````ts
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '```\nx\n``\n```' }); // ["x\n``"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '```\nx\n\t````  ' }); // ["x"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '```\nx\n~~~\n```' }); // ["x\n~~~"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '```\nx\n``` y\n```' }); // ["x\n``` y"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '````\na\n  ```\nb\n````' }); // ["a\n  ```\nb"]
  `````

- Each line of a fenced block loses up to as many leading spaces as there are spaces and tabs before its opening fence.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '  ~~~\n  a\n   b\n c\n  ~~~~' }); // ["a\n b\nc"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '\t~~~\n  a\n~~~' }); // [" a"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '~~~\n  a\n~~~' }); // ["  a"]
  ```

- A fence that is never closed runs to the end of the text.

  ````ts
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '```\na\nb' }); // ["a\nb"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '```\na\n```\nb' }); // ["a"]
  ````

- A thematic break, three or more of one of `-`, `*` and `_` after at most three spaces, with spaces or tabs between and after them, ends the open block and gives no block.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', {
    value: 'a\n---\nb\n* * *\nc\n   ___\nd\n-\t-\t-',
  }); // ["a", "b", "c", "d"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\n--\nb\n    ---\nc\n-*-' }); // ["a -- b --- c -*-"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\n--- \nb' }); // ["a", "b"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\n---x' }); // ["a ---x"]
  ```

- A list item starts with `-`, `*`, `+`, or one to nine digits and `.` or `)`, after any spaces or tabs, followed by a space, a tab or the end of the line.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', {
    value: '- a\n  - b\n\t- c\n3) d\n+ e\n123456789. f\n*\tg',
  }); // ["a", "b", "c", "d", "e", "f", "g"]
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '-x\n1234567890. y\n1.y' }); // []
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: '- ' }); // []
  ```

- A list item's text runs on over the lines after it up to a blank line or a line that starts another block.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '- a\nmore\n- b' }); // ["a more", "b"]
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '- a\n\nmore\n- b' }); // ["a", "b"]
  ```

- A nested item is an item of its own.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '- a\n  - b' }); // ["a", "b"]
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '- a\n  b' }); // ["a b"]
  ```

- An item whose text is empty once its inline markup is removed gives no block.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '-\n\n- y' }); // ["y"]
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '- [](u)\n- y' }); // ["y"]
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '-\nfoo\n\n- y' }); // ["foo", "y"]
  ```

- A list item ends a paragraph only when it has text and, if ordered, its number is 1.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: 'Text\n- a' }); // ["a"]
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: 'Text\n1. eins' }); // ["eins"]
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: 'Text\n01. eins' }); // ["eins"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'Text\n2. zwei\n0. null\n-' }); // ["Text 2. zwei 0. null -"]
  ```

- A table starts at a line that holds `|` and whose next line, also holding `|`, is a delimiter row of one cell for each header cell.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: '| A | B |\n|---|---|\n| 1 | 2 |' }); // ["A B", "1 2"]
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: '| A | B |\n|---|\n| 1 | 2 |' }); // []
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: 'Name\n|---|' }); // []
  ```

- A delimiter cell is one or more dashes with an optional colon at either end.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: '| A | B | C |\n|:-|-:|:-:|' }); // ["A B C"]
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: '| A |\n|:|' }); // []
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: '| A |\n| x |' }); // []
  ```

- A table ends the paragraph it starts in.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', {
    value: 'Text\n| A | B |\n|---|---|\n| 1 | 2 |\n\nnach',
  }); // ["Text", "nach"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', {
    value: 'Text\n| A | B |\n| 1 | 2 |\n\nnach',
  }); // ["Text | A | B | | 1 | 2 |", "nach"]
  ```

- A table runs to a blank line or to a line that starts a heading, a list item, a fence or a thematic break, and every line before it is a row.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', {
    value: '| A |\n|---|\n| 1 |\nx\n# H\n| 3 |',
  }); // ["A", "1", "x"]
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: '| A |\n|---|\n| 1 |\n\nx' }); // ["A", "1"]
  ```

- Each row but the delimiter row, the header row included, gives a block of its cells, trimmed, the non-empty ones joined by one space.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', {
    value: '| A | B |\n|---|:-:|\n| 1 |  |\n|  x | y  |',
  }); // ["A B", "1", "x y"]
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: '| A | B |\n|---|---|\n|  |  |' }); // ["A B", ""]
  ```

- Cells past the header's count are dropped.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', {
    value: '| A | B |\n|---|---|\n| 1 | 2 | 3 |',
  }); // ["A B", "1 2"]
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', {
    value: '| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |',
  }); // ["A B C", "1 2 3"]
  ```

- A `\|` inside a cell is a pipe.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: '| A |\n|---|\n| x\\|y |' }); // ["A", "x|y"]
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: '| A |\n|---|\n| x|y |' }); // ["A", "x"]
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: '| A |\n|---|\n| x\\y |' }); // ["A", "x\\y"]
  ```

- A row's leading `|` is dropped, and so is its trailing `|` unless a backslash precedes it.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: 'A | B\n---|---\n1 | 2' }); // ["A B", "1 2"]
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', {
    value: '| A | B |\n|---|---|\n| 1 | 2 \\|',
  }); // ["A B", "1 2 |"]
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: '|A|B|\n|-|-|\n|1|2|' }); // ["A B", "1 2"]
  ```

- A paragraph is a run of lines that start no other block, joined by one space.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\nb\n\nc' }); // ["a b", "c"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\n\nb\n\nc' }); // ["a", "b", "c"]
  ```

- A line of a paragraph or a list item that ends with a backslash, other than its last line, loses the backslash.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\\\nb' }); // ["a b"]
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '- a\\\nb' }); // ["a b"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\\' }); // ["a\\"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', { value: '# a\\' }); // ["a\\"]
  ```

- There are no indented code blocks or link reference definitions, so their lines are paragraph text.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: '    code\n[r]: https://x' }); // ["code [r]: https://x"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '    code' }); // []
  ```

- A result of more than `maxWildcardOutputLength` (5,000) blocks raises `LIST_TOO_LARGE`.

  ```ts
  await evalErrors('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'x\n\n'.repeat(5001) }); // ["LIST_TOO_LARGE"]
  await evalOk('COUNT(MARKDOWN_BLOCKS(value; "paragraph"))', { value: 'x\n\n'.repeat(5000) }); // 5000
  ```

Unspecified: in a block's text, what [PLAIN_TEXT](#plain_text) leaves unspecified in `"markdown"`.

---

## Lists

Higher-order list functions (`FILTER`, `FILTER_PROPERTY`, `FILTER_BY`, `EACH`,
`REDUCE`) take the callable as a **text literal** naming a function or operator
(for example `">"`, `"STARTS_WITH"`). The named callable is validated against
the registry at parse time — an unknown name is an `UNKNOWN_FUNCTION_REFERENCE`
error — and resolved again at evaluation time. Lists longer than the configured
`maxListLength` raise a `LIST_TOO_LARGE` security error.

### LIST

`LIST(...values: T) -> list<T>`

Builds a list from its arguments. All non-empty items must share a type;
mixed types are a compile-time `ARGUMENT_TYPES_MUST_HAVE_SAME_TYPE` error (and,
at runtime, `null` with a `LIST_MIXED_TYPES` warning).

```ts
await evalOk('LIST(1; 2; 3)'); // [1, 2, 3]
```

### INDEX

`INDEX(list: list<T>, index: number) -> T`

Returns the 1-based item at `index`, or `null` when the index is `<= 0`, past
the end, or fractional. A non-list first argument is a compile-time type error.
Commonly used to produce a guaranteed-`null` value, e.g. `INDEX(LIST(1); 0)`.

```ts
await evalOk('INDEX(LIST(10; 20; 30); 2)'); // 20
await evalOk('INDEX(LIST(10; 20; 30); 4)'); // null
```

### FLAT

`FLAT(list: list<any>) -> list<any>`

Fully flattens a nested list (all levels). A non-list, non-empty input returns
`null` with a `TYPE` warning. Flattening beyond the output-length limit raises a
`LIST_TOO_LARGE` security error.

```ts
await evalOk('FLAT(LIST(LIST(1; 2); LIST(3)))'); // [1, 2, 3]
await evalOk('FLAT(value)', { value: [1, [2, [3]]] }); // [1, 2, 3]
```

### SORT

`SORT(list: list<T>, descending?: boolean) -> list<T>`

Stable sort. Mixed types order by kind: numbers < strings (case-insensitive) <
booleans < objects < `null`. `descending` reverses the order (equal keys keep
their original order). A non-list input is a compile-time type error.

```ts
await evalOk('SORT(LIST(3; 1; 2))'); // [1, 2, 3]
await evalOk('SORT(LIST(3; 1; 2); true)'); // [3, 2, 1]
```

### SORT_BY_PROPERTY

`SORT_BY_PROPERTY(list: list<T>, property: text, descending?: boolean) -> list<T>`

Sorts objects by a property, using dotted paths for nested access. Items missing
the property sort last and keep their original order. `property` is a text
literal.

```ts
// value = [{ a: 2 }, { a: 1 }, { a: 3 }]
await evalOk('SORT_BY_PROPERTY(value; "a")', { value }); // [{a:1},{a:2},{a:3}]
// nested path:
await evalOk('SORT_BY_PROPERTY(value; "a.b")', { value: nested });
```

### FILTER

`FILTER(target: list<T>, operator: callable, operatorValue?: any) -> list<T>`

Keeps items for which the named `operator` returns `true`. The operator is
called with `(item)` or, when `operatorValue` is given, `(item, operatorValue)`.

```ts
await evalOk('FILTER(LIST(1; 2; 3); ">"; 1)'); // [2, 3]
await evalOk('FILTER(LIST("data:a"; "x"); "STARTS_WITH"; "data:")'); // ["data:a"]
```

### FILTER_PROPERTY

`FILTER_PROPERTY(target: list<T>, property: text, operator: callable, operatorValue?: any) -> list<T>`

Like `FILTER`, but the operator receives the item's `property` (dotted path
supported) instead of the item itself.

```ts
// value = [{ a: { b: 1 } }, { a: { b: 2 } }, { a: null }]
await evalOk('FILTER_PROPERTY(value; "a.b"; "="; 2)', { value }); // [{ a: { b: 2 } }]
```

### EACH

`EACH(target: list<T>, operator: callable, ...args?: any) -> list<R>`

Maps each item through the named `operator`, producing a new list. Extra `args`
are evaluated once and passed to every call after the item.

```ts
await evalOk('EACH(LIST("a"; "bb"); "LEN")'); // [1, 2]
```

### REDUCE

`REDUCE(initial_value: A, list: list<T>, lambda: callable) -> A` · control flow

Folds a list into a single value. `lambda` names a two-argument function or
operator called as `(accumulator, item)`. An empty list returns
`initial_value`.

```ts
await evalOk('REDUCE(0; LIST(1; 2; 3); "+")'); // 6
await evalOk('REDUCE(""; LIST("a"; "b"); "CONCAT")'); // "ab"
```

### INCLUDES

`INCLUDES(target: list<T>, value: T) -> boolean`

Whether the list contains `value`, using `EQ`-style coerced equality: text that
reads as a number equals that number, the texts `true` and `false` (in any
case) equal the booleans, and two objects, such as dates, are equal only as the
same value object. A non-list first argument returns `null` with a `TYPE`
warning; if no element matches but some comparison was indeterminate (`null`),
the result is `null`.

```ts
await evalOk('INCLUDES(LIST("a"; "b"); "b")'); // true
await evalOk('INCLUDES(LIST("a"); "b")'); // false
```

### TAKE

`TAKE(list: list<T>, count: number, start?: number) -> list<T>`

- The result is `count` consecutive items from the 1-based position `start`, which is 1 when omitted.

  ```ts
  await evalOk('TAKE(LIST(1; 2; 3); 2)'); // [1, 2]
  await evalOk('TAKE(LIST(1; 2; 3); 2; 1)'); // [1, 2]
  await evalOk('TAKE(LIST(1; 2; 3); 2; 2)'); // [2, 3]
  ```

- A `count` of 0 gives `[]`.

  ```ts
  await evalOk('TAKE(LIST(1; 2; 3); 0)'); // []
  await evalOk('TAKE(LIST(1; 2; 3); 1)'); // [1]
  ```

- A run past the end gives the items that exist.

  ```ts
  await evalOk('TAKE(LIST(1; 2; 3); 2; 3)'); // [3]
  await evalOk('TAKE(LIST(1; 2; 3); 5)'); // [1, 2, 3]
  await evalOk('TAKE(LIST(1; 2; 3); 1; 4)'); // []
  await evalOk('TAKE(LIST(); 2)'); // []
  await evalOk('TAKE(LIST(1; 2; 3); 2; 2)'); // [2, 3]
  ```

- A `count` that is not a whole number of 0 or more returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('TAKE(LIST(1; 2; 3); -1)'); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2; 3); 1.5)'); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2; 3); 0)'); // []
  ```

- A `start` that is not a whole number of 1 or more returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('TAKE(LIST(1; 2; 3); 1; 0)'); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2; 3); 1; 1.5)'); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2; 3); 1; -1)'); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2; 3); 1; 1)'); // [1]
  ```

- Items are taken as they are, `null` and `""` included.

  ```ts
  await evalOk('TAKE(value; 2)', { value: [null, '', 'a'] }); // [null, ""]
  await evalOk('TAKE(value; 2; 2)', { value: [null, '', 'a'] }); // ["", "a"]
  ```

Unspecified: nothing.

### INDEX_OF

`INDEX_OF(list: list<T>, value: T) -> number`

- The result is the 1-based position of the first item equal to `value`.

  ```ts
  await evalOk('INDEX_OF(LIST("a"; "b"; "a"); "a")'); // 1
  await evalOk('INDEX_OF(LIST("a"; "b"; "a"); "b")'); // 2
  await evalOk('INDEX(LIST("a"; "b"); INDEX_OF(LIST("a"; "b"); "b"))'); // "b"
  ```

- A list with no item equal to `value` returns `null`.

  ```ts
  await evalOk('INDEX_OF(LIST("a"; "b"); "c")'); // null
  await evalOk('INDEX_OF(LIST(); "a")'); // null
  await evalOk('INDEX_OF(LIST("a"; "b"); "a")'); // 1
  ```

- Items compare as [INCLUDES](#includes) and `=` compare them, so text that reads as a number equals that number.

  ```ts
  await evalOk('INDEX_OF(value; "2")', { value: [1, 2, 3] }); // 2
  await evalOk('INDEX_OF(value; 2)', { value: ['1', ' 2 '] }); // 2
  await evalOk('INDEX_OF(value; "2x")', { value: [1, 2] }); // null
  ```

- The texts `true` and `false`, in any letter case, equal each other and the booleans.

  ```ts
  await evalOk('INDEX_OF(value; "TRUE")', { value: [false, true] }); // 2
  await evalOk('INDEX_OF(value; "true")', { value: ['TRUE', true] }); // 1
  await evalOk('INDEX_OF(value; "yes")', { value: [false, true] }); // null
  ```

- Other text compares case-sensitively.

  ```ts
  await evalOk('INDEX_OF(value; "A")', { value: ['a', 'A'] }); // 2
  await evalOk('INDEX_OF(value; "a")', { value: ['a', 'A'] }); // 1
  ```

- A `null` item equals nothing.

  ```ts
  await evalOk('INDEX_OF(value; 1)', { value: [null, 1] }); // 2
  await evalOk('INDEX_OF(value; 1)', { value: [1, null] }); // 1
  ```

- A `value` of `""` returns `null`.

  ```ts
  await evalOk('INDEX_OF(LIST("a"; ""); "")'); // null
  await evalOk('INDEX_OF(LIST("a"; " "); " ")'); // 2
  ```

- A list that holds a list, the empty list included, returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('INDEX_OF(value; 1)', { value: [[1], 2] }); // null with a TYPE warning
  await evalOk('INDEX_OF(value; 1)', { value: [[], 1] }); // null with a TYPE warning
  await evalOk('INDEX_OF(value; 1)', { value: [1, 2] }); // 1
  ```

- A list as `value`, the empty list included, returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('INDEX_OF(value; LIST(1))', { value: [1] }); // null with a TYPE warning
  await evalOk('INDEX_OF(LIST(1); LIST())'); // null with a TYPE warning
  await evalOk('INDEX_OF(value; 1)', { value: [1] }); // 1
  ```

Unspecified: whether a date, time, datetime or other object equals another.

### FILTER_BY

`FILTER_BY(list: list<T>, keys: list<any>, operator: callable, operatorValue?: any) -> list<T>`

- The result is the items of `list` whose key, the item at the same position in `keys`, the named `operator` answers `TRUE` for.

  ```ts
  await evalOk('FILTER_BY(LIST("a"; "b"; "c"); LIST(9; 3; 12); ">"; 8)'); // ["a", "c"]
  await evalOk('FILTER_BY(LIST("a"; "b"; "c"); LIST(9; 3; 12); ">"; 10)'); // ["c"]
  await evalOk('FILTER_BY(LIST(); LIST(); ">"; 1)'); // []
  ```

- The operator is called as `(key)`, or as `(key, operatorValue)` when `operatorValue` is given, `null` included.

  ```ts
  await evalOk('FILTER_BY(LIST("x"; "y"); LIST(""; "z"); "IS_EMPTY")'); // ["x"]
  await evalOk('FILTER_BY(LIST(1; 2); LIST(5; 0); ">"; value)', { value: 0 }); // [1]
  await evalOk('FILTER_BY(LIST(1; 2); LIST(5; 0); ">"; value)', { value: null }); // []
  await evalOk('FILTER_BY(LIST(1; 2); LIST(TRUE; TRUE); "AND")'); // [1, 2]
  await evalOk('FILTER_BY(LIST(1; 2); LIST(TRUE; TRUE); "AND"; value)', { value: null }); // []
  ```

- A key that the operator answers `FALSE` or `null` for drops its item.

  ```ts
  await evalOk('FILTER_BY(LIST(1; 2); value; ">"; 0)', { value: [5, null] }); // [1]
  await evalOk('FILTER_BY(LIST(1; 2); value; ">"; 0)', { value: [5, -1] }); // [1]
  await evalOk('FILTER_BY(LIST(1; 2); value; ">"; 0)', { value: [5, 1] }); // [1, 2]
  ```

- A `list` and `keys` of different lengths return `null` with a `TYPE` warning.

  ```ts
  await evalOk('FILTER_BY(LIST("a"; "b"); LIST(1); ">"; 0)'); // null with a TYPE warning
  await evalOk('FILTER_BY(LIST("a"); LIST(1; 2); ">"; 0)'); // null with a TYPE warning
  await evalOk('FILTER_BY(LIST("a"; "b"); LIST(1; 2); ">"; 0)'); // ["a", "b"]
  ```

- The operator is called as [FILTER](#filter) calls it, the function behind an operator token or else the first function of that name that has an implementation.

  ```ts
  await evalOk(
    'FILTER_BY(LIST("x"; "y"; "z"); LIST("apple"; "banana"; "cherry"); "STARTS_WITH"; "b")',
  ); // ["y"]
  await evalOk('FILTER_BY(LIST("x"; "y"); LIST("apple"; "banana"); "STARTS_WITH"; LIST("a"; "b"))'); // []
  ```

- An operator name that the registry does not hold is a parse-time `UNKNOWN_FUNCTION_REFERENCE` error.

  ```ts
  await evalErrors('FILTER_BY(LIST(1); LIST(1); "NOPE")'); // ["UNKNOWN_FUNCTION_REFERENCE"]
  await evalErrors('FILTER_BY(LIST(1); LIST(1); "ISNUMBER")'); // []
  ```

Unspecified: an operator that reaches the call as a value that is not text, or as a name with no implementation, which only a host's own functions or registry can give.

### DISTINCT

`DISTINCT(list: list<T>) -> list<T>`

- The result is the first occurrence of each distinct item, in order.

  ```ts
  await evalOk('DISTINCT(LIST("x"; "y"; "x"))'); // ["x", "y"]
  await evalOk('DISTINCT(LIST("y"; "x"; "y"))'); // ["y", "x"]
  await evalOk('DISTINCT(LIST())'); // []
  ```

- The items `null` and `""` are dropped.

  ```ts
  await evalOk('DISTINCT(LIST("x"; ""))'); // ["x"]
  await evalOk('DISTINCT(value)', { value: [null, 'a'] }); // ["a"]
  await evalOk('DISTINCT(LIST("x"; " "))'); // ["x", " "]
  ```

- Text, numbers and booleans are equal when they have the same type and value, with no conversion.

  ```ts
  await evalOk('DISTINCT(value)', { value: [1, '1', true, 'true', 1, '1'] }); // [1, "1", true, "true"]
  await evalOk('DISTINCT(value)', { value: [1, 1, true, true] }); // [1, true]
  ```

- Text compares case-sensitively.

  ```ts
  await evalOk('DISTINCT(value)', { value: ['a', 'A'] }); // ["a", "A"]
  await evalOk('DISTINCT(value)', { value: ['a', 'a'] }); // ["a"]
  ```

- Dates, times and datetimes are equal when their kind and their `iso` text are.

  ```ts
  await evalOk('COUNT(DISTINCT(LIST(DATE(2024; 1; 2); DATE(2024; 1; 2))))'); // 1
  await evalOk('COUNT(DISTINCT(LIST(DATE(2024; 1; 2); DATE(2024; 1; 3))))'); // 2
  await evalOk('COUNT(DISTINCT(LIST(TIME(1; 2; 3); TIME(1; 2; 3); TIME(1; 2; 4))))'); // 2
  ```

- A list that holds a list, the empty list included, or any other object returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('DISTINCT(value)', { value: [[1], 2] }); // null with a TYPE warning
  await evalOk('DISTINCT(value)', { value: [[], 2] }); // null with a TYPE warning
  await evalOk('DISTINCT(value)', { value: [{ a: 1 }] }); // null with a TYPE warning
  await evalOk('DISTINCT(value)', { value: [{ iso: '2024-01-02' }] }); // null with a TYPE warning
  await evalOk('DISTINCT(value)', { value: [{ __formula_object_kind: 'date', iso: 5 }] }); // null with a TYPE warning
  await evalOk('DISTINCT(value)', { value: [1, 2] }); // [1, 2]
  ```

Unspecified: nothing.

### GROUP_COUNTS

`GROUP_COUNTS(list: list<any>) -> list<number>`

- The result is, for each item of [DISTINCT](#distinct)`(list)` in the same order, how many items of `list` equal it.

  ```ts
  await evalOk('GROUP_COUNTS(LIST("x"; "y"; "x"; ""))'); // [2, 1]
  await evalOk('GROUP_COUNTS(LIST("y"; "x"; "x"))'); // [1, 2]
  await evalOk('GROUP_COUNTS(LIST())'); // []
  await evalOk('INDEX(DISTINCT(value); INDEX_OF(GROUP_COUNTS(value); MAX(GROUP_COUNTS(value))))', {
    value: ['a', 'b', 'b', 'c'],
  }); // "b"
  await evalOk('MAX(GROUP_COUNTS(value)) - MIN(GROUP_COUNTS(value)) <= 1', {
    value: ['a', 'b', 'b', 'c'],
  }); // true
  ```

- Items compare as in `DISTINCT`.

  ```ts
  await evalOk('GROUP_COUNTS(value)', { value: [1, '1', true, 'true', 'a', 'A', 1, null, ''] }); // [2, 1, 1, 1, 1, 1]
  await evalOk('GROUP_COUNTS(LIST(DATE(2024; 1; 2); DATE(2024; 1; 2); DATE(2024; 1; 3)))'); // [2, 1]
  await evalOk('GROUP_COUNTS(value)', { value: [1, 1] }); // [2]
  ```

- Where `DISTINCT` returns `null` with a warning, `GROUP_COUNTS` returns `null` with the same warning.

  ```ts
  await evalOk('GROUP_COUNTS(value)', { value: [[1], 2] }); // null with a TYPE warning
  await evalOk('GROUP_COUNTS(value)', { value: [{ a: 1 }] }); // null with a TYPE warning
  await evalOk('GROUP_COUNTS(value)', { value: [1, 2] }); // [1, 1]
  ```

Unspecified: nothing.

---

## Date & time

`DATE`, `TIME`, and `NOW` produce structured values, not plain strings. A date
value exposes `.iso`, `.year`, `.month`, `.day`; a time value exposes `.iso`,
`.hour`, `.minute`, `.second`; a datetime value exposes `.iso`, `.date`, `.time`.
All arithmetic is in UTC. Functions that read a date/time also accept ISO
strings and datetime values. `NOW`, `TODAY`, and the no-argument component
overloads are `uncached` (re-evaluated each run).

### DATE

`DATE(year: number, month: number, day?: number) -> date`

Builds a date (day defaults to `1`). Invalid calendar dates (month outside
1…12, or a non-existent day like Feb 30) return `null`.

```ts
await evalOk('DATE(2024; 2; 29).iso'); // "2024-02-29"
await evalOk('DATE(2024; 13; 1)'); // null
```

### DATEVALUE

`DATEVALUE(date_string: text | number) -> date`

Parses a date from an ISO date/datetime string, or from a numeric timestamp
(auto-detected as seconds or milliseconds). Non-finite numbers and unparseable
text return `null`.

```ts
await evalOk('DATEVALUE("2024-02-29T01:02:03Z").iso'); // "2024-02-29"
await evalOk('DATEVALUE(86400).iso'); // "1970-01-02"
```

### TIME

`TIME(hour: number, minute?: number, second?: number) -> time`

Builds a time (minute/second default to `0`). Out-of-range components
(hour > 23, minute/second > 59) return `null`.

```ts
await evalOk('TIME(1; 2).iso'); // "01:02:00"
await evalOk('TIME(24; 0; 0)'); // null
```

### TIMEVALUE

`TIMEVALUE(time_string: text) -> time`

Parses a time from an ISO datetime string or a `HH:MM`/`HH:MM:SS` string.

```ts
await evalOk('TIMEVALUE("2024-02-29T01:02:03Z").iso'); // "01:02:03"
```

### NOW

`NOW() -> datetime` · uncached

The current UTC date and time as a datetime value.

```ts
await evalOk('NOW().date.iso'); // e.g. "2026-07-03"
```

### TODAY

`TODAY() -> date` · uncached

The current UTC date.

```ts
await evalOk('TODAY().iso'); // e.g. "2026-07-03"
```

### DAY

`DAY(date: date | datetime) -> number`
`DAY() -> number` · uncached

Day of the month from a date, or today's day with no argument (the no-arg call
binds to the `DAY_NOW` signature).

```ts
await evalOk('DAY(DATE(2024; 2; 29))'); // 29
```

### MONTH

`MONTH(date: date | datetime) -> number`
`MONTH() -> number` · uncached

Month number (1…12) from a date, or the current month with no argument.

```ts
await evalOk('MONTH(DATE(2024; 2; 29))'); // 2
```

### YEAR

`YEAR(date: date | datetime) -> number`
`YEAR() -> number` · uncached

Year from a date, or the current year with no argument.

```ts
await evalOk('YEAR(DATE(2024; 2; 29))'); // 2024
```

### HOUR

`HOUR(time: time | datetime) -> number`
`HOUR() -> number` · uncached

Hour (0…23) from a time, or the current hour with no argument.

```ts
await evalOk('HOUR(TIME(1; 2; 3))'); // 1
```

### MINUTE

`MINUTE(time: time | datetime) -> number`
`MINUTE() -> number` · uncached

Minute (0…59) from a time, or the current minute with no argument.

```ts
await evalOk('MINUTE(TIME(1; 2; 3))'); // 2
```

### SECOND

`SECOND(time: time | datetime) -> number`
`SECOND() -> number` · uncached

Second (0…59) from a time, or the current second with no argument.

```ts
await evalOk('SECOND(TIME(1; 2; 3))'); // 3
```

### DAYS

`DAYS(end_date: date | datetime, start_date: date | datetime) -> number`

Whole days from `start_date` to `end_date` (can be negative). Note the argument
order: end first, then start.

```ts
await evalOk('DAYS(DATE(2024; 1; 2); DATE(2024; 1; 1))'); // 1
```

### DATEDIF

`DATEDIF(start_date: date | datetime, end_date: date | datetime, unit: text) -> number`

Difference between two dates in whole `unit`s. Accepts `D`/`DAY`/`DAYS`,
`M`/`MONTH`/`MONTHS`, `Y`/`YEAR`/`YEARS` (case-insensitive). Returns `null` when
`end_date` precedes `start_date` or the unit is unrecognized.

```ts
await evalOk('DATEDIF(DATE(2024; 1; 1); DATE(2025; 1; 1); "Y")'); // 1
await evalOk('DATEDIF(DATE(2024; 1; 1); DATE(2024; 1; 31); "D")'); // 30
```

### WEEKDAY

`WEEKDAY(date: date | datetime, type?: number) -> number`
`WEEKDAY() -> number` · uncached

Weekday number for a date, or today's weekday with no argument. `type` selects
the numbering: `1` (default) → Sunday=1…Saturday=7; `2` → Monday=1…Sunday=7;
`3` → Monday=0…Sunday=6. Other `type` values return `null`.

```ts
// 2024-01-01 is a Monday
await evalOk('WEEKDAY(DATE(2024; 1; 1); 1)'); // 2
await evalOk('WEEKDAY(DATE(2024; 1; 1); 2)'); // 1
```

### WEEKNUM

`WEEKNUM(date: date | datetime, type?: number) -> number`
`WEEKNUM() -> number` · uncached

Week number where week 1 contains Jan 1. `type` `1` (default) → weeks start
Sunday; `type` `2` → weeks start Monday. Other `type` values return `null`.

```ts
await evalOk('WEEKNUM(DATE(2024; 1; 1); 2)'); // 1
await evalOk('WEEKNUM(DATE(2024; 1; 8); 2)'); // 2
```

### ISOWEEKNUM

`ISOWEEKNUM(date: date | datetime) -> number`
`ISOWEEKNUM() -> number` · uncached

ISO-8601 week number (weeks start Monday; week 1 contains Jan 4), or the current
ISO week with no argument.

```ts
await evalOk('ISOWEEKNUM(DATE(2024; 1; 4))'); // 1
```

---

## Control flow

### IF

`IF(cond: boolean | text, then: T, else: T) -> T` · control flow

Returns `then` when `cond` is truthy, otherwise `else`. Only the taken branch is
evaluated (the other is skipped). `then` and `else` must share a type
(`ARGUMENT_TYPES_MUST_HAVE_SAME_TYPE` otherwise), and a non-boolean-like `cond`
is an `ARGUMENT_TYPE_MISMATCH` at compile time.

```ts
await evalOk('IF(TRUE; TRUE; NOT(1))'); // true  (else branch never runs)
```

### SWITCH

`SWITCH(expression: any, ...casesAndValues: any) -> any` · control flow

Compares `expression` against each case (using `EQ`-style coerced equality) and
returns the matching value. A trailing odd argument is the default. With no
match and no default, returns `null`. `null` matches `null` explicitly.

```ts
await evalOk('SWITCH(2; 1; "a"; 2; "b"; "d")'); // "b"
await evalOk('SWITCH(3; 1; "a"; 2; "b"; "d")'); // "d"  (default)
await evalOk('SWITCH("1"; 1; "ok"; "no")'); // "ok" (coerced)
```

---

## Type predicates & empty

### IS_EMPTY

`IS_EMPTY(value: any) -> boolean`

Whether `value` is empty: `null`, empty text, or an empty list. `0` and `"x"`
are not empty.

```ts
await evalOk('IS_EMPTY("")'); // true
await evalOk('IS_EMPTY(0)'); // false
```

### EMPTY

`EMPTY() -> null` · alias `BLANK`

Returns an explicit empty value (`null`).

```ts
await evalOk('EMPTY()'); // null
await evalOk('BLANK()'); // null
```

### ISNUMBER

`ISNUMBER(value: any) -> boolean`

Whether `value` is a finite number. Numeric strings and booleans are `false`.
Return type is non-nullable.

```ts
await evalOk('ISNUMBER(1)'); // true
await evalOk('ISNUMBER("1")'); // false
```

### ISTEXT

`ISTEXT(value: any) -> boolean`

Whether `value` is text. Return type is non-nullable.

```ts
await evalOk('ISTEXT("a")'); // true
await evalOk('ISTEXT(1)'); // false
```

### ISDATE

`ISDATE(value: any) -> boolean`

Whether `value` is a date, time, or datetime value, or an ISO date string that
parses to a real calendar date. Return type is non-nullable.

```ts
await evalOk('ISDATE(DATE(2024; 2; 29))'); // true
await evalOk('ISDATE("2024-02-30")'); // false (not a real date)
```
