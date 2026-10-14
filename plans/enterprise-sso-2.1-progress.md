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

## Latest audit implementation (reviewed input: f7b6be1)

The supplied latest audit is preserved in `enterprise-sso-2.1-latest-audit.md`.
Implementation now addresses each source finding:

- Deployment-pinned `AUTH_RECOVERY_ORIGIN` keeps origin/RP/UV/CSRF checks and
  authorizes only recovery host routes. Fresh independent recovery can repair the
  database App URL only after deployment URL settings agree with the pin.
- Actual compromise can revoke the final ready key. Its sessions are revoked,
  Required stays enforced, and an urgent degraded-recovery marker/event is written.
  Two current independent drills clear the degraded marker.
- Individual anonymous failure evidence remains transactional. Shared PostgreSQL
  windows emit at most two alert batches per five minutes, capped at 100 recipients
  each, independent of request IP. IP/account/global admission limits precede
  challenge allocation. Successful security operations remain fully notified.
- Emergency actors retain their presented token hash and compare it under the
  mutation row lock. Rotation invalidates requests authorized before the rotation.
  Invalid recovery cookies can fall back only to a separate valid normal admin.
- Administrator-only password restoration is the default: one stable User ID for
  one hour, preserving the SSO mode and other users’ OIDC sessions. Instance-wide
  Password Only remains a distinct audited scope with a separate confirmation.
- Enforcement preview uses indexed PostgreSQL counts, not unbounded JSON session
  reads. Legacy sessions without a typed expiry projection are conservatively counted. Registration/renewal
  populate the typed expiry projection; an additive migration creates its index.
- SSO invitations use the existing email queue with SSO-specific instructions,
  generation-specific delivery keys, and accurate queued/sent/manual results.
  No invitation password capability is created.
- Security-alert review links point to the validated canonical instance URL;
  canonical conflict defers email instead of generating an unsafe link.
- Selecting a revision synchronizes the complete editable draft, including mappings.
  Editing marks it unsaved and clears activation impact/confirmation. Testing and
  activation require a saved revision; blank secrets preserve only its same-client
  encrypted secret. Production configuration remains separately labelled.
- Administrator pickers and the account directory use bounded server search and
  pagination. Superseded searches are aborted; recovery is not tied to the first
  workspace user page.
- Authentication now follows existing product DetailTabs, semantic cards/badges,
  focus styling, accessible feedback, and responsive layouts. Only the visible tab
  is mounted. System settings defer the authentication bundle/data until selected;
  diagnostics reads happen on demand and WebAuthn loads only for a ceremony.
- Expanded runbooks cover Compose/Helm pins, exact repair boundaries, scoped/global
  restoration, compromise/custody drills, alert abuse, expected blockers, rollback,
  and completion evidence. Real provider/physical-key/multi-replica certification
  remains external acceptance work rather than an inferred completed result.

New isolated database coverage includes 10,000 session rows, administrator search
beyond the first page, 60 concurrent/distributed failure events with 120 fixture
administrators, final compromised-key revocation, rotated-capability mutation
rejection, scoped restoration expiry, and pinned-origin repair. Fixture migrations
were applied only to `enterprise_sso_test`. Helm lint and both Compose configuration
validations run without starting services or deploying changes.

### Final verification of the latest audit implementation

- Full unit suite: **5,697 passed across 748 files**, with four intentional skips.
  Includes stale recovery-cookie fallback and aborted section-request regressions.
- Isolated PostgreSQL suites: **42 passed across three files**, including signed
  WebAuthn and HTTPS OIDC exchange fixtures plus the scale/concurrency cases above.
- TypeScript passes; all changed/new TypeScript and JavaScript files pass ESLint
  with zero warnings, including explicitly checked framework/test configuration.
- Upcoming documentation: **four contracts passed**; retained identity guides also
  pass their two contracts. Helm lint and integrated/split Compose validation pass.
