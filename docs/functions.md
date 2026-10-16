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
  text included, returns `null` with a `TYPE` warning, and `null` selects the
  default of an optional mode. Through
  a higher-order call that item is `null`, as for any callee that fails: the
  higher-order functions keep a callee's value, not its warnings.
- **Operators.** Where an operator backs a function, the operator and the named
  call compile to the same signature. `1 + 2` and `ADD(1; 2)` are identical.
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
non-empty, non-text value, and plain `null` when the input is empty.

**Text segmentation.** `WORDS`, `WORD_COUNT` and `LEADING_WORDS` share one
tokeniser, chosen by an optional `mode` literal (a misspelt mode is a
compile-time `LITERAL_VALUE_NOT_ALLOWED` error, also when higher-order calls
pass the mode on through callables named by string literals, as far as the
parser follows them; see **Modes** under [Conventions](#conventions)):

- `"whitespace"` (default) — the text is trimmed and split at every run of
  whitespace. Whitespace is JavaScript's `\s`: tabs, line breaks and the
  no-break space U+00A0 separate words; U+0085 and U+001C–U+001F do not
  (Python's `str.split()` also splits at those), and the byte order mark
  U+FEFF does (Python's `str.split()` does not).
- `"letters"` — runs of letters, marks and numbers (`\p{L}`, `\p{M}`,
  `\p{N}`). An apostrophe (`'`, `’`) or a hyphen (`-`, U+2010, U+2011, the soft
  hyphen U+00AD) between two runs joins them into one word, and so does `.` or
  `,` between two digits: `don't`, `E-Mail-Adresse` and `3,5` are one word
  each, `Kund:innen` is two.
- `"locale"` — the word-like segments `Intl.Segmenter` finds for the BCP 47
  language tag in `option` (`"de"`, `"en-GB"`). A malformed tag, or one the
  runtime holds no segmentation data for, returns `null` with a `TYPE` warning
  instead of falling back to the host's locale. The segmentation comes from the
  runtime's ICU data, so a runtime that upgrades ICU can answer differently;
  the other modes do not depend on ICU.
- `"pattern"` — every non-empty match of the regular expression in `option`,
  written raw or as `/pattern/flags` with flags from `imsu` (`g` is implied).
  The pattern is compiled under the safety rules of
  [MATCH_EXPRESSION](#match_expression), including the 8,000-character input
  limit; those rules do not bound the time a pattern they accept takes
  (**Work**, below).

`option` is accepted only in the `"locale"` and `"pattern"` modes; elsewhere
any option, the empty text `""` included, returns `null` with a `TYPE`
warning. In those two modes an omitted, `null` or empty tag or pattern returns
`null` with a `TYPE` warning too. A `null` option is no option, so outside
those modes it is ignored.

`SENTENCES` takes a `mode` too: `"punctuation"` (default) ends a sentence at a
whitespace run directly after `.`, `!` or `?`; `"terminators"` ends one at
every run of `.`, `!`, `?`, `。`, `！`, `？`. The optional `keep` list names
tokens that never end a sentence — abbreviations such as `"z. B."`, `"Dr."`,
`"ca."` — so each language's abbreviations are data the caller supplies. There
is no locale sentence mode: `Intl.Segmenter` has no abbreviation data for
sentences and splits German `"Wir helfen z. B. Handwerkern."` after `z.` and
after `B.`.

Embedders that count outside a formula import the same tokenisers from
`@formulang/core-functions`: `splitWords(text, mode?, option?)` and
`splitSentences(text, mode?, keep?)`.

**Bounds.** List results (`WORDS`, `SENTENCES`, `LINES`, `MARKDOWN_BLOCKS`)
longer than `maxWildcardOutputLength` (5,000) raise a `LIST_TOO_LARGE` security
error, as `FLAT` does; `WORD_COUNT` and `LINE_COUNT` build no list and count
past that bound. List arguments (`keep`, `phrases`, `items`) longer than
`maxListLength` (1,000) raise `LIST_TOO_LARGE`. Each `keep` token, and each
phrase in `"word"` mode, is found with one Knuth-Morris-Pratt search, in time
linear in the lengths of the text and of the token or phrase however often
their occurrences overlap. Each phrase in `"substring"` mode, and each item of
`MISSING_FROM`, is found with one substring search, linear in the same
lengths: a phrase of up to 250 code units by the runtime's own search, whose
tables in V8 cover such a phrase whole, and a longer one by Knuth-Morris-Pratt.
V8's tables cover only a phrase's last 250 code units, so its own search reads
a longer phrase whose mismatch lies before them in time proportional to the
text's length times the phrase's: on 100,000 code units of `a`, ten phrases
of 8,000 code units, `"ab"` followed by `a`s, take 2.2 s that way and 7.6 ms
with Knuth-Morris-Pratt (`FIRST_CONTAINED` under the default limits, Node
22.23.3, best of three).

**Work.** What each text function does with its input, read from its code,
and what bounds the input:

| Function                                       | Work                                                                                                                                                                                                                                                           | Bounded by                                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORDS`, `WORD_COUNT`, `LEADING_WORDS`         | one fixed expression over the text (`"whitespace"`, `"letters"`), the runtime's `Intl.Segmenter` (`"locale"`), or the formula's own expression (`"pattern"`)                                                                                                   | `"pattern"`: the [MATCH_EXPRESSION](#match_expression) rules and the text at most `maxRegexTextLength` (8,000), which do not bound the time (below) |
| `SENTENCES`                                    | one fixed expression over the text (in `"terminators"` mode a second on each piece), and one Knuth-Morris-Pratt search per `keep` token, linear in the text and the token                                                                                      | `keep` at most `maxListLength`; the result at most `maxWildcardOutputLength`                                                                        |
| `LINES`, `LINE_COUNT`                          | one scan for the line breaks with a fixed expression, each line trimmed in `"non-blank"` mode; `LINE_COUNT` counts the lines as it finds them                                                                                                                  | `LINES`: the result at most `maxWildcardOutputLength`                                                                                               |
| `FIRST_CONTAINED`, `CONTAINS_ANY`              | per phrase in list order, one substring search (`"substring"`) or one Knuth-Morris-Pratt search (`"word"`), each linear in the lengths of the text and the phrase: the text's length times the number of phrases, plus the phrases' lengths, in the worst case | `phrases` at most `maxListLength`                                                                                                                   |
| `MISSING_FROM`                                 | the text normalised once, then per item its normalisation and one substring search, linear in the lengths of the text and the item: the text's length times the number of items, plus the items' lengths, in the worst case                                    | `items` at most `maxListLength`                                                                                                                     |
| `PLAIN_TEXT` (`"html"`)                        | one forward scan of the markup, tags, comments and dropped elements included, and fixed expressions on each piece of text                                                                                                                                      | the length of `markup`                                                                                                                              |
| `PLAIN_TEXT` (`"markdown"`), `MARKDOWN_BLOCKS` | one pass over the lines, fixed expressions on each, then one scan of each block's inline text                                                                                                                                                                  | the length of `markup`; `MARKDOWN_BLOCKS`: the result at most `maxWildcardOutputLength`                                                             |

This is read from the code: it is what the code claims for its own loops and
for the patterns it runs, and review owns those claims. No spec measures the
time or the work of these functions, and none checks the complexity of a loop
or of a pattern.

Four patterns of 1.0.0 code read their input in more than linear time. Each was
measured on Node 22.23.3, as the best of three runs on an input built against
it:

- `regex.ts`'s nested-quantifier check, `\([^)]*[+*{][^)]*\)[+*{]`, on `(+`
  repeated: 0.06 ms at 100 code units, 19 ms at 800. It is cubic in the length
  of the formula's own pattern, which it reads after the length check
  (`maxRegexPatternLength`, 100 by default).
- The alternation check beside it, `\([^)]*\|[^)]*\)[+*{]`, on `(|` repeated:
  0.05 ms at 100 code units, 17 ms at 800; cubic in the same way.
- The formula's own pattern, which the regex functions and the `"pattern"`
  mode compile through 1.0.0's `compileSafeRegex`, inherits its rules and
  their gap: a pattern they accept can take polynomial time, and
  `maxRegexTextLength` (8,000) does not bound it.
  `WORD_COUNT(value; "pattern"; "\\s*\\s*!")` on a run of spaces, under the
  default limits, takes 0.14 s at 1,000 spaces, 1.1 s at 2,000 and 8.9 s at
  4,000, and 76 s at 8,000 (one run). The function wall-time limit,
  `maxFunctionWallTimeMs` (10 s), is read when the call returns, so it reports
  such a call only after the call has run.
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

The words of `text`, in order, found by the [text segmentation](#text) mode:
`mode` is one of the literals `"whitespace"` (default), `"letters"`,
`"locale"`, `"pattern"`, and `option` carries the language tag or the pattern
of the last two. An empty text yields `[]`.

```ts
await evalOk('WORDS("  Kennst du   das? ")'); // ["Kennst", "du", "das?"]
await evalOk('WORDS("Für 3,5 Mio. Kund:innen"; "letters")'); // ["Für", "3,5", "Mio", "Kund", "innen"]
await evalOk('WORDS("Kund:innen"; "locale"; "de")'); // ["Kund:innen"]
await evalOk('WORDS(LOWER("Für 50$ – sofort!"); "pattern"; "[A-Za-z0-9$\']+")'); // ["f", "r", "50$", "sofort"]
```

### WORD_COUNT

`WORD_COUNT(text: text, mode?: text, option?: text) -> number`

The number of words `WORDS` finds with the same arguments; `""` counts `0`.
No list is built, so a long text is countable past the list-result limit.

```ts
await evalOk('WORD_COUNT("  Kennst du   das? ")'); // 3
await evalOk('WORD_COUNT("Don\'t re-enter the e-mail, oder?"; "letters")'); // 5
await evalOk('WORD_COUNT(""; "whitespace")'); // 0
```

### LEADING_WORDS

`LEADING_WORDS(text: text, count: number, mode?: text, option?: text) -> text`

The first `count` words joined by one space, or `null` when the text has fewer
words. A `count` that is not a positive whole number returns `null` with a
`TYPE` warning. `mode` and `option` work as for `WORDS`.

```ts
await evalOk('LEADING_WORDS("eins zwei  drei vier"; 2)'); // "eins zwei"
await evalOk('LEADING_WORDS("eins zwei"; 3)'); // null
await evalOk('EACH(LIST("a b"; "c d e"); "LEADING_WORDS"; 2)'); // ["a b", "c d"]
```

### SENTENCES

`SENTENCES(text: text, mode?: text, keep?: list<text>) -> list<text>`

The sentences of `text`, each trimmed, empty pieces dropped. `mode` is
`"punctuation"` (default) or `"terminators"` (see
[text segmentation](#text)). `keep` lists tokens that never end a sentence: a
split that falls inside or at the end of an occurrence of a listed token is
suppressed when the occurrence starts at a word boundary — a token starting
with a letter, mark or number must not follow one (`"ca."` inside `Africa.`
does not count), a token starting with anything else always counts (`"..."`
in `Na ja...`). Matching is case-sensitive and empty entries are skipped. In
`"terminators"` mode the terminator run stays with the sentence it ends, and a
piece holding nothing but terminators is not a sentence. The `"punctuation"`
mode splits as Python's `re.split(r"(?<=[.!?])\s+", text.strip())` does, with
JavaScript's whitespace: U+FEFF separates sentences, U+0085 and U+001C–U+001F
do not.

```ts
await evalOk('SENTENCES("Hi. Ok!  Next? end")'); // ["Hi.", "Ok!", "Next?", "end"]
await evalOk('SENTENCES("3.5 Uhr. Gut."; "terminators")'); // ["3.", "5 Uhr.", "Gut."]
await evalOk('SENTENCES("Wir helfen z. B. Handwerkern."; "punctuation"; LIST("z. B."))'); // ["Wir helfen z. B. Handwerkern."]
```

### LINES

`LINES(text: text, mode?: text) -> list<text>`

The lines of `text` as written (not trimmed). A line ends at `\r\n`, `\n`,
`\r`, U+000B, U+000C, U+0085, U+2028 or U+2029; a final line break ends the
last line instead of starting an empty one. `mode` is `"non-blank"` (default),
which drops lines that are empty after trimming, or `"all"`.

```ts
await evalOk('LINES(value)', { value: 'a\n\n b' }); // ["a", " b"]
await evalOk('LINES(value; "all")', { value: 'a\n\n b' }); // ["a", "", " b"]
```

### LINE_COUNT

`LINE_COUNT(text: text, mode?: text) -> number`

The number of lines `LINES` returns with the same arguments; `""` counts `0`.

```ts
await evalOk('LINE_COUNT(value)', { value: 'a\r\nb\rc' }); // 3
await evalOk('LINE_COUNT(""; "all")'); // 0
```

### FIRST_CONTAINED

`FIRST_CONTAINED(text: text, phrases: list<text>, match?: text, ignoreCase?: boolean) -> text`

The first phrase of `phrases`, in list order, that occurs in `text` — list
order wins over the order in the text — or `null` when none does. `match` is
the literal `"substring"` (default) or `"word"`; `"word"` also requires that
the characters directly before and after the occurrence are not letters, marks
or numbers (or are the edges of the text). `ignoreCase` (default `FALSE`)
compares after lower-casing both sides as `LOWER` does; the answer is the
phrase as listed. Empty phrases are skipped.

```ts
await evalOk('FIRST_CONTAINED("Gut, oder? Richtig?"; LIST("Richtig?"; "oder?"))'); // "Richtig?"
await evalOk('FIRST_CONTAINED("KENNST DU DAS?"; LIST("kennst du das?"); "substring"; TRUE)'); // "kennst du das?"
await evalOk('FIRST_CONTAINED("Der Geschäftsführer"; LIST("führer"); "word")'); // null
```

### CONTAINS_ANY

`CONTAINS_ANY(text: text, phrases: list<text>, match?: text, ignoreCase?: boolean) -> boolean`

Whether `FIRST_CONTAINED` finds a phrase with the same arguments; an empty
list yields `false`. It is a separate name rather than a `CONTAINS` list
overload because an overload could not carry `match` and `ignoreCase`.

```ts
await evalOk('CONTAINS_ANY("the homeowner"; LIST("owner"))'); // true
await evalOk('CONTAINS_ANY("the homeowner"; LIST("owner"); "word")'); // false
await evalOk('CONTAINS_ANY("abc"; LIST())'); // false
```

### MISSING_FROM

`MISSING_FROM(items: list<text>, text: text, normalise?: text) -> list<text>`

The items, in order and as listed, that `text` does not contain. `normalise`
sets how both sides are compared: `"whitespace"` (default) trims them and
collapses every whitespace run to one space; `"exact"` compares them as
written; `"loose"` also lower-cases them and folds typographic quotes
(`‘ ’ ‚ ‛ ‹ ›` to `'`, `“ ” „ ‟ « »` to `"`) and dashes (U+2010 to U+2015 and
the minus sign U+2212 to `-`). Items that are empty after normalising are
skipped.

```ts
await evalOk('MISSING_FROM(LIST("liefern schnell"; "billig"); value)', {
  value: 'Wir liefern\n  schnell.',
}); // ["billig"]
await evalOk('MISSING_FROM(LIST("\\"hallo\\""); value; "loose")', { value: 'Er sagte „Hallo“.' }); // []
```

### PLAIN_TEXT

`PLAIN_TEXT(markup: text, format: text) -> text`

The text of `markup`, one line per block, with whitespace collapsed within
each line and blank lines dropped. `format` is a required literal:

- `"html"` — comments and the content of `script`, `style`, `title` and `head`
  are dropped. `head` ends at `</head>` or, as HTML lets that end tag be
  omitted, where the body starts: at `<body>`, at text, or at any element that
  cannot live in `head` (only `base`, `basefont`, `bgsound`, `link`, `meta`,
  `noframes`, `noscript`, `script`, `style`, `template` and `title` can; the
  content of `noframes`, `noscript` and `template` inside `head` is head
  content too). The content of a dropped element ends at its end tag:
  `</script`, in any case, followed by a space, a tab, a line feed, a carriage
  return, a form feed, `/` or `>` (`</scripts>` does not end it).
  `address`, `article`, `aside`, `blockquote`, `br`, `dd`, `div`,
  `dl`, `dt`, `figcaption`, `figure`, `footer`, `h1`–`h6`, `header`, `hr`,
  `li`, `main`, `nav`, `ol`, `p`, `pre`, `section`, `table`, `td`, `th`, `tr`
  and `ul` end a line where they open or close; every other tag is removed.
  Numeric character references and the 252 named references of HTML 4 are
  decoded as browsers decode them: a numeric reference may have any number of
  digits, leading zeros included; zero, a surrogate or a value past U+10FFFF
  is U+FFFD; 128 to 159 are the windows-1252 characters where that encoding
  has one (`&#150;` is an en dash); and `&lang;` is U+27E8. Unlike in a
  browser, a reference needs its closing `;`, and unknown names stay as
  written. Source line breaks (`\n`, `\r`, `\r\n`) are whitespace, except
  inside `pre`, where each one ends a line. The result is plain text, not
  sanitised HTML: `&lt;b&gt;` comes back as `<b>`. Tags, comments and
  declarations are read as the HTML
  tokenizer reads them: a quote opens an attribute value only right after
  `=`, so a `>` inside a quoted value does not end the tag, and a `<` that is
  not followed by a letter, `/`, `!` or `?` is text. Markup that ends inside
  a tag, a comment or a dropped element loses that unterminated part, as it
  does in a browser: `PLAIN_TEXT("Hello <b"; "html")` is `"Hello"`.
- `"markdown"` — ATX heading markers, `>` quote markers, list markers (`-`,
  `*`, `+`, `1.`, `1)`), table pipes and the delimiter row, code fences,
  emphasis (`*`, `_`, `**`, `__`), inline-code backticks and backslash escapes
  are removed; `[text](url)` becomes `text`, `![alt](url)` becomes `alt` and
  `<url>` becomes `url`. A paragraph's lines join into one line and each line
  of a fenced code block stays a line. The document is read as
  [MARKDOWN_BLOCKS](#markdown_blocks) reads it.

HTML is read in one forward scan and markdown line by line; **Work** under
[Text](#text) gives what each costs.

```ts
await evalOk('PLAIN_TEXT("<p>A&amp;B</p><p>C&nbsp;D</p><script>x</script>"; "html")'); // "A&B\nC D"
await evalOk('PLAIN_TEXT("## Titel"; "markdown")'); // "Titel"
await evalOk('PLAIN_TEXT("[Link](https://x) and **bold**"; "markdown")'); // "Link and bold"
```

### MARKDOWN_BLOCKS

`MARKDOWN_BLOCKS(text: text, kind: text) -> list<text>`

The blocks of one `kind`, in document order, without their markers and with
inline markup removed as `PLAIN_TEXT` removes it. `kind` is a required
literal: `"heading"` (every level), `"heading-1"` … `"heading-6"`,
`"list-item"`, `"table-row"`, `"paragraph"` or `"code"`. A block's text is:

- for a heading, its text without the opening and closing `#`s;
- for a list item, its text and continuation lines — nested items are items
  of their own, and a bare marker with no text is no item. As in CommonMark,
  an item interrupts a paragraph only when it has text and, if ordered, starts
  at 1: a wrapped line opening with `2025.` continues its paragraph;
- for a table row, its non-empty cells joined by one space — every row except
  the delimiter row, the header row included, and a table needs its delimiter
  row;
- for a paragraph, its lines joined by one space;
- for a fenced code block, its content unchanged.

The reading is a line-based subset of CommonMark with GFM tables: ATX
headings only (no `===` or `---` underlines), fenced code only (no indented
code blocks), list items recognised by their marker at any indentation, and
`>` quote markers read through. The text is read line by line; **Work** under
[Text](#text) gives what it costs.

```ts
// value = '## 1. Erstens\n- item\n  - nested\n| A | B |\n|---|---|\n| 1 | 2 |'
await evalOk('MARKDOWN_BLOCKS(value; "heading-2")', { value }); // ["1. Erstens"]
await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value }); // ["item", "nested"]
await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value }); // ["A B", "1 2"]
```

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

`count` consecutive items, starting at the 1-based position `start` (default
`1`). A `count` of `0` yields `[]`; a run past the end yields the items that
exist. A negative or fractional `count` or `start`, or a `start` below `1`,
returns `null` with a `TYPE` warning.

```ts
await evalOk('TAKE(LIST(1; 2; 3); 2)'); // [1, 2]
await evalOk('TAKE(LIST(1; 2; 3); 2; 3)'); // [3]
await evalOk('TAKE(LIST(1; 2; 3); 0)'); // []
```

### INDEX_OF

`INDEX_OF(list: list<T>, value: T) -> number`

The 1-based position of the first item equal to `value` under the coerced
equality of `INCLUDES` and `=`, or `null` when no item is equal or `value` is
empty. `INDEX(list; INDEX_OF(...))` reads the item back. Text that reads as a
number finds that number (`"2"` finds `2`), the texts `true` and `false` (in
any case) find the booleans, and two objects, such as dates, are equal only as
the same value object. So on the dates `DISTINCT` keeps, `INDEX_OF` answers as
`INCLUDES` does: it finds the date `DISTINCT` kept, but not an equal date held
as another object, such as a second occurrence in input data. A list that holds a
list, the empty list included, or a list `value` returns `null` with a `TYPE`
warning.

```ts
await evalOk('INDEX_OF(LIST("a"; "b"); "b")'); // 2
await evalOk('INDEX_OF(LIST("a"; "b"; "a"); "a")'); // 1
await evalOk('INDEX_OF(LIST("a"; "b"); "c")'); // null
await evalOk('INDEX_OF(value; "2")', { value: [1, 2, 3] }); // 2
```

### FILTER_BY

`FILTER_BY(list: list<T>, keys: list<any>, operator: callable, operatorValue?: any) -> list<T>`

Keeps the items of `list` whose key — the item at the same position in
`keys` — satisfies the named `operator`, called as `(key)` or, when
`operatorValue` is given, `(key, operatorValue)`. `list` and `keys` must have
the same length; otherwise the result is `null` with a `TYPE` warning. The
operator is validated at parse time as for `FILTER`, and called as `FILTER`
calls it: the function behind an operator token, otherwise the first function
of that name that has an implementation. For an overloaded name that can be
another overload than the one the parser checked for the types of the keys and
of `operatorValue`: `STARTS_WITH` runs its text form, so a list of prefixes
keeps nothing. An operator with no implementation returns `null` with a `TYPE`
warning.

```ts
await evalOk('FILTER_BY(LIST("a"; "b"; "c"); LIST(9; 3; 12); ">"; 8)'); // ["a", "c"]
await evalOk(
  'FILTER_BY(LIST("x"; "y"; "z"); LIST("apple"; "banana"; "cherry"); "STARTS_WITH"; "b")',
); // ["y"]
// value = a list of callouts: keep those longer than eight words
await evalOk('FILTER_BY(value; EACH(value; "WORD_COUNT"); ">"; 8)', { value });
```

### DISTINCT

`DISTINCT(list: list<T>) -> list<T>`

The first occurrence of each distinct item, in order, with empty items
dropped. Text, numbers and booleans are equal by value and type, with no
conversion (`1` and `"1"` stay apart, as do `TRUE` and `"true"`, and text is
compared case-sensitively); dates, times and datetimes are equal when their
kind and `iso` text are. `GROUP_COUNTS` uses the same equality. `=`, `INCLUDES`
and `INDEX_OF` do not: they convert text to numbers and to booleans, and take
two date values held as separate objects (as input data holds them) for two
values, as `COUNT_UNIQUE` counts them. A list that holds a list, the empty list
included, or any other object returns `null` with a `TYPE` warning.

```ts
await evalOk('DISTINCT(LIST("x"; "y"; "x"; ""))'); // ["x", "y"]
await evalOk('COUNT(DISTINCT(LIST("a"; "A"; "a")))'); // 2
await evalOk('COUNT(DISTINCT(LIST(DATE(2024; 1; 2); DATE(2024; 1; 2))))'); // 1
```

### GROUP_COUNTS

`GROUP_COUNTS(list: list<any>) -> list<number>`

For each item of `DISTINCT(list)`, in the same order, how many items of `list`
equal it — so the two lists line up position by position. Items compare as in
`DISTINCT`: by value and type with no conversion, dates and times by kind and
`iso` text. `=`, `INCLUDES`, `INDEX_OF` and `COUNT_UNIQUE` differ: they take
two date values held as separate objects for two values, and the first three
convert text to numbers and to booleans. A list that holds a list, the empty
list included, or any other object returns `null` with a `TYPE` warning.

```ts
await evalOk('GROUP_COUNTS(LIST("x"; "y"; "x"; ""))'); // [2, 1]
// groups balanced within one: MAX(GROUP_COUNTS(value)) - MIN(GROUP_COUNTS(value)) <= 1
// the largest group: INDEX(DISTINCT(value); INDEX_OF(GROUP_COUNTS(value); MAX(GROUP_COUNTS(value))))
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
