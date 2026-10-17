# PR #886 review dispositions

This records the review of `c52a7190a` and its fixes after rebasing onto
`2c38d4a4e`. It is not a full enterprise API or load/HA certificate.

## Published-release upgrade

The current Prisma client inserts defaults for newly added columns even when a
create selects only `id`. The certification script now generates a separate
client from the published baseline schema and uses it only for baseline seeding.
It then deploys the current migrations and runs the current-client verification.
Generation uses installed dependencies with automatic installation disabled;
the temporary schema and client are removed on exit. The database-name guard and
already-upgraded guard remain enforced. The complete upgrade test passed locally
against isolated PostgreSQL with `SSO_CERT_AUTH_LOAD=1`: all 12 tests passed,
including preserved legacy data/sessions and concurrent authentication reads.

## Automation browser credentials

The auditor fixture now uses `generateApiKey()` and stores its returned prefix
and hash. Playwright workers and the application share the same API-key secret,
including when CI supplies a custom value. Production token-shape validation is
unchanged. All 28 production-browser tests passed across desktop, Pixel 5,
iPhone 13 and iPad Pro, with a custom API-key secret supplied as in CI.

## CodeQL alert 5190

Disposition: false positive for `js/insufficient-password-hash` in
`src/lib/auth-abuse.ts`. Inspected CodeQL analysis `1971806796` (PR merge commit
`430bc36643459acdd77374cdaafd2f88d0277d69`) and its SARIF code flows.

The source is the object returned by `createEmergencyAccount()` in
`tests/integration/emergency-password-database.test.ts` (lines 67 and 69 in the
reviewed revision). The traced accesses are `first.id` and `second.id`, passed as
`accountId` to `passwordEmergencyLogin()`, then to `consumeAuthRateLimit()`.
CodeQL classifies the returned object as a password source although the selected
property is the database account identifier. The rate-limit helper HMACs that
identifier to avoid storing it in cleartext; its output is never a password
verifier. The concurrency test exercises the actual rate-limit implementation.

Actual emergency passwords are generated with 256 random bits, stored using
scrypt (`N=32768`, `r=8`, `p=3`) with an independent 128-bit salt, and verified
through `verifyEmergencyPassword()` with a timing-safe comparison. The password
crypto tests pass. No password-hashing algorithm, authentication check, scan
configuration, or global rule suppression was changed.

## Checkov alerts 5424–5429

The two Compose fixtures require an operator-supplied, URL-safe isolated database
password. PostgreSQL, PgBouncer, application processes and migration commands use
the same required value. Missing values fail Compose interpolation.

The k6 Pod uses the verified ARM64 image digest with `Always` pull policy,
`RuntimeDefault` seccomp, and probes for its idle process and writable work volume.
These probes do not certify load outcomes. The image architecture and registry
access requirements are documented.

A targeted Checkov scan reproduced both `CKV_SECRET_4` findings on the original
Compose files. The modified files have zero such findings; all four targeted
Kubernetes checks pass without skips or exemptions. The local repository-wide
scan additionally found an existing `CKV_K8S_15` finding in the agent deployment;
that is outside these six reviewed findings and is not presented as a full clean
repository scan.

## Scope accuracy

Automation is integrated in this branch. Settings GET/PATCH, service draft
GET/PUT and publication POST bring the registry to 89 operations. Effective
configuration, validation, simulation, modes, restore, history, diagnostics and
the remaining enterprise endpoint families are still unfinished. The workflow
inventory and implementation tracker retain those release blockers.
