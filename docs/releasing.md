# Releasing

Maintainer guide. Releases are version-driven: a maintainer sets the shared version, merges to `main` (commit messages are free-form), and the `Release` workflow publishes to npm exactly when that version is not yet published — then tags `v<version>` and creates a GitHub release with auto-generated notes. There is no `CHANGELOG.md`; the [GitHub Releases page](https://github.com/formulang/formula/releases) holds the notes.

The two files that define the pipeline:

- [`.github/workflows/release.yml`](../.github/workflows/release.yml) — the release workflow
- [`scripts/set-version.js`](../scripts/set-version.js) — sets or verifies the single shared version (exposed as `pnpm run set-version`)

All four packages (`@formulang/definitions`, `@formulang/parser`, `@formulang/runner`, `@formulang/core-functions`) always share one version and are published together, even when only one of them changed. The version lives in five `package.json` files — the private root package plus the four workspaces — and the release workflow fails any run where they disagree.

## Cutting a release, step by step

1. **Set the version.** From the repo root:

   ```sh
   pnpm run set-version 1.2.3
   ```

   This writes the version into all five `package.json` files. You choose the number — apply semver judgment (breaking change → major, new features → minor, fixes/docs → patch). Always use the script rather than editing the files by hand, so they never drift apart; the workflow's `--check` gate rejects any mismatch.

2. **Commit.** Any message, e.g. `git commit -am "Release 1.2.3"`. No tooling parses commit messages — there is no required format.

3. **Merge or push to `main`.** Use the normal PR flow or push directly; the workflow only cares about the resulting state of `main`.

4. **Let the workflow gate and publish.** On push to `main`, the `Release` workflow verifies the version lockstep (`node scripts/set-version.js --check`), builds, tests, then asks npm whether the version already exists:
   - **Already published** → the run ends green without doing anything (see [the green no-op](#when-the-version-is-unchanged-green-no-op)).
   - **Not yet published** → it publishes all four packages to npm, then tags `v<version>` and creates the GitHub release.

A release therefore happens exactly when `main` carries a version that npm does not have yet.

## What the workflow does in detail

The `Release` workflow triggers on every push to `main`. Runs are serialized through the `release` concurrency group (`cancel-in-progress: false`), so two merges in quick succession queue rather than race.

1. `actions/checkout`, then pnpm + Node 22 setup with `registry-url: https://registry.npmjs.org` (this writes the `.npmrc` that reads `NODE_AUTH_TOKEN` at publish time).
2. `pnpm install --frozen-lockfile`.
3. `node scripts/set-version.js --check` — fails the run unless all five `package.json` files carry the same version. On mismatch it lists every file's version so the offender is obvious.
4. `pnpm run build` and `pnpm run test` — a broken build or failing tests stops the run here; nothing is published.
5. **Version gate.** The workflow asks npm about all four packages at `<version>`. Only when every one of them already exists are the remaining steps skipped (green no-op); if any package is missing at that version, the run proceeds to publish.
6. **Publish.** `pnpm -r publish --access public --no-git-checks` publishes every workspace package to npmjs.org; the private root package is skipped automatically. Because each package sets `publishConfig.provenance: true` and the workflow grants `id-token: write`, npm generates [provenance attestations](https://docs.npmjs.com/generating-provenance-statements) linking the published tarballs to this exact workflow run.
7. **Tag + GitHub release.** The workflow creates and pushes the `v<version>` git tag, then runs `gh release create v<version> --generate-notes` — GitHub generates the release notes from the merged pull requests and commits since the previous release.

Order matters: tagging and the GitHub release run **only after a successful publish**. A failed publish leaves no tag and no release behind, so a failed run can simply be re-run once the cause is fixed. This holds for partial failures too: the version gate publishes as long as _any_ of the four packages is missing at that version, and `pnpm -r publish` skips the ones that already went out — so a re-run completes the release instead of no-opping. If a re-run still cannot get all four published, release a fresh version.

## When the version is unchanged (green no-op)

Most pushes to `main` do not change the version — docs, refactors, tests. The workflow still verifies the version lockstep, builds, and tests, then logs that the version is already published and skips the publish, tag, and release steps. A green run without a release is the normal outcome for day-to-day merges, not an error.

## One-time setup

Required once per repository, **before the first release version lands on `main`**:

1. **`NPM_TOKEN` repository secret.** Create a **granular access token** on npmjs.com (Access Tokens → Generate New Token → Granular Access Token) with read/write permission on the `@formulang` packages and scope, and a **short expiration** (a week is plenty — it is only needed until trusted publishing takes over, see below). Avoid the classic "Automation" token type that bypasses 2FA; npm itself warns against it. Add the token in GitHub under Settings → Secrets and variables → Actions → New repository secret, named `NPM_TOKEN`. The workflow exposes it as `NODE_AUTH_TOKEN` for the `.npmrc` written by `actions/setup-node`.

   If a release run reaches the publish step with the secret missing or invalid, that step fails. Fix the secret, then re-run the failed workflow run from the Actions UI — nothing partial has happened, because tagging and the GitHub release only run after a successful publish.

   **After the first release: switch to trusted publishing.** A token is only required to bootstrap, because npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers) is configured per package and the settings page exists only once a package has been published. As soon as `1.0.0` is on npm: open each of the four packages on npmjs.com → Settings → Trusted Publisher → GitHub Actions, and enter organization `formulang`, repository `formula`, workflow `release.yml`. Then update the workflow's publish step to npm's OIDC flow (requires npm CLI ≥ 11.5.1 in the job) and delete the `NPM_TOKEN` secret — publishing then authenticates the workflow run itself via OIDC (the `id-token: write` permission is already in place), with no long-lived secret to leak or rotate, and provenance generated automatically. The short expiry on the bootstrap token means it retires itself even if forgotten.

2. **`GITHUB_TOKEN`** is provided automatically by GitHub Actions — no setup. The workflow's `permissions` block grants it `contents: write` (push the tag, create the release) and `id-token: write` (npm provenance).
3. **Branch protection needs no special-casing.** The workflow never pushes commits to `main` — it only pushes a tag — so `main` protection can be as strict as you like.
4. The npm packages themselves need no pre-creation: the first publish with `--access public` creates them under the `@formulang` scope, provided the token owner may publish there.

## Verifying a release

After the workflow run is green:

```sh
npm view @formulang/parser version        # newest published version
npm view @formulang/definitions version   # all four packages share it
npm view @formulang/runner version
npm view @formulang/core-functions version
```

And on GitHub:

- <https://github.com/formulang/formula/releases> — a `v<version>` release with auto-generated notes.
- The `v<version>` tag points at the released commit on `main`.

Provenance: each package page on npmjs.com shows the "Provenance" section linking to the workflow run; in a consuming project, `npm audit signatures` verifies the attestations.

If a push did _not_ release when you expected one: check the "Check whether this version is already on npm" step in the `Release` run — almost always, `main` carries a version npm already has. Bump it with `pnpm run set-version` and merge again.

## Rules

- **Never reuse a published version.** npm permanently reserves published name+version pairs — a version cannot be published twice, not even after an unpublish. If a release shipped broken, fix the problem and release a new version.
- **Never publish locally.** No `npm publish`/`pnpm publish` from a workstation: it bypasses CI tests, breaks the single-version guarantee, and cannot produce provenance attestations. Publishing happens only from the release workflow. (Consequently, npm tokens for the `@formulang` scope should not live on developer machines at all.)
- **All packages always share one version.** Set it with `pnpm run set-version`, never by editing the five `package.json` files individually — the script keeps them in lockstep, and the workflow's `--check` gate fails the release on any mismatch.
- **Never create or delete `v*` tags by hand.** The workflow creates tags as a mirror of what was published; a hand-made tag claims a release that npm does not have and skews the auto-generated notes of the next real release.
- **Commit messages are free-form.** No required format, no linting, nothing parses them. Write clear messages anyway — they feed the auto-generated release notes.

## See also

- [CONTRIBUTING.md](../CONTRIBUTING.md) — the development workflow that produces the changes being released.
- [architecture.md](architecture.md) — what the packages being released contain.
