# Releasing the SDK

1. Update `package.json`, `api-source/version.ts`, and `CHANGELOG.md` to the same version. Do not edit generated files under `src/` directly.
2. Run `npm run build:api` to refresh committed package artifacts.
3. Run `npm run check`.
4. Merge the release commit to `main`.
5. Push the matching version tag, for example `v1.0.2`.

GitHub Actions verifies that the tag matches the package and runtime versions, runs the complete prepublish checks, and publishes the public npm package with provenance.