- Optimized production build passes. The standalone package automatically includes
  the generated Prisma engine; boot was verified without copying an engine into
  the artifact. Public/static assets were copied using the normal standalone
  packaging procedure. The obsolete, unsupported PWA `swcMinify` option was removed
  while replacing its untyped configuration loader with the package's typed import.
- Production HTTPS browser suite: **four passed**, with two explicit skips for the
  Chromium-only virtual hardware authenticator. Chromium, Firefox and WebKit verify
  desktop/mobile layout, keyboard access, validation and saved-revision selection.
  Chromium also verifies recovery enrollment, separate-context sign-in, secure
  production cookie behavior, authorization/CSRF boundaries and logout. The rapid
  tab-switching regression passes against the optimized package. Fresh screenshots
  are retained in the versioned documentation assets.

The HTTPS fixture used a local, explicitly opted-in self-signed certificate and an
isolated database; production secret checks stayed enabled. No production deployment,
external provider tenant, real physical key or multi-replica release certification
is implied. Those acceptance requirements remain listed above. All changes remain
on `feat/enterprise-sso-2.1`; no PR is created.

## Regression audit follow-up (reviewed input: 022dc69)

The supplied audit is preserved in `enterprise-sso-2.1-regression-audit.md`.

- Import now creates the legacy recovery-only designation only when local login was
  disabled. Optional administrators named in break-glass environment settings keep
  ordinary credentials login and existing credentials sessions. The evaluator and
  credentials callback also handle already-imported Optional policies that contain
  that email, without replaying import or changing authoritative policy state.
- Helm integrated and split application Deployments use Recreate. A mandatory,
  read-only pre-upgrade cutover Job runs before the migration Job. It checks zero
  desired application replicas, complete pending/running/terminating pod shutdown,
  and the release-labelled deployment inventory (including renamed deployments).
  RBAC permits reads only. API failure blocks migration. Upgrade rendering requires
  an explicit tested image tag/digest containing the gate script; the default older
  appVersion image is not silently accepted. Kustomize application profiles use
  Recreate too; their release-wide stop/migrate/start gate is operator-owned.
- The upgrade runbook explicitly documents downtime, ingress/worker drain, external
  controller suspension, HPA scale-to-zero/reactivation, migration ownership,
  failure recovery and coordinated database/application rollback. No rolling-upgrade
  compatibility certificate, live production cutover or cluster acceptance is claimed.
- Provider record reads are authoritative on authentication-options requests.
  Unchanged records reuse decryption/options/metadata; changed records invalidate
  local caches immediately. Promise reuse is keyed to the record and cannot make a
  different registration inherit stale options. Callbacks captured before rotation
  reject with a fresh-sign-in message; JWT issuance rechecks that registration.
  First-link/JIT transactions share the policy lock with activation and recheck the
  enabled registration before creating users or identities. Brief policy DB outages
  retain decoding options while authorization callbacks fail protected access closed.
- Historically tolerated settings no longer crash the administration dashboard.
  Production continues through the established runtime reader. The console shows a
  compatibility warning, preserves historical snapshots in PostgreSQL, omits
  incompatible snapshots from editable revision choices, and requires a complete,
  validated replacement for staging. Invalid historical snapshots remain archival
  evidence, not silently normalized live configuration or unverified rollback targets.

Verification completed for this follow-up:

- **5,709 unit tests passed across 749 files**, four intentional skips.
- **42 existing PostgreSQL tests passed across three suites**.
- **Eight upgrade tests passed** using an isolated database first migrated with the
  pre-SSO 2.0 baseline (`ea38c8c5601189225e3c5edd1efeed855c034c7d`), seeded with existing
  provider ciphertext, administrator/password, immutable identity, linking approval,
  team membership, incident history and a pre-upgrade encrypted OIDC session, then
  upgraded through the branch's additive migrations. They cover Optional/Required
  import with break-glass, Entra without email_verified, stable records/session,
  historical configuration, stale first-link rejection and two independent module
  cache instances sharing PostgreSQL through provider rotation and rollback.
