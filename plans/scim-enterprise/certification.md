# SCIM enterprise implementation and certification

Implementation branch: `feat/enterprise-scim-2.1`. Baseline: `326f21685`.
Evidence date: 2026-10-22. No production providers, users, teams or credentials were used.

## Architecture and delivered behavior

Directory authority is represented by `ScimConnector`, `ScimIdentity`, `ScimGroup`,
`ScimGroupMembership`, `ScimGroupTeamBinding`, `ScimTeamGrant`, `ScimCredential` and
transactional `ScimEvent` records. Directory groups never implicitly own an
operational team. Existing-team binding requires a fresh administrator and an
impact preview pinned to the membership snapshot. Directory deletion and administrator detachment revoke memberships still owned
solely by the retiring binding. Other approved group grants transfer provenance;
manual memberships, actual local role promotions and owners remain. Notification
preferences do not convert directory grants to manual ownership. Revocation bumps
session versions and clears a revoked member's team-lead assignment. Teams,
services, schedules and escalation rules remain intact, with an audit coverage
review flag when memberships were revoked.

System roles retain OIDC/manual authority. Profile updates never claim SCIM role
ownership. Connector profile field policy governs name, email, title, department
and photos; the OIDC security transaction also respects directory-owned profile
fields. Account changes use the shared last-administrator mutation boundary.
Deactivation revokes ordinary access and records affected on-call shifts,
escalation rules and teams without active responders for coverage review.
Independent emergency principals and their timing policies remain separate.

Credentials are connector-scoped, hashed, one-time secrets, with scopes, purpose,
owner, expiry, last use, generation and revocation. Registry rotation bounds the
previous credential's overlap. PostgreSQL remains authoritative across replicas;
mutations recheck credential validity under shared row locks. Registry cutover
fences legacy database/environment authentication, including old replicas that
observe the disabled legacy configuration marker. Drain old-version SCIM traffic
before cutover; old route implementations must not continue serving writes.

Shared validation covers bounded bodies, integer pagination, JSON equality
filters, structural case normalization, ordered atomic PATCH, supported profile
attributes and explicit errors. Group mutations preserve membership row IDs and
apply differential changes. Unknown/cross-connector member references fail.
`excludedAttributes=members` avoids loading member collections. ETags, Bulk,
sorting and unsupported schemas are not advertised.

The administration workspace includes setup, connector isolation, profile field
ownership, scoped credential rotation, server-paginated identities/groups/activity,
rehire approval, existing-account binding, impact previews, safe detach,
diagnostics and a bounded comparison of local directory intent with team state.
Reapproving a preview reconciles missing memberships. It cannot infer changes an
identity provider has not delivered. One lifecycle connector owns each user.

## Reproduction

Use a disposable PostgreSQL database named **enterprise_scim_test**. The suites
refuse other database names. Supply its URL through `DATABASE_URL`; never copy
production secrets. Apply all migrations and generate Prisma before running.

```sh
npx prisma generate
npx prisma migrate deploy
npm run certify:scim:unit
VITEST_USE_REAL_DB=1 SCIM_LOAD_TEST=1 npm run certify:scim:db
npm run certify:scim:baseline
```

`certify:scim:baseline` loads the pre-change resource-route code from the baseline
commit into a temporary test fixture, sharing the current credential harness. It
requires three specific regression failures against the historical routes and
then three passes against the current routes. Temporary source fixtures are
removed in `finally`.

For the upgrade rehearsal, use the dedicated local Docker container
`opsknight-scim-cert-db`, PostgreSQL user from `DATABASE_URL`, and run
`npm run certify:scim:upgrade`. Set `SCIM_CERT_DOCKER` when Docker lives elsewhere.
The script creates a baseline schema and seeded legacy fixtures inside a rolled
back PostgreSQL transaction, applies the staged SCIM migrations, and asserts
identity/group-ID preservation, owner/service protection and role-authority repair.
This verifies migration logic independently of the already-migrated database.

For browser verification, set disposable `SCIM_E2E_ADMIN_EMAIL` and
`SCIM_E2E_ADMIN_PASSWORD` (at least 20 characters), then seed:

```sh
npx ts-node --project tsconfig.script.json scripts/scim/seed-certification.ts
```

