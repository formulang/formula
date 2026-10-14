# Formulang language guide

This guide is for people who _write_ formulas. It describes the complete
syntax and semantics of the formula language: what you can type, how it is
parsed, how values and types behave, and what happens when something is wrong.

If you are embedding Formulang in an application instead, start with
[architecture.md](architecture.md) and [extending.md](extending.md). For the
full list of built-in functions, see [functions.md](functions.md).

Everything below is derived from the reference implementation in
[`@formulang/parser`](../parser/README.md) and verified against its test
suite. Examples use the default syntax: argument separator `;`, decimal
separator `.`.

## Contents

- [A formula is one expression](#a-formula-is-one-expression)
- [Configurable punctuation](#configurable-punctuation)
- [Literals](#literals)
- [Variables](#variables)
- [Property access](#property-access)
- [List wildcards](#list-wildcards)
- [Operators](#operators)
- [Function calls](#function-calls)
- [Callable references](#callable-references)
- [Enumerated literals](#enumerated-literals)
- [Types](#types)
- [Null and empty values](#null-and-empty-values)
- [When a formula is invalid](#when-a-formula-is-invalid)
- [Limits](#limits)
- [Cheat sheet](#cheat-sheet)

## A formula is one expression

A formula is a single expression that evaluates to a single value. There are
no statements, no variable assignment, no line continuations, and no comment
syntax — every character outside a string literal is significant or
whitespace. (In the examples below, `--` marks commentary for the reader; it
is not formula syntax.)

```
IF(max_length > 0; "this"; "that")
```

Whitespace (spaces, tabs, newlines) between tokens is ignored and never
changes meaning. These two formulas are identical:

```
COUNT(LIST(LIST(1); LIST(2); LIST(3)))
  COUNT( LIST( LIST( 1 ) ; LIST(2) ; LIST( 3 ) ) )
```

Whitespace is also optional around operators:

```
IF(some_variable<>some_other_variable;"stuff";"yes")
```

The grammar, in brief:

```
formula    := expression
expression := postfix (binary-operator expression)*   -- precedence climbing
postfix    := primary accessor*
accessor   := "." property | ".*." property
primary    := number | text | boolean | variable
            | FUNCTION_NAME "(" [expression (";" expression)*] ")"
            | "(" expression ")"
```

## Configurable punctuation

Two punctuation characters are configurable by the host application that
embeds Formulang. Ask the application you are writing formulas for which
convention it uses.

| Setting            | Default | Alternative |
| ------------------ | ------- | ----------- |
| Argument separator | `;`     | `,`         |
| Decimal separator  | `.`     | `,`         |

The two must differ; configuring both to `,` is rejected with the
`INVALID_SYNTAX_CONFIG` error. The valid combinations are `;`+`.` (default),
`,`+`.`, and `;`+`,`.

With the default separator:

```
LIST(1; 2; 3)
```

With `argumentSeparator: ','`:

```
IF(max_length > 0, "this", "that")
```

With `decimalSeparator: ','` (argument separator stays `;`):

```
1,23
```

Using the wrong argument separator produces a targeted error. Writing
`LIST(1, 2)` under the default syntax fails with:

```
UNEXPECTED_TOKEN: Use ';' to separate function arguments.
```

For embedders, the configuration is a parse option:

```ts
import { createRegistry, registerCoreFormulaDefinitions } from '@formulang/definitions';
import { parseFormula } from '@formulang/parser';

const registry = createRegistry();
registerCoreFormulaDefinitions(registry);

const rule = parseFormula('LIST(1, 2, 3)', {
  registry,
  syntax: { argumentSeparator: ',' },
});
```

## Literals

### Numbers

A number literal is a sequence of digits with at most one decimal separator.
A leading minus sign is part of the literal when it appears in a value
position (see below). All of these are valid:

```
1
1.5
.5
-1
-0.5
0.125
```

Not supported: scientific notation (`1e3`), thousands separators
(`1_000`, `1,000`), hexadecimal, and `Infinity`/`NaN`. Non-finite results at
runtime (for example division by zero) become `null`.

The minus sign is only part of a number literal where a value can start: at
the beginning of the formula, after `(`, after an argument separator, or
after another operator. Everywhere else `-` means subtraction:

```
2 + -1        -- addition with the literal -1
1-2           -- subtraction: SUB(1; 2)
0 -1          -- also subtraction: SUB(0; 1)
(-3)          -- the literal -3
value * -1    -- multiplication by the literal -1
```

There is **no general unary minus**. `-value` is a parse error; write
`0 - value` or `value * -1` instead.

### Text

Text literals use double quotes only. Single quotes are not string
delimiters — `'abc'` is a parse error.

```
"hello"
"data:"
""
```

Three escape sequences are recognized inside a string:

| Escape | Produces       |
| ------ | -------------- |
| `\"`   | a double quote |
| `\\`   | a backslash    |
| `\n`   | a newline      |

Any other backslash sequence drops the backslash and keeps the character:
`"a\tb"` is the three characters `atb`, not a tab. To put a tab or other
special character in a string, type it literally — newlines and tabs are
legal inside string literals.

```
"a\"b"    -- a"b
"a\\b"    -- a\b
"a\nb"    -- a, newline, b
```

Close every string. A string without a closing quote silently consumes the
rest of the formula, which usually surfaces as a confusing error later in
the source.

A single string literal may be at most 8,000 characters by default
(`STRING_LITERAL_TOO_LONG`).

### Booleans

`TRUE` and `FALSE` are literals, written in any letter case:

```
TRUE
FALSE
SORT(LIST(3; 1; 2); true)    -- lowercase works too
```

They take precedence over everything else: an identifier spelled `true` (in
any case) is always the boolean literal, never a variable, and `TRUE(...)`
is not a function call.

### Empty (null)

There is no `null` keyword. The empty value is produced by the zero-argument
function `EMPTY()` (alias `BLANK()`), and by operations that have no result
(missing properties, out-of-range `INDEX`, division by zero, and so on):

```
EMPTY()    -- null
BLANK()    -- null
```

See [Null and empty values](#null-and-empty-values) for how `null` flows
through formulas.

### Lists

There is no bracket syntax for lists. Build them with `LIST(...)`:

```
LIST(1; 2; 3)
LIST()           -- empty list
```

All items of a `LIST(...)` call must have the same type. Mixing types is a
parse-time error (`ARGUMENT_TYPES_MUST_HAVE_SAME_TYPE`):

```
LIST(1; "a")     -- error: number and text in one list
```

## Variables

Variables are the inputs of a formula. The host application declares which
variables exist and what type each one has; a formula can only read them,
never create or assign them. Referencing an undeclared name is an error
(`UNKNOWN_VARIABLE`).

Variable names must be **lower_snake_case**, enforced by the parser:

- starts with a lowercase letter `a–z`
- segments of lowercase letters and digits, separated by single underscores
- every segment starts with a letter
- no uppercase letters, no leading/trailing underscore, no double underscore

| Valid        | Invalid                                |
| ------------ | -------------------------------------- |
| `value`      | `Value` (uppercase)                    |
| `max_length` | `camelCase`                            |
| `item2`      | `foo_2bar` (segment starts with digit) |
| `snake_name` | `_foo`, `foo_`, `foo__bar`             |

```
max_length > 0
value.snake_name
```

Names are matched exactly as declared. Since anything containing an
uppercase letter is rejected outright (`INVALID_VARIABLE_NAME`), there is no
case-folding to rely on: `Value` is never a way to reach `value`.

An identifier may be at most 64 characters by default
(`IDENTIFIER_TOO_LONG`).

## Property access

Use `.` to read a property of an object value. Chains are allowed, and work
on function results as well as variables:

```
value.snake_name
value.a.b
DATE(2024; 2; 29).year    -- 2024
NOW().date.iso
```

Property names follow the same lower_snake_case rule as variables
(`INVALID_PROPERTY_NAME` otherwise).

Property access is **allowlist-based**. An object type declares its
properties, and only those can be read:

- Reading an undeclared property is a security error
  (`PROPERTY_NOT_ALLOWLISTED`), at parse time and again at run time.
- Reading a property of a non-object (for example `value.id` where `value`
  is a number) is a type error (`PROPERTY_TARGET_NOT_OBJECT`).
- The names `__proto__`, `prototype`, `constructor`, and anything starting
  with `__` are always rejected (`DENYLISTED_PROPERTY`):

```
value.__proto__    -- security error, never evaluated
```

At run time, reading a property of an object that turned out to be `null`
yields `null` rather than an error, and the parser tracks this: accessing a
property through a nullable object gives the property's type marked
nullable.

## List wildcards

`.*.` maps a property read over every element of a list. The result is a new
list:

```
list.*.name
value.items.*.id
```

Semantics, in order:

1. The target must be a list. If its declared type is not a list, parsing
   fails with `WILDCARD_TARGET_NOT_LIST`. If the runtime value is not a
   list, the result is `null`.
2. For each element, the property is read exactly like `.` access (same
   allowlist and denylist rules). Elements that are `null` or not objects
   contribute `null`.
3. If the property values are themselves lists, the result is flattened
   **one** level.

With `value = [{ ids: [1, 2] }, { ids: [3] }]`:

```
value.*.ids    -- [1, 2, 3]
```

With `list = [{ name: "a" }, { name: ["b", "c"] }, { name: null }]`:

```
list.*.name    -- ["a", "b", "c", null]
```

Wildcard expansion is bounded: the input list may have at most 1,000
elements (`LIST_TOO_LARGE`) and the flattened output at most 5,000
(`WILDCARD_OUTPUT_TOO_LARGE`) under the default limits.

## Operators

Every operator is shorthand for a built-in function; `1 + 2` and `ADD(1; 2)`
compile to the same call. All operators are binary (two operands) and are
listed here from tightest to loosest binding. Higher precedence binds
tighter.

| Precedence | Operator | Function | Meaning            | Associativity |
| ---------- | -------- | -------- | ------------------ | ------------- |
| 40         | `^`      | `POW`    | exponentiation     | right         |
| 30         | `*`      | `MUL`    | multiplication     | left          |
| 30         | `/`      | `DIV`    | division           | left          |
| 20         | `+`      | `ADD`    | addition           | left          |
| 20         | `-`      | `SUB`    | subtraction        | left          |
| 20         | `&`      | `CONCAT` | text concatenation | left          |
| 10         | `=`      | `EQ`     | equals             | left          |
| 10         | `<>`     | `NEQ`    | not equal          | left          |
| 10         | `>`      | `GT`     | greater than       | left          |
| 10         | `>=`     | `GTE`    | greater or equal   | left          |
| 10         | `<`      | `LT`     | less than          | left          |
| 10         | `<=`     | `LTE`    | less or equal      | left          |

Consequences you can rely on:

```
1 + 2 * 3           -- 7   (* binds tighter than +)
(1 + 2) * 3         -- 9   (parentheses override precedence)
2 * 3 ^ 2           -- 18  (^ binds tighter than *)
1 + 2 ^ 3           -- 9
2 ^ 3 ^ 2           -- 512 (^ is right-associative: 2 ^ (3 ^ 2))
(2 ^ 3) ^ 2         -- 64
"a" & "b" = "ab"    -- true (& binds tighter than =)
```

Note that `&` sits in the same tier as `+` and `-`. When mixing
concatenation with arithmetic, use parentheses.

Comparison tokens are single tokens; `<=`, `>=`, and `<>` must be written
without an inner space, and no surrounding space is required:

```
max_length <= 100
max_length <> 10
```

Things that are **not** operators in this language:

- `==` and `!=` — use `=` and `<>`.
- Unary minus and unary `!` — use `0 - x` / `x * -1` and `NOT(x)`.
- `%` — use `MOD(dividend; divisor)`.
- Logical `&&`/`||` or keyword operators — use `AND(...)`, `OR(...)`,
  `NOT(...)`.
- A ternary conditional — use `IF(cond; then; else)`.

### Comparison coercions

The comparison operators are deliberately forgiving at run time:

```
1 = "1"      -- true: numeric text compares as a number
"" = 0       -- null: empty text counts as empty, not as a value
value > 0    -- with value = [null]: true (lists compare by COUNT)
value > 0    -- with value = []:     false
```

Boolean-like text also coerces: comparing against `"true"`/`"false"` behaves
like comparing against `TRUE`/`FALSE`. `SWITCH` matches cases with the same
rules as `=`.

Arithmetic operators are not forgiving: `1 + "x"` is rejected at parse time
(`ARGUMENT_TYPE_MISMATCH`).

### Text concatenation

`&` (that is, `CONCAT`) accepts any number of values but only produces text
from text. Non-text input yields `null` with a `TYPE` warning at run time —
convert explicitly:

```
"a" & "b" & "c"              -- "abc"
CONCAT(1; "a")               -- null, with a TYPE warning
CONCAT(TO_TEXT(123); "a")    -- "123a"
```

## Function calls

A call is a function name followed by parenthesized arguments separated by
the argument separator:

```
LEN("abc")                            -- 3
ROUND(AVG(LIST(1; 2; 3)) * 100; 0)
PI()                                  -- zero arguments still need ()
```

Function names must start with an uppercase letter and contain only
uppercase letters, digits, and underscores — by convention
`UPPER_SNAKE_CASE` (digits appear in names like `LOG10`). Anything else is
rejected before the function is even looked up:

```
foo(1)      -- INVALID_FUNCTION_NAME (expected UPPER_SNAKE_CASE)
Len("x")    -- INVALID_FUNCTION_NAME: mixed case is not accepted
NOPE(1)     -- UNKNOWN_FUNCTION: well-formed name, but not registered
```

Several built-ins have aliases that behave identically: `BLANK` for
`EMPTY`, `LENGTH` for `LEN`, `AVERAGE` for `AVG`.

Arguments may be any expression, including nested calls and operator
expressions. Parenthesis nesting is limited to 16 levels by default
(`PARENS_TOO_DEEP`).

### Overloads, optional and variadic parameters

A name can have several signatures; the parser picks the overload matching
your argument types. `LEN` accepts text or a list:

```
LEN("abc")        -- 3: text overload
LEN(LIST(1;2))    -- 2: list overload
LEN(1)            -- NO_MATCHING_OVERLOAD: no signature takes a number
```

Trailing optional parameters may be omitted, and variadic functions take any
number of arguments:

```
LEFT("hello")        -- "h": count defaults to 1
LEFT("hello"; 2)     -- "he"
COUNT_UNIQUE(1; 2; 2)
```

See [functions.md](functions.md) for every signature.

### Evaluation order and short-circuiting

Control-flow functions do not evaluate arguments they do not need. `IF`
evaluates the condition and only the taken branch; `AND` and `OR` stop at
the first decisive argument:

```
IF(TRUE; TRUE; NOT(1))    -- true: the else branch (which would error) is skipped
AND(FALSE; NOT(1))        -- false: second argument skipped
OR(TRUE; NOT(1))          -- true: second argument skipped
```

## Callable references

Higher-order functions — `FILTER`, `FILTER_PROPERTY`, `FILTER_BY`, `EACH`,
`REDUCE` — take another function or operator as an argument. You pass it
**by name, as a string literal**: either the function's `UPPER_SNAKE_CASE`
name or an operator token.

```
FILTER(LIST(1;2;3); ">"; 1)                          -- [2, 3]
FILTER(LIST("data:a";"x"); "STARTS_WITH"; "data:")   -- ["data:a"]
EACH(LIST("a";"bb"); "LEN")                          -- [1, 2]
REDUCE(0; LIST(1; 2; 3); "+")                        -- 6
REDUCE(""; LIST("a"; "b"); "CONCAT")                 -- "ab"
```

The reference must be a plain double-quoted literal written directly in the
call. It cannot come from a variable or be computed — this is enforced at
parse time (`EXPECTED_STRING_LITERAL_REFERENCE`):

```
FILTER(LIST(1;2); value; 1)          -- error: not a literal
FILTER(LIST(1;2); UPPER("gt"); 1)    -- error: an expression is not a literal
```

Because the reference is a literal, the parser fully validates it while
parsing:

- The name must exist: `FILTER(LIST(1;2); "NOPE"; 1)` fails with
  `UNKNOWN_FUNCTION_REFERENCE`.
- The referenced callable must accept the arguments it will be invoked with:
  `EACH(LIST("a"); "LEN"; 1)` fails with `NO_MATCHING_OVERLOAD` because
  `LEN` takes one argument, not two.
- Its return type must fit: `FILTER(LIST("a";"bb"); "LEN")` fails with
  `ARGUMENT_TYPE_MISMATCH` because a filter check must return a boolean,
  and `LEN` returns a number.

How each host function invokes the reference:

| Call                                      | Reference invoked as                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `FILTER(list; "OP"; x?)`                  | `OP(item)` or `OP(item; x)` — keep items where true                                   |
| `FILTER_PROPERTY(list; "path"; "OP"; x?)` | `OP(item.path)` or `OP(item.path; x)`                                                 |
| `FILTER_BY(list; keys; "OP"; x?)`         | `OP(key)` or `OP(key; x)` with the key at the item's position — keep items where true |
| `EACH(list; "OP"; extra...)`              | `OP(item; extra...)` — collect results                                                |
| `REDUCE(init; list; "OP")`                | `OP(accumulator; item)`                                                               |

A related literal-only rule applies to property-path parameters of
`FILTER_PROPERTY` and `SORT_BY_PROPERTY`: the path is a string literal and
may use dots to reach nested properties.

```
FILTER_PROPERTY(value; "a.b"; "="; 2)
SORT_BY_PROPERTY(value; "a.b")
```

## Enumerated literals

A literal-only parameter — one that takes a string literal written directly
in the call, like the callable references above — can also list the exact
values it admits: a mode switch, for example. Any other literal fails at
parse time with `LITERAL_VALUE_NOT_ALLOWED`, and the message names every
admitted value, so a misspelt mode never compiles. Matching is exact and
case-sensitive.

```
WORD_COUNT(value; "letters")     -- counts words by letter runs
WORD_COUNT(value; "whitespce")   -- error: Parameter 'mode' must be one of "whitespace",
                                 --   "letters", "locale", "pattern"; got "whitespce"
```

The admitted values are part of the function definition
(`FunctionParamDefinition.literalValues`), so an editor holding the
definitions can offer them as completions; [functions.md](functions.md) lists
them for every built-in that has a mode.

## Types

Formulang is statically typed. While parsing, every node is assigned a type,
functions are resolved against typed signatures, and mismatches are reported
before anything runs.

| Type    | Written in errors as | Values                                       |
| ------- | -------------------- | -------------------------------------------- |
| Number  | `number`             | finite floating-point numbers                |
| Text    | `text`               | Unicode strings                              |
| Boolean | `boolean`            | `TRUE`, `FALSE`                              |
| Null    | `null`               | the empty value                              |
| List    | `List<number>`       | ordered values of one element type           |
| Object  | `Object(date)`       | property bags with an allowlisted shape      |
| Any     | `any`                | host-declared "unknown"; checked at run time |
| Union   | `(number \| text)`   | one of several types, in signatures          |

A trailing `?` marks a nullable type: `number?` is "a number or empty".
You will meet this notation in error messages, for example:

```
ADD("x"; 1)
-- Parameter 'a' expected number? but got text
```

Rules the type checker enforces that you will notice as an author:

- **Operator and function arguments** must match a signature.
  `1 + "x"` and `POW("x"; 2)` are parse-time errors
  (`ARGUMENT_TYPE_MISMATCH`).
- **`LIST(...)` items** must share one type (see [Lists](#lists)).
- **`IF` branches** must have the same type — the whole expression has one
  type regardless of which branch runs. `IF(TRUE; "x"; 0)` is an error
  (`ARGUMENT_TYPES_MUST_HAVE_SAME_TYPE`). A branch may be `EMPTY()`; the
  result is then the other branch's type, nullable.
- **`IF` conditions** must be boolean-like: boolean or text (text because
  `"true"`/`"false"` coerce at run time). `IF(1; TRUE; FALSE)` is an error.
  At run time, a text condition must actually be `"true"` or `"false"`
  (case-insensitive, trimmed) — anything else is a runtime error, as in
  `NOT(1)`.
- **Return types flow through.** `EACH(LIST("a";"bb"); "LEN")` is known at
  parse time to be `List<number?>?`, so you can keep composing with it.

There are no implicit conversions between numbers and text in arithmetic or
function arguments. Coercions exist only inside the comparison operators and
`SWITCH` (see [Comparison coercions](#comparison-coercions)), plus explicit
conversion functions like `TO_TEXT`.

## Null and empty values

`null` — the empty value — is a first-class citizen and never crashes a
formula. The conventions:

**Empty in, empty out.** Core functions return `null` when a required input
is empty instead of erroring:

```
1 / 0                    -- null (division by zero)
ADD(1/0; 2)              -- null: the empty propagates
2 ^ INDEX(LIST(1); 9)    -- null: out-of-range INDEX is empty
```

**Test with `IS_EMPTY`, not `=`.** Equality against an empty value is
itself `null`, so use the predicate:

```
IS_EMPTY(1/0)                    -- true
IS_EMPTY("")                     -- true: empty text counts as empty
IS_EMPTY(0)                      -- false
IF(IS_EMPTY(value); 0; value)
```

`IS_EMPTY` treats `null`, empty text `""`, and empty lists as empty.

**Produce empties with `EMPTY()` in value positions.** The idiomatic place
is an `IF` branch:

```
IF(value > 0; value; EMPTY())
```

Passing `EMPTY()` directly as a typed function argument is a parse-time
error, because its type is `null`, not the parameter's type:

```
ADD(EMPTY(); 1)
-- Parameter 'a' expected number? but got null
```

**Nullability is tracked, enforcement is split.** The parser lets a nullable
value flow into a parameter (most built-in parameters are nullable anyway);
if a host-defined function declares a non-nullable parameter and the value
is empty at run time, evaluation reports `NULL_NOT_ALLOWED` for that node.

## When a formula is invalid

Parsing never throws and never half-works silently: you always get a result
plus a list of structured errors. Each error carries:

- `kind` — `parse` (malformed syntax), `type` (well-formed but incorrectly
  typed), `security` (blocked by policy or resource limits), `config`
  (invalid syntax configuration), or `runtime` (found during evaluation),
- `code` — a stable identifier like `UNKNOWN_VARIABLE`,
- `message` — human-readable text,
- `span` — the character range in your source the error points at.

The parser recovers and keeps going where it can, so one pass may report
several errors. How they are displayed depends on the application embedding
Formulang; the codes and spans are what it has to work with.

Errors you are most likely to see, with a minimal trigger for each:

| Code                                 | Example that triggers it                                       |
| ------------------------------------ | -------------------------------------------------------------- |
| `UNEXPECTED_TOKEN`                   | `1 2` (trailing token); also `1 ! 2`, wrong argument separator |
| `EXPECTED_RPAREN`                    | `(1 + 2`                                                       |
| `EXPECTED_PROPERTY`                  | `value.` (dot without a property name)                         |
| `INVALID_FUNCTION_NAME`              | `foo(1)`                                                       |
| `INVALID_VARIABLE_NAME`              | `Value`                                                        |
| `INVALID_PROPERTY_NAME`              | `value.Bad`                                                    |
| `UNKNOWN_VARIABLE`                   | `missing` (name not declared by the host)                      |
| `UNKNOWN_FUNCTION`                   | `NOPE(1)`                                                      |
| `NO_MATCHING_OVERLOAD`               | `LEN(1)`                                                       |
| `ARGUMENT_TYPE_MISMATCH`             | `1 + "x"`, `POW("x"; 2)`                                       |
| `ARGUMENT_TYPES_MUST_HAVE_SAME_TYPE` | `LIST(1; "a")`, `IF(TRUE; "x"; 0)`                             |
| `NULL_NOT_ALLOWED`                   | passing `EMPTY()` to a non-nullable parameter                  |
| `EXPECTED_STRING_LITERAL_REFERENCE`  | `FILTER(LIST(1;2); value; 1)`                                  |
| `LITERAL_VALUE_NOT_ALLOWED`          | `WORD_COUNT(value; "whitespce")`                               |
| `UNKNOWN_FUNCTION_REFERENCE`         | `FILTER(LIST(1;2); "NOPE"; 1)`                                 |
| `PROPERTY_TARGET_NOT_OBJECT`         | `value.id` where `value` is a number                           |
| `WILDCARD_TARGET_NOT_LIST`           | `value.*.id` where `value` is a number                         |
| `PROPERTY_NOT_ALLOWLISTED`           | reading a property the type does not declare                   |
| `DENYLISTED_PROPERTY`                | `value.__proto__`                                              |

At run time the same structure applies: hard failures (denylisted access,
resource limits, boolean-like violations such as `NOT(1)`) surface as
errors with `kind: 'runtime'` or `kind: 'security'`, while soft type
problems (like `CONCAT(1; "a")`) produce `null` plus a warning attached to
the node output.

## Limits

Formulas run inside conservative resource limits. The host can raise or
lower them; the defaults below are what ships. Authors mostly notice these
when a formula is generated or pathological.

| Limit                                                                   | Default           | Error when exceeded         |
| ----------------------------------------------------------------------- | ----------------- | --------------------------- |
| Source length                                                           | 16,000 characters | `SOURCE_TOO_LONG`           |
| Tokens                                                                  | 500               | `TOO_MANY_TOKENS`           |
| String literal length                                                   | 8,000 characters  | `STRING_LITERAL_TOO_LONG`   |
| Identifier length                                                       | 64 characters     | `IDENTIFIER_TOO_LONG`       |
| Parenthesis nesting                                                     | 16 levels         | `PARENS_TOO_DEEP`           |
| AST nodes                                                               | 500               | `TOO_MANY_AST_NODES`        |
| List size (EACH/FILTER/wildcard/REDUCE input)                           | 1,000 items       | `LIST_TOO_LARGE`            |
| Wildcard output size                                                    | 5,000 items       | `WILDCARD_OUTPUT_TOO_LARGE` |
| List results (`FLAT`, `WORDS`, `SENTENCES`, `LINES`, `MARKDOWN_BLOCKS`) | 5,000 items       | `LIST_TOO_LARGE`            |
| Regex pattern length                                                    | 100 characters    | `REGEX_UNSAFE`              |
| Regex input length                                                      | 8,000 characters  | `REGEX_INPUT_TOO_LONG`      |

Evaluation is additionally bounded by step, cost, and wall-time budgets
(`EVAL_LIMIT_EXCEEDED`, `COST_LIMIT_EXCEEDED`, `WALL_TIME_LIMIT_EXCEEDED`);
a formula that stays within the sizes above will not normally meet them.

## Cheat sheet

```
-- Literals
1   1.5   .5   -0.5              -- numbers (no 1e3, no thousands separators)
"text"  "say \"hi\"\n"           -- text: double quotes; \" \\ \n
TRUE  FALSE  true                -- booleans, any case
EMPTY()                          -- the empty value (alias BLANK())
LIST(1; 2; 3)                    -- lists (no [] syntax)

-- Variables and access
max_length                       -- lower_snake_case, declared by the host
value.a.b                        -- property chains (allowlisted)
list.*.name                      -- map property over a list, flatten one level
DATE(2024; 2; 29).year           -- properties of function results

-- Operators (tightest to loosest; all map to functions)
2 ^ 3 ^ 2                        -- 512: ^ right-assoc          (POW)
2 * 3 ^ 2                        -- 18:  then * /               (MUL, DIV)
1 + 2 * 3                        -- 7:   then + - &             (ADD, SUB, CONCAT)
"a" & "b" = "ab"                 -- true: then = <> < <= > >=   (EQ, NEQ, ...)
1 = "1"                          -- true: comparisons coerce; arithmetic doesn't
value * -1                       -- no unary minus; no ==, !=, %, &&, ||, ?:

-- Functions
IF(max_length > 0; "this"; "that")    -- ; by default, , if configured
ROUND(AVG(LIST(1; 2; 3)) * 100; 0)    -- nesting
LEN("abc")  LEN(LIST(1;2))            -- overloads by argument type
IF(TRUE; TRUE; NOT(1))                -- IF/AND/OR evaluate lazily

-- Callable references (literal strings only)
FILTER(LIST(1;2;3); ">"; 1)           -- [2, 3]
EACH(LIST("a";"bb"); "LEN")           -- [1, 2]
REDUCE(0; LIST(1; 2; 3); "+")         -- 6
SORT_BY_PROPERTY(value; "a.b")        -- literal property path

-- Null handling
1 / 0                                 -- null, not an error
IS_EMPTY(1/0)                         -- true: test emptiness this way
"" = 0                                -- null: not with =
IF(value > 0; value; EMPTY())
```

Full signatures for every built-in: [functions.md](functions.md).