- **Four optimized HTTPS browser checks passed** in Chromium/Firefox/WebKit;
  two Chromium-only virtual-authenticator cases are intentionally skipped on other
  browsers. Hardware recovery still runs in a separate context with secure cookies.
- **Four rendered Helm cutover contracts and four upcoming-doc contracts passed**.
  Helm lint and all three Kustomize profiles render successfully. Infrastructure
  rolling strategies remain independent of stopped application-runtime cutover.
- TypeScript, modified-file lint (zero warnings), diff checks and the optimized
  standalone production build pass. Production boot/browser verification used an
  isolated local TLS fixture with secret checks enabled.

The repeatable upgrade harness is `scripts/certify-sso-upgrade.cjs`; it accepts only
`enterprise_sso_upgrade_test`, refuses an already-upgraded database, and never resets
or drops it. Development fixtures were recreated only in that explicitly isolated
local database. This is schema/application upgrade evidence, not a substitute for
rehearsing an upgraded copy of a customer's actual deployment or certifying real IdP
claims, physically independent keys, ingress, delivery and Kubernetes cutover. Those
external acceptance requirements remain outstanding. No PR or deployment is created.

## Full implementation audit follow-up — local certification (2026-10-13)

The supplied audit is preserved in `enterprise-sso-2.1-full-audit.md`. All work stays
on `feat/enterprise-sso-2.1`; no PR is created. The latest main change `4eeaea218`
was incorporated by cherry-pick (`7f734e6ab`), without merging or rewriting history.

- Existing identity resolution, fingerprint backfill and first linking now hold the
  authoritative policy/provider registration locks. Claim synchronization reacquires
  those locks through commit and checks the user's security epoch. Rotation rejects
  stale callbacks; concurrent SCIM disable or role changes cannot be overwritten by
  stale OIDC claims. Real PostgreSQL regressions exercise both interleavings.
- Deployment CI renders upgrades with an explicit tested image, verifies rejection
  of an unpinned upgrade, and asserts the current Recreate application strategy.
  Every deployment workflow command step passed in a disposable local workspace.
  This records local verification, not a claim that hosted CI has passed.
- The authentication overview is extracted into a product-styled component, preserving
  the console's responsive layout. Unrecognized session methods display Unknown.
  A real staging-validation error screenshot and a reproducible certification guide
  document the actual interface and failure behavior.
- Upgrade certification defaults to the exact published v2.0.0 commit
  `097f4916a38ddcc6d1512f71b72bde36abbeb171`. The isolated fixture preserves existing
  users, credentials, provider ciphertext, immutable identities, team membership,
  incident history and encrypted sessions through additive migrations.

Verification and committed evidence:

- 5,725 unit tests passed across 753 files; four intentional skips.
- 42 existing PostgreSQL tests passed across three suites, plus 11 exact-release
  upgrade/race tests and one bounded authentication read-load probe.
- The database probe completed 1,600 reads at concurrency 1/10/25/50 with a shared
  five-connection pool and zero errors. Source hashes, CPU and latency measurements
  are in `certification/enterprise-sso-2.1-authentication-load.json`.
- Four optimized HTTPS browser checks passed across Chromium, Firefox and WebKit;
  two virtual-authenticator cases apply only to Chromium. These exercise virtual
  recovery credentials in a separate browser context, not physical security keys.
- An actual disposable Kind cluster ran the published 2.0.0 image and chart, rejected
  migration while two old application pods remained, kept the application stopped
  after a deliberately unreachable migration database, and recovered to two upgraded
  replicas with 198 migrations (177 in the published baseline). The original browser
  session and administrator identity remained usable. PostgreSQL outage denied
  protected access; restoration recovered the original session. A separate database
  restored from the baseline backup ran the published old image successfully with
  the original session. Evidence is in `certification/enterprise-sso-2.1-kind-cutover.json`.
