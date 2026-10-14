---
title: Rehearse SSO upgrades and local failures
description: Reproduce isolated schema, authentication, deployment-cutover, failure and rollback checks before customer acceptance.
type: how-to
product_area: identity
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-10-13
  evidence:
    - plans/certification/enterprise-sso-2.1-kind-cutover.json
    - plans/certification/enterprise-sso-2.1-authentication-load.json
    - scripts/certify-sso-upgrade.cjs
    - scripts/certify-authentication-http.cjs
    - tests/integration/sso-upgrade-database.test.ts
---

# Rehearse SSO upgrades and local failures

Use disposable fixtures and a restored copy of the actual deployment before
production acceptance. The local evidence below covers application/schema
boundaries; real provider tenants, physically independent keys and custody remain
separate acceptance requirements. Read [Upgrade existing SSO](./upgrade-existing-sso/)
for the maintenance window, controller suspension and rollback boundaries.

## Released-version migration and concurrent callbacks

The upgrade harness now defaults to the exact **v2.0.0** commit
`097f4916a38ddcc6d1512f71b72bde36abbeb171`. Create a fresh disposable database named
`enterprise_sso_upgrade_test`, set `DATABASE_URL` and `DIRECT_URL` to it, then run:

```bash
node scripts/certify-sso-upgrade.cjs
```

It refuses an already-upgraded database and never drops or resets one. Existing
users, provider ciphertext, links, approvals, teams, incidents and an encrypted
OIDC session are seeded before applying branch migrations. The tests cover Optional
and Required import, break-glass compatibility, Entra without email_verified,
replica cache convergence, historical configuration, linked-identity registration
checks, and rotation between resolution and role/profile synchronization. A further
case deactivates the user and advances its security version in that interval;
claim synchronization must leave the deactivated user unchanged.

The registration locks apply to already-linked identities too. Claim writes hold
the policy/provider locks until commit, check the user's captured security version,
and retain the last-administrator invariant. A rejected callback returns a fresh
sign-in message; it does not persist the obsolete role or profile claims.

## Bounded read and HTTP probes

For the database probe, use a fresh upgrade fixture, a five-connection pool and a
unique application name. Add `application_name=sso-auth-certification` and
`connection_limit=5` to its database URL, then run:

```bash
DATABASE_POOL_SIZE_INTEGRATED=5 SSO_CERT_AUTH_LOAD=1 node scripts/certify-sso-upgrade.cjs
```

The probe executes 1,600 operations across policy/provider and protected-session
profiles at concurrency 1, 10, 25 and 50. It records latency distributions, CPU time,
errors and observed PostgreSQL connections in the versioned certification JSON.
Provider metadata is injected in this probe; it does not measure external OAuth,
bcrypt sign-in, HTTP or production capacity. Image transfer or other host activity
can affect local tail latency. Compare controlled runs with equivalent resources.

For an actual local HTTPS deployment, record a private Playwright storage state
from a fixture user's successful login. Keep it outside the repository with mode
0600 and run:

```bash
SSO_CERT_BASE_URL=https://localhost:3005 \
SSO_CERT_SESSION_STATE=/private/path/fixture-storage-state.json \
SSO_CERT_EXPECTED_USER_ID=fixture-user-id \
node scripts/certify-authentication-http.cjs
```

This tool permits only localhost HTTPS. It records the first request separately,
warms up with 100 requests at each concurrency level, then measures three rounds
of 500 requests at concurrency 1, 10, 25 and 50 (6,000 measured requests). It verifies the same User ID on every response and never
prints cookies or authentication headers. Its self-signed-certificate exception is
restricted to that local fixture. Results are written to
`plans/certification/enterprise-sso-2.1-http-steady-state.json`. Latencies include
Playwright client IPC and JSON validation; responses are disposed after every
request. Compare repeated rounds, median and tail latency with equivalent server
and client resources. The historical 300-request run used a TLS proxy, nginx and a
Kubernetes NodePort/Service with two ready application replicas; a port-forward
transport was not used for the final browser/load measurements.

## Signed provider, recovery-abuse and alert-fan-out checks

Create a disposable `enterprise_sso_test` database and point `DATABASE_URL` and
`DIRECT_URL` at it. Configure an isolated test `NEXTAUTH_SECRET`, then run:

