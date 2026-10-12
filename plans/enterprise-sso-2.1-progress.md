# Enterprise SSO 2.1 delivery record

The complete user specification is preserved in
[enterprise-sso-2.1-specification.md](enterprise-sso-2.1-specification.md).
All implementation, migrations, tests, and manually maintained 2.1 documentation
belong to `feat/enterprise-sso-2.1` in `opsknight-enterprise-sso`. Do not create a PR
without the user's instruction. Do not modify or publish the website repository.

This branch is an implementation in progress, not a completed enterprise SSO
release. The original specification's seven-PR recommendation is superseded by
the user's single-branch/no-PR direction. Use incremental commits on this branch.

## Verification recorded on 2026-10-12

- Full TypeScript check: passed (`npx tsc --noEmit`).
- ESLint for every modified/new TypeScript and JavaScript file: passed with zero warnings.
- Authentication/OIDC/session regressions, policy action guards, policy form behavior,
  and OIDC architecture contracts: 316 tests passed across 33 files.
- Dedicated PostgreSQL policy tests: 6 passed, including concurrent import, durable
  revocation cutoffs, enforcement/write ordering, missing-policy behavior, competing
  administrator updates, and mandatory-audit rollback.
- Existing PostgreSQL password-recovery compatibility: 5 tests passed across 3 files,
  including concurrent reset issuance and session revocation.
- Upcoming 2.1 documentation contracts: 4 passed, including frontmatter, internal
  links, released-version preservation, provider detail retention and policy claims.
- Both additive migrations applied successfully to the isolated
  `enterprise_sso_test` database. No production/application database was used.

This is source, unit, component and PostgreSQL verification. It is not a live IdP,
real-browser, WebAuthn, accessibility, multi-replica deployment or complete-release
certification. Those requirements remain explicitly outstanding below.

## Security foundation implemented in this increment

- PostgreSQL singleton policy, monotonically increasing policy versions, explicit
  legacy import snapshot, separate import marker, and audited bootstrap transaction.
- Advisory lock for simultaneous replica migration; no policy cache or database-
  outage fallback; a missing already-migrated policy fails closed.
- Central evaluator for ordinary credentials, OIDC, password writes, and sessions.
- Server session validation rejects disallowed methods on the next protected
  request even with cached auth options or cached user security projections.
- Immutable issuing-policy versions and persisted method-specific revocation
  cutoffs prevent sessions returning when a restrictive mode is later relaxed.
- Password changes, password-reset issuance/completion, invitation issuance,
  direct invitation activation, and inline admin invitations consult policy.
  Password mutation transactions lock the policy row to serialize enforcement.
- Compatibility emergency-password sessions have absolute/idle limits and reject
  trusted-device extension. They are explicitly not the final emergency subsystem.
- Long-lived event streams recheck authoritative policy, and the Edge middleware
  defers login redirects to the server's authoritative session evaluation.
- Administrator mode changes require fresh server-established authentication,
  strict input validation, shared rate limiting, optimistic concurrency, and an
  atomic audit. Disabling SSO additionally proves the administrator's password.
- New Required activation stays blocked until independent emergency recovery and
  real administrator login verification are available. Existing Required installs
  preserve the legacy policy without being labeled readiness-certified.
- Active-provider edits are blocked under Required until a fresh administrator
  deliberately returns to Optional. This is a temporary guard pending staged revisions.
- Personal Security hides password creation/change when system policy blocks it.

## Phase 0 / Phase 1 remaining certification

Verify every direct route with real HTTP requests, policy transitions in both
directions, stale method-less JWTs, all remember/device extension calls, unknown
methods, corrupt records, missing database state, and setup authorization. Exercise
database migration against fresh and pre-existing installations, concurrent policy
admins, mandatory-audit failure rollback, and integrated/split deployments. Add a
notification intent for policy changes, and complete method/expiry/revocation
projection in session administration. Do not treat current unit coverage as proof
of every topology or browser requirement.

## Phase 2: independent emergency recovery — outstanding

Implement EmergencyAccount, WebAuthn public credentials, versioned credential
revocation, single-use challenge state, dedicated emergency sessions, and mandatory
events. Use a maintained WebAuthn verifier with exact origin/RP binding, user
verification, registration proof, authentication proof, replay prevention, and
counter/credential synchronization handling. Private keys never reach the server.

Enrollment requires an authorized fresh admin or a narrowly authorized fresh
emergency session. Require two separately verified active identities before new
enforcement. Account verification must result from a real sign-in drill using
authentication independent of the IdP. Provide secure backup-key enrollment,
replacement and compromise revocation without an ordinary password reset.

