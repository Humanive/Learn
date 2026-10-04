# Raycast Store Submission

The extension lives in `apps/raycast`. Its Store title is **Learn** (previously **Learn Browser Capture**). The official publish command opens a pull request against `raycast/extensions`; Raycast reviews that pull request before publishing the extension.

## Current Submission Blockers

The logged-in Raycast profile was confirmed as `junjie_zhou` in ego-browser on 2026-10-03. Its profile showed zero published extensions. The manifest uses that author. The extension now includes browser capture, workspace creation, resource browsing and filters, manual resource addition, tag editing, removal, and Terminal ingestion. Review fixes preserve newer capture destinations, generate preference types before standalone typechecking, and refresh workspace names and destination badges after nested creation.

1. Complete the remaining browser integration checks before Store submission: first capture, subsequent capture, duplicate URL, changing workspace, and selecting among active browser windows. Local Raycast command icons were visually verified on 2026-10-03, and the user confirmed the extension works; each of those individual flows has not been independently verified in this preparation.

The compatible Learn CLI supports `learn list --json` and `learn add --workspace --title`. npm accepted `@humanive/learn-cli@0.1.0` and its dependency `@humanive/learn-core@0.1.0` on 2026-10-03. Install with `npm install -g @humanive/learn-cli`; both unscoped packages `learn` and `learn-cli` are unrelated projects. Newly created packages may take a few minutes to appear in registry queries. Both packages are bound to the GitHub Trusted Publisher described in [npm publishing](npm-publishing.md).

Raycast Store review PR [#31878](https://github.com/raycast/extensions/pull/31878) was opened on 2026-10-03 from `junjiezhou1122:add-learn-browser-capture`. It remains open for review and is not yet available in the Store. The latest source includes the review fixes through `970e31bb`; standalone validation passed with 54 tests and 2 monorepo-only tests skipped, plus build, typecheck, and lint. The local Raycast installation was updated and all five commands were verified in the launcher, with live workspace browsing loading CLI data.

## Packaging Already Prepared

- A validated 512×512 RGBA PNG at `assets/icon.png`, referenced as `"icon": "icon.png"` in the manifest.
- A distribution build script using `ray build -e dist`.
- An extension-local `package-lock.json` for npm-based Store CI; the monorepo continues to use pnpm.
- Official Raycast ESLint configuration, Prettier, and lint scripts.
- Extension-local README with source installation, browser integration, commands, and troubleshooting.
- Initial CHANGELOG entry using `{PR_MERGE_DATE}`.
- Node type declarations aligned with the Raycast API peer dependency.

The extension has no import from `@humanive/learn-core`. It invokes an externally installed Learn CLI, so its npm dependencies and source code can build independently in `raycast/extensions/extensions/learn-raycast/`.

## Validate Locally

From the Learn repository root:

```bash
pnpm --filter learn-raycast build
pnpm --filter learn-raycast test
CI=true pnpm --filter learn-raycast lint
```

After copying the extension into a clean standalone directory, run:

```bash
npm ci
npm run build
npm test
CI=true npm run lint
```

`lint` validates the author against Raycast's user API. Do not substitute another person's username merely to pass it.

The CLI compatibility check is:

```bash
node apps/cli/dist/cli.js list --json
node apps/cli/dist/cli.js add --help
```

The first command must print a JSON array; the second must include `--workspace` and `--title`.

## Review Considerations

The extension reads browser tabs solely through `BrowserExtension.getTabs()`. AppleScript is used only to launch shell-quoted ingestion commands in Terminal, which may require macOS automation permission. Its application allowlist does not establish compatibility with every listed browser; confirm behavior with the browser integration before claiming support.

The official guidelines discourage separate commands solely for configuration. **Choose Learn Workspace** switches the capture destination; reviewers may ask to expose workspace switching within the capture command instead.

PR #31878 review requires Raycast-styled screenshots for view commands. `metadata/learn-raycast-1.png` contains the actual workspace picker framed at 2000×1250 pixels. Put up to six PNG files in `metadata/`, each exactly 2000×1250 pixels. Use Raycast Window Capture with **Save to Metadata**, a consistent background and theme, and sample workspace names. The official documentation recommends at least three screenshots. README images belong in `media/`.

## Submit After the Blockers Are Resolved

From the standalone extension directory, `npm run publish` authenticates with GitHub and opens or updates the official review pull request. It publishes source code externally. An alternative is to fork `raycast/extensions`, copy this extension into `extensions/learn-raycast/`, and open a pull request manually.

## Official References

- [Prepare an Extension for Store](https://developers.raycast.com/basics/prepare-an-extension-for-store)
- [Publish an Extension](https://developers.raycast.com/basics/publish-an-extension)
- [ESLint Configuration](https://developers.raycast.com/information/developer-tools/eslint)
- [Browser Extension API](https://developers.raycast.com/api-reference/browser-extension)