Start a local app with `OPSKNIGHT_PROCESS_ROLE=web`, `NEXTAUTH_URL`, a disposable
`NEXTAUTH_SECRET`, and the fixture `DATABASE_URL`. Set `SCIM_E2E_BASE_URL` and run
`npm run certify:scim:browser`. Chromium, Firefox and WebKit are configured.
Screenshots are captured only after the one-time secret has been hidden. Raw
network traces are disabled to keep bearer secrets out of evidence artifacts.

For HTTP replica verification, start a second local app with a different port and
`BUILD_DIR`, the same database, and the same disposable `NEXTAUTH_SECRET`. Bound
each Prisma pool in the URL, for example `?connection_limit=5&pool_timeout=10`.
Set `SCIM_CERT_REPLICA_URLS=http://localhost:3028,http://localhost:3029` and run
`npm run certify:scim:replicas`. It verifies concurrent create deduplication,
cross-replica disable visibility, shared admission limits and immediate revocation.
The script permits only localhost replicas and the isolated database.

With those replicas idle, run `npm run certify:scim:outage` against the dedicated
container. The script checks its certification label before stopping PostgreSQL,
checks retryable 503 responses from both replicas and verifies unchanged account
state after restart. A `finally` block restarts the container on failure.

Use a separate disposable database for `tests/integration/auth.test.ts`,
`api-v2-team-administration.test.ts` and `api-v2-team-activity.test.ts` because those
existing suites intentionally truncate all tables between cases.

## Evidence recorded in this workspace

- Historical regression harness: three expected pre-change failures, followed by
  three current-route passes, observed against PostgreSQL.
- Unit/API/provider-shaped requests: pass; includes Entra and Okta fixtures,
  unsupported attributes/paths, case normalization, bounds, role policy and
  immutable identity handling.
- PostgreSQL lifecycle/capacity: pass; includes connector isolation, OIDC role
  authority, last administrator, atomic invalid PATCH, differential membership,
  manual promotions, multiple bound-group membership union, tombstones, rehire
  rejection, credential expiry/rotation/scopes/revocation, audit-write rollback,
  privacy-erasure compatibility, configurable profile ownership, independent
  emergency-account/session preservation and on-call/escalation coverage warnings.
- Capacity fixture: 100,000 users, 10,000 groups, and a 10,000-member group. Indexed
  lookup was confirmed with EXPLAIN. A 100-query local lifecycle-handler sample
  measured p95 9.47 ms and p99 26.19 ms; engineering budgets were p95 <2,000 ms,
  p99 <5,000 ms. These are local handler/database figures, not production HTTP SLAs.
- Two HTTP app instances: eight concurrent POSTs produced one identity; shared
  rate admission, cross-replica deactivation and credential revocation passed.
  The same harness also passed against the compiled standalone production server
  together with a development replica.
- Database outage/restart: both replicas returned sanitized 503 responses with
  Retry-After during a real container stop. The attempted mutation left persisted
  account state unchanged; reads recovered after PostgreSQL restart.
- Adjacent auth/team database suites: 35 tests passed against a separate fixture.
- Next route compatibility: 43 metrics/RSS/API-v2 tests passed after moving shared
  helpers outside route modules and exposing the required asynchronous route
  context type. A clean nonincremental TypeScript check and the full optimized
  production build passed, including all generated route types and 206 static pages.
- Browser journey: Chromium, Firefox and WebKit passed. The journey creates a
  connector and credential, provisions users/groups over HTTP, previews/approves
  an operational-team binding, checks activity and drift, hides the secret,
  revokes credentials and verifies a subsequent 401. Layouts at 1440/768/390 pixels
  and the scoped axe WCAG A/AA accessibility scan passed.
- Upgrade rehearsal: stable IDs, manual-team isolation, owner privileges and
  service ownership were preserved; no implicit team bindings were created.
- Backup/restore rehearsal: a PostgreSQL custom-format dump was restored into the
  dedicated SCIM container. The restored database retained 100,000 capacity
  identities, 10,000 groups and the manual-membership protection trigger.

Verbose logs and screenshots remain under temporary/ignored test output paths.
The GitHub Actions workflow preserves CI artifacts for seven days. It contains
only disposable local fixture credentials, not provider/production secrets.

## Release gates and limits

