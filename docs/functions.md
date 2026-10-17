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
  `evalErrors(source, variables?)`, from the same file, returns instead the
  codes of the errors the formula reports, and its comment shows them.
  `core-functions/src/functions/function-docs.spec.ts` runs the examples on
  this page and compares each result with its comment, read as JSON less a note
  in brackets after it, except six it names: two whose value is the current
  date, three that name a variable they do not give, and one whose comment
  marks its value with `~`.
- **Rules.** Some sections state their function as rules, one bullet each,
  every bullet followed by examples that show it, and close with one sentence
  naming the inputs whose result they leave unspecified. In those sections the
  comment of an `evalOk` call also names the warning the call attaches
  (`null with a TYPE warning`), and a comment that names none states that the
  call attaches none.

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
tokeniser, chosen by `mode` ([WORDS](#words) gives the modes); `SENTENCES` has
modes of its own and a `keep` list of tokens that end no sentence. There is no
locale sentence mode: `Intl.Segmenter` has no abbreviation data for sentences
and splits German `"Wir helfen z. B. Handwerkern."` after `z.` and after `B.`.
Embedders that count outside a formula import the same tokenisers from
`@formulang/core-functions`: `splitWords(text, mode?, option?)` and
`splitSentences(text, mode?, keep?)`.

**Bounds.** Each function's section states the bounds it applies:
`maxWildcardOutputLength` (5,000) to a list it returns and `maxListLength`
(1,000) to a list it reads, both raising `LIST_TOO_LARGE` as `FLAT` does. Each
`keep` token, and each phrase in `"word"` mode, is found with one
Knuth-Morris-Pratt search, in time linear in the lengths of the text and of the
token or phrase however often their occurrences overlap. Each phrase in `"substring"` mode, and each item of
`MISSING_FROM`, is found with one substring search, linear in the same
lengths. A phrase of up to 250 code units goes to the runtime's own search,
whose tables in V8 cover such a phrase whole. A longer one first has its last
250 code units looked for with that search: where they do not occur, neither
does the phrase, and where they first occur the whole phrase is compared once.
When those 250 code units repeat with a period of at most 63 (a run of one
letter, say), another window of 250 code units of the phrase, whose period is
longer, is looked for in the same way. The rest of the text is then read by a
scan that shifts by the pair of code units under the phrase's last two,
compares the phrase from its start where those two agree, and goes on with
Knuth-Morris-Pratt matching where the next place would start inside the units
it compared: it makes at most six comparisons for each code unit of the text.
V8's own search alone reads a longer phrase whose mismatch lies before its last
250 code units in time proportional to the text's length times the phrase's.
Measured on Node 22.23.3 under the default limits, best of three, with V8's own
search in brackets: on 1,000,000 code units of prose (random letters and
spaces), `MISSING_FROM` with `normalise` `"exact"` and 1,000 absent items of
300 code units takes 214 ms (207 ms); on a document of 5,000 entries of 300
code units that each end with the same 250-unit note, 1,000 absent items that
end with that note take 134 ms (1.0 s); on 100,000 code units of `a`,
`FIRST_CONTAINED` with ten phrases of 8,000 code units, `"ab"` followed by
`a`s, takes 5 ms (3.9 s). Where V8 finds a phrase's first code unit rarely and
rejects each such place at the next unit, its search is the faster: on 100,000
code units that repeat a 250-unit block holding the letter `c` once, at its
start, `FIRST_CONTAINED` with 1,000 phrases of `c` and the block 32 times takes
25 ms (6.6 ms).

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
or of a pattern. Each cost but that of the formula's own pattern (below) is
linear in the length of the text or list the function reads, and that length is
bounded only by what the runtime bounds:
`maxStringLiteralLength` bounds literals, not a text the formula computes, so a
`SUBSTITUTE` of a `SUBSTITUTE` in a 10,533-character source makes 25,000,000
code units, on which `FIRST_CONTAINED` with 43 phrases of 8,002 code units takes
0.97 s, as long as 43 phrases of 250 code units whose first character the text
holds take (1.0 s); building the text alone, `LEN`, takes 0.17 s.

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

- `"whitespace"` (the default): the text is trimmed and split at every run of whitespace, and the
  pieces are the words, in order. Whitespace is JavaScript's `\s`: spaces, tabs, line breaks, the
  no-break space U+00A0 and the byte order mark U+FEFF separate words; U+0085 and U+001C to
  U+001F do not, though Python's `str.split()` splits at them. A text of nothing but whitespace
  has no words.

  ```ts
  await evalOk('WORDS("  Kennst du   das? ")'); // ["Kennst", "du", "das?"]
  await evalOk('WORDS(value)', { value: 'a\tb\nc\u00A0d\uFEFFe' }); // ["a", "b", "c", "d", "e"]
  await evalOk('WORDS(value)', { value: 'a\u001Cb\u0085c' }); // ["a\u001cb\u0085c"]
  await evalOk('WORDS("")'); // []
  await evalOk('WORDS("  ")'); // []
  ```

- `"letters"`: the words are the runs of letters, marks and numbers (Unicode's `\p{L}`, `\p{M}`
  and `\p{N}`). One apostrophe (`'`, `’`) or one hyphen (`-`, U+2010, U+2011, the soft hyphen
  U+00AD) between two runs joins them into one word, and so does one `.` or `,` between two
  digits; every other character separates words.

  ```ts
  await evalOk('WORDS("Don\'t re-enter the e-mail, oder?"; "letters")'); // ["Don't", "re-enter", "the", "e-mail", "oder"]
  await evalOk('WORDS("Für 3,5 Mio. Kund:innen"; "letters")'); // ["Für", "3,5", "Mio", "Kund", "innen"]
  await evalOk('WORDS(value; "letters")', {
    value: 'it\u2019s E\u2010Mail Ge\u2011biet Silben\u00ADtrennung',
  }); // ["it\u2019s", "E\u2010Mail", "Ge\u2011biet", "Silben\u00adtrennung"]
  await evalOk('WORDS("a--b \'zitiert\' 3.5. x,y 1,2,3"; "letters")'); // ["a", "b", "zitiert", "3.5", "x", "y", "1,2,3"]
  ```

- `"locale"`: the segments `Intl.Segmenter` marks word-like for the BCP 47 language tag in
  `option` (`"de"`, `"en-GB"`). They come from the runtime's ICU data, so a runtime with other
  ICU data can answer otherwise; the other modes do not depend on ICU. A malformed tag, or one the
  runtime holds no segmentation data for, returns `null` with a `TYPE` warning instead of falling
  back to the host's locale.

  ```ts
  await evalOk('WORDS("Kund:innen"; "locale"; "de")'); // ["Kund:innen"]
  await evalOk('WORDS("Don\'t stop"; "locale"; "en-GB")'); // ["Don't", "stop"]
  await evalOk('WORDS("a b"; "locale"; "x-invalid-")'); // null with a TYPE warning
  await evalOk('WORDS("a b"; "locale"; "zz")'); // null with a TYPE warning
  ```

- `"pattern"`: every non-empty match of the regular expression in `option`, left to right. Of the
  options that hold no line terminator, one that starts with `/` and ends with `/` and lower-case
  letters (or none) is read as `/pattern/flags`, split at its last `/`: each flag is one of `i`,
  `m`, `s` and `u`, at most once, and `g` is implied, so any other letter, `g` included, or a flag
  written twice returns `null` with a `REGEX` warning; any other is the pattern as written, its
  slashes included.

  ```ts
  await evalOk('WORDS(LOWER("Für 50$ – sofort!"); "pattern"; "[A-Za-z0-9$\']+")'); // ["f", "r", "50$", "sofort"]
  await evalOk('WORDS("Ab ab"; "pattern"; "/ab/i")'); // ["Ab", "ab"]
  await evalOk('WORDS("/ab/I"; "pattern"; "/ab/I")'); // ["/ab/I"]
  await evalOk('WORDS("abc"; "pattern"; "x*")'); // []
  await evalOk('WORDS("Ab"; "pattern"; "/ab/g")'); // null with a REGEX warning
  await evalOk('WORDS("a"; "pattern"; "/a/ii")'); // null with a REGEX warning
  ```

- The pattern is compiled under the safety rules of [MATCH_EXPRESSION](#match_expression): a
  pattern they refuse as unsafe, and a text of more than `maxRegexTextLength` (8,000) code
  units, are errors, and a look-behind returns `null` with a `REGEX` warning. They do not bound
  the time a pattern they accept takes (**Work**, under [Text](#text)).

  ```ts
  await evalErrors('WORDS("aaa"; "pattern"; "(a+)+")'); // ["REGEX_UNSAFE"]
  await evalErrors('WORDS(value; "pattern"; "a")', { value: 'a'.repeat(8001) }); // ["REGEX_INPUT_TOO_LONG"]
  await evalOk('WORDS("ab"; "pattern"; "(?<=a)b")'); // null with a REGEX warning
  ```

- `option` belongs to `"locale"` and `"pattern"`: in the other modes any option, `""` included,
  returns `null` with a `TYPE` warning, and in those two an omitted or empty option does too. A
  `null` option is no option.

  ```ts
  await evalOk('WORDS("a b"; "whitespace"; "de")'); // null with a TYPE warning
  await evalOk('WORDS("a b"; "letters"; "")'); // null with a TYPE warning
  await evalOk('WORDS("a b"; "locale")'); // null with a TYPE warning
  await evalOk('WORDS("a b"; "pattern"; "")'); // null with a TYPE warning
  await evalOk('WORDS("a b"; "whitespace"; value)', { value: null }); // ["a", "b"]
  await evalOk('WORDS("a b"; "pattern"; value)', { value: null }); // null with a TYPE warning
  ```

- A `null` text returns `null`; a value that is not text returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('WORDS(value)', { value: null }); // null
  await evalOk('WORDS(value)', { value: 5 }); // null with a TYPE warning
  ```

- A result of more than `maxWildcardOutputLength` (5,000) words raises `LIST_TOO_LARGE`;
  [WORD_COUNT](#word_count) counts past it.

  ```ts
  await evalErrors('WORDS(value)', { value: 'w '.repeat(5001) }); // ["LIST_TOO_LARGE"]
  await evalOk('COUNT(WORDS(value))', { value: 'w '.repeat(5000) }); // 5000
  ```

Unspecified: in `"pattern"` mode, an option that holds a line terminator.

### WORD_COUNT

`WORD_COUNT(text: text, mode?: text, option?: text) -> number`

- The number of words [WORDS](#words) finds with the same arguments; where `WORDS` returns
  `null`, so does `WORD_COUNT`, with the same warning.

  ```ts
  await evalOk('WORD_COUNT("  Kennst du   das? ")'); // 3
  await evalOk('WORD_COUNT("Don\'t re-enter the e-mail, oder?"; "letters")'); // 5
  await evalOk('WORD_COUNT("a1b22"; "pattern"; "[0-9]+")'); // 2
  await evalOk('WORD_COUNT("a b"; "whitespace"; "de")'); // null with a TYPE warning
  await evalOk('WORD_COUNT(value)', { value: null }); // null
  await evalOk('WORD_COUNT(value)', { value: 5 }); // null with a TYPE warning
  ```

- `""`, and a text of nothing but whitespace, count `0`.

  ```ts
  await evalOk('WORD_COUNT("")'); // 0
  await evalOk('WORD_COUNT("  "; "letters")'); // 0
  ```

- No list is built, so a text of more than 5,000 words, where `WORDS` raises `LIST_TOO_LARGE`, is
  counted.

  ```ts
  await evalOk('WORD_COUNT(value)', { value: 'w '.repeat(5100) }); // 5100
  ```

Unspecified: in `"pattern"` mode, an option that holds a line terminator, as for `WORDS`.

### LEADING_WORDS

`LEADING_WORDS(text: text, count: number, mode?: text, option?: text) -> text`

- The first `count` words, as [WORDS](#words) finds them with `mode` and `option`, joined by one
  space; where `WORDS` returns `null`, so does `LEADING_WORDS`, with the same warning.

  ```ts
  await evalOk('LEADING_WORDS("eins zwei  drei vier"; 2)'); // "eins zwei"
  await evalOk('LEADING_WORDS("Don\'t re-enter it"; 2; "letters")'); // "Don't re-enter"
  await evalOk('EACH(LIST("a b"; "c d e"); "LEADING_WORDS"; 2)'); // ["a b", "c d"]
  await evalOk('LEADING_WORDS("a b"; 1; "whitespace"; "de")'); // null with a TYPE warning
  ```

- A text with fewer than `count` words returns `null`; one with exactly `count` gives them all.

  ```ts
  await evalOk('LEADING_WORDS("eins zwei"; 3)'); // null
  await evalOk('LEADING_WORDS("eins zwei"; 2)'); // "eins zwei"
  await evalOk('LEADING_WORDS(""; 1)'); // null
  ```

- A `count` that is not a positive whole number returns `null` with a `TYPE` warning; a `null`
  count returns `null`.

  ```ts
  await evalOk('LEADING_WORDS("a b"; 0)'); // null with a TYPE warning
  await evalOk('LEADING_WORDS("a b"; 2.5)'); // null with a TYPE warning
  await evalOk('LEADING_WORDS("a b"; -1)'); // null with a TYPE warning
  await evalOk('LEADING_WORDS("a b"; value)', { value: null }); // null
  ```

- A `null` text returns `null`; a value that is not text returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('LEADING_WORDS(value; 1)', { value: null }); // null
  await evalOk('LEADING_WORDS(value; 1)', { value: 5 }); // null with a TYPE warning
  ```

Unspecified: in `"pattern"` mode, an option that holds a line terminator, as for `WORDS`.

### SENTENCES

`SENTENCES(text: text, mode?: text, keep?: list<text>) -> list<text>`

- `"punctuation"` (the default): a sentence ends at each run of whitespace directly after `.`,
  `!` or `?`, as Python's `re.split(r"(?<=[.!?])\s+", text.strip())` splits, with JavaScript's
  whitespace: U+FEFF separates sentences, U+0085 and U+001C to U+001F do not.

  ```ts
  await evalOk('SENTENCES("Hi. Ok!  Next? end")'); // ["Hi.", "Ok!", "Next?", "end"]
  await evalOk('SENTENCES("3.5 Uhr. Gut.")'); // ["3.5 Uhr.", "Gut."]
  await evalOk('SENTENCES("Na ja… Gut.")'); // ["Na ja… Gut."]
  await evalOk('SENTENCES(value)', { value: 'Ja.\uFEFFNein.\u0085Doch.' }); // ["Ja.", "Nein.\u0085Doch."]
  ```

- `"terminators"`: every run of `.`, `!`, `?`, `。`, `！` and `？` ends a sentence and stays with
  it; a piece holding nothing but terminators is no sentence.

  ```ts
  await evalOk('SENTENCES("3.5 Uhr. Gut."; "terminators")'); // ["3.", "5 Uhr.", "Gut."]
  await evalOk('SENTENCES("Wirklich?! Ja。 Nein！"; "terminators")'); // ["Wirklich?!", "Ja。", "Nein！"]
  await evalOk('SENTENCES("Hm. ... Ja."; "terminators")'); // ["Hm.", "Ja."]
  ```

- Each sentence is trimmed, and a piece that is empty after trimming is dropped.

  ```ts
  await evalOk('SENTENCES("Hi. Ok ")'); // ["Hi.", "Ok"]
  await evalOk('SENTENCES(" Ja.  ")'); // ["Ja."]
  await evalOk('SENTENCES("")'); // []
  await evalOk('SENTENCES("!? ..."; "terminators")'); // []
  ```

- `keep` lists tokens that never end a sentence: a split that falls inside an occurrence of a
  listed token that neither starts nor ends with whitespace, or at its end, does not happen.
  Every such token counts, and their occurrences may overlap. An occurrence counts only at a word
  boundary: a token that starts with a letter, mark or number must not follow one (`"ca."` inside
  `Africa.` does not count), and a token that starts with anything else always counts. Tokens
  match case-sensitively; empty ones are skipped.

  ```ts
  await evalOk('SENTENCES("Wir helfen z. B. Handwerkern.")'); // ["Wir helfen z.", "B.", "Handwerkern."]
  await evalOk('SENTENCES("Wir helfen z. B. Handwerkern."; "punctuation"; LIST("z. B."))'); // ["Wir helfen z. B. Handwerkern."]
  await evalOk('SENTENCES("Dr. Smith kam z. B. heute."; "punctuation"; LIST("Dr."; "z. B."))'); // ["Dr. Smith kam z. B. heute."]
  await evalOk('SENTENCES("Das ist z. B. gut."; "punctuation"; LIST("z. B."; "z."))'); // ["Das ist z. B. gut."]
  await evalOk('SENTENCES("Africa. Ok."; "punctuation"; LIST("ca."))'); // ["Africa.", "Ok."]
  await evalOk('SENTENCES("Na ja... Gut."; "terminators"; LIST("..."))'); // ["Na ja... Gut."]
  await evalOk('SENTENCES("Dr. Who"; "punctuation"; LIST("dr."))'); // ["Dr.", "Who"]
  await evalOk('SENTENCES("a. b"; "punctuation"; LIST(""; "a."))'); // ["a. b"]
  ```

- A `null` text returns `null`, and a `null` `keep` is no list; a text that is not text, or a
  `keep` entry that is not text, returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('SENTENCES(value)', { value: null }); // null
  await evalOk('SENTENCES("a. b"; "punctuation"; value)', { value: null }); // ["a.", "b"]
  await evalOk('SENTENCES(value)', { value: 5 }); // null with a TYPE warning
  await evalOk('SENTENCES("a. b"; "punctuation"; value)', { value: [1] }); // null with a TYPE warning
  ```

- A result of more than `maxWildcardOutputLength` (5,000) sentences, and a `keep` list of more
  than `maxListLength` (1,000) tokens, raise `LIST_TOO_LARGE`.

  ```ts
  await evalErrors('SENTENCES(value)', { value: 'Ja. '.repeat(5001) }); // ["LIST_TOO_LARGE"]
  await evalErrors('SENTENCES("a. b"; "punctuation"; value)', { value: Array(1001).fill('x') }); // ["LIST_TOO_LARGE"]
  ```

Unspecified: a `keep` token that starts or ends with whitespace.

### LINES

`LINES(text: text, mode?: text) -> list<text>`

- The lines of `text`, as written (not trimmed): a line ends at `\r\n`, `\n`, `\r`, U+000B,
  U+000C, U+0085, U+2028 or U+2029, and a final line break ends the last line instead of starting
  an empty one.

  ```ts
  await evalOk('LINES(value)', { value: 'a\r\nb\rc\u000Bd\u000Ce\u0085f\u2028g\u2029h' }); // ["a", "b", "c", "d", "e", "f", "g", "h"]
  await evalOk('LINES(value; "all")', { value: 'a\n' }); // ["a"]
  await evalOk('LINES(value; "all")', { value: 'a\n\n' }); // ["a", ""]
  await evalOk('LINES(value)', { value: ' a ' }); // [" a "]
  await evalOk('LINES("")'); // []
  ```

- `"non-blank"` (the default) drops each line that is empty once trimmed of JavaScript's
  whitespace; `"all"` keeps it.

  ```ts
  await evalOk('LINES(value)', { value: 'a\n\n \t\u00A0\nb' }); // ["a", "b"]
  await evalOk('LINES(value; "all")', { value: 'a\n\n \t\u00A0\nb' }); // ["a", "", " \t\u00a0", "b"]
  await evalOk('LINES(value; "all")', { value: '\n' }); // [""]
  ```

- A `null` text returns `null`; a value that is not text returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('LINES(value)', { value: null }); // null
  await evalOk('LINES(value)', { value: 5 }); // null with a TYPE warning
  ```

- A result of more than `maxWildcardOutputLength` (5,000) lines raises `LIST_TOO_LARGE`;
  [LINE_COUNT](#line_count) counts past it.

  ```ts
  await evalErrors('LINES(value)', { value: 'x\n'.repeat(5001) }); // ["LIST_TOO_LARGE"]
  ```

Unspecified: nothing; these rules decide every text and mode.

### LINE_COUNT

`LINE_COUNT(text: text, mode?: text) -> number`

- The number of lines [LINES](#lines) returns with the same arguments; where `LINES` returns
  `null`, so does `LINE_COUNT`, with the same warning.

  ```ts
  await evalOk('LINE_COUNT(value)', { value: 'a\r\nb\rc' }); // 3
  await evalOk('LINE_COUNT(value)', { value: 'a\n\n b' }); // 2
  await evalOk('LINE_COUNT(value; "all")', { value: 'a\n\n b' }); // 3
  await evalOk('LINE_COUNT(value)', { value: null }); // null
  await evalOk('LINE_COUNT(value)', { value: 5 }); // null with a TYPE warning
  ```

- `""` counts `0`.

  ```ts
  await evalOk('LINE_COUNT("")'); // 0
  await evalOk('LINE_COUNT(""; "all")'); // 0
  ```

- No list is built, so a text of more than 5,000 lines, where `LINES` raises `LIST_TOO_LARGE`, is
  counted.

  ```ts
  await evalOk('LINE_COUNT(value)', { value: 'x\n'.repeat(5001) }); // 5001
  ```

Unspecified: nothing; these rules decide every text and mode.

### FIRST_CONTAINED

`FIRST_CONTAINED(text: text, phrases: list<text>, match?: text, ignoreCase?: boolean) -> text`

- The first phrase of `phrases`, in list order, that occurs in `text`, as the list holds it, so
  list order wins over the order in the text; `null` when none does, an empty list included.

  ```ts
  await evalOk('FIRST_CONTAINED("Gut, oder? Richtig?"; LIST("Richtig?"; "oder?"))'); // "Richtig?"
  await evalOk('FIRST_CONTAINED("ab"; LIST("abc"; "b"))'); // "b"
  await evalOk('FIRST_CONTAINED("abc"; LIST("x"; "y"))'); // null
  await evalOk('FIRST_CONTAINED("abc"; LIST())'); // null
  ```

- `"substring"` (the default): the phrase occurs anywhere in the text, compared code unit by code
  unit.

  ```ts
  await evalOk('FIRST_CONTAINED("the homeowner"; LIST("owner"))'); // "owner"
  await evalOk('FIRST_CONTAINED("Der Geschäftsführer"; LIST("führer"))'); // "führer"
  await evalOk('FIRST_CONTAINED("Owner"; LIST("owner"))'); // null
  ```

- `"word"`: an occurrence counts only when the characters directly before and after it are not
  letters, marks or numbers, or are the text's edges; any occurrence of the phrase can be the one.

  ```ts
  await evalOk('FIRST_CONTAINED("Der Geschäftsführer"; LIST("führer"); "word")'); // null
  await evalOk('FIRST_CONTAINED("the homeowner, the owner"; LIST("owner"); "word")'); // "owner"
  await evalOk('FIRST_CONTAINED("(owner)"; LIST("owner"); "word")'); // "owner"
  await evalOk('FIRST_CONTAINED("owner2"; LIST("owner"); "word")'); // null
  ```

- `ignoreCase` `TRUE` compares after lower-casing both sides as [LOWER](#lower) does; `FALSE` and
  `null` compare as written. The answer is the phrase as the list holds it.

  ```ts
  await evalOk('FIRST_CONTAINED("KENNST DU DAS?"; LIST("kennst du das?"); "substring"; TRUE)'); // "kennst du das?"
  await evalOk('FIRST_CONTAINED("Product Owner,"; LIST("product owner"); "word"; TRUE)'); // "product owner"
  await evalOk('FIRST_CONTAINED("ABC"; LIST("b"); "substring"; FALSE)'); // null
  await evalOk('FIRST_CONTAINED("abc"; LIST("b"); "substring"; value)', { value: null }); // "b"
  ```

- Empty phrases are skipped.

  ```ts
  await evalOk('FIRST_CONTAINED("abc"; LIST(""; "b"))'); // "b"
  await evalOk('FIRST_CONTAINED("abc"; LIST(""))'); // null
  ```

- A `null` text or list returns `null`; a text that is not text, a list holding a value that is
  not text, or an `ignoreCase` that is not a boolean returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('FIRST_CONTAINED(value; LIST("a"))', { value: null }); // null
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: null }); // null
  await evalOk('FIRST_CONTAINED(value; LIST("a"))', { value: 5 }); // null with a TYPE warning
  await evalOk('FIRST_CONTAINED("abc"; value)', { value: ['a', 1] }); // null with a TYPE warning
  await evalOk('FIRST_CONTAINED("abc"; LIST("b"); "substring"; value)', { value: 'yes' }); // null with a TYPE warning
  ```

- A list of more than `maxListLength` (1,000) phrases raises `LIST_TOO_LARGE`.

  ```ts
  await evalErrors('FIRST_CONTAINED("abc"; value)', { value: Array(1001).fill('x') }); // ["LIST_TOO_LARGE"]
  ```

Unspecified: nothing; these rules decide every text, list and option.

### CONTAINS_ANY

`CONTAINS_ANY(text: text, phrases: list<text>, match?: text, ignoreCase?: boolean) -> boolean`

- Whether [FIRST_CONTAINED](#first_contained) finds a phrase with the same arguments: `TRUE` where
  it answers a phrase, `FALSE` where it finds none, an empty list included, and `null`, with the
  same warning, where it returns `null` for its arguments.

  ```ts
  await evalOk('CONTAINS_ANY("the homeowner"; LIST("owner"))'); // true
  await evalOk('CONTAINS_ANY("the homeowner"; LIST("owner"); "word")'); // false
  await evalOk('CONTAINS_ANY("ABC"; LIST("b"); "substring"; TRUE)'); // true
  await evalOk('CONTAINS_ANY("abc"; LIST())'); // false
  await evalOk('CONTAINS_ANY("abc"; LIST(""))'); // false
  await evalOk('CONTAINS_ANY(value; LIST("a"))', { value: null }); // null
  await evalOk('CONTAINS_ANY(value; LIST("a"))', { value: 5 }); // null with a TYPE warning
  await evalErrors('CONTAINS_ANY("abc"; value)', { value: Array(1001).fill('x') }); // ["LIST_TOO_LARGE"]
  ```

Unspecified: nothing; these rules decide every text, list and option.

### MISSING_FROM

`MISSING_FROM(items: list<text>, text: text, normalise?: text) -> list<text>`

- The items, in order and as listed, that `text` does not contain once both sides are normalised
  as `normalise` says.

  ```ts
  await evalOk('MISSING_FROM(LIST("b"; "x"; "a"); "abc"; "exact")'); // ["x"]
  await evalOk('MISSING_FROM(LIST(" x "); "abc")'); // [" x "]
  ```

- `"whitespace"` (the default): both sides are trimmed and every run of whitespace, JavaScript's
  `\s` with line breaks and the no-break space U+00A0, becomes one space.

  ```ts
  await evalOk('MISSING_FROM(LIST("liefern schnell"; "billig"); value)', {
    value: 'Wir liefern\n  schnell.',
  }); // ["billig"]
  await evalOk('MISSING_FROM(LIST("liefern schnell"); value)', {
    value: 'Wir liefern\u00A0schnell.',
  }); // []
  await evalOk('MISSING_FROM(LIST(" billig "); "billig")'); // []
  ```

- `"exact"`: both sides as written.

  ```ts
  await evalOk('MISSING_FROM(LIST("liefern schnell"); value; "exact")', {
    value: 'liefern  schnell',
  }); // ["liefern schnell"]
  await evalOk('MISSING_FROM(LIST("Liefern"); "liefern"; "exact")'); // ["Liefern"]
  ```

- `"loose"`: as `"whitespace"`, and both sides lower-cased as [LOWER](#lower) does, with the
  typographic quotes `‘ ’ ‚ ‛ ‹ ›` folded to `'` and `“ ” „ ‟ « »` to `"`, and the dashes U+2010
  to U+2015 and the minus sign U+2212 to `-`.

  ```ts
  await evalOk('MISSING_FROM(LIST("\\"hallo\\""); value; "loose")', { value: 'Er sagte „Hallo“.' }); // []
  await evalOk('MISSING_FROM(LIST("it\'s"); value; "loose")', { value: 'IT\u2019S' }); // []
  await evalOk('MISSING_FROM(LIST("a-b"); value; "loose")', { value: 'A\u2013B' }); // []
  await evalOk('MISSING_FROM(LIST("a-b"); value; "loose")', { value: 'A\u2212B' }); // []
  await evalOk('MISSING_FROM(LIST("liefern  schnell"); value; "loose")', {
    value: 'LIEFERN\nSCHNELL',
  }); // []
  ```

- Items that are empty once normalised are skipped.

  ```ts
  await evalOk('MISSING_FROM(LIST(""; "  "; "x"); "abc")'); // ["x"]
  await evalOk('MISSING_FROM(LIST(""; "x"); "abc"; "exact")'); // ["x"]
  ```

- A `null` list or text returns `null`; a text that is not text, or an item that is not text,
  returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('MISSING_FROM(value; "abc")', { value: null }); // null
  await evalOk('MISSING_FROM(LIST("a"); value)', { value: null }); // null
  await evalOk('MISSING_FROM(LIST("a"); value)', { value: 5 }); // null with a TYPE warning
  await evalOk('MISSING_FROM(value; "abc")', { value: ['a', 2] }); // null with a TYPE warning
  ```

- A list of more than `maxListLength` (1,000) items raises `LIST_TOO_LARGE`.

  ```ts
  await evalErrors('MISSING_FROM(value; "abc")', { value: Array(1001).fill('x') }); // ["LIST_TOO_LARGE"]
  ```

Unspecified: nothing; these rules decide every list, text and mode.

### PLAIN_TEXT

`PLAIN_TEXT(markup: text, format: text) -> text`

- The text of `markup`, read as the required `format`, `"html"` or `"markdown"`, says: one line
  per block, whitespace (JavaScript's `\s`) collapsed to one space within each line, each line
  trimmed, and blank lines dropped.

  ```ts
  await evalOk('PLAIN_TEXT("<p>A&amp;B</p><p>C&nbsp;D</p>"; "html")'); // "A&B\nC D"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '# Titel\n\nZeile  eins\nZeile zwei' }); // "Titel\nZeile eins Zeile zwei"
  await evalOk('PLAIN_TEXT(""; "html")'); // ""
  ```

- In `"html"`, a tag runs from `<` followed by an ASCII letter, or `</` followed by one, to the
  first `>` that is not inside a quoted attribute value, and is removed with its attributes. A
  quoted value is one in double or single quotes that directly follows an attribute name and `=`,
  spaces allowed around the `=` (`name="…"`, `name = '…'`); a quote anywhere else is an ordinary
  character. Tag names are read in either letter case.

  ```ts
  await evalOk('PLAIN_TEXT(value; "html")', {
    value: '<b>bold</b> <a href="x" title="a > b">link</a>',
  }); // "bold link"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<a b=c d="x>y">z' }); // "z"
  await evalOk('PLAIN_TEXT(value; "html")', { value: "<a title='a > b'>x</a>" }); // "x"
  await evalOk('PLAIN_TEXT("<P>a</P><DIV>b</DIV>"; "html")'); // "a\nb"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<a title = "a > b">x</a>' }); // "x"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<a "b>c">d' }); // "c\">d"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<a b=="x>y">z' }); // "y\">z"
  ```

- In `"html"`, a `<` followed by anything but an ASCII letter, `/`, `!` or `?`, or at the end of
  the markup, is text.

  ```ts
  await evalOk('PLAIN_TEXT("1 < 2 and a <3 <"; "html")'); // "1 < 2 and a <3 <"
  ```

- In `"html"`, a comment is dropped: from `<!--` to the next `-->` or `--!>` after it, `<!-->` and
  `<!--->` being whole comments. So is any other `<!` or `<?` up to the next `>`, as a document
  type or a processing instruction is.

  ```ts
  await evalOk('PLAIN_TEXT("a<!-- x -->b"; "html")'); // "ab"
  await evalOk('PLAIN_TEXT("a<!-- x --->b"; "html")'); // "ab"
  await evalOk('PLAIN_TEXT("a<!-- <p>x</p> -->b"; "html")'); // "ab"
  await evalOk('PLAIN_TEXT("a<!-->b-->c"; "html")'); // "ab-->c"
  await evalOk('PLAIN_TEXT("a<!--->b"; "html")'); // "ab"
  await evalOk('PLAIN_TEXT("a<!-- x --!>b<!-- y --!z -->c"; "html")'); // "abc"
  await evalOk('PLAIN_TEXT(value; "html")', {
    value: "<!DOCTYPE html><?xml version='1.0'?><p>x</p>",
  }); // "x"
  ```

- In `"html"`, the content of `script`, `style` and `title` is dropped up to the element's end
  tag, written in any letter case; nothing else inside ends it.

  ```ts
  await evalOk(
    'PLAIN_TEXT("a<script>if (x < 1) {}</script>b<style>p{}</style>c<title>T</title>d"; "html")',
  ); // "abcd"
  await evalOk('PLAIN_TEXT("a<SCRIPT>x</SCRIPT>b"; "html")'); // "ab"
  await evalOk('PLAIN_TEXT(value; "html")', { value: "a<script>'</p>'</script>b" }); // "ab"
  await evalOk('PLAIN_TEXT("a<script><!--<script></script>-->b</script>c"; "html")'); // "a-->bc"
  ```

- In `"html"`, the content of `noscript`, `noframes` and `template` is dropped, up to the
  element's end tag as for `script`, while the document is in its head: from its start until
  text other than spaces, tabs, line breaks and form feeds, a character reference included, the
  start tag of an element other than `html`, `head` and those that belong in a head (`base`,
  `basefont`, `bgsound`, `link`, `meta`, `noframes`, `noscript`, `script`, `style`, `template`
  and `title`), or one of the end tags `</head>`, `</body>`, `</html>` and `</br>`. After that
  their content is text.

  ```ts
  await evalOk('PLAIN_TEXT(value; "html")', {
    value:
      '<html><head><title>T</title><meta charset="utf-8"><noscript>N</noscript></head><body><p>B</p></body></html>',
  }); // "B"
  await evalOk('PLAIN_TEXT("<noscript>N</noscript>x"; "html")'); // "x"
  await evalOk('PLAIN_TEXT("</p><noscript>N</noscript>x"; "html")'); // "x"
  await evalOk('PLAIN_TEXT("<head></head><noscript>N</noscript>"; "html")'); // "N"
  await evalOk('PLAIN_TEXT("<p>a</p><noscript>N</noscript>"; "html")'); // "a\nN"
  await evalOk('PLAIN_TEXT("<head>x<noscript>N</noscript></head>"; "html")'); // "xN"
  await evalOk('PLAIN_TEXT("&nbsp;<head><noscript>N</noscript></head>x"; "html")'); // "Nx"
  ```

- In `"html"`, `address`, `article`, `aside`, `blockquote`, `br`, `dd`, `div`, `dl`, `dt`,
  `figcaption`, `figure`, `footer`, `h1`–`h6`, `header`, `hr`, `li`, `main`, `nav`, `ol`, `p`,
  `pre`, `section`, `table`, `td`, `th`, `tr` and `ul` end a line where they open or close; no
  other tag ends one, and a line break in the markup is whitespace.

  ```ts
  await evalOk('PLAIN_TEXT("<ul><li>a</li><li>b</li></ul>x<br>y<hr>z"; "html")'); // "a\nb\nx\ny\nz"
  await evalOk('PLAIN_TEXT("<table><tr><td>1</td><td>2</td></tr></table>"; "html")'); // "1\n2"
  await evalOk('PLAIN_TEXT("<div>  </div>x<span>y</span>"; "html")'); // "xy"
  await evalOk('PLAIN_TEXT(value; "html")', { value: 'a\n  b\t c' }); // "a b c"
  ```

- In `"html"`, inside `pre`, a nested `pre` included, each line break (`\n`, `\r` or `\r\n`),
  written in the markup or given by a character reference, ends a line; whitespace still
  collapses within those lines, and blank ones are dropped.

  ```ts
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<pre>a\nb</pre>c\nd' }); // "a\nb\nc d"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<pre>a</pre>b\nc' }); // "a\nb c"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<pre><pre>a</pre>b\nc</pre>d\ne' }); // "a\nb\nc\nd e"
  await evalOk('PLAIN_TEXT(value; "html")', { value: '<pre>a  b\n\n  c</pre>' }); // "a b\nc"
  await evalOk('PLAIN_TEXT("<pre>a&#10;b&#13;c</pre>d&#10;e"; "html")'); // "a\nb\nc\nd e"
  ```

- In `"html"`, a numeric reference, decimal (`&#150;`) or hexadecimal (`&#x96;`, `&#X96;`), with
  one digit or more, leading zeros included, gives its code point, except that zero, a surrogate
  and a value past U+10FFFF give U+FFFD, and 128 to 159 give the windows-1252 character where that
  encoding has one and stay C1 controls where it has none.

  ```ts
  await evalOk('PLAIN_TEXT("&#65;&#x42;&#X43;&#0067;"; "html")'); // "ABCC"
  await evalOk('PLAIN_TEXT("a&#1;b&#127;c&#x10FFFF;"; "html")'); // "a\u0001b\u007fc\udbff\udfff"
  await evalOk('PLAIN_TEXT("&#0;&#xD800;&#xDFFF;&#x110000;"; "html")'); // "\ufffd\ufffd\ufffd\ufffd"
  await evalOk('PLAIN_TEXT("&#150;&#159;&#128;&#129;"; "html")'); // "\u2013\u0178\u20ac\u0081"
  ```

- In `"html"`, the 252 named references of HTML 4 (`&amp;`, `&nbsp;`, `&euro;` and the rest)
  give the characters the HTML standard's table maps them to, `&lang;` and `&rang;` U+27E8 and
  U+27E9. A reference needs its closing `;`, and any other name stays as written.

  ```ts
  await evalOk('PLAIN_TEXT("&auml;&euro;&lang;x&rang;"; "html")'); // "ä€\u27e8x\u27e9"
  await evalOk('PLAIN_TEXT("&amp &AMP; &foo; &amp;amp;"; "html")'); // "&amp &AMP; &foo; &amp;"
  ```

- In `"html"`, markup that ends inside a tag, a comment, a `<!` or `<?`, or dropped content loses
  that unfinished part.

  ```ts
  await evalOk('PLAIN_TEXT("Hello <b"; "html")'); // "Hello"
  await evalOk('PLAIN_TEXT("a<!-- x"; "html")'); // "a"
  await evalOk('PLAIN_TEXT("a<!DOCTYPE"; "html")'); // "a"
  await evalOk('PLAIN_TEXT("a<script>x"; "html")'); // "a"
  await evalOk('PLAIN_TEXT(value; "html")', { value: 'a<script>x</script b="y' }); // "a"
  ```

- In `"html"`, the result is plain text, not HTML: a reference to `<` gives `<`.

  ```ts
  await evalOk('PLAIN_TEXT("&lt;b&gt;"; "html")'); // "<b>"
  ```

- In `"markdown"`, the document is read into blocks as [MARKDOWN_BLOCKS](#markdown_blocks) reads
  it, and each block gives one line: a heading's, a list item's or a table row's text, or a
  paragraph's lines joined by one space; each line of a fenced code block stays a line.

  ````ts
  await evalOk('PLAIN_TEXT("## Titel"; "markdown")'); // "Titel"
  await evalOk('PLAIN_TEXT("> zitat"; "markdown")'); // "zitat"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '- a\n1. b\n2) c' }); // "a\nb\nc"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '| A | B |\n|---|---|\n| 1 | 2 |' }); // "A B\n1 2"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '```\na\nb\n```' }); // "a\nb"
  ````

- In `"markdown"`, emphasis: a run of `*` or `_` is left-flanking when the character after it is
  not whitespace and not punctuation, or is punctuation and the character before the run is
  whitespace or punctuation; it is right-flanking in the mirror case (whitespace is JavaScript's
  `\s` or the text's edge, punctuation a character of Unicode's P or S categories). A `*` run can
  open when it is left-flanking and close when it is right-flanking; a `_` run can open when it
  is left-flanking and either not right-flanking or after punctuation, and close when it is
  right-flanking and either not left-flanking or before punctuation. A run that can close is
  removed together with the nearest run of the same character before it that can open, whatever
  their lengths, and the runs of the other character opened between the two pair no more; a run
  that pairs with none stays.

  ```ts
  await evalOk('PLAIN_TEXT("**bold** and _it_ and __b__ and *i*"; "markdown")'); // "bold and it and b and i"
  await evalOk('PLAIN_TEXT("**bold _and_ more**"; "markdown")'); // "bold and more"
  await evalOk('PLAIN_TEXT("_a *b* c_"; "markdown")'); // "a b c"
  await evalOk('PLAIN_TEXT("*a _b* c_"; "markdown")'); // "a _b c_"
  await evalOk('PLAIN_TEXT("(*it*), *a*."; "markdown")'); // "(it), a."
  await evalOk('PLAIN_TEXT("snake_case * x **a"; "markdown")'); // "snake_case * x **a"
  await evalOk('PLAIN_TEXT("2*3*4"; "markdown")'); // "234"
  ```

- In `"markdown"`, a run of backticks pairs with the next run of exactly as many, and the code
  span between them keeps its text as written, less one space at each end when it starts and
  ends with a space and holds more than whitespace; other whitespace at its ends, a tab or a
  no-break space, stays. A run with no partner stays.

  ```ts
  await evalOk('PLAIN_TEXT("Use `a*b*c` here"; "markdown")'); // "Use a*b*c here"
  await evalOk('PLAIN_TEXT("`` a ` b ``"; "markdown")'); // "a ` b"
  await evalOk('PLAIN_TEXT("x` a `y"; "markdown")'); // "xay"
  await evalOk('PLAIN_TEXT("`x"; "markdown")'); // "`x"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: 'a`\tx\t`b c`\u00A0y\u00A0`d' }); // "a x b c y d"
  ```

- In `"markdown"`, a backslash before an ASCII punctuation character is removed, except inside a
  code span or an autolink, where it stays; a backslash before anything else stays, and one at
  the end of a paragraph line other than the last (a hard line break) is dropped.

  ```ts
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '\\*not em\\* a\\b' }); // "*not em* a\\b"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '`\\*`' }); // "\\*"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '<https://x.de/a\\_b>' }); // "https://x.de/a\\_b"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: 'a\\\nb\\' }); // "a b\\"
  ```

- In `"markdown"`, for link text of at most 1,000 code units, a destination of at most 2,000 and
  nested pairs of at most 500, an inline link `[text](url)` gives `text` and an image
  `![alt](url)` gives `alt`; `[text][ref]` and a `[ref]: url` line stay as written. Link text may
  hold brackets nested one level deep, and a destination parentheses nested one level deep, in
  pairs; an escaped bracket is a bracket all the same.

  ```ts
  await evalOk('PLAIN_TEXT("[Link](https://x) and ![Bild](b.png)"; "markdown")'); // "Link and Bild"
  await evalOk('PLAIN_TEXT("[a [b] c](u) [x](u (v)) [t][r]"; "markdown")'); // "a [b] c x [t][r]"
  await evalOk('PLAIN_TEXT("[a [b [c]] d](u)"; "markdown")'); // "[a [b [c]] d](u)"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '[a \\[b] c](u) [r]: https://x' }); // "a [b] c [r]: https://x"
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: '[a \\[b c](u)' }); // "[a [b c](u)"
  ```

- In `"markdown"`, up to 2,000 code units after the scheme's `:` and 256 on each side of an
  address's `@`, `<url>` gives `url` when its scheme is a letter followed by letters, digits, `+`,
  `.` or `-`, 2 to 32 characters in all, and the rest after its `:` holds no whitespace, `<` or
  `>`; `<name@host>` gives `name@host` when neither side holds whitespace, `<`, `>` or `@`; any
  other such `<…>` stays as written.

  ```ts
  await evalOk('PLAIN_TEXT("<https://x.de> <HTTP://y.de> <a@b.de> <x> <ab:c d>"; "markdown")'); // "https://x.de HTTP://y.de a@b.de <x> <ab:c d>"
  ```

- A `null` markup returns `null`; a value that is not text returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('PLAIN_TEXT(value; "html")', { value: null }); // null
  await evalOk('PLAIN_TEXT(value; "markdown")', { value: 5 }); // null with a TYPE warning
  ```

Unspecified: in `"html"`, `</` followed by anything but an ASCII letter; in `"markdown"`, HTML
tags and character references, link text of more than 1,000 code units, a destination of more
than 2,000 or a nested pair of more than 500, an autolink of more than 2,000 code units after
its scheme or more than 256 on a side of an address's `@`, and what `MARKDOWN_BLOCKS` leaves
unspecified.

### MARKDOWN_BLOCKS

`MARKDOWN_BLOCKS(text: text, kind: text) -> list<text>`

- The blocks of one `kind`, in document order, each without its markers and with its inline
  markup removed as [PLAIN_TEXT](#plain_text) removes it; in every block but a code block,
  whitespace (JavaScript's `\s`) is then collapsed to one space and the text trimmed. `kind` is
  required: `"heading"` (every level), `"heading-1"` … `"heading-6"`, `"list-item"`,
  `"table-row"`, `"paragraph"` or `"code"`.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "heading-2")', { value: '# A\n## B\n## C' }); // ["B", "C"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', { value: '# A\n## B\n## C' }); // ["A", "B", "C"]
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '- **bold** [l](u)' }); // ["bold l"]
  await evalOk('MARKDOWN_BLOCKS(""; "paragraph")'); // []
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', { value: '#  a\u00A0\t b  ' }); // ["a b"]
  ```

- The text is read line by line, and a line ends at `\n`, `\r` or `\r\n`; U+2028 and U+2029 end
  none, though they end one for [LINES](#lines). A blank line ends the open block.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\r\rb\r\nc\n\nd' }); // ["a", "b c", "d"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\u2028b' }); // ["a b"]
  ```

- A heading is one to six `#`s after at most three spaces, followed by a space, a tab or the end
  of the line; its text is the rest of the line less a closing run of `#`s that follows a space
  or a tab. There are no `===` or `---` underlines.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', {
    value: '# Titel #\n   ### drei\n# C#\n#\n#\tTab',
  }); // ["Titel", "drei", "C#", "", "Tab"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: '#x\n####### x\n    # vier' }); // ["#x ####### x # vier"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading-6")', { value: '###### F\n####### G' }); // ["F"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', { value: 'Titel\n===' }); // []
  ```

- `>` quote markers are read through: up to three spaces, `>` and one optional space, again for
  each level of nesting. A tab after `>` is no part of the marker: it stays in the line.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: '> > zitat\n>weiter' }); // ["zitat weiter"]
  await evalOk('MARKDOWN_BLOCKS(value; "heading")', { value: '   > # h' }); // ["h"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: '    > x' }); // ["> x"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '>~~~\n>\tcode\n>~~~' }); // ["\tcode"]
  ```

- A code fence is three or more backticks or tildes after any number of spaces, and a backtick
  fence's text after it holds no backtick. The fenced block holds the lines up to a closing line
  of at least as many of the same character with only spaces or tabs around them, each losing up
  to as many leading spaces as precede the opening fence; an unclosed fence runs to the end.

  ````ts
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '```js\nconst a = 1;\n```' }); // ["const a = 1;"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '  ~~~\n  a\n   b\n  ~~~~' }); // ["a\n b"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '```\nx\n``\n```' }); // ["x\n``"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '```\na' }); // ["a"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: '``` a`b\nx' }); // ["``` a`b x"]
  ````

- A thematic break, three or more of one of `-`, `*` and `_` after at most three spaces, with
  spaces or tabs between them allowed, ends the block before it and gives no block.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\n---\nb\n* * *\nc\n   ___\nd' }); // ["a", "b", "c", "d"]
  ```

- A list item starts with `-`, `*`, `+`, or one to nine digits and `.` or `)`, after any spaces
  or tabs, followed by a space, a tab or the end of the line. Its text runs on over the lines
  after it up to a blank line or a line that starts another block; a nested item is an item of
  its own, and a marker with no text is no item.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', {
    value: '- a\n  - b\n\t- c\n3) d\n+ e\n123456789. f',
  }); // ["a", "b", "c", "d", "e", "f"]
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '- a\nmore\n- b' }); // ["a more", "b"]
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: '-x\n\n-\n- y' }); // ["y"]
  ```

- A list item interrupts a paragraph only when it has text and, if ordered, its number is 1;
  otherwise the line continues the paragraph.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: 'Text\n- a' }); // ["a"]
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: 'Text\n1. eins' }); // ["eins"]
  await evalOk('MARKDOWN_BLOCKS(value; "list-item")', { value: 'Text\n01. eins' }); // ["eins"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'Text\n2025. war gut\n-' }); // ["Text 2025. war gut -"]
  ```

- A table starts at a line holding `|` whose next line, also holding `|`, is a delimiter row with
  one cell per header cell, each of dashes with an optional colon at either end. It ends a
  paragraph it starts in and runs to a blank line or the next heading, list item, fence or
  thematic break. Each row but the delimiter row, the header row included, is a block: its cells
  trimmed and the non-empty ones joined by one space, with cells past the header's count dropped
  and `\|` inside a cell read as a pipe.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', {
    value: '| A | B |\n|---|:-:|\n| 1 | 2 | 3 |\n| x\\|y | |',
  }); // ["A B", "1 2", "x|y"]
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: 'Name\n|---|' }); // []
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', { value: '| A | B |\n|---|\n| 1 | 2 |' }); // []
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', {
    value: 'Text\n| A | B |\n|---|---|\n| 1 | 2 |\n\nnach',
  }); // ["Text", "nach"]
  await evalOk('MARKDOWN_BLOCKS(value; "table-row")', {
    value: '| A | B |\n|---|---|\n| 1 | 2 |\n# H\n| 3 | 4 |',
  }); // ["A B", "1 2"]
  ```

