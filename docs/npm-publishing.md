# npm publishing

Learn publishes two public packages in order:

- `@humanive/learn-core`: compiled workspace, resource, adapter, and ingestion logic.
- `@humanive/learn-cli`: the `learn` executable, depending on the same release of core.

The `humanive` npm Organization was created under the maintainer's logged-in `junjiezhou1122` account on 2026-10-03. Both packages were published at version `0.1.0` that day, and installation of the CLI and its core dependency from the official registry was verified. Both packages have a GitHub Trusted Publisher configured for `Humanive/Learn`, workflow `npm-publish.yml`, with direct publishing enabled. The workflow is prepared locally; deployment to GitHub and an actual OIDC publication remain to be verified.

## Automatic releases

`.github/workflows/npm-publish.yml` validates tests and packed installation on pull requests. It publishes when CLI/core code, package configuration, release scripts, or the workflow itself changes on `main`. It can also be started manually from GitHub Actions on `main`. Changes limited to Raycast or research documents do not trigger it.

The workflow:

1. Installs locked dependencies and verifies the release planner.
2. Chooses a shared version for both packages from the public npm registry. The first release uses the package.json baseline, initially `0.1.0`. Subsequent releases increment the highest stable published version's patch number. A higher baseline checked into both manifests can request a minor or major release.
3. Builds core and CLI, runs their tests, and packs both packages with pnpm. pnpm converts `workspace:*` into the exact core version in the CLI tarball.
4. Installs the actual tarballs in a temporary directory and verifies `learn --version`, creating a workspace, adding a pending URL with a title, and the JSON API used by Raycast.
5. Uses npm CLI and GitHub OIDC to publish core, waits for it to be visible, then publishes CLI with the `latest` tag.

Versions are changed only in the runner checkout. The workflow does not commit version bumps back to the repository. `learn --version` reads the installed package.json, so it matches the released version.

The `learnRelease.commit` field links each npm release to its Git commit. Rerunning a completed release skips existing packages; rerunning a partial release reuses that commit's version. Registry lookup errors other than 404 fail the workflow instead of guessing a version. Releases are serialized using workflow concurrency. A commit must descend from the most recent recorded release; older or unrelated workflow commits and partial releases older than an already published version fail instead of rolling the `latest` tag back. Documentation-only pushes do not prevent an otherwise valid pending release.

## First publication

Confirm ownership of the `humanive` npm scope and log in with an account authorized to publish both packages. Node.js 24 and npm 11.5.1 or later support the publishing flow.

From a clean checkout of the release commit on `main`:

```bash
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
pnpm install --frozen-lockfile
node scripts/npm-release.mjs prepare
pnpm test:release
node scripts/npm-release.mjs publish
```

Interactive authentication or 2FA may need maintainer input. The first publication creates the packages so their settings become available on npmjs.com. `prepare` changes both local manifest versions and records the Git commit; run this sequence in a release checkout, not on top of unrelated pending edits.

## Configure Trusted Publishing once

For **each** package on npmjs.com, open **Settings → Trusted publishing → Add trusted publisher → GitHub Actions**, then configure:

| Field | Value |
| --- | --- |
| Organization or user | `Humanive` |
| Repository | `Learn` |
| Workflow filename | `npm-publish.yml` |
| Environment name | Leave empty; the workflow does not declare an environment |
| Allowed actions | Enable direct `npm publish` |

Current npm defaults allow staged publication; this workflow uses direct publication, so explicitly enable `npm publish`. The workflow file must exist on GitHub under `.github/workflows/`. Use the exact case shown above.

The workflow grants `id-token: write` only to the publishing job and uses a GitHub-hosted Ubuntu runner. It needs no `NPM_TOKEN` repository secret. npm automatically attaches provenance when publishing these public packages from the public repository through OIDC.

After configuring both packages, run **Actions → Publish npm packages → Run workflow** on a new release commit on `main` to verify an actual OIDC publication. If the bootstrap commit was already published with `learnRelease.commit` metadata, dispatching that same commit skips both publications and validates the workflow without exercising OIDC. Future qualifying pushes to `main` publish automatically.

## Local verification

```bash
pnpm test:release
```

This builds and tests the CLI/core packages and validates their installation from tarballs without publishing. Artifacts live in the gitignored `.npm-release/` directory. Live adapter integration tests are opt-in with `LEARN_LIVE_TESTS=1`; they require network access and any external tools/API configuration used by the adapters.

## Verify a published release

```bash
npm view @humanive/learn-cli version
npm view @humanive/learn-core version
npm install -g @humanive/learn-cli
learn --version
```

Raycast's Learn Executable preference can use the installed `learn` command or the absolute path printed by `command -v learn`. Raycast Store submission is a separate review process described in [raycast-store.md](raycast-store.md).

## References

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
- [pnpm workspace publishing](https://pnpm.io/workspaces#publishing-workspace-packages)
