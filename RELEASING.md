# Releasing

Streamfold uses `bumpp` for synchronized versions, release commits, and tags.
Pushing a `v*` tag starts the npm release workflow.

## One-time setup

1. Make `assistant-ui/streamfold` public before publishing. npm provenance
   requires a public source repository.
2. Create a GitHub environment named `npm`.
3. For the first publish, add a granular npm token authorized to publish as the
   `NPM_TOKEN` environment secret. The package must exist before npm trusted
   publishing can be configured.
4. After the first publish, configure `streamfold` on npm with this trusted
   publisher:
   - Organization: `assistant-ui`
   - Repository: `streamfold`
   - Workflow: `release.yml`
   - Environment: `npm`
   - Allowed action: `npm publish`
5. Verify trusted publishing, then remove the long-lived `NPM_TOKEN`.

## Publish

From a clean, up-to-date `main` branch:

```bash
pnpm release
# Equivalent:
pnpm release:latest
```

`bumpp` updates the root and package versions, runs the complete source and
package checks, creates `chore: release v<version>`, tags it, and pushes the
commit and tag. The tag starts the GitHub Actions release job, which runs
`pnpm publish:npm` and publishes `./packages/core` as the public `streamfold`
package with the npm `latest` tag. The command waits for that workflow and
exits only after the package is available on npm or the release fails.

For a beta:

```bash
pnpm release:beta
```

The beta command bumps to a beta version, follows the same release path, waits
for completion, and publishes with the npm `beta` tag. The release workflow
rebuilds the embedded Wasm, runs JavaScript, TypeScript, Rust, and package
checks, publishes to npm with provenance, and creates the matching GitHub
release.

Do not run `npm publish` without a package path from the workspace root. The
root manifest is intentionally private and is never published. The
`pnpm publish:npm` helper targets the public package and is invoked by the
release workflow. Normal releases should use `pnpm release:latest` or
`pnpm release:beta` so publication happens through the trusted GitHub Actions
environment.

For a manual recovery publish from the repository root:

```bash
pnpm publish:latest
# or
pnpm publish:beta
```

These commands always publish `./packages/core`; they never publish the private
workspace root. They do not bump versions, create tags, or create GitHub
releases.