Live Entra/Okta tenant runs remain **unverified**: no provider environments with
SCIM group entitlement were available. Local provider-shaped requests and browser
screenshots are not a substitute for provider certification or an OIN submission.
Do not label this implementation “10/10 certified” on that basis.

Production-scale connection-pool budgets, infrastructure failover, rolling
old/new-version cutover with traffic draining, provider-specific retry behavior,
and environment-specific p95/p99 HTTP budgets require deployment certification.
The local capacity fixture proves bounded behavior, not a production capacity SLA.
Directory event ordering is request order within a transaction; there is no
provider-specific remote event timestamp ordering contract or advertised ETag
optimistic concurrency. Identity restoration after DELETE requires explicit
approval and a subsequent provider reactivation.

Back up the database before rollout. Review legacy groups without external IDs
and approve team bindings individually. Do not downgrade to the old operational
team-backed SCIM routes after registry adoption. Rehearse a reviewed backup-based
rollback; do not drop identity/audit records as an automatic rollback action.
Advanced provider-side drift fetching and arbitrary multi-source lifecycle
ownership are not advertised. Local drift comparison and explicit single-source
lifecycle approval are the supported boundary.

## Initial review follow-up (2026-10-22)

- Integrated `origin/main` at `58e9271cc` (follow-redirects 1.16.1) by rebasing the
  feature branch; no merge into main and no pull request.
- Adopted `REVOKE_DIRECTORY_GRANTS` for group DELETE and administrative detach.
  PostgreSQL tests cover sole grants, notification edits, another group still
  granting access, manual members/promotions, session-version revocation,
  team-lead cleanup and transaction rollback when audit insertion fails.
- The browser journey uses the provisioned user's own scoped API key to assert
  team-member API access before binding removal and denial after removal. It
  exercises administrator detachment, reapproval and HTTP group DELETE.
- `npm run certify:scim:snapshot` creates a synthetic production-like baseline
  with 100,000 users, 10,000 groups and 100,000 directory memberships, takes a
  PostgreSQL custom-format backup, restores into a separate database and applies
  all staged migrations. It verified 10,000 OIDC role-source repairs, stable IDs,
  unchanged operational memberships/owner/service, no implicit bindings and
  preservation of the legacy credential authority until explicit registry
  adoption. No real production snapshot was available or used. Registry cutover
  remains covered by the separate PostgreSQL lifecycle test.
- The SCIM workflow now also runs on pushes to this feature branch, including the
  synthetic snapshot rehearsal. A draft PR is unnecessary to trigger it.

Follow-up local results: 87 unit/API tests, 33 PostgreSQL lifecycle/capacity tests,
and the full Chromium/Firefox/WebKit journeys passed. TypeScript and lint passed.
The synthetic backup/restore upgrade rehearsal passed.

The reconciliation service batches membership insertions, removals, session-version
updates and grant transfers. A real SCIM DELETE revoked 10,000 directory-created
memberships in 2.64 seconds within the default 10-second transaction budget,
preserving the manual owner and service assignment. This is a local engineering
measurement, not a production SLA. The optimized production build also passed
for the access-policy revision. CI installation follows the existing repository
`npm ci --legacy-peer-deps` policy for its lockfile's optional peer dependencies.

## Final hardening follow-up

Profile PUT without active now preserves disabled state. DELETE clears directory
membership intent and derived grants in its security transaction; rehire requires
fresh provider membership synchronization. Explicit per-member legacy adoption
uses a pinned preview and fresh administrator approval. Credential rotation
preserves disabled connectors. Collection PATCH/PUT/DELETE return SCIM 405 with
Allow. Group collection paging shares a 10,000-member budget; full representations
are never truncated and serialized responses are bounded to 8 MiB.

JWT session evaluation now bypasses the process-local security projection cache.
A two-app HTTP harness warmed sessions before deactivation, role downgrade and
group-grant revocation; it checked rejected sessions on both apps and rejected
team API access. The measured sequential observations were 2203/117/1563 ms,
within the 5000 ms harness budget. That measures local request completion, not an
upper bound on production network latency. Authorization reads committed state;
already executing requests remain outside the guarantee.

