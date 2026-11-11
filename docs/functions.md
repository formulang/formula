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
  empty input.
- **Warnings vs. errors.** Type mismatches that the parser can catch (for
  example `POW("x"; 2)`) are compile-time errors with code
  `ARGUMENT_TYPE_MISMATCH`. Type problems only visible at runtime usually return
  `null` and attach a non-fatal warning to the node output (visible via
  `output.warnings`), rather than throwing. `AND`/`OR`/`NOT`/`IF` are the
  exception: a non-boolean-like runtime value is a runtime error.
- **Operators.** Where an operator backs a function, the operator and the named
  call compile to the same signature. `1 + 2` and `ADD(1; 2)` are identical.
- **Mode parameters.** A parameter that lists its admitted values, such as
  `"whitespace"` or `"word"`, must be written as one of those string literals;
  any other literal is the parse error `LITERAL_VALUE_NOT_ALLOWED`, and a
  non-literal is `EXPECTED_STRING_LITERAL_REFERENCE`. A mode that reaches the
  function another way (passed on by `EACH` or `FILTER`, or produced by an
  expression) is checked when the call runs: the function returns `null` with a
  `TYPE` warning, and `EACH`/`FILTER` keep the `null` without the warning. A
  `null` mode counts as omitted and selects the default, the first value listed.
- **Text and list limits.** `WORDS`, `WORD_COUNT`, `LEADING_WORDS`,
  `SENTENCES`, `LINES`, `LINE_COUNT`, `FIRST_CONTAINED`, `CONTAINS_ANY`,
  `MISSING_FROM`, `TAKE`, `INDEX_OF`, `FILTER_BY`, `DISTINCT` and
  `GROUP_COUNTS` follow the usual null convention:
  a `null` required argument gives `null`, and a value of the wrong type gives
  `null` with a `TYPE` warning. A list argument longer than `maxListLength`
  (1,000 by default) and a list result longer than `maxWildcardOutputLength`
  (5,000) raise `LIST_TOO_LARGE`; `WORD_COUNT` and `LINE_COUNT` count past that
  bound. These functions are charged by the size of their input: the cost
  estimate grows with the text's length and, for `FIRST_CONTAINED`,
  `CONTAINS_ANY`, `MISSING_FROM` and the `keep` tokens of `SENTENCES`, with the
  number of phrases, items or tokens searched. A call too large for
  `maxFunctionCostUnits` fails with `FUNCTION_COST_LIMIT_EXCEEDED` before it
  runs. A phrase or item longer than 250 code units raises `PHRASE_TOO_LONG` (a
  security error).
