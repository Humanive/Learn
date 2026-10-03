# Raycast Store Submission

The extension lives in `apps/raycast`. Its Store title is **Learn Browser Capture**. The official publish command opens a pull request against `raycast/extensions`; Raycast reviews that pull request before publishing the extension.

## Current Submission Blockers

1. Set `apps/raycast/package.json` → `author` to the maintainer's confirmed Raycast username. `Humanive` returned HTTP 404 during Raycast's author validation on 2026-10-03. An existing username alone does not establish that it belongs to the maintainer.
2. Complete the remaining browser integration checks before Store submission: first capture, subsequent capture, duplicate URL, changing workspace, and selecting among active browser windows. Local Raycast command icons were visually verified on 2026-10-03, and the user confirmed the extension works; each of those individual flows has not been independently verified in this preparation.

The compatible Learn CLI is included in this change and can be installed from the repository using the extension README. It supports `learn list --json` and `learn add --workspace --title`. There is no published npm package for this project; the unscoped npm package `learn` is unrelated. A versioned CLI release would make installation more convenient, but source installation is the current documented route.

No Raycast Store pull request has been opened.

## Packaging Already Prepared

- A validated 512×512 RGBA PNG at `assets/icon.png`, referenced as `"icon": "icon.png"` in the manifest.
- A distribution build script using `ray build -e dist`.
- An extension-local `package-lock.json` for npm-based Store CI; the monorepo continues to use pnpm.
- Official Raycast ESLint configuration, Prettier, and lint scripts.
- Extension-local README with source installation, browser integration, commands, and troubleshooting.
- Initial CHANGELOG entry using `{PR_MERGE_DATE}`.
- Node type declarations aligned with the Raycast API peer dependency.

The extension has no import from `@learn/core`. It invokes an externally installed Learn CLI, so its npm dependencies and source code can build independently in `raycast/extensions/extensions/learn-raycast/`.

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

The extension reads browser tabs solely through `BrowserExtension.getTabs()`. It has no AppleScript implementation. Its application allowlist does not establish compatibility with every listed browser; confirm behavior with the browser integration before claiming support.

The official guidelines discourage separate commands solely for configuration. **Choose Learn Workspace** switches the capture destination; reviewers may ask to expose workspace switching within the capture command instead.

Store screenshots are optional. If supplied, put up to six PNG files in `metadata/`, each exactly 2000×1250 pixels. Use Raycast Window Capture with **Save to Metadata**, a consistent background and theme, and sample workspace names. The official documentation recommends at least three screenshots. README images belong in `media/`.

## Submit After the Blockers Are Resolved

From the standalone extension directory, `npm run publish` authenticates with GitHub and opens or updates the official review pull request. It publishes source code externally. An alternative is to fork `raycast/extensions`, copy this extension into `extensions/learn-raycast/`, and open a pull request manually.

## Official References

- [Prepare an Extension for Store](https://developers.raycast.com/basics/prepare-an-extension-for-store)
- [Publish an Extension](https://developers.raycast.com/basics/publish-an-extension)
- [ESLint Configuration](https://developers.raycast.com/information/developer-tools/eslint)
- [Browser Extension API](https://developers.raycast.com/api-reference/browser-extension)