A separate HTTP harness populated 100 groups with 10,000 members each. Thirty
HTTP full-member collection samples returned one complete group per page, with
p50 382 ms, p95 573 ms and p99 1346 ms; max response was 1,727,158 bytes. Metadata
paging returned 100 groups without members, and full-group GET/rename passed.
Client RSS delta was about 76 MiB with six database connections and zero HTTP
errors. This is client memory, not server RSS. Server CPU/RSS, aggregate database
time and production connection-pool behavior remain deployment certification
items; do not relabel these local measurements as production capacity evidence.

Browser journeys exercise confirmation cancellation and approval for credential
revocation and binding detachment. The UI guards concurrent mutations and
connection switching, explains trusted Entra claims, exposes selected legacy
adoption, and distinguishes independent manual memberships from unexpected
directory grants. The verification guide requires actual create/update/disable
activity rather than treating Test Connection as lifecycle certification.

Live Entra/Okta group-entitled environments remain unavailable. Rolling deployment,
real provider retries/SSO, real deployment failover/rollback and server resource
budgets are still external release gates. This branch must not be called fully
10/10 externally certified until those gates have independent evidence.

Final local regression pass: 161 unit/API/security tests, 39 PostgreSQL
lifecycle/capacity scenarios, 50 adjacent API/auth tests and three browser
journeys passed. Baseline, staged upgrade, restored-snapshot upgrade,
two-replica credentials, warmed sessions and outage/restart harnesses passed.

Invited users also retain INVITED status on profile-only PUT/PATCH; only ACTIVE
users serialize active=true. Disable/reactivate events represent actual status
transitions. An additional 64 auth/session regressions are included in the
certification unit command. A capacity run under simultaneous compilation hit
the unchanged transaction budget; capacity certification is rerun without
competing compiler load, and production load budgets remain deployment gates.

The final idle-compiler capacity rerun passed all 39 PostgreSQL scenarios;
10,000-member DELETE took 2.29 seconds. The final optimized production build
passed. Expanded SCIM CI also passed on `b867d5af1` before the invited-account
refinement; the final commit is independently rerun by branch CI.

### PR 906 integration follow-up

General database CI does not opt into the isolated SCIM suites. Direct invocation requires
`SCIM_CERTIFICATION=1` and `VITEST_USE_REAL_DB=1`; the `certify:scim:db` command sets the
former explicitly. The dedicated database-name guard remains mandatory even when opted in.
SCIM User relations retain inactive directory state on deactivation and cascade on hard
delete. Session-version increments for grant reconciliation pass through the approved
user-security module in the same transaction, with existing post-commit invalidation.

Admission history saturation evicts bounded history instead of rejecting unrelated new
credentials. Repeated invalid-token negative caching and per-token admission limits remain;
this process-local protection is not a global network flood limiter. Keep perimeter request
limits for distributed unique-token floods. Successful credentials are never cached.

CodeQL alert 5531 (`js/insufficient-password-hash`) points to the API-key fixture in
`certify-session-replicas.mjs`, not a user password or imported SCIM secret. The fixture
is generated locally from `randomBytes(32)` (256 random bits) with an `ok_test_` prefix,
then stored using the same keyed, domain-separated SHA-256 HMAC as production API keys.
The fixture accepts no caller-supplied token. Password KDF guidance does not apply to
this random verifier; this reasoning is specific to this finding and does not certify
entropy of historical environment tokens. Registry SCIM credentials are independently
generated from 32 random bytes; historical credentials must be rotated during cutover.

Runbook history browser assertions follow the current custom select, search and archived
evidence text. The team parity journey reloads after out-of-band service fixture writes
so a previously prefetched service list cannot hide the new services. Mobile/PWA CI uses
the version-matched Playwright image to avoid the observed Ubuntu package-download hang.

### Deep-audit regression pass

The additional email expression-index migration preserves stored email case and historical
accounts. The upgrade and restored-snapshot harnesses apply it after the existing five
migrations. Mixed-case linked-account filtering (including count=0), duplicate creation and
rename rejection, User member types, optional displayName removal and atomic legacy-cutover
acknowledgement have PostgreSQL regressions. UI regressions cover selection invalidation,
legacy warnings across connections and disabled credential labels.

