Release and compatibility helper scripts live here.

- `set-version.js`: sets (or, with `--check`, verifies) the single shared
  version across the root package and every workspace package. The release
  workflow publishes whenever the version on `main` is not yet on npm.
- `compat/`: the compatibility baseline recorded from 1.0.0 (commit
  `699d57e`). `extract-corpus.js` collects the formulas of the 1.0.0 spec files
  and docs into `corpus.json`; `generate-baseline.js` records 1.0.0's outcome
  for each of them in `baseline-1.0.0.json`; `harness.js` is the code they
  share. `runner/src/compat.spec.ts` checks that the current source produces
  the same outcomes for every formula that names none of the functions added
  since. The baseline is frozen at 1.0.0 and normally never regenerated. To
  regenerate it, build a 1.0.0 checkout (`pnpm install`, `pnpm run build`
  there), build this repository, then run:
  - `node scripts/compat/extract-corpus.js <checkout> <commit>`
  - `node scripts/compat/generate-baseline.js <checkout> <commit>`

  Both write prettier-formatted JSON, so `prettier:check` passes on the result.