- 300 HTTP session reads through TLS, nginx and the two-replica Kubernetes Service
  completed at concurrency 10/25/50 with zero errors. The repeatable probe and results
  are `scripts/certify-authentication-http.cjs` and
  `certification/enterprise-sso-2.1-http-load.json`.
- TypeScript, modified-file ESLint with zero warnings, the optimized standalone build,
  four rendered cutover contracts and four upcoming documentation contracts pass.

The Kind rehearsal uses one node and an integrated application topology. Its Linux
certification image packages the optimized source bundle and Linux dependencies;
this does not certify the production image supply chain, multi-node HA, split workers,
customer ingress, real email delivery or production capacity. Load figures are local
measurements, not throughput guarantees. Per the user's explicit choice, live IdP
and physically independent security-key certification remain pending. No live tenant
or production deployment was changed. See
`docs/v2.1.0/guides/identity/local-certification.md` for replay steps and scope.

## Latest deep review follow-up — 2026-10-13

Input is archived in `enterprise-sso-2.1-latest-deep-review.md`. The previous pushed
commit's hosted workflow completed successfully. Main's remaining patch `a278116a0`
was incorporated as `161db888a` without merging, rewriting history or creating a PR.

- Staged verification and claims preview accept a securely linked issuer/subject
  without a mutable email claim. New links still require explicit approval and
  provider-appropriate matching email assurance. An existing-binding proof cannot
  recreate a subsequently removed identity. Five signed Entra-style token cases
  exercise linked/unlinked, missing-email and approval combinations against local
  HTTPS/JWKS and PostgreSQL; they do not claim live vendor acceptance.
- Hardware recovery no longer shares an instance-wide budget with unknown accounts
  or legacy password attempts. Known accounts retain bounded ceremony creation;
  browser-bound in-progress ceremonies have three independent verification attempts.
  Foreign browser requests cannot consume those attempts. Reauthentication has a
  separate authenticated-session reserve. A real limiter/signature/database test
  completes recovery after 400 distributed unknown-account and 40 foreign-browser
  failures, including saturation of the account's new-ceremony budget. It also proves
  the verification reserve stops after three failed attempts.
- Security operations create at most 100 immediate recipient alerts. An additive
  `AuthenticationAlertFanout` outbox stores the remainder in the same transaction.
  Workers use cursor pagination and transactional row locks with SKIP LOCKED;
  each pass processes at most five batches of 100. A 1,203-active-administrator
  test completed with two concurrent workers, no duplicate alerts, and about
  19 ms in the measured originating transaction. Each recipient's eligibility is
  checked when its batch is materialized. Anonymous aggregation remains capped.
- Diagnostics is now a focused component with the same session-revocation behavior,
  keyboard support and responsive product controls. Documentation explains staged
  ownership, recovery quotas, targeted-identifier abuse and asynchronous alert delivery.
- Dedicated Enterprise SSO CI runs authentication units/type checking, signed-token
  and WebAuthn database suites, distributed-abuse availability, alert fan-out, and an
  exact published-v2.0.0 upgrade with preserved-session/race checks and load artifacts.

Verification:

- 5,754 unit tests across 756 files passed, four intentional skips; the subsequent
  focused authentication/provider/component run passed all 281 tests.
- 49 PostgreSQL tests across three authentication suites passed; the released-version
  upgrade/race/read-load suite passed 12 tests. The new migration is additive.
- TypeScript, modified-file lint with zero warnings, Prisma schema validation,
  eight deployment/documentation contracts and the optimized standalone build pass.
- Four production HTTPS browser checks pass across Chromium/Firefox/WebKit, with
  two intentional non-Chromium virtual-authenticator skips. The local fixture uses
  a dedicated database role and keeps production secret validation enabled.
- The new HTTP probe performs 400 warmup requests plus 6,000 measured requests in
  three rounds at concurrency 1/10/25/50, all with zero errors. Warm p95 ranges were
  6.7–7.2 ms, 19.0–24.1 ms, 37.0–37.8 ms and 69.4–135.1 ms respectively. This run uses
  one optimized web process, a five-connection database pool, and a local TLS proxy.
  It includes Playwright client overhead and is not directly comparable with the
  previous two-replica Kind topology. No authorization freshness check was weakened.

