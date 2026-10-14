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

- **Tests need no build.** `vitest.config.ts` aliases `@formulang/*` to each package's `src/index.ts`, so the entire suite runs against source (currently 69 spec files / 462 tests). Run `pnpm run test` freely and often.
- **Lint DOES need a build.** `lint` is `tsc --noEmit` per package, and cross-package imports resolve through the published entrypoints (`dist/`). Run `pnpm run build` before `pnpm run lint` — and before anything else that resolves `dist/` instead of the vitest aliases.
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
4. Document the function in `docs/functions.md`.