The local 25-binding diagnostic fixture contains 250,000 directory memberships, 10,000
operational members and directory grants. The action returned 25 summaries (4,983 bytes)
in 2,175–4,963 ms across three observations; process RSS delta ranged from 0 to
540,672 bytes. The instrumented run recorded one SQL query at 4,933 ms versus
4,963 ms for the whole action. These are action-process
RSS and action roundtrip measurements (with Prisma query-duration events also recorded), not server-memory measurements or a production
latency guarantee. The test enforces a 16-KiB response bound, a 96-MiB process RSS delta
limit and a 10-second local latency budget. Missing, unexpected and independent manual
counts are separately verified against multiple connector sources.

Live Entra/Okta and production rolling upgrade, failover, rollback and PgBouncer resource
budgets remain external release gates. The independent automation browser gate remains
with its existing work; this regression pass does not alter it.

The completed local pass also passed 167 unit/API/auth/UI tests, all 43 PostgreSQL
regressions, the optimized production build and Chromium/Firefox/WebKit journeys
against that build. Two compiled replicas passed duplicate provisioning, shared
admission and credential revocation. Warmed-session deactivation, role downgrade
and grant-removal observations were 69/26/235 ms locally; these are measurements,
not a network-wide production maximum.

The million-membership HTTP re-run (100 groups × 10,000) observed p50/p95/p99 of
438/1,314/2,003 ms with zero HTTP errors and a maximum 1,727,158-byte response.
Client RSS delta was 52,084,736 bytes with 10 database connections. The two-app
PostgreSQL stop/restart check returned retryable 503s without fallback or partial
writes and recovered successfully. The baseline harness again observed its three
expected old-route failures and three passing current-route regressions.

A subsequent Firefox CI run reported a native checkbox interaction failure.
Inspection found that the initial connector fetch could still update an editable
form's defaults/layout; the failed run did not include a trace proving the exact cause. The connection fieldset
is now disabled until that fetch completes (and during writes). A deferred-fetch UI
regression verifies that edits cannot begin early and that the new-connection checkbox
retains its checked state after loading. A separate regression verifies that cancelling
a directory fetch does not disable the connection form. All 169 unit/API/auth/UI
tests pass. Browser assertions remain native clicks and
state checks; no forced clicks or broad retries are added.

The final source passed Chromium, Firefox and WebKit against a warmed isolated
development server (three journeys, 1.7 minutes). A preceding cold-server Chromium
run timed out during login before reaching SCIM; its Firefox and WebKit journeys
passed. The earlier optimized production build and three-browser production
journeys cover the preceding deep-audit implementation; final-head CI recompiles
and exercises the readiness guard against its isolated development server; the
general workflow separately builds the production application.


## Latest focused review: avatar, response atomicity and shared email reservations

The ordinary-invitation race was reproduced against the preceding code: an
uncommitted upper-case User insert and lower-case SCIM create both succeeded
(SCIM HTTP 201). A seventh migration now reserves PostgreSQL lower(email) through
an AFTER row trigger shared by all User writers. Reservation counters preserve
historical duplicates, case-only edits and atomic address reuse after the last
holder renames or is deleted. The staged legacy upgrade verifies historical
case variants before installation, rejection of a new variant, retention after
one deletion and reuse after the final deletion. Installation holds a User-table
write lock; real rollout timing remains unverified.

PATCH now preserves an existing custom avatar when photos are untouched and
refreshes generated defaults after a name change. Group POST/PUT/PATCH responses
are serialized inside their serializable transaction, including the byte check;
rejected representations cannot follow a committed directory or grant mutation.
The 10,000-member fixture uses 256 multibyte characters per display name and
verifies POST/PATCH 413 rollback, no committed audit event, and successful bounded
PATCH with excludedAttributes=members.

Local verification so far: all 169 unit/API/auth/UI tests and all 47 PostgreSQL
lifecycle/capacity tests pass. This includes real OIDC JIT/SCIM races and ordinary
invitation collisions, avatar preservation and explicit photo updates, reservation
reuse, and the large multibyte response fixture. The earlier form-readiness fix
already passed both SCIM push/PR CI runs on b407c8fc4; repeated browser certification
and exact-head checks for this focused pass are recorded in the PR evidence.

The focused pass also completed an optimized production build and nine full
browser journeys against that compiled application: Chromium, Firefox and WebKit
three times each (9 passed, 1.2 minutes), with native checkbox interactions,
no forced clicks, no retries and unchanged timeouts. TypeScript and lint passed.
The final 256-character multibyte group fixture confirms that oversized rejection
also preserves a membership removed by the pending PATCH, not only its group name.
