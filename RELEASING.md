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
```

`bumpp` updates the root and package versions, runs the complete source and
package checks, creates `chore: release v<version>`, tags it, and pushes the
commit and tag.

For a beta:

```bash
pnpm release:beta
```

The release workflow rebuilds the embedded Wasm, runs JavaScript, TypeScript,
Rust, and package checks, publishes to npm with provenance, and creates the
matching GitHub release.