- A paragraph is a run of lines that start no other block, and its block is those lines joined
  by one space. There are no indented code blocks, HTML blocks or link reference definitions:
  their lines are paragraph text. A line whose `#`, `>`, fence or thematic-break marker follows a
  tab is no part of this rule; the closing sentence leaves it unspecified.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'a\nb\n\nc' }); // ["a b", "c"]
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', {
    value: '    code\n<div>x</div>\n[r]: https://x',
  }); // ["code <div>x</div> [r]: https://x"]
  await evalOk('MARKDOWN_BLOCKS(value; "code")', { value: '    code' }); // []
  ```

- A `null` text returns `null`; a value that is not text returns `null` with a `TYPE` warning.

  ```ts
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: null }); // null
  await evalOk('MARKDOWN_BLOCKS(value; "paragraph")', { value: 5 }); // null with a TYPE warning
  ```

- A result of more than `maxWildcardOutputLength` (5,000) blocks raises `LIST_TOO_LARGE`.

  ```ts
  await evalErrors('MARKDOWN_BLOCKS(value; "paragraph")', { value: 'x\n\n'.repeat(5001) }); // ["LIST_TOO_LARGE"]
  ```

Unspecified: a `#`, `>`, fence or thematic-break marker preceded by a tab.

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

- `count` consecutive items, from the 1-based position `start`; an omitted or `null` `start` is
  `1`.

  ```ts
  await evalOk('TAKE(LIST(1; 2; 3); 2)'); // [1, 2]
  await evalOk('TAKE(LIST(1; 2; 3); 2; 2)'); // [2, 3]
  await evalOk('TAKE(LIST(1; 2; 3); 1; value)', { value: null }); // [1]
  ```