```bash
npx prisma migrate deploy
npx vitest run -c vitest.int.config.ts --no-file-parallelism tests/integration/authentication-policy-database.test.ts tests/integration/emergency-authentication-database.test.ts tests/integration/oidc-staged-authentication-database.test.ts
```

The local HTTPS issuer signs actual RS256 ID tokens and exercises code exchange,
PKCE, nonce, JWKS and identity ownership. Entra-style tokens omit email and/or
email_verified: an existing issuer/subject link succeeds, while a new link still
requires explicit approval and matching email ownership. Removing a tested existing
link before activation cannot silently recreate it. Claims preview follows the same
ownership rules. Provider metadata uses a local fixture, not a live Entra tenant.

The WebAuthn suite uses real local signatures and PostgreSQL rate limits. It injects
400 unknown-account attempts from 40 clients and 40 foreign-browser verifications,
then completes a legitimate ceremony despite a saturated new-ceremony account
budget. It also verifies a reserved authenticated reauthentication path. A second
case creates 1,200 additional administrators, checks that the security-operation
transaction creates only 100 recipient alerts, and drains the remainder using two
concurrent workers without duplicates. Results are recorded in
`plans/certification/enterprise-sso-2.1-resilience.json`.

Further regressions exercise 3,000 already-throttled requests with exact shared
counts and at most three event/audit samples per category/window. The fan-out crash
test terminates the worker's actual PostgreSQL connection after alert inserts and
cursor advancement but before commit, verifies rollback, then drains the backlog
with two workers. It also changes administrator membership between batches.

The delivery-backlog fixture simulates 30-day-old intents with 100 prior attempts,
a stale worker lease, a removed administrator and an unavailable queue. Queue
acceptance alone must not mark delivery; after a simulated database delivery
acknowledgment, 240 retained intents drain. Transport is stubbed: this tests durable
application recovery and recipient checks, not SMTP/vendor delivery. A real provider
outage, exhausted central notification retries and operator requeue must still be
rehearsed with the configured delivery integration before release acceptance.

The **Enterprise SSO certification** GitHub workflow runs these suites and the exact
published-release upgrade on isolated PostgreSQL services, including a bounded
read-load artifact. This complements the deployment and ordinary unit workflows.

## Actual Kind and Helm cutover evidence

The recorded `c59a20c` rehearsal used a dedicated Kind cluster (Kubernetes v1.37.0), one node,
its own PostgreSQL StatefulSet and a local fixture namespace:

1. Extract the Helm chart from the exact v2.0.0 tag. Install its published image with
   a pre-created fixture Secret, a disposable database, zero application replicas
   and the one-shot migration owner. Confirm the image revision label matches the
   tagged commit. Seed the existing administrator/provider/identity/team, then start
   two application replicas. Sign in normally and retain private browser state.
2. Take a database dump after that login. The published release fixture had **177**
   migration records. Keep encryption keys and the NextAuth secret stable.
3. Attempt the current-chart upgrade with a tested image while those replicas are
   live. The authentication cutover Job must fail before migration; confirm the
   old Deployment still has two ready replicas and the original database still
   has 177 migration records.
4. Stop all application Deployments and wait for complete pod deletion. Inject an
   unreachable migration database endpoint in the disposable fixture Secret.
   The cutover gate succeeds, the migration Job fails, and application replicas
   remain zero. Confirm the original database has not advanced.
5. Restore the correct Secret and retry with the tested new image. The migration
   owner advanced that tested source to **198** migration records (subsequent additive
   migrations increase this count); two new
   application replicas become ready. Verify the original administrator, unchanged
   provider ciphertext and the browser session created by the old application.
6. Run Chromium/Firefox/WebKit console, keyboard, desktop/mobile and validation
   checks through the Service. Chromium additionally enrolls a virtual authenticator
   and signs into recovery in a separate context with secure production cookies.
   These are protocol/browser checks, not proof of physical hardware independence.
7. Delete the disposable PostgreSQL pod by scaling its StatefulSet to zero.
   Protected access must be unavailable while the database is absent. Restore it
   and verify the original session recovers without an automatic policy downgrade.
