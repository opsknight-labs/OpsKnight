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

## Phase 1: abuse protection and authentication

| Item | State | Evidence |
| --- | --- | --- |
| Unidentified clients no longer bypass all limiting | Done | Concurrency lane for unidentified verifications; separate legacy-scrypt budget; unit tests in `api-v2-legacy-token-dos-protection.test.ts` |
| Failed-auth block uses the shared PostgreSQL counter | Done | Each replica folds the post-increment shared count into local memory when it records a failure. A replica that never saw a failure for an IP can admit that IP's first lookup, so an attacker spread over N replicas gets at most N attempts beyond the limit per window. Unit-tested with a mocked shared count |
| Malformed tokens rejected before any database lookup | Done | Unit test asserts `apiKey.findFirst` is not called |
| Per-process legacy `scrypt` concurrency ceiling | Done | `API_V2_LEGACY_SCRYPT_CONCURRENCY` (default 2) |
| `Retry-After` on pre-auth 429s | Done | `details.retryAfter` is set on every pre-auth rate-limit error |
| Proxy trust: CF-Connecting-IP only when selected | Done | `TRUSTED_PROXY_HEADER`; X-Forwarded-For read from the right by raw position; `TRUSTED_PROXIES` accepts CIDRs and is enforced when the peer address is known. Unit tests include spoofed headers |
| Positive-auth cache stays removed | Unchanged | Revocation test already in the suite |
| Topology tests (Cloudflare, Nginx, Traefik, Compose, Kubernetes) | **Not yet run** | Needs real ingress; route handlers do not expose the socket address, so `TRUST_PROXY_HEADERS=true` remains an operator assertion that only the ingress can reach the app |
| PostgreSQL connection pressure under a failed-auth flood | **Not yet run** | Needs load environment |

New environment variables: `TRUSTED_PROXY_HEADER`, `API_V2_UNIDENTIFIED_AUTH_CONCURRENCY` (16), `API_V2_LEGACY_SCRYPT_CONCURRENCY` (2), `API_V2_LEGACY_UNIDENTIFIED_LIMIT` (30 per minute).

Behaviour change to announce: deployments that relied on `CF-Connecting-IP` being honoured by default must set `TRUSTED_PROXY_HEADER=cf-connecting-ip`. Direct Docker deployments with no trusted proxy still resolve every client to the unidentified bucket and are protected by the concurrency and legacy-budget controls, not by a per-client quota.

## Phase 2: parity with product domain commands

| Item | State | Evidence |
| --- | --- | --- |
| `PATCH /incidents/{id}` assignment uses `assignIncidentDomainCommand` | Done | `rest-patch.test.ts` asserts the command is called with the patch transaction and that no hand-written assignment event is created |
| `POST /incidents/{id}/assign` rejects `assigneeId` + `teamId` together | Done | `IncidentAssignV2Schema` refine |
| `POST /incidents/{id}/assign` no longer unassigns on an empty or invalid-JSON body | Done | Empty body is a validation error; unassign is an explicit `null` |
| Notification retry reports a lost race as 409 | Done | Compare-and-set loser re-reads status and returns `NOTIFICATION_NOT_RETRYABLE` |
| Escalation policy and delete protection compared with the UI actions | Reviewed | Both are admin-only and block deleting a policy used by services |
| Same-initial-state parity suite (UI path vs REST path, compare rows/outbox) | **Not yet run** | Needs the database integration environment |

## Phase 3: atomicity and audit

| Item | State | Evidence |
| --- | --- | --- |
| Audit record commits with the business change on every v2 mutation route | Done | `runV2AuditedMutation` plus in-transaction hooks (incident lifecycle/create/patch, schedule override, status page create/update/make-default, notification requeue). A scan of `src/app/api/v2` finds no `logV2Audit` call without a transaction. Unit tests prove the audit uses the mutation's transaction client and that an audit failure fails the mutation |
| Crash, rollback and cross-replica replay scenarios | **Not yet run** | Needs the database integration environment |
| Every mutating operation has a declared retry contract | Done | `mutation-contract.ts` classifies all 28 POST/PATCH/DELETE operations (required / supported / natural / never). `api-v2-mutation-contract.test.ts` fails if a route has no entry, or if an entry claims idempotency or ETag support the route source does not implement |
| `Idempotency-Key` supported on the remaining creates | Done | teams, services, schedules, status-page announcements and service accounts now replay (same key → original result, `Idempotency-Replayed: true`, one audit record). Token issuance is deliberately `never` because the response holds a one-time secret |
| Optimistic concurrency (ETag / If-Match → 412) | Done | teams, services, schedules, escalation policies, integrations. The version check is in the UPDATE's WHERE clause. Unit tests cover the contract and header parsing only; **a two-writer race against PostgreSQL is not yet run** |
| One mapping for database failures | Done | `database-errors.ts`: P2002/P2003 → 409, P2025 → 404, P2034 → retryable 409, connectivity/pool timeout → retryable 503 with `Retry-After`; driver detail is never exposed. Unit-tested per code |
| Idempotency retention after expiry (7 days), key reuse with a different body, concurrent requests on different replicas | Documented; **not yet run** | Retention follows the completed-job cleanup window; needs the database integration environment |

## Phase 4: authorization

| Item | State | Evidence |
| --- | --- | --- |
| `GET /audit-logs` returns redacted, bounded `details` | Done | `audit-projection.ts` (shared logger redaction + depth/width/length bounds); invalid `entityType` is a 400 instead of a 500. Unit tests |
| Runbook step configuration never returned | Done | `GET /runbooks/{id}` returns step summaries only (no commands, URLs, env, secret refs). **Behaviour change**: the `config` field is gone. Unit tests |
| Single scope registry for issuance and docs | Done | `api-scope-registry.ts` (typed `Record<ApiScope, …>`); API-key and service-account issuance, the docs table and the OpenAPI description derive from it. `runbooks:write` and `users:write` grant nothing on v2 and are marked reserved / not issuable. The settings UI panels still hold their own scope lists (`ServiceAccountsPanel.tsx`, `ApiKeysPanel.tsx`, `api-keys/page.tsx`) and are **not yet** migrated |
| Service-account token lifetime is an explicit decision | Done | `expiresInDays` or `neverExpires: true` is required; `API_V2_ALLOW_NON_EXPIRING_TOKENS=false` and `API_V2_TOKEN_MAX_DAYS` let a deployment forbid or cap. Last-use is already returned in token metadata. Unit tests |
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
| Tab data loaded only for the active tab | Not done | Tabs switch client-side; lazy loading needs per-tab navigation |
| Browser tests at mobile/laptop/large widths, keyboard and dialog flows | **Not yet run** | No browser run in this audit |

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

Node 20, `npx tsc --noEmit` clean after deleting `tsconfig.tsbuildinfo`. `vitest run -c vitest.unit.config.ts --no-file-parallelism` (766 files) passed except one expectation in `api-v2-cross-team.test.ts` (on-call route now answers 404 instead of 403 for an inaccessible schedule), which is still to be reconciled with the test. Database integration tests were not run locally. The default `vitest run` also picks up `tests/docs/tooling/*.test.mjs` (written for `node --test`) and the database integration files, which fail to load or need PostgreSQL; those are environmental and were not counted. `node --test tests/docs/tooling/` was run: the only failure attributable to this change (docs frontmatter) was fixed; the remaining failure (`public-reference-freshness`, stale configuration reference around `AUTH_LOCAL_LOGIN_ENABLED` / `OIDC_REQUIRE_EMAIL_VERIFIED_STRICT`) concerns unrelated settings. The new environment variables from this audit are not yet in the configuration reference.
