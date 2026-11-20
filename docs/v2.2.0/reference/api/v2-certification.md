---
title: REST API v2 release gate
description: Audit status, evidence and open items for the REST API v2 release gate.
type: reference
product_area: api
audience: [developer, operator, administrator]
verification:
  level: test
  verified_at: 2026-10-14
  evidence:
    - tests/unit/api-v2-legacy-token-dos-protection.test.ts
    - tests/unit/api-v2-openapi-conformance.test.ts
    - tests/unit/api-v2-mutation-contract.test.ts
    - tests/unit/api-v2-authorization-matrix.test.ts
---

# REST API v2 release gate

Status of the audit of PR #863 (commit `c92c651`), written against the working tree. "Evidence" names the check that was actually run; items that need a production-like environment are marked **Not yet run** rather than assumed.

This is historical evidence for PR #863, not certification of the current enterprise expansion. The current [API reference](./v2.md) and runtime capability catalog supersede its operation and scope inventory: `runbooks:write` and `users:write` now gate implemented operations. Full enterprise release gates remain in `plans/rest-api-enterprise/workflow-inventory.json` and require final-candidate evidence.

## Phase 1: abuse protection and authentication

| Item | State | Evidence |
| --- | --- | --- |
| Unidentified clients no longer bypass all limiting | Done | Concurrency lane for unidentified verifications; separate legacy-scrypt budget; unit tests in `api-v2-legacy-token-dos-protection.test.ts` |
| Valid credentials are not refused because of other clients on the same IP | Done | An IP over its failed-auth budget is no longer rejected outright. It keeps verifying through a small per-IP concurrency allowance (`API_V2_OVER_BUDGET_IP_CONCURRENCY`, default 4) and stops writing the shared counter, so a valid integration behind the same NAT still authenticates while the database work the abuser can cause stays bounded. Unit tests: a valid token succeeds from an over-budget IP; the allowance sheds with 429 and `Retry-After`; other IPs are unaffected. Under a sustained flood the allowance can be saturated by the abuser, so a legitimate client on that IP may still see 429s; that residual risk needs the NAT load test below |
| Failed-auth counting uses the shared PostgreSQL counter | Done | Each replica folds the post-increment shared count into local memory when it records a failure. A replica that never saw a failure for an IP can admit that IP's first lookup, so an attacker spread over N replicas gets at most N attempts beyond the limit per window. Unit-tested with a mocked shared count |
| Malformed tokens rejected before any database lookup | Done | Unit test asserts `apiKey.findFirst` is not called |
| Per-process legacy `scrypt` concurrency ceiling | Done | `API_V2_LEGACY_SCRYPT_CONCURRENCY` (default 2) |
| `Retry-After` on pre-auth 429s | Done | `details.retryAfter` is set on every pre-auth rate-limit error |
| Proxy trust: CF-Connecting-IP only when selected | Done | `TRUSTED_PROXY_HEADER`; X-Forwarded-For read from the right by raw position; `TRUSTED_PROXIES` accepts CIDRs and is enforced when the peer address is known. Unit tests include spoofed headers |
| Positive-auth cache stays removed | Unchanged | Revocation test already in the suite |
| Topology tests (Cloudflare, Nginx, Traefik, Compose, Kubernetes) | **Not yet run** | Needs real ingress; route handlers do not expose the socket address, so `TRUST_PROXY_HEADERS=true` remains an operator assertion that only the ingress can reach the app |
| Valid credentials keep working while their address floods invalid tokens | **Measured: failed, fix unmeasured** | Local k6 on the production image, 2 replicas behind nginx: with a 300 rps invalid flood from the same address, 60% of a 24 rps valid probe got an admission 429 (threshold 5%); direct deployment at 200 rps: 57%. No server errors, no 401/403 for valid clients. A priority lane for recently verified credentials was added afterwards (hint only; the database still decides every request) and is unit-tested, **but the flood runs were not repeated** because the image rebuild stalled on a saturated Docker VM |
| PostgreSQL connection pressure under a failed-auth flood | **Not yet run** | Needs load environment |

New environment variables: `TRUSTED_PROXY_HEADER`, `API_V2_UNIDENTIFIED_AUTH_CONCURRENCY` (16), `API_V2_LEGACY_SCRYPT_CONCURRENCY` (2), `API_V2_LEGACY_UNIDENTIFIED_LIMIT` (30 per minute), `API_V2_OVER_BUDGET_IP_CONCURRENCY` (4).

