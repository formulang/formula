Release helper scripts live here.

- `set-version.js`: sets (or, with `--check`, verifies) the single shared
  version across the root package and every workspace package. The release
  workflow publishes whenever the version on `main` is not yet on npm.