Artifacts: `certification/enterprise-sso-2.1-resilience.json`,
`certification/enterprise-sso-2.1-http-steady-state.json`, and the refreshed bounded
read artifact. The previous Kind cutover record remains historical evidence for its
recorded source, image and topology. Multi-node/split-runtime failure certification,
real outbound-provider delivery, live IdPs and independent physical-key custody still
require their own acceptance runs. The user's decision to leave live tenants/keys
pending remains in force. These results support the specific tested behavior;
no universal compatibility, zero-downtime or numeric “10/10” certification is claimed.

## Recovery and alert-resilience audit follow-up — 2026-10-13

Input is archived in `enterprise-sso-2.1-recovery-hardening-audit.md`.
The existing branch already contains the two main-branch patches referenced by
that audit; a patch-equivalence comparison found no missing main changes.

- Authorized canonical-origin repair now upserts missing system settings. Both
  existing-row and environment-only installations are tested, including rejection
  of conflicting environment origins, ordinary administrators and stale policy
  versions. SSO Required remains enabled and mandatory evidence commits atomically.
- Already-throttled emergency options, verification and legacy requests increment
  shared counters with at most three event/audit samples per category/five-minute
  window. The local 3,000-request stress test preserved all 3,000 rejections while
  creating three events and three audit rows. Limiter/counter writes still occur;
  ingress limits remain necessary for volumetric traffic.
- The fan-out crash test terminates an actual PostgreSQL worker connection after
  inserts and cursor advancement but before commit. Both roll back. Two workers
  subsequently complete delivery-intent creation for 1,400 eligible administrators
  without duplicates, excluding a removed administrator and a later-created one.
- An aged backlog fixture retains 240 intents representing 30 days and 100 previous
  attempts, reclaims an expired lease, excludes a removed administrator and refuses
  to equate queue acceptance with delivery. It drains only after a simulated
  transport acknowledgment. This is application/database recovery evidence;
  actual provider outages and exhausted provider retries still need acceptance.
- Recovery, throttling and local-certification guides document these behaviors
  and distinguish the local fixtures from external certification.

Verification: all 53 PostgreSQL authentication tests passed on a freshly migrated
isolated schema. The focused authentication/provider/component and agent-container
run passed 286 tests. The earlier full unit run passed 5,753 tests with four skips
and one Docker lifecycle timeout during concurrent heavy workloads; all five tests
in that lifecycle file passed in the focused rerun. TypeScript, zero-warning
modified-file lint, eight deployment/documentation contracts and the optimized
standalone build passed. The refreshed resilience artifact records the measured
local results and explicitly identifies its simulated transport scope.

Live tenant and independent physical-key checks remain pending as requested.
Customer-clone upgrades, multi-node/split-runtime failures and real outbound
provider acceptance remain release acceptance work. These changes do not claim
universal compatibility or a numeric production-readiness certification.

## Claim parity, terminal delivery and edge protection — 2026-10-13

Input: `enterprise-sso-2.1-terminal-delivery-audit.md`.

- Production OIDC login, staged signed-token verification and claims preview now
  share boolean-claim normalization. Existing bindings reject explicit false,
  including string/numeric representations already recognized by production.
  Linked identities retain missing-email and provider-specific missing-claim
  compatibility. Signed-token regressions cover each rejection and acceptance.
- Ineligible recipients receive terminal `cancelledAt` metadata. Workers and the
  dashboard pending count exclude them. Reinstating an administrator cannot revive
  cancelled intents; a regression verifies their attempt count never advances.
  A nullable-column migration preserves existing delivery/pending state and adds
  indexes for selection and retention.
- Scheduled cleanup removes delivered/cancelled intent metadata older than 90 days,
  in batches of at most 1,000 per terminal category. Pending work, events, audits
  and in-app notifications remain untouched; PostgreSQL regressions verify this.
