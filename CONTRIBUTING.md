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

Adding a function touches four places: a definition (portable metadata in `@formulang/definitions`), an implementation (executable code in `@formulang/core-functions`), a co-located spec file, and an entry in [docs/functions.md](docs/functions.md). A function that 1.0.0 does not have is documented as its signature, one bullet per rule with examples under each, and one closing `Unspecified:` sentence naming the inputs the rules leave open; `core-functions/src/functions/function-docs.spec.ts` runs every example on that page and fails on a rule bullet without one. The full walkthrough is in [docs/extending.md](docs/extending.md).
