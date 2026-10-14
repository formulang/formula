Release and compatibility helper scripts live here.

- `set-version.js`: sets (or, with `--check`, verifies) the single shared
  version across the root package and every workspace package. The release
  workflow publishes whenever the version on `main` is not yet on npm.
- `compat/`: the compatibility check against 1.0.0. `extract-corpus.js`
  collected every formula of the 1.0.0 spec files and docs (plus a few probes)
  into `corpus.json`, and `generate-baseline.js` recorded 1.0.0's outcome for
  each of them under several registry shapes (`harness.js`) in
  `baseline-1.0.0.json`. Both ran once, against `699d57e`, and record that
  commit; `runner/src/compat.spec.ts` requires the current source to produce
  the same outcomes. Regenerate only when the corpus itself must change, from a
  1.0.0 checkout with `pnpm install` and `pnpm run build` done:
  `node scripts/compat/extract-corpus.js <checkout> <commit>`, then
  `node scripts/compat/generate-baseline.js <checkout> <commit>`.
