# Enterprise SSO 2.1 delivery record

The complete specification remains in [enterprise-sso-2.1-specification.md](enterprise-sso-2.1-specification.md).
The supplied historical [deep branch audit](enterprise-sso-2.1-branch-audit.md) is preserved separately; its outstanding findings describe the earlier foundation, not the final code.

Implementation, migrations, tests and manually maintained upcoming documentation
stay in the separate `opsknight-enterprise-sso` worktree on
`feat/enterprise-sso-2.1`. The user's single-branch/no-PR instruction supersedes
the specification's suggested PR sequence. No website repository is modified or
published. v2.0.0 remains the released version.

## Implemented behavior

### Authoritative policy and session enforcement

PostgreSQL owns Password Only, SSO Optional and SSO Required policy after a
serialized one-time legacy import. A fresh zero-user installation starts in
Password Only so deprecated SSO-only flags cannot deadlock first-admin setup. Missing imported policy and database failures
fail closed. Existing sessions carry their method and immutable issuing-policy
version; persisted method-specific cutoffs prevent revoked sessions returning
when policy is later relaxed. Credential/OIDC login, protected sessions, password
creation/change/reset and password invitations consult authoritative policy.
Fresh administrator mutations lock the policy and actual acting User/security
rows; revocation and concurrent demotion cannot reuse stale authorization.

System Diagnostics exposes the 100 most recent registered sessions by method,
expiry, issuing version and state, with fresh, audited targeted revocation.
Personal Security separates current sign-in method, linked identity and system
policy. Password controls disappear when Required blocks them. Streaming
connections retain their existing periodic authoritative policy checks; already
delivered data cannot be recalled.

### Independent emergency recovery

Dedicated EmergencyAccount, public WebAuthn credentials, browser-bound single-use
challenges, credential versions, independent opaque recovery sessions and events
are implemented. SimpleWebAuthn verifies signatures, challenge, exact origin/RP,
user presence/verification and counter state. Synced/backup-eligible credentials
are rejected. No private keys reach the server. Enrollment requires fresh normal
administrator or narrowly scoped recovery authorization. Registration alone does
not establish readiness: a separate successful authentication drill verifies the
current credential version and canonical origin, with a 90-day readiness lifetime.

`/login/emergency` opens `/recovery`, outside ordinary application administration.
Emergency principals never resolve into normal User/JIT/SCIM/responders, NextAuth
JWTs or trusted devices. Recovery sessions have a one-hour absolute cap and
15-minute idle timeout. Passive reads do not refresh idle; deliberate visible
interaction does. Sensitive mutations require five-minute freshness.
Reauthentication rotates the capability without extending its absolute cap.
Enrollment, revocation and disablement revoke affected sessions and invalidate
previous readiness. Shared attempt limits do not permanently lock an account.

Privacy-preserving WebAuthn attestation cannot prove physically distinct keys or
custodians. The independence confirmation is an explicit custody obligation;
operators must actually hold and drill separate hardware. This limitation is
stated in the guide, rather than represented as a cryptographic guarantee.

### Staged onboarding, activation and recovery repair

Immutable encrypted provider revisions preserve current production configuration
while discovery and actual administrator authentication are tested separately.
Tests bind revision, existing administrator, browser, state, nonce, PKCE, origin,
expiration and current production configuration version. Real code exchange and
RS256/JWKS verification establish proof; test callbacks issue no ordinary session.
First linking requires explicit ownership approval and matching verified email;
stable issuer/subject bindings preserve the original User ID. Effective ADMIN and
current user/token state are rechecked under transactional locks.

Impact preview includes password sessions, unbound users, exact administrator
proof, independently drilled recovery identities and active replica conflicts.
Required activation needs a proof from the current origin within 15 minutes and
two current independent drills. Activation checks expected versions and commits
provider, policy, cutoffs, audit and alerts atomically. An origin, role, token,
credential or production configuration change invalidates corresponding evidence.
Previously activated revisions can be staged as new rollback revisions, and need
fresh login verification before activation. The old direct provider-save action
cannot bypass this workflow, including for Optional or cosmetic changes.

A fresh emergency principal can stage/test/activate a provider repair while
preserving Required. A completely unavailable IdP never causes automatic password
fallback. The separate explicit password-restoration workflow changes policy,
updates an existing active administrator in place, advances both session cutoffs,
rotates token version and audits/enqueues alerts. Imported legacy passwords create
only recovery sessions; two verified independent identities allow retiring the
bridge without deleting its original User. A deliberate normal Password Only
transition also clears the legacy bridge after proving the administrator password.

### Console, identity lifecycle and diagnostics

System SSO / Authentication provides Overview, Connection, Access & provisioning,
Authentication policy and Diagnostics. Provider templates/issuer/client fields,
Auth0 organization, client authentication method, scopes, ordered role rules,
profile claims and session bounds remain available. Claims preview explains
identity/linking/JIT/role decisions without treating untrusted samples as proof.
Broad ADMIN rules require acknowledgement; role source and issuer bindings are
visible. Emergency Access has independent enrollment, backup/replacement,
revocation, disablement, current drill state and recovery events.

