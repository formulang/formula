# Formulang — guide for AI coding agents

Formulang is an open-source, safe, embeddable, strongly-typed formula/expression language for TypeScript and JavaScript ([github.com/formulang/formula](https://github.com/formulang/formula), MIT). This repository is a pure TypeScript library monorepo: four npm packages, no servers, no UI, nothing to deploy or launch — the only feedback loops are the test suite and the TypeScript build. Design constraints that shape most code: security first (allowlisted property access, a prototype-pollution denylist, resource limits, structured errors instead of throws), full type binding and overload resolution at parse time, portable data-only definitions kept separate from backend-only implementations, and configurable syntax (argument separator `;` or `,`, decimal separator `.` or `,`).

## Repo map

| Path              | Package                     | What it is                                                                                                               |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `definitions/`    | `@formulang/definitions`    | Portable contracts, types, and registry primitives — the shared vocabulary of the system (no execution logic).           |
| `parser/`         | `@formulang/parser`         | Compiles formula source text into a typed, validated AST (a `TypedRule`) against a registry.                             |
| `runner/`         | `@formulang/runner`         | Asynchronous evaluation engine for compiled formulas, with caching, batching, limits, and per-node output.               |
| `core-functions/` | `@formulang/core-functions` | Built-in function definitions and executable implementations; `createCoreFormulaRuntime()` wires a ready-to-use runtime. |
| `docs/`           | —                           | Cross-package documentation: architecture, language reference, function reference, extending, best practices, releasing. |
| `scripts/`        | —                           | `set-version.js` sets (or verifies with `--check`) the shared version; `compat/` holds the 1.0.0 compatibility baseline. |

All four packages are published to npmjs.org and share a single version. Dependency direction: `definitions` has no internal dependencies; `parser` and `core-functions` depend on `definitions`; `runner` depends on `definitions` and `parser`.

## Environment

- Node >= 22 (`.nvmrc` pins 22; CI tests 22 and 24).
- pnpm, pinned via `"packageManager": "pnpm@11.9.0"`. Enable with `corepack enable` (or `npm i -g pnpm`).
- `pnpm install` at the repo root installs all workspaces (listed in `pnpm-workspace.yaml`).

## Commands

Run from the repo root.

| Task                          | Command                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Install                       | `pnpm install`                                                                                                                |
| Build all packages (tsc)      | `pnpm run build`                                                                                                              |
| Lint = type-check (no eslint) | `pnpm run lint` — requires a prior build, see below                                                                           |
| Test everything               | `pnpm run test`                                                                                                               |
| Test with coverage            | `pnpm run test:coverage`                                                                                                      |
| Format                        | `pnpm run prettier`                                                                                                           |
| Check formatting (CI)         | `pnpm run prettier:check`                                                                                                     |
| Delete build output           | `pnpm run clean`                                                                                                              |
| One package's script          | `pnpm --filter @formulang/<name> run <script>`, e.g. `pnpm --filter @formulang/parser run test` (or `cd parser && pnpm test`) |
| One test file                 | `pnpm exec vitest run core-functions/src/functions/add.spec.ts`                                                               |

## Critical facts (non-obvious — read before working)

- **Tests need no build.** `vitest.config.ts` aliases `@formulang/*` to each package's `src/index.ts`, so the entire suite runs against source (currently 77 spec files / 846 tests). Run `pnpm run test` freely and often.
- **Lint DOES need a build.** `lint` is `tsc --noEmit` per package (core-functions' also type-checks its test helper, `src/test-helpers/`, under `tsconfig.test-helpers.json`), and cross-package imports resolve through the published entrypoints (`dist/`). Run `pnpm run build` before `pnpm run lint` — and before anything else that resolves `dist/` instead of the vitest aliases.
- Test files are `*.spec.ts`, co-located with the source they test.
- TypeScript 6 with `module`/`moduleResolution` set to `nodenext` (modern Node module semantics, matching `engines >=22`), CJS emit. Mind Node-style module resolution rules when adding imports.
- Formatting is enforced: prettier plus `prettier-plugin-organize-imports`. Run `pnpm run prettier` before finishing any change; CI fails on `prettier:check`.
- **Releases are version-driven, not commit-driven.** Commit messages are free-form — no required format, no message linting, nothing parses them. A release happens exactly when `main` carries a version that is not yet on npm: the release workflow checks the version lockstep, builds, tests, publishes all packages, then tags `v<version>` and creates a GitHub release with auto-generated notes. If the version on `main` is already published, the run is a green no-op.
- **Versions are set manually, but only via `pnpm run set-version X.Y.Z`.** Never edit the five `package.json` `version` fields individually — the script keeps the root and all four workspaces in lockstep, and the release workflow enforces equality with `node scripts/set-version.js --check`. There is no `CHANGELOG.md`; release notes live on the GitHub Releases page.
- Internal dependencies use the `workspace:^` protocol. Keep it — pnpm rewrites it to real semver ranges at publish time.
- **Zero third-party runtime dependencies.** Published packages may depend only on other `@formulang/*` packages. Adding a third-party runtime dependency is an architectural decision that requires explicit human sign-off; do not make it on your own.
- CI (`.github/workflows/ci.yml`) runs on every PR and push to `main`: build, lint, `prettier:check`, and tests on Node 22 and 24. Releases run from `.github/workflows/release.yml` on push to `main`.

## Documentation map

Update documentation in the same change as the code it describes:

| You changed...                                  | Update                                               |
| ----------------------------------------------- | ---------------------------------------------------- |
| Built-in functions (added, removed, behavior)   | `docs/functions.md` + `core-functions/README.md`     |
| Language syntax, operators, literals            | `docs/language.md` + `parser/README.md`              |
| Contracts, registry, types, execution model     | `docs/architecture.md` + the affected package README |
| Extension points (custom functions, registries) | `docs/extending.md`                                  |
| Release or CI mechanics                         | `docs/releasing.md` + `CONTRIBUTING.md`              |

Also present: root `README.md` (project overview), `SECURITY.md` (security model and reporting), and a `README.md` in each package directory.

## Adding a built-in function (checklist)

1. Add a signature id in `definitions/src/builtin-signature-ids.ts` and the portable definition (name, params, return type, purity — plus an operator registration if it has an operator form) in `definitions/src/register-core-definitions.ts`.
2. Implement it in `core-functions/src/functions/<name>.ts` (most implementations extend `AbstractEagerBatchImplementation`) and register the implementation under its signature id in `core-functions/src/functions/register-primitive-implementations.ts`.
3. Add a co-located `<name>.spec.ts` next to the implementation.
4. Document the function in `docs/functions.md`: its signature, one bullet per rule, each one condition and its outcome in one sentence with at least two `evalOk`/`evalErrors` examples under it that call the function and give different results, and one closing `Unspecified:` sentence; rules every such function shares go under _Shared rules_, once, and no section states them again. `core-functions/src/functions/shared-rules.spec.ts` runs each shared rule against every added function and every parameter the rule governs, read from the live registry.

   `core-functions/src/functions/function-docs.spec.ts` checks exactly these in `docs/functions.md`:

   - Each function the 1.0.0 baseline does not name has a section, and no other section closes with an `Unspecified:` sentence.
   - Such a section opens with its signature line, the whole line as the live registry renders it.
   - Its rules are top-level bullets, each followed by one code block of examples, and it closes with one sentence that starts with `Unspecified:`, and prose outside a rule, a nested bullet, a line of a code block that is no example and text after the closing sentence each fail.
   - With its code spans and link targets taken out and after NFKC normalisation, a bullet holds only letters, marks, numbers, spaces, `,`, `(`, `)`, `[` and `]`, a hyphen-minus, an apostrophe or an underscore after a letter, mark or number and before a letter or number, a `+` inside a `U+` code point in capitals, and one `.`, its last character, and the closing sentence is held to the same, with the colon of `Unspecified:` at its start.
   - No bullet holds a comma directly followed by "and", "or", "but", "nor", "so", "yet" or "then".
   - Read with link targets taken out, after NFKC normalisation, with format characters and the marks `` ` ``, `*`, `_` and `~` dropped, every other punctuation mark or symbol read as a space, and case folded by upper then lower case, no bullet of a section equals a shared rule, holds all its words in a row, has all its own words in a row inside one or starts with the same four words as one, and no shared rule equals another or holds all its words in a row.
   - The shared rules stand once, under their heading, opened by their one sentence, as bullets with examples in the form of the rules and with no closing sentence.
   - Each bullet has at least two examples.
   - The parser, reading each example against the live registry, finds a call of the function of its section in it, or in the shared rules a call of a function the baseline does not name, and a name inside a string literal is no call.
   - Each example gives what its comment states, the value and the warning for `evalOk` and the error codes for `evalErrors`.
   - At least two of the examples of a bullet state different results.
   - Every example statement on the page is read, each inside a function section or the shared rules.
   - Every example of a function the baseline names gives the value its comment states, read as JSON less a note in brackets after it, but six the spec names, two whose value is the current date, three that name a variable they do not give and one whose comment marks its value with `~`.

   It cannot decide these, which the reviewer decides:

   - Whether a bullet states one condition and its outcome.
   - Whether a rule holds beyond its examples.
   - Whether the examples of a rule sit on either side of its condition.
   - Whether a bullet restates a shared rule in other words.
