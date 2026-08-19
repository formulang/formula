@AGENTS.md

## Quick verification loop

- `pnpm run test` — fast source-level checks (vitest aliases; no build required).
- `pnpm run build && pnpm run lint` — must pass before declaring work done (lint resolves `dist/`).
- `pnpm run prettier` — run at the end; CI enforces `prettier:check`.

## Commits & releases

Commit messages are free-form — no required format, no linting. Versions are set only via
`pnpm run set-version X.Y.Z` (never edit the five `package.json` versions individually); a
release happens exactly when `main` carries a version not yet on npm — the workflow publishes,
tags, and creates a GitHub release. No `CHANGELOG.md`; notes live on GitHub Releases.