Behaviour change to announce: deployments that relied on `CF-Connecting-IP` being honoured by default must set `TRUSTED_PROXY_HEADER=cf-connecting-ip`. Direct Docker deployments with no trusted proxy still resolve every client to the unidentified bucket and are protected by the concurrency and legacy-budget controls, not by a per-client quota.

## Phase 2: parity with product domain commands

| Item | State | Evidence |
| --- | --- | --- |
| `PATCH /incidents/{id}` assignment uses `assignIncidentDomainCommand` | Done | `rest-patch.test.ts` asserts the command is called with the patch transaction and that no hand-written assignment event is created |
| `POST /incidents/{id}/assign` rejects `assigneeId` + `teamId` together | Done | `IncidentAssignV2Schema` refine |
| `POST /incidents/{id}/assign` no longer unassigns on an empty or invalid-JSON body | Done | Empty body is a validation error; unassign is an explicit `null` |
| Notification retry reports a lost race as 409 | Done | Compare-and-set loser re-reads status and returns `NOTIFICATION_NOT_RETRYABLE` |
| Escalation policy and delete protection compared with the UI actions | Reviewed | Both are admin-only and block deleting a policy used by services |
| Incident-linked runbook execution integration tests | Fixed, **not run** | The two PostgreSQL tests used keys without `incidents:read`, which the route now requires, so they received 403. Their keys now carry `incidents:read`, and a new negative test asserts 403 and no execution row without it. These need PostgreSQL and were not run locally |
| Same-initial-state parity suite (UI path vs REST path, compare rows/outbox) | **Not yet run** | Needs the database integration environment |

## Phase 3: atomicity and audit

| Item | State | Evidence |
| --- | --- | --- |
| Audit record commits with the business change on every v2 mutation route | Done | `runV2AuditedMutation` plus in-transaction hooks (incident lifecycle/create/patch, schedule override, status page create/update/make-default, notification requeue). A scan of `src/app/api/v2` finds no `logV2Audit` call without a transaction. Unit tests prove the audit uses the mutation's transaction client and that an audit failure fails the mutation |
| Rollback and concurrent-retry scenarios against PostgreSQL | Done (local) | `tests/integration/api-v2-runtime.test.ts` on PostgreSQL 16: injected audit-insert failure (DB trigger) rolls the mutation back; 5 concurrent notification retries give one 200, four 409 and one audit row; concurrent creates with one `Idempotency-Key` give one resource and one audit row; key reuse with a different body is 409. Load check on 2 replicas: audit counts equal mutation counts. Process-crash and replica-kill scenarios **not yet run** |
| Every mutating operation has a declared retry contract | Done | `mutation-contract.ts` classifies all 28 POST/PATCH/DELETE operations (required / supported / natural / never). `api-v2-mutation-contract.test.ts` fails if a route has no entry, or if an entry claims idempotency or ETag support the route source does not implement |
| `Idempotency-Key` supported on the remaining creates | Done | teams, services, schedules, status-page announcements and service accounts now replay (same key → original result, `Idempotency-Replayed: true`, one audit record). Token issuance is deliberately `never` because the response holds a one-time secret |
| Optimistic concurrency (ETag / If-Match → 412) | Done | teams, services, schedules, escalation policies, integrations. ETags are now strong validators (`"<updatedAt ms>"`); a weak `W/` tag in `If-Match` gets 412 because it cannot match under strong comparison (RFC 9110). The escalation-policy update always moves `updatedAt`, so a steps-only edit changes the ETag. The version check is in the UPDATE's WHERE clause. The validator covers the resource's own state; related data embedded only for reading (services using a policy) is not covered. Unit tests cover header parsing and the contract; two-writer race, 20 rapid consecutive writes (every validator distinct), stale and weak `If-Match`, and a steps-only policy edit changing the ETag were run against PostgreSQL (`api-v2-runtime.test.ts`); under load, 473 two-writer races produced exactly one winner each |
| One mapping for database failures | Done | `database-errors.ts`: P2002/P2003 → 409, P2025 → 404, P2034 → retryable 409, connectivity/pool timeout → retryable 503 with `Retry-After`; driver detail is never exposed. Unit-tested per code |
| Idempotency retention after expiry (7 days), key reuse with a different body, concurrent requests on different replicas | Documented; **not yet run** | Retention follows the completed-job cleanup window; needs the database integration environment |

