# SCIM enterprise implementation and certification

Implementation branch: `feat/enterprise-scim-2.1`. Baseline: `326f21685`.
Evidence date: 2026-10-22. No production providers, users, teams or credentials were used.

## Architecture and delivered behavior

Directory authority is represented by `ScimConnector`, `ScimIdentity`, `ScimGroup`,
`ScimGroupMembership`, `ScimGroupTeamBinding`, `ScimTeamGrant`, `ScimCredential` and
transactional `ScimEvent` records. Directory groups never implicitly own an
operational team. Existing-team binding requires a fresh administrator and an
impact preview pinned to the membership snapshot. Directory deletion detaches
bindings and preserves operational memberships and routing.

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
