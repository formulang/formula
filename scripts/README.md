Release and compatibility helper scripts live here.

- `set-version.js`: sets (or, with `--check`, verifies) the single shared
  version across the root package and every workspace package. The release
  workflow publishes whenever the version on `main` is not yet on npm.
- `compat/`: the compatibility check against 1.0.0. `extract-corpus.js`
  collects every formula of the 1.0.0 spec files and docs (plus a few probes)
  into `corpus.json`. `harness.js` adds probe formulas for every function name
  the current source adds, two formulas that take a callable's name from a
  value or an expression, an environment in which a variable holds an added
  name, and a registry shape per added name in which the host registered its
  own function under it, next to the shapes an embedder builds by hand. It
  freezes the clock the functions read (`new Date()`), not the one the
  runner measures its wall-time limits by (`Date.now()`), and records whether
  a formula asked the registry for an added name. `generate-baseline.js`
  recorded 1.0.0's outcome for every formula under every shape in
  `baseline-1.0.0.json`: the parse errors, or the value, warnings, errors and
  the value of every node of each run. Both ran against `699d57e` and record
  that commit; the generator refuses to record from a build that is not its
  checkout's source. `runner/src/compat.spec.ts` requires the current source
  to produce the same outcomes for every formula that names no function added
  since (it writes none in its source, in any letter case, and neither 1.0.0
  nor the current source asked the registry for one), and for every formula
  once the added definitions are retired. Regenerate when the corpus or the
  added names change: run `pnpm run build` here and in a 1.0.0 checkout (after
  `pnpm install` there), then run these two from this repository:
  - `node scripts/compat/extract-corpus.js <checkout> <commit>`
  - `node scripts/compat/generate-baseline.js <checkout> <commit>`
