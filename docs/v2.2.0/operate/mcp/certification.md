---
title: MCP certification status
order: 2
description: What has and has not been certified for MCP, and how to collect release evidence.
type: reference
product_area: mcp
audience: [operator, developer]
verification:
  level: source
  verified_at: 2026-11-09
  evidence:
    - .github/workflows/mcp-certification.yml
    - scripts/mcp/certify.cjs
    - scripts/mcp/conformance.ts
    - scripts/mcp/certify-replicas.ts
    - tests/e2e/mcp-lifecycle.spec.ts
---

# MCP certification status

Baseline source: `f9f772a1fb43798bf45400c8e2ec7a0a823fa43f`. Branch: `feat/enterprise-mcp-2.2`. This is a development candidate; local results below were collected from the development worktree, without final-SHA certification or a released image.

Observed locally on 27 October 2026:

- Independent runbook review milestone: all 46 MCP PostgreSQL tests passed together in a fresh disposable PostgreSQL 16 database, including 18 new approval cases. They cover preparation without starting work, ciphertext/input privacy, distinct native reviewers, digest/session/capability changes, token rotation and same-grant refresh, rejected/expired/wrong-grant proposals, stale published versions, competing decisions/commits, one-time consumption, native-step policy preservation, pre-commit rollback and lost-response retry. The migration is additive on the existing native preview table; this is not a generic approval implementation for every sensitive domain.
- The updated local checker completed all 15 stages, including typecheck, 26 MCP tests, 46 datasource/deployment tests, the 46-test PostgreSQL suite, coverage, standalone build and six browser tests. Chromium, Firefox and WebKit each passed both the native two-user approval/execution/retry flow and the existing consent/read/revocation flow, including mobile review. A local 4 GB Node build heap failed before this run; the successful build used 6 GB. Local checker and dedicated MCP CI now default the build to that heap size.
- Full unit suite after the approval change: all 951 files passed, 10,051 tests passed and seven skipped. The 72 focused MCP/datasource/deployment tests also passed. Three existing native step-approval transaction tests and the existing unchanged-plan preview/execution test passed in isolated PostgreSQL runs with a 60-second fixture hook deadline. One earlier native fixture reset exceeded its default ten-second hook; the successful isolated rerun does not establish a green full integration suite.

