# Releasing

Streamfold publishes from GitHub Actions with npm trusted publishing and
provenance. Pushing a `v*` tag starts `.github/workflows/release.yml`.

## One-time setup

1. Make `assistant-ui/streamfold` public.
2. Create a GitHub environment named `npm` and add required reviewers if
   desired.
3. Configure the `streamfold` npm trusted publisher:
   - provider: GitHub Actions
   - repository: `assistant-ui/streamfold`
   - workflow: `release.yml`
   - environment: `npm`
   - allowed action: `npm publish`
4. After one successful release, set npm publishing access to require 2FA and
   disallow tokens.

Also enable private vulnerability reporting, protect `main` and `v*` tags, and
require the CI jobs before merging.

## Publish

Start from a clean, up-to-date `main` branch:

```bash
pnpm release
```

For a beta:

```bash
pnpm release:beta
```

`bumpp` updates both package versions, runs `pnpm release:check`, creates the
release commit and tag, and pushes them. The command then waits for GitHub
Actions to publish the package and create the matching GitHub release.

Do not publish from the workspace root or run a local recovery publish. The
root package is private, and npm publication should remain traceable to the
release workflow.