- A `count` of `0` gives `[]`, and a run past the end gives the items that exist.

  ```ts
  await evalOk('TAKE(LIST(1; 2; 3); 0)'); // []
  await evalOk('TAKE(LIST(1; 2; 3); 2; 3)'); // [3]
  await evalOk('TAKE(LIST(1; 2; 3); 5)'); // [1, 2, 3]
  await evalOk('TAKE(LIST(1; 2; 3); 1; 4)'); // []
  await evalOk('TAKE(LIST(); 2)'); // []
  ```

- A negative or fractional `count` or `start`, or a `start` below `1`, returns `null` with a
  `TYPE` warning.

  ```ts
  await evalOk('TAKE(LIST(1; 2; 3); -1)'); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2; 3); 1.5)'); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2; 3); 1; 0)'); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2; 3); 1; 1.5)'); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2; 3); 1; -1)'); // null with a TYPE warning
  ```

- A `null` list or `count` returns `null`; a list or a `count` of another type returns `null`
  with a `TYPE` warning.

  ```ts
  await evalOk('TAKE(value; 1)', { value: null }); // null
  await evalOk('TAKE(LIST(1; 2; 3); value)', { value: null }); // null
  await evalOk('TAKE(value; 1)', { value: 'abc' }); // null with a TYPE warning
  await evalOk('TAKE(LIST(1; 2; 3); value)', { value: '2' }); // null with a TYPE warning
  ```

