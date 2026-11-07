# Contributing to Formulang

Thanks for contributing. This document covers the development environment, the commands you will use, how testing works, and how your changes end up in a release.

## Development environment

- **Node >= 22.** The repo carries an `.nvmrc`, so `nvm use` picks the right version.
- **pnpm.** The exact version is pinned via the `packageManager` field in `package.json`. Run `corepack enable` once to activate it (or install pnpm globally with `npm i -g pnpm`).

```sh
git clone https://github.com/formulang/formula.git
cd formula
corepack enable
pnpm install
```

## Command reference

All commands run from the repo root.

| Command                   | Purpose                                                                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run build`          | Compile all packages to `dist/`.                                                                                                                                                                                                                      |
| `pnpm run lint`           | Type-check all packages (`tsc --noEmit`), and core-functions' test helper (`core-functions/tsconfig.test-helpers.json`). Requires a prior `pnpm run build`, because package entrypoints resolve to the built `dist/` of their workspace dependencies. |
| `pnpm run test`           | Run the full vitest suite. No build required.                                                                                                                                                                                                         |
| `pnpm run test:coverage`  | Full suite with V8 coverage.                                                                                                                                                                                                                          |
| `pnpm run prettier`       | Format the repo.                                                                                                                                                                                                                                      |
| `pnpm run prettier:check` | Verify formatting (CI runs this).                                                                                                                                                                                                                     |
| `pnpm run clean`          | Remove all build outputs.                                                                                                                                                                                                                             |

## Project layout

```
definitions/     @formulang/definitions   — portable contracts, types, and registry primitives
parser/          @formulang/parser        — formula source -> typed, validated AST (TypedRule)
runner/          @formulang/runner        — asynchronous evaluation engine
core-functions/  @formulang/core-functions — built-in function definitions + implementations
docs/            language, functions, architecture, extending, best-practices, and releasing guides
scripts/         release tooling (set-version.js)
```

The four packages form a small dependency chain: `definitions` has no dependencies; `parser` and `core-functions` depend on `definitions`; `runner` depends on `definitions` and `parser`. Published packages must stay free of third-party runtime dependencies.

## Testing

Tests use [vitest](https://vitest.dev). Spec files are named `*.spec.ts` and live next to the source they cover (for example `parser/src/index.spec.ts` next to `parser/src/index.ts`).

```sh
# Everything
pnpm run test

# A single file
pnpm exec vitest run parser/src/index.spec.ts

# One package
pnpm --filter @formulang/parser run test
# ...or equivalently
cd parser && pnpm test

# With coverage
pnpm run test:coverage
```

Tests never need a build: the root `vitest.config.ts` aliases `@formulang/*` imports to each package's TypeScript sources, so the suite runs on a fresh checkout right after `pnpm install`.

## Code style

- Formatting is [Prettier](https://prettier.io) with `prettier-plugin-organize-imports`; imports are sorted automatically. `pnpm run prettier:check` is enforced in CI — run `pnpm run prettier` before pushing.
- TypeScript runs in `strict` mode across all packages. `pnpm run lint` must pass without errors.

## Commit messages

Write clear, imperative commit messages (for example, `Add wall-time guard for variable resolvers`). There is no required format and no tooling enforcement — commit messages do not drive versioning or releases. Good messages still matter: they surface in `git log` and in the auto-generated notes of the release that ships your change.

## Pull request checklist

- `pnpm run build`, `pnpm run lint`, `pnpm run test`, and `pnpm run prettier:check` all pass locally (CI runs the same steps on Node 22 and 24).
- New behavior is covered by a co-located `*.spec.ts` file.
- No third-party runtime dependencies were added to published packages.

## Versions and releases

All packages share a single version, and contributors normally never touch it — a maintainer bumps it when cutting a release, using `pnpm run set-version X.Y.Z` (never by editing the five `package.json` files individually; the script keeps them in lockstep and the release workflow fails on any mismatch). A release happens exactly when `main` carries a version that is not yet on npm. There is no `CHANGELOG.md`: release notes are auto-generated on the [GitHub Releases page](https://github.com/formulang/formula/releases). Details in [docs/releasing.md](docs/releasing.md).

## Adding a built-in function

Adding a function touches four places: a definition (portable metadata in `@formulang/definitions`), an implementation (executable code in `@formulang/core-functions`), a co-located spec file, and an entry in [docs/functions.md](docs/functions.md). A function that 1.0.0 does not have is documented as its signature, one bullet per rule with examples under each, and one closing `Unspecified:` sentence naming the inputs the rules leave open. The full walkthrough is in [docs/extending.md](docs/extending.md).

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