## Phase 4: authorization

| Item | State | Evidence |
| --- | --- | --- |
| `GET /audit-logs` returns redacted, bounded `details` | Done | `audit-projection.ts` (shared logger redaction + depth/width/length bounds); invalid `entityType` is a 400 instead of a 500. Unit tests |
| Runbook step configuration never returned | Done | `GET /runbooks/{id}` returns step summaries only (no commands, URLs, env, secret refs). **Behaviour change**: the `config` field is gone. Unit tests |
| Single scope registry for issuance and docs | Done | `api-scope-registry.ts` (typed `Record<ApiScope, …>`); API-key and service-account issuance, the docs table and the OpenAPI description derive from it. `runbooks:write` and `users:write` grant nothing on v2 and are marked reserved / not issuable. The settings UI now derives from it too: both panels list only active scopes issuable by the viewer's role (service-account tokens by the target account's role), and the Explorer's required-scope labels come from the operation registry. Component tests compute counts from the registry |
| Service-account token lifetime is an explicit decision | Done | `expiresInDays` or `neverExpires: true` is required; `API_V2_ALLOW_NON_EXPIRING_TOKENS=false` and `API_V2_TOKEN_MAX_DAYS` let a deployment forbid or cap. Last-use is already returned in token metadata. Unit tests |
| Disabled service accounts cannot be issued tokens | Done | `SERVICE_ACCOUNT_DISABLED` (409), checked before generating a secret and again inside the issuing transaction. A disable that lands between the check and the insert can still leave a token that authentication then rejects; no privilege results. Active-token counts now exclude expired tokens. Unit tests |
| Service-account identity and the browser boundary | Done | Identity is the reserved email domain only (profile text such as job title no longer counts); credentials and OIDC sign-in refuse such accounts. Tokens may not carry scopes the account's role cannot issue; team ids are validated |
| Detail endpoints no longer reveal whether an inaccessible object exists | Done for schedules (detail, on-call, overrides) and runbook execution against an incident; the latter now uses `incidentReadWhere`. **Behaviour change**: executing a runbook against an incident also needs `incidents:read` |
| Role × scope × operation matrix | Done | `api-v2-authorization-matrix.test.ts` asserts, for all 63 operations and 4 roles: no scope → denied, disabled principal → denied, USER never gets a global mutation, only ADMIN administers service accounts; the full decision table is a committed snapshot. This tests the policy function, **not** per-route resource filtering with real data (cross-team object tests exist for a subset in `api-v2-cross-team.test.ts`) |
| Notification read policy decided | Done | ADMIN/RESPONDER see delivery detail; AUDITOR gets metadata only (no message body, recipient or email); USER has no access. The unreachable own-notifications branch is removed. Policy unit tests in `api-v2-hardening.test.ts` |

## Phase 5: contract

| Item | State | Evidence |
| --- | --- | --- |
| `GET /api/v2/openapi.json` returns the bare OpenAPI document | Done | Route test asserts `openapi`/`info`/`paths` at the root and no envelope keys; the architecture guard allowlists the route |
| Canonical operation registry | Done | `openapi-registry.ts` (operationId, scope, result shape for all 63 operations). The conformance test checks it against the route handlers: same operations, and the declared scope equals the scope the handler's authorization action maps to |
| OpenAPI 3.1 correctness | Done, with a limit | `nullable` (3.0 syntax) converted to 3.1 types; every `$ref` resolves; every component schema compiles under Ajv 2020-12; unique readable operationIds; typed success bodies, 429 with `Retry-After`, 412/409 where applicable; a real `problem+json` and a real success envelope validate against the documented schemas. **Not run through a full OpenAPI validator or a generated TypeScript/Python client** (adding `@readme/openapi-parser` failed on a pre-existing next-auth/nodemailer peer conflict, so no dependency was added) |
| Documentation cannot overstate features | Done | Endpoint list, scope table and retry table in `v2.md` are generated from the registries and checked by `api-v2-docs-sync.test.ts`; section 8 lists what is not available over REST |
| Breaking-change check | Done | `findBreakingChanges` + committed baseline `tests/fixtures/api-v2-openapi.baseline.json`; a removal, narrowed request enum, new required input or removed response field fails the test until the baseline is deliberately updated. The baseline is this PR's spec, not a previous release |
| Request examples | Done | Verified sample bodies are attached to operations; they are already validated against the runtime Zod schemas. Executable curl examples against seeded ids are **not** done |