Users can be invited without a password hash or setup token. Required selects
this behavior automatically. The seven-day first-link approval binds exact issuer,
client/config version and verified email; renewal invalidates pending password
capabilities. Ordinary lifecycle, SCIM and operational identity remain separate
from emergency principals.

Every security mutation and emergency login result persists mandatory audit and
durable high-priority in-app/email intent transactionally. A leased outbox hands email intents to the existing notification control plane
with stable delivery keys; that control plane owns provider admission and retries. Delivery outages retain intents and
in-app alerts. Expired ceremony state is cleaned by scheduler maintenance.
Web replicas periodically record legacy-setting and canonical-origin conflicts;
PostgreSQL remains authoritative. Conflicting canonical origins fail authentication
administration closed; the ordinary Settings screen remains available to reconcile
configuration where ordinary administrator access is still valid.

## Supplied audit findings addressed

- A: Required recovery repair stages/tests a provider and preserves Required; explicit password restoration is a separate audited action.
- B: Passive emergency reads never refresh idle time; hard expiry and reauthentication caps are exercised against PostgreSQL.
- C: Separate recovery-only sessions and identifiable mandatory security events/durable alerts replace ordinary legacy-emergency JWT issuance.
- D: The acting administrator's real row is locked and rechecked behind concurrent demotion; stale authorization and expected versions fail closed.
- E: Required-compatible SSO invitations create bound first-link approvals without passwords or setup tokens.

## Verification recorded on 2026-10-12

- TypeScript: `npx tsc --noEmit` passed.
- Modified/new TypeScript and JavaScript: ESLint passed with zero warnings.
- Full unit suite: 5,685 passed across 745 files; four intentionally skipped.
- Authentication/OIDC/session/user-invitation/component regressions: 308 passed
  across 31 files, including eight canonical-origin/CSRF boundary tests.
- Isolated PostgreSQL suites: 37 passed across policy, signed WebAuthn and staged
  OIDC suites. They exercise concurrency, mandatory-intent rollback, shared email
  handoff leases/delivery-queue outage retention, signed origin/RP/UV/counter/replay failures,
  passive idle/hard expiry, reauthentication, credential revocation, real HTTPS
  token exchange, nonce/audience/PKCE/JWKS, explicit linking, legacy issuer ownership protection, origin-bound proof,
  Required readiness, emergency Required repair, password-free invitations, an administrator-reset/password-change race, and
  explicit administrator restoration.
- Chromium browser recovery test: console sections/mobile overflow, virtual hardware-key
  enrollment and a separate-context sign-in drill, no ordinary NextAuth user,
  incident-route denial, recovery logout and anonymous/foreign-origin rejection.
  Three additional Chromium/Firefox/WebKit desktop/mobile and keyboard/validation
  checks passed. The virtual authenticator establishes browser/protocol integration, not physical
  hardware independence or production-provider certification.
- Upcoming documentation: four contracts passed, including frontmatter, internal
  links, released-version preservation and retained provider detail.
- The final optimized production build passed using the repository-configured
  `.next-pre-push` directory. Git hook wrappers were absent in this worktree, so checks were run
  manually. An alternate, unexcluded `.next-prepush` directory exposed existing
  generated route-type errors: extra helper exports in status/Jira routes and
  optional page props in teams/schedules. These unrelated framework contracts are
  not covered by the repository's normal TypeScript artifact exclusions.
- Additive enterprise authentication and origin-readiness migrations applied to
  isolated `enterprise_sso_test`; no production/application database was migrated.

The PostgreSQL OIDC fixture verifies actual HTTPS code exchange and signed token
verification. Discovery shape is injected in that fixture and independently tested
in the existing discovery/provider matrix suite. Readiness fixtures in activation
tests represent already-verified database state; signed WebAuthn tests and the
separate-context browser drill establish how real verification writes that state.
They do not constitute hardware/vendor attestation.

## Documentation delivered

Upcoming 2.1 guides cover authentication modes, existing administrator migration,
independent emergency setup, tested enforcement, credential/provider rotation,
lockout recovery and emergency troubleshooting. Existing detailed Entra, Google,
Okta, Auth0 and Generic/Keycloak instructions remain. Setup, authentication concepts,
legacy configuration, SCIM, invitations, sessions and audits describe implemented
boundaries. Real browser captures accompany the console and Emergency Access.
Downgrade guidance requires coordinated application/database/settings rollback,
no mixed old/new replicas, a pre-upgrade backup and consideration of restored
revoked state. Emergency authentication explicitly depends on PostgreSQL.

## External release certification still required

The implementation is not a certification of every environment in the original
matrix. Before a production release, walk the guides against actual Entra, Google,
Okta, Auth0 and custom IdP tenants and physically independent keys; exercise real
provider-side assignment/deactivation and key/secret rotation. Verify native desktop/mobile Safari/Firefox hardware-key flows and screen-reader
behavior, split/multiple-replica runtime,
restarts, external PostgreSQL restore and a controlled application downgrade.
Confirm actual alert delivery and operational custody/drill procedures in the target
deployment. No production deployment, website publication or PR is implied by this
branch, and no complete external-release certification is claimed.
