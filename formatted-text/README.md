# @formulang/formatted-text

Opt-in functions that read HTML and markdown for
[Formulang](https://github.com/formulang/formula) — an open-source, safe,
embeddable, strongly-typed formula language for TypeScript and JavaScript.

`PLAIN_TEXT` turns HTML or markdown into plain text, one line per block, and
`MARKDOWN_BLOCKS` picks the headings, list items, table rows, paragraphs or code
blocks out of a markdown document. They are not part of the standard library:
a host adds them beside `createCoreFormulaRuntime()`. Like every Formulang
package, this one depends only on `@formulang/definitions`.

## Getting started

```sh
npm install @formulang/definitions @formulang/parser @formulang/runner @formulang/core-functions @formulang/formatted-text
```

```ts
import { createCoreFormulaRuntime } from '@formulang/core-functions';
import { registerFormattedTextFunctions } from '@formulang/formatted-text';
import { parseFormula } from '@formulang/parser';
import { evaluateRuleAsync } from '@formulang/runner';

const runtime = createCoreFormulaRuntime();
registerFormattedTextFunctions(runtime); // definitions and implementations

const rule = parseFormula('PLAIN_TEXT("<p>Hello <b>world</b></p>"; "html")', {
  registry: runtime.registry,
});
const { value } = await evaluateRuleAsync(rule, {
  registry: runtime.registry,
  resolver: runtime.implementations,
}); // "Hello world"
```

`registerFormattedTextFunctions(runtime)` is shorthand for the two halves:

| Export                                                | Registers                                                     | Where it runs          |
| ----------------------------------------------------- | ------------------------------------------------------------- | ---------------------- |
| `registerFormattedTextDefinitions(registry)`          | The data-only `FunctionDefinition`s, into a `FormulaRegistry` | Anywhere, browser too  |
| `registerFormattedTextImplementations(registrations)` | The executable implementations, by signature id               | The evaluating backend |

A parse-only host, such as a formula editor, imports the definitions from
`@formulang/formatted-text/definitions`, a module that imports nothing but
`@formulang/definitions`:

```ts
import { createRegistry, registerCoreFormulaDefinitions } from '@formulang/definitions';
import { registerFormattedTextDefinitions } from '@formulang/formatted-text/definitions';

const registry = createRegistry();
registerCoreFormulaDefinitions(registry);
registerFormattedTextDefinitions(registry);
```

The signature ids are `PLAIN_TEXT/v1` and `MARKDOWN_BLOCKS/v1`
(`FormattedTextSignatureIds`).

## Functions

Both functions follow the conventions of the core text functions
([docs/functions.md](../docs/functions.md#conventions)): a `null` text gives
`null`, a value of another type gives `null` with a `TYPE` warning, and the
second argument must be written as one of the listed string literals. A list
result longer than `maxWildcardOutputLength` (5,000) raises `LIST_TOO_LARGE`.

The `evalOk` calls below are the package's test helper
(`formatted-text/src/test-helpers/eval-formula.ts`): the core runtime with these
functions opted in. The comment after each call shows the result.

### PLAIN_TEXT

`PLAIN_TEXT(markup: text?, format: text) -> text?`

The text of HTML or markdown markup, one line per block. `format` is `"html"`
or `"markdown"`. Tags and markers are removed, whitespace within a line is
collapsed to one space, and blank lines are dropped.

```ts
await evalOk('PLAIN_TEXT("<h1>Title</h1><p>A &amp; B</p><script>x()</script>"; "html")'); // "Title\nA & B"
await evalOk('PLAIN_TEXT("[Link](https://x) and **bold**"; "markdown")'); // "Link and bold"
await evalOk('PLAIN_TEXT("# One" & CHAR(10) & "- a" & CHAR(10) & "- b"; "markdown")'); // "One\na\nb"
```

### MARKDOWN_BLOCKS

`MARKDOWN_BLOCKS(text: text?, kind: text) -> list<text>?`

The text of the markdown blocks of one kind, in document order, with inline
markup removed. `kind` is `"heading"` (every level), `"heading-1"` to
`"heading-6"`, `"list-item"` (nested items each count), `"table-row"` (the
row's non-empty cells joined by a space; the delimiter row is not a row),
`"paragraph"` or `"code"` (a fenced block's lines, as written).

```ts
await evalOk('MARKDOWN_BLOCKS("Intro" & CHAR(10) & "===" & CHAR(10) & "## Next"; "heading")'); // ["Intro", "Next"]
await evalOk('MARKDOWN_BLOCKS("- a" & CHAR(10) & "  - b"; "list-item")'); // ["a", "b"]
await evalOk('MARKDOWN_BLOCKS("|A|B|" & CHAR(10) & "|-|-|" & CHAR(10) & "|1|2|"; "table-row")'); // ["A B", "1 2"]
```

## What the readers read

Both readers are single forward scans written for this package, not full
parsers. They cover the markup found in everyday content; the rest is kept as
written rather than guessed at.

**HTML.** Tags are removed; `script`, `style` and `title` content is dropped,
and so is `noscript`, `noframes` and `template` content in the head. Comments,
declarations and processing instructions are dropped. Block elements (`p`,
`div`, `li`, `h1`–`h6`, `tr`, `td`, `br` and the like) end a line, and line
breaks inside `pre` are kept. Numeric references and the named references of
HTML 4 plus `&apos;` are decoded. Not supported:

- The other named references HTML5 added (`&check;`, `&NewLine;` and some 2,000
  more) stay as written.
- No document tree is built, so `textarea`, `xmp` or `iframe` content is read
  as markup like any other.

**Markdown.** ATX headings (`# Title`) and setext headings (`Title` over `===`
or `---`), bullet and ordered list items, pipe tables, paragraphs, fenced code
(` ``` ` or `~~~`), block quotes and thematic breaks. Inline: emphasis by the
CommonMark rules (delimiter run lengths and the rule of 3 included, so
`**foo*` keeps one `*`), code spans, backslash escapes, inline links and images
(`[text](url)` gives `text`) and autolinks. Not supported:

- Indented code blocks: their lines are read as paragraph text.
- Reference links (`[text][ref]`) and their definitions stay as written.
- Inline and block HTML, and character references, stay as written.
- Blocks are read line by line without list indentation, so a setext underline
  or fence inside a list item is not recognised as part of the item.

## Limits and cost

The cost estimate grows with the length of the markup, at 0.0000003 seconds per
code unit (about twice the slowest measured input), and is not capped. A call on
markup too long for `maxFunctionCostUnits` (2 by default, so about 6.6 million
code units) fails with `FUNCTION_COST_LIMIT_EXCEEDED` before it runs.

## Why a separate package

The readers and the HTML entity table are over a thousand lines that most
hosts never need. Keeping them out of `@formulang/core-functions` keeps the
standard library small and lets them evolve on their own, and a host that does
not register them cannot have formulas that call them. The definitions live in
this package too, so the opt-in is one dependency.

## License

MIT