- Sustained local abuse at concurrency 30 retained all 27,090 rejection counts in
  30.03 seconds with three event/audit samples. This is local database evidence,
  not a production distributed-attack capacity guarantee.
- An optional private NGINX edge example limits only emergency API requests.
  Its Docker fixture rejected 989 of 1,000 burst requests before the fixture
  upstream, kept ordinary login available and resumed admission after refill.
  CI runs the same fixture using the recorded pinned image. Documentation explains
  trusted client-address handling, TLS placement, independent edge replicas and
  the need for a protected custodian path during shared-NAT abuse.
- A fresh fetch and patch-equivalence comparison found no unincorporated main
  patches. The numeric behind count reflects earlier cherry-picks; history was
  not merged or rewritten.

Verification: 58 database tests on a freshly migrated isolated schema, 281 focused
unit/component tests, eight deployment/documentation contracts, TypeScript and
zero-warning modified-file lint, Prisma validation and the optimized production
build pass. Edge results are recorded separately from
application resilience in `certification/enterprise-sso-2.1-edge.json`.

Live tenant/key checks remain pending per the user's decision. Customer-clone,
real notification-provider and multi-node/split-runtime acceptance remain scoped
external checks; local fixtures do not certify those environments.

Hosted certification exposed a fixture startup connection-reset race after Docker
published its port. The bounded readiness loop now retries socket startup errors
and fails explicitly if NGINX never becomes ready; measured load errors remain fatal.

## Corrected crash evidence and complete delivery recovery — 2026-10-14

Input: `enterprise-sso-2.1-certification-correction-audit.md`.

The earlier claim of actual backend termination through `adeda2ccc` was invalid:
the test accepted a PostgreSQL argument-type error as its expected exception.
That historical assertion is withdrawn. The corrected test requires a successful
integer-PID termination acknowledgment, a failed operation on the killed connection,
and independent absence from `pg_stat_activity`, before checking alert/cursor
rollback and concurrent recovery. The new artifact records both observations.

- Login, staging and claims preview share organization-boundary claim normalization.
  Seven signed-token domain cases cover boolean, string and numeric true/false and
  missing verification, alongside the existing linked Entra compatibility suite.
- The worker reconciles exhausted/expired FAILED and SKIPPED transport records into
  a terminal failed state. Retryable failures remain pending; UNKNOWN remains under
  central reconciliation. Failed intents leave the automatic polling queue.
- Diagnostics displays a bounded failed-delivery list and confirmation-based retry.
  The action requires fresh authority, rechecks recipient eligibility, locks the
  intent, fences duplicate/stale generations, and commits mandatory audit evidence.
  A new generation rebuilds the transport payload under a new idempotency key.
  Cancelled recipients cannot be revived. Terminal failed metadata uses the same
  bounded 90-day retention as completed/cancelled records; audit evidence is separate.
- Database tests cover terminal cancellation/failure, retryable-state preservation,
  fresh authority, concurrent retries, new keys and delivery acknowledgment. UI
  tests cover confirmation, cancellation and disabled actions during mutation.
- Current main patches are already represented on this branch; a fresh comparison
  found no missing patches. No merge, PR or history rewrite was performed.

Local real-provider delivery, live tenant/key and production multi-node acceptance
are not implied by these fixtures. The user's instruction to leave live tenants
and physical keys pending remains in force.

Verification for this follow-up: 69 PostgreSQL authentication tests passed on a
freshly migrated isolated schema. The full unit suite passed 5,756 tests across
757 files, with four intentional skips; the focused authentication/UI run passed
283 tests. TypeScript, modified-file lint with zero warnings, Prisma schema
validation and eight deployment/documentation contracts passed. The real central
enqueue regression verifies rebuilt encrypted payloads and deduplication across
worker passes; only the final delivery acknowledgment is simulated.

The optimized production build also passed. The dedicated hosted workflow includes
the new diagnostics component regression and all signed-token/database cases.