8. Restore the pre-upgrade dump into a separate rollback database. Deploy the
   **published old image and old chart against that restored database**, retaining
   its encryption/JWT keys. Confirm 177 migrations, no AuthenticationPolicy table,
   the original administrator and its session. Never run the old image against the
   upgraded database as a rollback experiment.

The new certification image packaged the optimized application bundle with Linux
production dependencies and a freshly generated Linux Prisma client. Its image ID
and application source hashes are recorded in the result JSON. This rehearsal does
not certify the release image's full supply-chain provenance, multiple-node HA,
split worker load, customer ingress, live IdP sign-in or outbound email providers.
Repeat those acceptance cases in the target topology before release approval.

## A verified staging failure

Clear a required Client ID in a saved provider draft, then attempt to stage it. The
console shows an error; production remains unchanged and the unsaved draft cannot
be tested or activated. This screenshot was captured on the upgraded Linux/Kind
application after the server rejected that request:

![Rejected staging request with the unchanged SSO Optional policy](../../assets/enterprise-staging-validation-failure.png)

Correct the draft, save and validate it, then complete real administrator sign-in
and independent recovery drills before activating a revision. A local error screen
or a virtual-key success does not replace those live acceptance steps.

## Terminal delivery and sustained admission tests

Staged verification, claims preview and production login use the same boolean-claim
normalizer. Explicitly unverified email rejects even an existing issuer/subject
binding. Missing email and missing verification claims still follow the existing
provider/link ownership rules; absence is not an explicit rejection.

Removed or inactive administrators' email intents receive a terminal cancellation
timestamp. Restoring administrator access does not restart those old intents.
The diagnostics page separates fan-out jobs, materialized pending emails, failed, completed and cancelled deliveries. The scheduled cleanup
retains delivered, cancelled and failed metadata for 90 days from the terminal timestamp,
then removes up to 1,000 of each per pass. Pending delivery and fan-out work, security
events, audit rows and in-app alerts are unaffected by this cleanup. Existing
notification/audit retention policies remain separate. Cancellation cannot recall
mail already handed to a provider.

The PostgreSQL abuse test runs at concurrency 30 for at least 30 seconds and at
least 3,000 rejections. Its artifact records actual request count, duration and
bounded audit samples. This measures local counter contention, not distributed
production capacity.

Run `python3 scripts/certify-sso-edge.py` with Docker to test the optional
`deploy/nginx/emergency-rate-limit.conf` example against an isolated fixture
upstream. It verifies early 429 rejection, ordinary login isolation and admission
after refill; `plans/certification/enterprise-sso-2.1-edge.json` records results.
No real authentication or database requests occur in that edge fixture.

## Connection-termination evidence correction

The original fan-out crash fixture incorrectly allowed any transaction error to
satisfy its expectation. PostgreSQL could reject `pg_terminate_backend(bigint)`
before a connection was terminated. Reports produced through `adeda2ccc` therefore
must not be used as evidence of real connection termination.

The corrected fixture casts the PID to `integer`, requires the termination call
to return true, forces another operation on that transaction, and independently
requires the PID to be absent from `pg_stat_activity`. It then checks rollback of
both alert rows and cursor, concurrent recovery, and recipient changes. A SQL
type error or a false termination result now fails certification. Refreshed reports
include `backendAbsentFromActivity` alongside the termination acknowledgment.

## Failed security email recovery

Diagnostics distinguishes pending emails from terminal failures. Exhausted `FAILED`
notifications, failed notifications with expired/missing payloads, and `SKIPPED`
notifications stop the authentication worker's automatic polling. A retryable
`FAILED` notification remains pending while the central queue has attempts and a
live payload. `UNKNOWN` outcomes remain with central reconciliation; they are not
automatically resent. Inspect Notification History for provider-specific details.

After correcting the provider, open **System → SSO / Authentication → Diagnostics**.
The delivery history loads 25 records per page and supports status filtering. Choose **Retry email**
and confirm the new attempt. Fresh administrator or independent recovery authority
is required. The operation checks recipient eligibility, rejects stale/concurrent
requests and commits a mandatory audit event. It rebuilds a new payload from the
retained security intent under a new idempotency key, so an expired old payload
does not block recovery. Repeated clicks cannot create multiple retry generations.
An explicit retry may duplicate a message whose earlier delivery was uncertain.
Cancelled recipients cannot be retried. Failed metadata joins delivered/cancelled
metadata in the bounded 90-day retention policy; export delivery metadata before
that window if needed. Security audit and in-app evidence retain their own policies.