- **Examples.** The `evalOk(source, variables?)` calls in the examples are the
  repository's test helper (`core-functions/src/test-helpers/eval-formula.ts`):
  it wires `createCoreFormulaRuntime()`, parses, optimizes, and evaluates the
  formula, asserts that no errors were produced, and returns the result value.
  The comment after each call shows that value.

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
- **Text:** [CONCAT](#concat) · [JOIN](#join) · [LEN](#len) · [LOWER](#lower) · [UPPER](#upper) · [TRIM](#trim) · [LEFT](#left) · [RIGHT](#right) · [MID](#mid) · [REPLACE](#replace) · [SUBSTITUTE](#substitute) · [CHAR](#char) · [TO_TEXT](#to_text) · [STARTS_WITH](#starts_with) · [ENDS_WITH](#ends_with) · [CONTAINS](#contains) · [CONTAINS_ANY](#contains_any) · [FIRST_CONTAINED](#first_contained) · [MISSING_FROM](#missing_from) · [MATCH_EXPRESSION](#match_expression) · [REGEXEXTRACT](#regexextract) · [REGEXREPLACE](#regexreplace) · [ENCODEURL](#encodeurl) · [ISURL](#isurl) · [WORDS](#words) · [WORD_COUNT](#word_count) · [LEADING_WORDS](#leading_words) · [SENTENCES](#sentences) · [LINES](#lines) · [LINE_COUNT](#line_count)
- **Lists:** [LIST](#list) · [INDEX](#index) · [TAKE](#take) · [INDEX_OF](#index_of) · [FLAT](#flat) · [SORT](#sort) · [SORT_BY_PROPERTY](#sort_by_property) · [FILTER](#filter) · [FILTER_PROPERTY](#filter_property) · [FILTER_BY](#filter_by) · [EACH](#each) · [REDUCE](#reduce) · [INCLUDES](#includes) · [DISTINCT](#distinct) · [GROUP_COUNTS](#group_counts)
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
numbers.

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
non-empty, non-text value, and plain `null` when the input is empty.

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

### CONTAINS_ANY

`CONTAINS_ANY(text: text?, phrases: list<text?>?, match?: text, ignoreCase?: boolean?) -> boolean?`

Whether `FIRST_CONTAINED` finds any of the `phrases` in `text`. A `null` list of
phrases gives `null`.

```ts
await evalOk('CONTAINS_ANY("The cat sat"; LIST("dog"; "cat"))'); // true
await evalOk('CONTAINS_ANY("concatenate"; LIST("cat"); "word")'); // false
```

### FIRST_CONTAINED

`FIRST_CONTAINED(text: text?, phrases: list<text?>?, match?: text, ignoreCase?: boolean?) -> text?`

Returns the first phrase, in list order (not text order), that occurs in
`text`, as written in the list, or `null` when none does. `match` is
`"substring"` (the default) or `"word"`, which also needs no letter, mark or
number directly beside the phrase. `ignoreCase` compares lower-cased text.
`null` and empty phrases are ignored.

```ts
await evalOk('FIRST_CONTAINED("The cat sat"; LIST("sat"; "cat"))'); // "sat"
await evalOk('FIRST_CONTAINED("Concatenate"; LIST("CAT"); "substring"; true)'); // "CAT"
await evalOk('FIRST_CONTAINED("Concatenate"; LIST("cat"); "word")'); // null
```

### MISSING_FROM

`MISSING_FROM(items: list<text?>?, text: text?, normalise?: text) -> list<text>?`

Returns the `items`, in order, that `text` does not contain as a substring.
`normalise` is applied to both sides first: `"whitespace"` (the default)
collapses runs of whitespace and trims, `"exact"` changes nothing, and `"loose"`
also lower-cases and folds typographic quotes and dashes to plain ones. `null`
and empty items are left out of the result.

```ts
await evalOk('MISSING_FROM(LIST("apples"; "pears"); "I like  apples")'); // ["pears"]
await evalOk('MISSING_FROM(LIST("Apples"); "I like apples"; "loose")'); // []
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

`WORDS(text: text?, mode?: text, option?: text?) -> list<text>?`

Splits a text into its words. `mode` is `"whitespace"` (the default: runs of
non-whitespace, punctuation included), `"letters"` (runs of letters, marks and
numbers, where an apostrophe or hyphen between two runs, or `.` or `,` between
two digits, keeps them one word) or `"locale"`. `"locale"` uses the runtime's
`Intl.Segmenter` with the BCP 47 tag given as `option`, so results can differ
between JavaScript runtimes and versions, which ship different locale data; an
invalid or unsupported tag gives `null` with a `TYPE` warning. `option` is
accepted only in `"locale"` mode and is then required.

```ts
await evalOk('WORDS("Hello, big world")'); // ["Hello,", "big", "world"]
await evalOk('WORDS("Hello, well-known world"; "letters")'); // ["Hello", "well-known", "world"]
```

### WORD_COUNT

`WORD_COUNT(text: text?, mode?: text, option?: text?) -> number?`

The number of words `WORDS` finds, with the same `mode` and `option`. It
counts without building a list, so it is not capped by the list limits.

```ts
await evalOk('WORD_COUNT("Hello, big world")'); // 3
await evalOk('WORD_COUNT("   "; "letters")'); // 0
```

### LEADING_WORDS

`LEADING_WORDS(text: text?, count: number?, mode?: text, option?: text?) -> text?`

Returns the first `count` words of `text` joined by single spaces, or `null`
when the text has fewer than `count` words. `count` must be a whole number of 1
or more; anything else gives `null` with a `TYPE` warning. `mode` and `option`
are those of `WORDS`.

```ts
await evalOk('LEADING_WORDS("One  two three four"; 2)'); // "One two"
await evalOk('LEADING_WORDS("One two"; 3)'); // null
```

### SENTENCES

`SENTENCES(text: text?, mode?: text, keep?: list<text?>?) -> list<text>?`

Splits a text into trimmed sentences. `mode` is `"punctuation"` (the default: a
sentence ends at `.`, `!` or `?` followed by whitespace) or `"terminators"`
(every run of `.`, `!`, `?` or their full-width forms ends a sentence, even
inside `3.14`). `keep` lists tokens, such as abbreviations, that never end a
sentence; a token counts only where it starts at a word boundary.

```ts
await evalOk('SENTENCES("It works. Does it? Yes!")'); // ["It works.", "Does it?", "Yes!"]
await evalOk('SENTENCES("Dr. Smith left. He ran."; "punctuation"; LIST("Dr."))'); // ["Dr. Smith left.", "He ran."]
await evalOk('SENTENCES("Pi is 3.14. Yes."; "terminators")'); // ["Pi is 3.", "14.", "Yes."]
```

### LINES

`LINES(text: text?, mode?: text) -> list<text>?`

Splits a text at line breaks (`\n`, `\r\n`, `\r`, and the other Unicode
mandatory breaks). `mode` is `"non-blank"` (the default), which skips lines
that are empty or whitespace only, or `"all"`, which keeps them. A final line
break ends the last line rather than starting an empty one.

```ts
await evalOk('LINES("a" & CHAR(10) & " " & CHAR(10) & "b")'); // ["a", "b"]
await evalOk('LINES("a" & CHAR(10) & CHAR(10) & "b"; "all")'); // ["a", "", "b"]
```

### LINE_COUNT

`LINE_COUNT(text: text?, mode?: text) -> number?`

The number of lines `LINES` finds, with the same `mode`, without the list
limits.

```ts
await evalOk('LINE_COUNT("a" & CHAR(10) & "b" & CHAR(10))'); // 2
```

---

## Lists

Higher-order list functions (`FILTER`, `FILTER_PROPERTY`, `EACH`, `REDUCE`) take
the callable as a **text literal** naming a function or operator (for example
`">"`, `"STARTS_WITH"`). The named callable is validated against the registry at
parse time — an unknown name is an `UNKNOWN_FUNCTION_REFERENCE` error — and
resolved again at evaluation time. Lists longer than the configured
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

### TAKE

`TAKE(list: list<T?>?, count: number?, start?: number?) -> list<T?>?`

Returns `count` consecutive items beginning at the 1-based position `start`
(default 1), or fewer when the list ends first. `count` must be a whole number
of 0 or more and `start` a whole number of 1 or more, otherwise the result is
`null` with a `TYPE` warning; a `null` `count` gives `null`.

```ts
await evalOk('TAKE(LIST(1; 2; 3; 4); 2)'); // [1, 2]
await evalOk('TAKE(LIST(1; 2; 3; 4); 5; 3)'); // [3, 4]
```

### INDEX_OF

`INDEX_OF(list: list<T?>?, value: T?) -> number?`

Returns the 1-based position of the first item equal to `value`, or `null` when
none is. Equality is that of `INCLUDES` and `=`, so `null` and `""` equal
nothing. A list among the items, or as `value`, gives `null` with a `TYPE`
warning.

```ts
await evalOk('INDEX_OF(LIST("a"; "b"; "c"); "b")'); // 2
await evalOk('INDEX_OF(LIST("a"); "z")'); // null
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

### FILTER_BY

`FILTER_BY(list: list<T?>?, keys: list<any?>?, operator: callable, operatorValue?: any?) -> list<T?>?`

Keeps the items of `list` whose key at the same position in `keys` satisfies
the named `operator`, called as `(key)` or, when `operatorValue` is given,
`(key, operatorValue)`; a `null` `operatorValue` counts as omitted. `operator`
is checked at parse time as in `FILTER`. `keys` must be as long as `list`,
otherwise the result is `null` with a `TYPE` warning. Each operator call is
charged against the cost limits like a call written in the formula.

```ts
await evalOk('FILTER_BY(LIST("a"; "b"; "c"); LIST(1; 5; 9); ">"; 3)'); // ["b", "c"]
await evalOk('FILTER_BY(LIST("x"; "y"); LIST("data:1"; "z"); "STARTS_WITH"; "data:")'); // ["x"]
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

Whether the list contains `value`, using `EQ`-style coerced equality. A non-list
first argument returns `null` with a `TYPE` warning; if no element matches but
some comparison was indeterminate (`null`), the result is `null`.

```ts
await evalOk('INCLUDES(LIST("a"; "b"); "b")'); // true
await evalOk('INCLUDES(LIST("a"); "b")'); // false
```

### DISTINCT

`DISTINCT(list: list<T?>?) -> list<T?>?`

Returns the first occurrence of each distinct non-empty item, in order. Texts,
numbers and booleans are equal only to the same value of the same type (`"1"`
and `1` differ, and text is case-sensitive); dates and times are equal when
their kind and `iso` text are. A list or object among the items gives `null`
with a `TYPE` warning.

```ts
await evalOk('DISTINCT(LIST("a"; "b"; "a"; ""; "c"))'); // ["a", "b", "c"]
```

### GROUP_COUNTS

`GROUP_COUNTS(list: list<any?>?) -> list<number>?`

For each item of `DISTINCT(list)`, in the same order, how many items of `list`
equal it. Equality and type errors are those of `DISTINCT`.

```ts
await evalOk('GROUP_COUNTS(LIST("a"; "b"; "a"; "a"))'); // [3, 1]
```

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