- `npm run test:mcp`: 25 boundary, catalog-policy, database-context and official-SDK protocol tests passed, including malformed JSON, proxy Host validation, cancellation admission and encoded response budgets.
- PostgreSQL 16 Alpine: all repository migrations including the additive MCP migration installed into isolated fresh databases. Upgrade from the pinned baseline database applied the additive migration (318 → 319 migrations), preserving its existing incident fixture; new grant tables were empty. This small populated fixture is not production-scale upgrade/rollback evidence.
- `DATABASE_URL=<isolated test database> npx vitest run -c vitest.int.config.ts --no-file-parallelism --maxWorkers=1 tests/integration/mcp-security-database.test.ts`: 19 tests passed, including code/refresh replay, scope intersection, current authority/revocation, mutation idempotency, context composition and retained export quotas. The database fixture resets once, then owns distinct principals/resources per case.
- Four additional PostgreSQL isolation tests passed: distinct primary/MCP backends and transaction settings; exhausted MCP pool with primary reads still available; server-side SQL cancellation and pool recovery; contended lock timeout while the primary transaction completes. These tests use a direct PostgreSQL 16 endpoint and do not certify PgBouncer or production mixed-workload capacity. All 23 database tests passed together in the final local run.
- Follow-up query profiling at the pushed foundation and the consolidated authority snapshot, using the same one-incident local database fixture: joined context decreased from 31 to 19 SQL statements, including authentication-related reads decreasing from 17 to 5. A three-step plan decreased from 28 to 18 statements; single search decreased from 14 to 8 and discovery from 7 to 4. Each joined investigation retained its separate native SEARCH_EXPORT quota write alongside top-level MCP admission. These local counts are not latency/capacity certification. The source-labelled aggregate artifacts contain no SQL text or parameters. Updated authority regressions cover role/membership/scope changes, token-version invalidation, expired or cross-grant credentials and parameterized hostile IDs. The updated 28-test PostgreSQL suite and all 15 local-check stages passed, including the production build and three native browser flows; the 71 focused unit/datasource/deployment tests passed separately. The full unit suite was rerun after this authority change: all 951 files and 10,050 tests passed, with seven skipped.
- Datasource and deployment preflight tests: 46 passed. Per-replica MCP connection reservations are included even when the web tier uses PgBouncer; invalid pool sizes and known MCP PgBouncer URLs fail closed.
- `npm run --silent mcp:coverage`: 314 operations classified, 69 executable candidates on 27 October 2026 (the inventory on 2026-11-09 is 325 classified and 147 candidates; see the [catalog](../../reference/mcp/catalog.md)); generated artifact explicitly reports `certified: false`.
- Typecheck, changed-source ESLint (zero warnings), API-client drift check and production standalone build passed.
- `npm run check:mcp:local` completed all 15 stages successfully using a new disposable PostgreSQL 16 container and fresh production build: 25 MCP tests, 46 datasource/deployment tests, 23 database tests and three native browser tests passed. Chromium, Firefox and WebKit exercised login, client registration, PKCE consent/exchange, read-only tool discovery, scoped read, denial of a guessed operation outside the consented scope, mobile settings and immediate grant revocation. The owned server/container were removed; logs and the uncertified source-labelled report remain in the printed OS temporary directory.
- Final full unit rerun after database isolation, with two workers and no concurrent build: all 951 files passed; 10,050 tests passed and seven skipped. A concurrent build/unit attempt exited 137 without a usable full-suite result; its owned orphaned container was identified and removed before the successful sequential run. Before this phase, a four-worker run passed 950 files/10,046 tests after an earlier dashboard timing flake; the focused dashboard file also passed on the pinned baseline. These are observed local results, not final-SHA release certification.
- The broad integration run encountered timeout/fixture-order failures and was stopped. A focused matched baseline/candidate comparison passed the same 23 existing collaboration/automation tests; this does not establish a clean full integration run.
- Independent general-agent fallback bug/security reviews completed and produced six findings. Fixes and focused regressions address incident context, cancellation admission, parse errors, native write/export quotas, OAuth admission starvation and serialized wire budgets. Specialized Bugbot/Security services were unavailable; these were fallback reviews, and no second review pass has been claimed.
- The initial GitHub MCP workflow for commit `12f04735e` completed its typecheck, unit/database/coverage checks, production build and three browser flows successfully. Its production dependency audit failed and the release-gates job was skipped; this is not a green workflow or a certified release. Follow-up changes require new CI results.
- `npm audit --omit=dev` on 27 October 2026: one existing high-severity Zod advisory remained (superseded by the [Zod upgrade below](#patched-zod-compatibility-upgrade)) ([GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)); the repository then used Zod 3.25.76 and the patched version was 4.6.6. Request bounds reduce MCP input exposure but do not clear the dependency finding or certify other entry points.

Local evidence is stored outside git under `/tmp/opsknight-mcp-*` and the OS temporary directory printed by `npm run check:mcp:local`. That repeatable command owns a disposable PostgreSQL container and production server, exercises three browsers and removes its infrastructure on exit. Its report records the base SHA and dirty-worktree status with `certified: false`. Temporary logs are not durable CI evidence and do not satisfy release acceptance. No release gate A–F is marked complete. Full regression, live-client, dependency/security, parity, load/failure-injection and multi-replica topology results remain pending. Missing implementation is listed in [architecture](architecture.md).

The `mcp-certification.yml` workflow (pull requests labelled `ci:full`, pushes to `main` and manual dispatch) runs modern protocol/security tests, PostgreSQL installation and replay tests, contract drift coverage, client drift checks, typecheck, production build and native browser workflows. A green `MCP PR validation` check means those automated checks passed; it does not certify full parity or production readiness. The separate manual `mcp-release-certification.yml` validates the release manifest before requesting protected approval, then revalidates it after approval. It checks exact source/image revisions, the complete gate inventory, review metadata and syntactically valid HTTPS artifact references. It does not fetch or cryptographically verify linked evidence, so reviewers must inspect those artifacts before approving.

Before review-ready status, rerun `npm run test:unit`, `npm run test:int`, `npm run build`, `npm run api:clients:check`, `npm run api:coverage`, `npm run mcp:coverage`, changed-file ESLint, typecheck, security and deployment workflows on the final SHA. Certify fresh install and populated upgrade/rollback. Compare matched ingestion/paging P95/P99, job age, SQL/auth/rate-limit counts, WAL, pool waits and failure recovery at 0/10/25/50/100 MCP concurrency across one/two/three replicas. Record actual host compatibility only after successful consent, read, write and long-task flows.

MCP-only emergency rollback: disable MCP in Settings, revoke clients/grants, and retain additive database tables while reverting application code. Do not drop authentication or task evidence during incident response. A database backup must preserve grant/client/code/token tables and the active application encryption key must be restored with it, because MCP token digests are derived from that key. Full disaster-recovery validation remains pending.

## Client matrix run, 8 November 2026

Source: `main` at `f934c9907` plus the follow-up fixes branch. Evidence (JSON reports, screenshots, exports) is stored outside git, as above. This is test evidence, not a signed release manifest.

- **Client profiles:** ten profiles (Claude web, ChatGPT including the `search` and `fetch` shape deep research needs, Claude Code, Cursor's app-scheme redirect, VS Code desktop and web, Codex CLI, Gemini CLI with an empty scope, MCP Inspector, and the 2026-07-28 stateless revision) each registered, signed in through the consent screen, exchanged the code with PKCE, ran a protocol session at that client's revision, refreshed and revoked. 189 of 189 checks passed on a local production build and 179 of 179 on the hosted site (before the older-revision check was added). **These profiles are modelled from each client's documented behaviour. They are not the applications.**
- **Real clients:** the official TypeScript SDK at 1.10.2, 1.13.3 and 1.32.2, the official Python SDK 2.3.0 and the **real Claude Code CLI 2.1.316** (five prompts: identity, drill-down, an honest "what changed", a refused change on a read-only connection, recovery from a not-found) passed, locally and on the hosted site. SDK 1.10.2 failed one step before the fix below. No other vendor application was run.
- **Found and fixed:** clients on the 2025-03-26 revision no longer receive `resource_link` blocks (their SDK rejected the result); an unknown `/.well-known/*` path answers 404 instead of the sign-in page; the Policy tab session-lifetime select has an accessible name (all eight MCP tabs now have zero axe violations at WCAG 2.2 AA).
- **Performance (local production build, one process, default 4 slots):** a single call takes 11 to 22 ms (p50); throughput saturates near 138 requests per second; above the concurrency cap the server answers 503 with `Retry-After`; memory stayed at 300 to 400 MB. Hosted calls from a remote machine take about 400 ms (network included).
- **Not tested:** writes and approvals on the hosted site (it has live Slack and Microsoft Teams integrations), the real Cursor, ChatGPT, VS Code, Codex and Gemini applications, client metadata documents other than Claude's, long soak and multi-replica failover.

## Official conformance suite

`npm run mcp:conformance -- --url=http://localhost:3042` runs the official [MCP conformance suite](https://github.com/modelcontextprotocol/conformance) (`@modelcontextprotocol/conformance`, pinned in `scripts/mcp/conformance.ts`) in server mode against a running OpsKnight on a local `*_test` database, and MCP PR validation runs it against the production build. The suite has no way to authenticate in server mode, so the harness turns MCP and personal access tokens on in that disposable database, mints a one-day personal token for the first active administrator through the production token code, and puts a local proxy in front of `/mcp` that adds the bearer header to requests carrying none. The proxy rewrites Host only when it names the proxy, so the suite's DNS-rebinding probes reach the server unchanged. The token is revoked when the run ends. The suite needs Node 22 or later.

Known failures belong in `scripts/mcp/conformance-baseline.yml` (passed with `--expected-failures` when present), one entry per scenario or `scenario:check-id` with the reason; the suite then fails the run on any new failure and on a baselined check that starts passing. No baseline is committed yet: the suite has not been run against this branch, so the first run on a quiet machine records it. Many server scenarios call fixture tools, prompts and resources that only the suite's reference server has (for example `test_simple_text`); OpsKnight is a domain server and does not ship them, so those failures say nothing about protocol conformance. The `conformance` gate in the release manifest links that run's evidence.

## Two-replica check

`npm run mcp:certify:replicas -- --a=http://localhost:3042 --b=http://localhost:3043` runs against two production replicas on one freshly seeded local database (`scripts/mcp/seed-local.cjs`), started with `MCP_ALLOWED_HOSTS=localhost:3043` so replica B accepts its own Host. It checks that an OAuth token minted through replica A (registration, browser consent, code exchange) works on B; that a change prepared through A is approved on B's review page and committed through B; that a `subscriptions/listen` stream on B sees a change made through A; and that the per-minute quota is one shared window (once A refuses a connection over its quota, B refuses it too). It uses Playwright's Chromium for the two browser steps.

## Client-profile emulation

The client matrix run of 8 November 2026 used a harness that was never committed. Only its transcripts survive (outside the repository); the code that emulated each client's registration, redirect form and protocol revision is gone, so there was nothing to port. `npm run mcp:conformance`, the browser suite and the client guides under `guides/mcp/clients/` cover part of that ground; rebuilding per-client profiles is open work.

## Running the release-only gate

1. In repository branch protection/rulesets, require the **`MCP PR validation`** check for merging. Configure a GitHub environment named `mcp-release-certification` with required human reviewers and restrict deployments to the protected `main` branch. The workflow runs on pushes to `main` and on pull requests only when they carry the `ci:full` label; once it runs, it skips the expensive MCP suite successfully when no MCP-related files changed. Two nightly workflows, `mcp-cimd-drift.yml` (checks the metadata documents real assistants publish against the test fixtures and opens an issue on drift; `npm run mcp:cimd-check` runs it by hand) and `mcp-mixed-load.yml` (mixed ingestion and MCP load evidence), also run on demand and never on pull requests. Repository branch-protection/environment settings are not managed by these workflow files.
2. Attach a reviewed `mcp-release-evidence.json` asset to the GitHub Release for the exact `vMAJOR.MINOR.PATCH` tag. The tagged commit must be reachable from `main`.
3. Dispatch **Enterprise MCP release certification** from `main`, supplying that release tag. The workflow checks the tag, validates the manifest, exposes the manifest as an Actions artifact for review, waits for environment approval, then checks the same manifest again against the exact checked-out source SHA.
4. Do not dispatch the release workflow as a substitute for missing implementation or live test evidence. A manifest marked `passed` is a human assertion backed by the linked artifacts, not proof generated by the validator.

The manifest is JSON with `schemaVersion: 1`, a 40-character `sourceRevision`, `imageDigest` in `sha256:<64 lowercase hex characters>` form, an `imageSourceRevision` equal to the same source SHA, an HTTPS `imageProvenanceUrl`, and a `review` object containing `reviewedBy` (GitHub username), UTC `reviewedAt`, and HTTPS `referenceUrl`. The `gates` object must contain exactly these required gate names: `architecture`, `protocol`, `oauth`, `rbac`, `workflowParity`, `approvals`, `durableTasks`, `mixedLoad`, `faultTolerance`, `clients`, `deployment`, `migrationUpgrade`, `security`, `documentation`, and `conformance` (the pinned official conformance suite run, see [Official conformance suite](#official-conformance-suite)). Every row needs `status: "passed"`, the same `sourceRevision`, and one to twenty unique, syntactically valid HTTPS `artifactUrls`. URLs with credentials, fragments, IP literals, local hostnames, or non-default ports are rejected.

No example manifest in this document is intended to pass. The evidence asset must be prepared from real results for the release SHA and image digest; do not mark pending work as passed.

## Managed-configuration browser checkpoint

On 2026-10-29, a fresh owned PostgreSQL 16 fixture, isolated production build and separate loopback server passed all six Chromium/Firefox/WebKit MCP browser flows. The production build/server received no MCP-prefixed environment variables. The settings page reported the database App URL as its origin source. Tests covered native login, PKCE consent and issuer checks, scoped calls, individual revocation, two-user runbook review/execution/retry, mobile layout and the new confirmation-gated revoke-all action against a live OAuth token.

The production build included its TypeScript check; the browser run took 32.5 seconds. Evidence was captured from a dirty tree based on `4b8d30ccca0c3bfc1e43186431b940c45bef57dd`, not a final commit. Logs and disposable secrets remained outside git; the owned server, database container and separate build directory were removed. The existing development server was left running. Copilot's reported 998 database passes were not rerun for this browser checkpoint. This is local evidence, not final-SHA CI, live-client or production capacity certification.

Use `npm run check:mcp:local -- --browser-only` to repeat the production browser stage after a separately completed database suite. The evidence report distinguishes this mode from a full local run.

## Automatic assistant registration checkpoint

On 2026-10-29, the automatic-registration candidate based on `9501b5a7adc3355e17adebbb5fece8f35fab90ff` passed 74 focused MCP/component tests and 45 focused PostgreSQL tests. The registration suite includes policy withdrawal, refresh scope narrowing, stale consent, separate user grants, revocation, metadata/body validation, registration quotas, registry capacity and bounded cleanup. TypeScript, zero-warning changed-source ESLint, Prisma validation and coverage generation passed. Coverage still reports `certified: false`.

An isolated PostgreSQL 16 fixture and production build with no MCP-prefixed product variables passed all nine Chromium/Firefox/WebKit flows in 41.8 seconds. The new flow enables automatic connections through native settings, anonymously registers a public client, completes PKCE consent without an explicit scope parameter or client secret, discovers scoped tools, and verifies that disabling automatic connections invalidates access. Existing consent/revocation and two-user runbook approval flows also passed.

The installed Claude Code 2.1.312 CLI independently registered against an owned loopback production server and produced the correct OpsKnight authorization URL with PKCE S256 and the expected resource. It received no manual client ID. This bootstrap check stopped before native approval and exchanged no code or token; it does not establish a complete signed-in Claude session or ChatGPT interoperability. Its temporary client profile and owned server/container were removed. The public OpsSentinal deployment was not changed. These are dirty-worktree local results, not final-SHA or live-client release certification.

## Authentication hardening checkpoint

The follow-up based on `47444867768faf9eb02d385644ead05419b9e412` passed 80 focused tests and 46 PostgreSQL authentication/registration/query-profile tests locally on 2026-10-29. Gated uploads exercise grant/client revocation, token expiry, scope/role changes and MCP shutdown while a request body is paused. Anonymous slow-body tests require rejection before the body is read. Additional tests cover independent OAuth admission, absolute metadata deadlines and cleanup, duplicate/prototype metadata keys and public-client method selection without downgrading private-only clients. The current published ChatGPT CIMD document was separately accepted as public `none` without fetching its JWKS URL; a complete live ChatGPT login was not performed.

To preserve fresh permissions after slow uploads, the route checks authority both before and after reading the body. The small-fixture statement counts were 7 for discovery, 11 for search, 22 for incident context, 21 for the three-step plan, and 38 for four concurrent searches. Quota writes remained one per top-level request, plus the existing native export quota for joined context/plans. These are statement counts, not production latency or capacity measurements.

At this pre-upgrade checkpoint, the Zod high-advisory exception was unchanged. No patched Zod 3 release was available in the registry when checked; the compatibility upgrade below supersedes that dependency status. Source hardening, scoped privacy headers and local tests do not establish best-in-class security, a clean dependency audit, production DoS immunity or final-SHA release certification.

## Patched Zod compatibility upgrade

The direct dependency is pinned to Zod 4.6.7, which is outside the affected range of GHSA-mrhx-c7xc-m3w5. Existing application and test schemas import the package's supported `zod/v3` compatibility API; the MCP protocol adapter continues to use `zod/v4`. This avoids a wholesale migration of validation contracts while removing the vulnerable package version. The empty audit baseline no longer accepts that high advisory. A compatible update of the transitive `qs` package to 6.17.1 also removed its moderate stringification DoS advisory. A fresh production audit reported zero critical/high/moderate and eleven low advisories. The MCP audit gate now rejects unreviewed moderate advisories as well as high/critical ones. Remaining advisories are not described as resolved.

The 221 affected REST operation fingerprints were refreshed only after verifying that their source changes were the compatibility import replacement; operation dispositions, authorization actions and contract hashes were retained. Canonical coverage and generated API-client drift checks passed. Four existing forms needed small type/subscription cleanups to pass changed-file lint with zero warnings; their validation schema contracts were retained. Focused MCP tests and incident-form/autosave tests passed. Full-suite/build/browser outcomes are recorded in the PR after completion; this checkpoint alone is not final-SHA production certification.

## Universal setup and replica checks

The settings page now identifies local automatic-connection readiness and supplies a read-only setup-check command built from that installation's App URL. `npm run mcp:doctor -- https://YOUR-HOST/mcp --json` checks same-origin discovery, public-client PKCE metadata, automatic registration and the anonymous 401 challenge without creating credentials. URL/TLS constraints, metadata size limits, wrong origins and anonymous-access failures have focused tests. It is not an external-client sign-in or capacity certificate.

The repeatable local browser harness and MCP CI now start two application replicas with the same database, canonical App URL and ordinary application secrets. The automatic-onboarding flow checks that one consented token discovers the same scoped tools on both replicas and is blocked on both after automatic connections are disabled. The second direct listener receives the canonical public Host, simulating an ingress that preserves it. Actual deployment topology, load balancers, production migration scale and independent real-client certification still need their own evidence.

The post-commit fault-injection child now waits at a bounded barrier so it cannot exit normally before the parent injects SIGKILL. The isolated three-case process/connection recovery suite passed with this harness fix; a previous full-suite run reported 1,013 passes and one ESRCH harness race and is not counted as a green run. Final rerun results are recorded in the PR after completion.

## Live client checkpoint

A client's status in the [compatibility table](../../guides/mcp/self-hosted-setup.md#client-compatibility) is tied to a run recorded here, and a unit test (`tests/mcp/docs-reference.test.ts`) enforces it:

- **Tested (vX.Y.Z, YYYY-MM-DD)** needs an entry below naming that version and date.
- **Verified (Client X.Y.Z, YYYY-MM-DD)** needs an entry naming the client version, the date, the negotiated MCP revision, the full 40-character server commit SHA and a result for every check: registration, consent, tools/list, scoped read, refresh, role change and revocation.

Record a new entry after each live run against a released build, using the steps of the OpsKnight MCP end-to-end rounds. Never record a check that was not observed.

### Claude Code against v2.1.2, 2026-11-03

- Server: a live deployment of build `386adeb` (v2.1.2 with the MCP pull requests up to #955); the full commit SHA was not recorded.
- Client: Claude Code CLI; its version and the negotiated revision were not recorded.
- Registration: pass (automatic registration, and the "not allowed to connect" page with automatic connections off).
- Consent: pass (PKCE consent page; the 48-scope by four-role consent matrix had no mismatches).
- tools/list: pass (31 tools for the administrator's consent at that run; the server now offers up to 54 tools and 11 prompts, see the [tool reference](../../reference/mcp/tools.md)).
- Scoped read: pass (`search_capabilities`, paged `incident_search`, exact page-size and unknown-operation errors).
- Refresh: not recorded.
- Role change: pass (promotion and demotion change the offered scopes; deactivation ends the session).
- Revocation: not recorded for an individual grant in this run.

This is a "Tested" entry, not "Verified": the client version, revision, full SHA, refresh and revocation are missing. It predates this release.

## Credential lifecycle through the official SDK client (round 6)

`tests/e2e/mcp-lifecycle.spec.ts` drives the published 1.x SDK client **over HTTP against the production-built server** (the same server the browser flows use) and checks what the in-process tests cannot: a direct write and its replay under one idempotency key; turning changes off hiding the write tool and refusing the call on the next request; a role change narrowing what a connected client sees on its very next call with no reconnect; refresh-token rotation retiring the previous access token; replaying a used refresh token revoking the whole grant, including the token just issued; and revocation ending a connected client on its next request. The spec removes everything it creates and restores the policy, so the browser flows that follow see the database they expect, and it runs once rather than once per browser.

Observed on 6 November 2026 against a local development server (not a production build): all six checks passed. It has **not yet been observed in the GitHub workflow against the production build**; that run is the evidence to record. It mints credentials directly in the database, so the OAuth consent and code exchange are covered only by the browser flows, not by this spec. The SDK negotiates revision 2025-11-25; revision 2026-07-28 is exercised by the raw-protocol tests and the listen-stream check, not by an SDK client.

This workflow runs on `main` and on pull requests labelled `ci:full`; add the label to a pull request that changes MCP paths to run it before merge.
