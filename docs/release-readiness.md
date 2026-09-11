# Release readiness checklist

Status: proposed release gate; identity/signing entries require maintainer decisions and credentials.

This checklist tracks the trust chain that must be complete before binaries are distributed outside the development team. Code-verifiable items should run in CI; the remaining items are manual release-owner decisions.

## Code and data integrity

- [x] Workspace backup/verify/restore commands with SHA-256 manifest (`bun run workspace:backup|verify|restore`).
- [x] Credential encryption key can come from Electron safeStorage or `CRAFT_CREDENTIAL_KEY` instead of the machine-id fallback.
- [x] Remote connections verify TLS by default; per-workspace `allowInsecureTls` is an explicit opt-in.
- [x] Dependency audit is a CI gate with a checked-in known-advisory baseline.
- [ ] Workspace backup/restore exercised against a real desktop workspace in CI or a release rehearsal.
- [ ] Recovery drill: kill the app/server after T1 but before T2, verify the operation parks as unknown and is visible in Run.

## Branding and update chain

The fork must not ship upstream identity. Maintainers must choose and record:

- [ ] independent product name and bundle/application id;
- [ ] owned update feed domain and release bucket;
- [ ] owned support, security, and documentation URLs;
- [ ] signing certificate / notarization identity per platform;
- [ ] release notes and rollback policy.

Until these are decided, `appId`, `productName`, update feed, and publisher metadata intentionally remain unmodified; do not publish public binaries from this branch.

## Artifact verification

- [ ] `bun run electron:dist:<platform>` completes on a clean machine.
- [ ] `bun run release:checksums` writes `SHA256SUMS` and `release-manifest.json`.
- [ ] Installer signature verifies with the platform tool (`signtool verify`, `codesign --verify`, `gpg --verify`).
- [ ] Checksum manifest is published next to the installer.
- [ ] SBOM/provenance generation is wired to the release job.
- [ ] Install, upgrade, and rollback are tested on the three supported platforms.
- [ ] Uninstall leaves user data intact and re-install finds the existing profile.

## Privacy

- [ ] Crash reporting is opt-in (`CRAFT_TELEMETRY_ENABLED=1` plus a DSN).
- [ ] A user-visible telemetry description and local diagnostic export exist.
- [ ] No provider tokens or workspace content are present in release artifacts or logs.
