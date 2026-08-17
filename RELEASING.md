# Releasing the SDK

1. Update `package.json`, `src/version.js`, `src/index.d.ts`, and `CHANGELOG.md` to the same version.
2. Run `npm run check`.
3. Merge the release commit to `main`.
4. Push the matching version tag, for example `v0.2.0`.

GitHub Actions verifies that the tag matches the package and runtime versions, runs the complete prepublish checks, and publishes the public npm package with provenance.