## Phase 6: developer workspace

| Item | State | Evidence |
| --- | --- | --- |
| API Activity filtered and paginated in the database | Done | `activity-query.ts` builds the `where`; keyset pagination; filters for action, actor, API key, resource type and date range live in the URL. Query unit tests and panel component tests |
| Activity is labelled as audit history, not traffic | Done | Panel text; reads and rejected requests are not recorded |
| Never-expiring service-account token is a deliberate choice | Done | Warning shown when selected |
| Credential inventory pagination (keys, service accounts) | Done | Filters and keyset cursors in the URL, evaluated in the database (`api-key-inventory.ts`, `service-account-inventory.ts`); header counts are aggregates. Real-PostgreSQL test pages through 60 keys exactly once and checks status filters |
| Tab data loaded only for the active tab | Done | Tabs are links; only the active tab's list, spec or activity is queried |
| One-time secrets need explicit acknowledgement | Done | `OneTimeSecretBanner`: checkbox then "Dismiss and clear"; code samples use the same local state |
| Browser tests at mobile/laptop/large widths, keyboard and dialog flows | **Not yet run** | No browser run in this audit |

## Status-page publication

| Item | State | Evidence |
| --- | --- | --- |
| Client can tell "saved and live" from "saved, republish pending or failed" | Done | `PATCH /status-pages/{id}` returns `publication` (`LIVE`, `PUBLISHING`, `FAILED`, `DISABLED`, revision, last error). The change and its audit record commit first; republishing happens after the commit, and a failure is recorded for background reconciliation |
| `PATCH` publication field against PostgreSQL | Done (local) | Runtime test asserts `publication` is returned and the audit row committed |
| Recovery after a crash right after the default-page commit, a failed publish of the new default, a failed republish of the demoted page | **Not yet run** | Needs PostgreSQL and the projector; the existing integration tests were not run locally |

## Round four (review of `d5482126`)

| Item | State | Evidence |
| --- | --- | --- |
| ETags backed by a dedicated monotonic revision | Done in code; **real-PostgreSQL rerun pending** | `revision` column on Team, Service, EscalationPolicy, Integration, OnCallSchedule; a `BEFORE UPDATE` trigger increments it on every write from any code path (metadata-only `ADD COLUMN`, no rewrite). `ETag: "<revision>"`; `If-Match` compares the revision in the UPDATE's WHERE clause. Unit tests and tsc pass; the migration applied cleanly to PostgreSQL 16 with all five triggers. The earlier timestamp-based version passed the two-writer, 20-rapid-write, stale and weak-validator tests on PostgreSQL; the same tests must be rerun against the revision implementation |
| Secret not retained in React action state | Done | `useSecretSafeAction` hands the secret to the dismissable banner and returns the action state with `token` removed. Hook and panel tests |
| Nested service-account token lists bounded | Done in code; **real-PostgreSQL rerun pending** | Newest 25 tokens per account (detail: 100), per-token `ACTIVE`/`EXPIRED` status, counts (`activeTokensCount`, `tokensTotal`, `tokensTruncated`) from `groupBy`/`count` aggregates; OpenAPI schema extended. Unit tests; the 120-token PostgreSQL test was written but not run |
| Independent OpenAPI validation | Done | Redocly CLI lint: valid, 2 warnings (missing `license`, now added; one ambiguous-path warning between `/runbooks/{id}/execute` and `/runbooks/executions/{id}`). `openapi-typescript` generated a 4,308-line client and a typed list/create/patch/execute workflow compiled with `tsc --strict`. `openapi-python-client` generated 256 modules, all import cleanly. A live workflow with the generated clients was **not** run (the local proxy was returning 504s under load; note the generated Python client raises on a non-JSON gateway error body) |
| k6 availability versus throughput | Done | `read_succeeded` (rate of 200s, threshold above 0.99) is separate from safe 429s; reads run at 40 rps so 24 keys stay inside the per-credential limit |
| Cold-start scenario | Written, **not run** | `cold_start`: valid credentials first appearing during a flood (no verified hint on any replica), measured in the first 15 s and in steady state; steady-state admission 429 threshold below 5% |
| Authentication admission is per replica | Documented | The priority, unidentified and legacy lanes are per-process by design (no Redis). Aggregate concurrency grows with replicas, so size `API_V2_*_CONCURRENCY` and the connection pool together; the 1, 2 and 4 replica connection measurements are **not yet run** |
| Branch behind `main` | Open | Needs a merge or rebase of `main`; not done here |