Local tests cover terminal failure reconciliation, retryable/unknown state
preservation, fresh-authority enforcement, concurrent retry rejection, new delivery
keys, real central enqueue with rebuilt encrypted payloads and deduplication,
simulated delivery acknowledgment, and the confirmation UI. They do not claim
real SMTP/vendor acceptance; those checks remain external acceptance work.

## Authorization at queued email dispatch

Authentication-security email is checked both when enqueued and immediately before
calling each provider, including fallback providers. A recipient must still be an
active administrator and the queued address must match the user's current email.
Demotion, deactivation, deletion or an address change suppresses queued delivery as
`SKIPPED`; the authentication intent subsequently records terminal failure for
explicit review. Unavailable authorization reads defer delivery without sending.
Mail already accepted by a provider cannot be recalled.

Diagnostics reports **Fan-out jobs pending** separately from **Materialized emails
pending**. A job may represent many recipients; neither figure is presented as a
combined recipient backlog. Provider-accepted, delivery-confirmed, failed and cancelled counts cover retained
records. Delivery history supports all five states, loads 25 records per page and
uses **Load more deliveries** for older entries. Retry confirmation stays open when
the server rejects the operation, with its error shown in the console. A successful
retry closes confirmation and refreshes history. Retention remains 90 days for
terminal delivery metadata; audit/in-app evidence follows its separate policy.

## Identity recognition and administrator readiness

Claims preview reports stable issuer/subject identity recognition separately from
administrator verification readiness. A recognized identity with group overage is
shown as **Identity recognized** with **Administrator verification blocked by
incomplete group claims**. It cannot satisfy the staged administrator test until
those claims are resolved. Sample claims remain a preview; a real signed-token
administrator test is required before activation. Editing claims or provider rules
invalidates the displayed preview.

## Submission and delivery receipts

**Sent to provider** records transport acceptance. **Delivery confirmed** requires
a delivery receipt or a central notification already confirmed as delivered.
Providers without final-delivery feedback remain **Sent to provider**; acceptance
is never presented as recipient delivery. Pending, accepted, confirmed, failed and
cancelled history filters report distinct states. A terminal bounce, complaint,
suppression or invalid-recipient receipt moves the accepted message to failed.

Receipt processing is serialized with linking the alert to its current transport
notification, so an early receipt is retained. Retrying clears that link and creates
a new generation; a late receipt for the old attempt cannot confirm the replacement.
Older completion timestamps are migrated conservatively into provider-acceptance
metadata because the old field did not distinguish acceptance from delivery.
Review the original provider evidence separately when auditing historical delivery.
Accepted messages without confirmation and other terminal delivery metadata use
bounded 90-day retention; security audit and in-app evidence remain independent.

### Receipts before provider acceptance persistence

Provider feedback is stored durably before reconciliation. A callback arriving before the
send result's message ID is persisted remains pending. The central dispatcher replays
pending receipts after persisting that result; queue processing also reconciles up to
100 due events per pass. Unmatched events yield for one minute, so an unknown message
cannot monopolize the batch. Concurrent replay locks each event and notification;
endpoint counters apply once per provider event ID. Terminal authentication delivery
failures cannot be reversed by a later delivery receipt.

Correlation requires both the message ID and the sending provider. Existing records use
recorded delivery-attempt evidence; unknown provider identity is never inferred from a
callback. New send results persist provider identity even if attempt-ledger persistence
fails. Existing feedback that may already have changed endpoint counters is preserved
as processed during migration. A follow-up migration repairs idempotent authentication
transport states for historical receipts with recorded provider evidence, without
repeating endpoint counters. Previously unmatched messages without a notification
remain eligible for reconciliation. Historical records without provider evidence require
operator investigation and are not automatically confirmed.

The HMAC endpoint accepts at most 64 KiB of raw request bytes, including streamed bodies
without a Content-Length header, and requires a bounded SHA-256 signature header.
Oversized bodies receive HTTP 413 before signature hashing or event ingestion.
These local ordering checks do not replace acceptance against a real provider's callback
adapter, physical WebAuthn keys, live identity tenants, or production HA deployments.