Expose `/login/emergency` and a restricted recovery console. Emergency sessions
must never resolve to a User, JIT/SCIM record, responder selector, incident role,
ordinary JWT, or trusted device. Enforce 60-minute absolute and 15-minute idle
limits on the server, with fresh authentication for credential/policy repair.
Rate-limit shared IP/credential attempts without permanent account-wide lockout
that lets an attacker deny recovery. Audit and durable high-priority notification
intent must commit for every success/failure; test notification-delivery outages.

## Phase 3: staged OIDC onboarding / enforcement — outstanding

Create immutable encrypted provider revisions, active revision references,
activation/rollback metadata, and staged test authorization bound to admin,
revision, state, nonce, PKCE, expiration and canonical origin. The staged callback
must never replace production config or create an ordinary production session.
Reuse validated issuer/subject and explicit linking semantics; no email-only join.

Record a real administrator login result for the exact tested revision and role
mapping. Invalidate readiness after any trust-relevant change, admin disable/role
change, credential revocation, emergency-account deactivation, or stale drill.
Discovery health and browser login verification are separate evidence.

Preview password sessions affected, users without binding, administrator-role
consequences, and missing recovery requirements. Under a single authoritative
transaction, check expected policy/revision versions, fresh admin authentication,
verified SSO admin and two independent emergency identities, activate the revision,
advance cutoffs, record audits and enqueue notification intents. Failures preserve
the old production revision. Concurrent edits must not activate untested state.

## Phase 4: final system UI — outstanding

Replace the long SSO form with Overview, Connection, Access & provisioning,
Authentication policy and Diagnostics. Preserve provider-specific fields and
templates; show discovery health and actual administrator login distinctly.
Build guided onboarding and the separate System → Emergency Access screen with
enrollment, credential management, drill history and audited recovery events.
Use existing components, single-column mobile forms, clear keyboard focus and
accessible validation. Preserve personal password/linked identity/sessions in
Settings → Security. Real screenshots only after tested UI exists.

## Phase 5: identity lifecycle / diagnostics — outstanding

Keep the stable issuer-and-subject model and first-link approvals. Add identity
resolution preview, claim-role tester, broadly matching ADMIN warnings, role-source
display and explicit diagnostics for missing claims, Entra group overage, email
changes, issuer migration, JIT/SCIM authority and deactivation revocation.
Emergency identities remain separate from all existing provisioning code.

Add secret-redacted authentication audit/diagnostic views, method-aware session
management and targeted revocation, emergency/policy alert delivery, and provider
outage/key rotation tests. Bound discovery metadata staleness and signing-key
refresh. Back-channel logout is a later optional enhancement, not this release's
ordinary logout mechanism or a readiness prerequisite.

## Phase 6: compatibility / operations — outstanding

Validate environment import on representative existing installations, no
conflicting live source of truth, fresh bootstrap, shared policy across replicas,
IdP outage without fallback, PostgreSQL outage, invalid staged config, issuer
migration, secret rotation and explicit application downgrade constraints.
Document external database recovery; emergency recovery itself depends on
PostgreSQL and cannot claim database-independent authentication. Redis is not a
new feature requirement. Preserve first admin IDs and operational references.

## Documentation deliverables — partially implemented

`authentication-modes.md` documents this increment and explicitly names its limits.
Update configure-oidc, authentication concepts, initial setup, personal/system
settings, sessions, user linking, audits and legacy configuration alongside code.
Retain detailed Entra/Google/Okta/Auth0/Generic OIDC/Keycloak instructions.

Still required once corresponding features work: migrate-admin-to-sso,
configure-emergency-access, test-and-enforce-sso, rotate-oidc-credentials,
sso-lockout-recovery and emergency-access troubleshooting. Do not publish pending
designs as supported procedures. Each page needs audience, prerequisites, exact
navigation/labels, actions, expected results, verification, failures, rollback,
security implications and actual source/test references. Maintain upcoming v2.1
metadata, indexes, links and identity contracts without weakening v2.0 tests.

## Phase 7: full certification — outstanding

Certify first-admin bootstrap/account preservation; provider flows for Entra,
Google, Okta, Auth0 and custom OIDC; linking expiry/issuer/subject/email collisions;
all mode transitions; independent recovery enrollment, drills, expiry, revocation,
lost keys and alerts; CSRF, replay, state/nonce, session fixation, escalation and
shared limits; IdP/DB/metadata failures; concurrent admins; integrated/split and
multi-replica/restart behavior; desktop/mobile Safari/Chrome/Firefox and keyboard
accessibility; and real documentation walkthroughs. Record surviving-session
semantics and stream revocation bounds. No final-completion claim until these
requirements and all nine acceptance guarantees in the specification have evidence.