## Findings from running against a real database

Both were invisible to unit tests with mocked Prisma and are fixed:

1. Audit details are stored under `details.metadata`; the API Activity query originally matched top-level paths and would have shown nothing.
2. The audit writer redacts any key containing `key`, so `apiKeyId` was stored as `[REDACTED]` and no change was attributable to a credential. The field is now `apiClientId` (token labels use `label`).

## Local runtime evidence (2026-10-15)

PostgreSQL 16 in Docker, Node 20. Full `vitest.int.config.ts` run on a quiet machine: 449 of 454 passed. The 5 failures: 4 in `runbook-agent-runtime.test.ts` (the spawned agent never submits; no child output; not diagnosed, and not a REST v2 test; the reviewer reported these passing on Linux CI) and 1 fixture error in a new test, fixed; the 19 `api-v2-runtime` tests then passed. The runbook execution tests, including the new missing-`incidents:read` negative test, pass (61/61). The production Docker image builds with the bundled fonts.

## Phase 7: observability and availability

| Item | State | Evidence |
| --- | --- | --- |
| Per-operation request metrics, latency and in-flight | Done | Every v2 route is wrapped with the shared request wrapper, labelled `api_v2.<operationId>` (bounded set, no ids or addresses). Unit test resolves all 63 operations from concrete URLs |
| Auth failure, rate-limit decision, error-category, idempotency and credential-lookup metrics | Done | `opsknight_api_v2_*` series with fixed label vocabularies; the metric registry's series-budget and forbidden-label checks pass |
| Load matrix (valid reads, invalid flood, unknown-IP, idempotent concurrent writes, ETag races) | Written, **not run** | `tests/certification/k6/api-v2-load-matrix.js` and `tests/certification/README-api-v2.md`. No 1/2/4-replica numbers, failover or connection-growth evidence exists yet |

## Phase 8: coverage

No new endpoints were added. Section 8 of `v2.md` documents what is out of scope, and `runbooks:write` / `users:write` are reserved rather than offered. Expansion should follow the order in the audit (incident custom fields and tags, schedule layers, runbook authoring, status-page components) and must reuse the domain commands.

## Phase 9: release gate

The before/after regression report against `main` (API v1, Events API, SSO, notifications, war rooms, agents, startup) is **not yet run**.

## Verification run

Node 20, 2026-10-14, after the previous round of changes (a later round, covering the review of `07ef9a2bf`, is re-checked below): `npx tsc --noEmit` clean (tsbuildinfo deleted first); `vitest run -c vitest.unit.config.ts --no-file-parallelism`: 769 files, 5956 tests passed, 4 skipped; `vitest run tests/architecture`: 91 files passed; `eslint` on changed files: 0 errors. Not run: database integration tests (`tests/integration/*` need PostgreSQL), browser tests, the k6 load matrix, a full OpenAPI validator and generated-client smoke tests. The default `vitest run` also loads `tests/docs/tooling/*.test.mjs` (written for `node --test`) and the integration files; those fail to load or need PostgreSQL and are not counted. `node --test tests/docs/tooling/`: 48 of 49 pass after the frontmatter fix; the remaining failure (`public-reference-freshness`, stale configuration reference around `AUTH_LOCAL_LOGIN_ENABLED` / `OIDC_REQUIRE_EMAIL_VERIFIED_STRICT`) concerns unrelated settings. The new environment variables from this audit are not yet in the configuration reference.

Round three (review of `469cb67a`, local certification): `tsc` and the unit suite are re-run before the push. Round two (review of `07ef9a2bf`): `npx tsc --noEmit` clean; targeted suites for the changed areas pass (auth abuse tests, concurrency, service-account lifecycle, settings panels, API v2 contracts and the architecture guard). The full unit suite is re-run before each push.
