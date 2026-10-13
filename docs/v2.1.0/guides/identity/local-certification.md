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