- A list of more than `maxListLength` (1,000) items raises `LIST_TOO_LARGE`.

  ```ts
  await evalErrors('TAKE(value; 1)', { value: Array(1001).fill(1) }); // ["LIST_TOO_LARGE"]
  ```

Unspecified: nothing; these rules decide every list, count and start.

### INDEX_OF

`INDEX_OF(list: list<T>, value: T) -> number`

- The 1-based position of the first item equal to `value`, so
  `INDEX(list; INDEX_OF(list; value))` reads it back.

  ```ts
  await evalOk('INDEX_OF(LIST("a"; "b"; "a"); "a")'); // 1
  await evalOk('INDEX_OF(LIST("a"; "b"); "b")'); // 2
  await evalOk('INDEX(LIST("a"; "b"); INDEX_OF(LIST("a"; "b"); "b"))'); // "b"
  ```

- Items compare as [INCLUDES](#includes) and `=` compare them: text that reads as a number equals
  that number, and the texts `true` and `false`, in any letter case, equal the booleans; other
  text compares case-sensitively.

  ```ts
  await evalOk('INDEX_OF(value; "2")', { value: [1, 2, 3] }); // 2
  await evalOk('INDEX_OF(value; 2)', { value: ['1', '2'] }); // 2
  await evalOk('INDEX_OF(value; "TRUE")', { value: [false, true] }); // 2
  await evalOk('INDEX_OF(value; "true")', { value: ['TRUE', true] }); // 1
  await evalOk('INDEX_OF(value; "A")', { value: ['a', 'A'] }); // 2
  ```

- `null` when no item is equal, or when `value` is empty.

  ```ts
  await evalOk('INDEX_OF(LIST("a"; "b"); "c")'); // null
  await evalOk('INDEX_OF(LIST("a"; ""); "")'); // null
  await evalOk('INDEX_OF(LIST(1; 2); value)', { value: null }); // null
  ```

- A list that holds a list, the empty list included, or a list as `value`, returns `null` with a
  `TYPE` warning; a `null` list returns `null`, and a list of another type `null` with a `TYPE`
  warning.

  ```ts
  await evalOk('INDEX_OF(value; 1)', { value: [[1], 2] }); // null with a TYPE warning
  await evalOk('INDEX_OF(value; 1)', { value: [[], 1] }); // null with a TYPE warning
  await evalOk('INDEX_OF(value; LIST(1))', { value: [1] }); // null with a TYPE warning
  await evalOk('INDEX_OF(value; 1)', { value: null }); // null
  await evalOk('INDEX_OF(value; 1)', { value: 'abc' }); // null with a TYPE warning
  ```

- A list of more than `maxListLength` (1,000) items raises `LIST_TOO_LARGE`.

  ```ts
  await evalErrors('INDEX_OF(value; 1)', { value: Array(1001).fill(1) }); // ["LIST_TOO_LARGE"]
  ```

Unspecified: whether a date, time, datetime or other object equals another.

### FILTER_BY

`FILTER_BY(list: list<T>, keys: list<any>, operator: callable, operatorValue?: any) -> list<T>`

- The items of `list` whose key, the item at the same position in `keys`, the named `operator`
  answers `TRUE` for, called as `(key)` or, when `operatorValue` is given, as
  `(key, operatorValue)`; a key it answers `FALSE` or `null` for drops its item.

  ```ts
  await evalOk('FILTER_BY(LIST("a"; "b"; "c"); LIST(9; 3; 12); ">"; 8)'); // ["a", "c"]
  await evalOk('FILTER_BY(LIST("x"; "y"); LIST(""; "z"); "IS_EMPTY")'); // ["x"]
  await evalOk('FILTER_BY(LIST(1; 2); value; ">"; 0)', { value: [5, null] }); // [1]
  await evalOk('FILTER_BY(LIST(); LIST(); ">"; 1)'); // []
  ```

- `list` and `keys` of different lengths return `null` with a `TYPE` warning.

  ```ts
  await evalOk('FILTER_BY(LIST("a"; "b"); LIST(1); ">"; 0)'); // null with a TYPE warning
  ```

- The operator is checked at parse time as for [FILTER](#filter), an unknown name being an
  `UNKNOWN_FUNCTION_REFERENCE` error, and called as `FILTER` calls it: the function behind an
  operator token, otherwise the first function of that name that has an implementation. For an
  overloaded name that can be another overload than the one the parser checked: `STARTS_WITH` runs
  its text form, so a list of prefixes keeps nothing.

  ```ts
  await evalOk(
    'FILTER_BY(LIST("x"; "y"; "z"); LIST("apple"; "banana"; "cherry"); "STARTS_WITH"; "b")',
  ); // ["y"]
  await evalOk('FILTER_BY(LIST("x"; "y"); LIST("apple"; "banana"); "STARTS_WITH"; LIST("a"; "b"))'); // []
  await evalErrors('FILTER_BY(LIST(1); LIST(1); "NOPE")'); // ["UNKNOWN_FUNCTION_REFERENCE"]
  ```

- A `null` list or `keys` returns `null`; a list of another type returns `null` with a `TYPE`
  warning.

  ```ts
  await evalOk('FILTER_BY(value; LIST(1); ">"; 0)', { value: null }); // null
  await evalOk('FILTER_BY(LIST(1); value; ">"; 0)', { value: null }); // null
  await evalOk('FILTER_BY(value; LIST(1); ">"; 0)', { value: 'abc' }); // null with a TYPE warning
  ```

- A list of more than `maxListLength` (1,000) items raises `LIST_TOO_LARGE`.

  ```ts
  await evalErrors('FILTER_BY(value; value; ">"; 0)', { value: Array(1001).fill(1) }); // ["LIST_TOO_LARGE"]
  ```

Unspecified: an operator name that has no implementation, which only a host's own registry can
hold.

### DISTINCT

`DISTINCT(list: list<T>) -> list<T>`

- The first occurrence of each distinct item, in order, with the empty items `null` and `""`
  dropped.

  ```ts
  await evalOk('DISTINCT(LIST("x"; "y"; "x"; ""))'); // ["x", "y"]
  await evalOk('DISTINCT(LIST())'); // []
  ```

- Text, numbers and booleans are equal by value and type, with no conversion: `1` and `"1"` stay
  apart, as do `TRUE` and `"true"`, and text compares case-sensitively.

  ```ts
  await evalOk('DISTINCT(value)', { value: [1, '1', true, 'true', 'a', 'A', 1, null, ''] }); // [1, "1", true, "true", "a", "A"]
  ```

- Dates, times and datetimes are equal when their kind and their `iso` text are.

  ```ts
  await evalOk('COUNT(DISTINCT(LIST(DATE(2024; 1; 2); DATE(2024; 1; 2))))'); // 1
  await evalOk('COUNT(DISTINCT(LIST(TIME(1; 2; 3); TIME(1; 2; 3); TIME(1; 2; 4))))'); // 2
  ```

- A list that holds a list, the empty list included, or any other object returns `null` with a
  `TYPE` warning; a `null` list returns `null`, and a list of another type `null` with a `TYPE`
  warning.

  ```ts
  await evalOk('DISTINCT(value)', { value: [[1], 2] }); // null with a TYPE warning
  await evalOk('DISTINCT(value)', { value: [[], 2] }); // null with a TYPE warning
  await evalOk('DISTINCT(value)', { value: [{ a: 1 }] }); // null with a TYPE warning
  await evalOk('DISTINCT(value)', { value: null }); // null
  await evalOk('DISTINCT(value)', { value: 'abc' }); // null with a TYPE warning
  ```

- A list of more than `maxListLength` (1,000) items raises `LIST_TOO_LARGE`.

  ```ts
  await evalErrors('DISTINCT(value)', { value: Array(1001).fill(1) }); // ["LIST_TOO_LARGE"]
  ```

Unspecified: nothing; these rules decide every list.

### GROUP_COUNTS

`GROUP_COUNTS(list: list<any>) -> list<number>`

- For each item of [DISTINCT](#distinct)`(list)`, in the same order, how many items of `list`
  equal it, so the two lists line up position by position; items compare as in `DISTINCT`, and
  a list `DISTINCT` refuses is refused the same way.

  ```ts
  await evalOk('GROUP_COUNTS(LIST("x"; "y"; "x"; ""))'); // [2, 1]
  await evalOk('GROUP_COUNTS(value)', { value: [1, '1', true, 'true', 'a', 'A', 1, null, ''] }); // [2, 1, 1, 1, 1, 1]
  await evalOk('GROUP_COUNTS(LIST(DATE(2024; 1; 2); DATE(2024; 1; 2); DATE(2024; 1; 3)))'); // [2, 1]
  await evalOk('GROUP_COUNTS(LIST())'); // []
  await evalOk('INDEX(DISTINCT(value); INDEX_OF(GROUP_COUNTS(value); MAX(GROUP_COUNTS(value))))', {
    value: ['a', 'b', 'b', 'c'],
  }); // "b"
  await evalOk('MAX(GROUP_COUNTS(value)) - MIN(GROUP_COUNTS(value)) <= 1', {
    value: ['a', 'b', 'b', 'c'],
  }); // true
  await evalOk('GROUP_COUNTS(value)', { value: [[1], 2] }); // null with a TYPE warning
  await evalOk('GROUP_COUNTS(value)', { value: null }); // null
  ```

- A list of more than `maxListLength` (1,000) items raises `LIST_TOO_LARGE`.

  ```ts
  await evalErrors('GROUP_COUNTS(value)', { value: Array(1001).fill(1) }); // ["LIST_TOO_LARGE"]
  ```

Unspecified: nothing; these rules decide every list.

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
