# PR #886 review dispositions

This records the review of `c52a7190a` and its fixes after rebasing onto
`2c38d4a4e`. It is not a full enterprise API or load/HA certificate.

## Published-release upgrade

The current Prisma client inserts defaults for newly added columns even when a
create selects only `id`. The certification script now generates a separate
client from the published baseline schema and uses it only for baseline seeding.
It then deploys the current migrations and runs the current-client verification.
Generation uses installed dependencies with automatic installation disabled;
the temporary schema and client are removed on exit. The database-name guard and
already-upgraded guard remain enforced. The complete upgrade test passed locally
against isolated PostgreSQL with `SSO_CERT_AUTH_LOAD=1`: all 12 tests passed,
including preserved legacy data/sessions and concurrent authentication reads.

## Automation browser credentials

The auditor fixture now uses `generateApiKey()` and stores its returned prefix
and hash. Playwright workers and the application share the same API-key secret,
including when CI supplies a custom value. Production token-shape validation is
unchanged. All 28 production-browser tests passed across desktop, Pixel 5,
iPhone 13 and iPad Pro, with a custom API-key secret supplied as in CI.

## CodeQL alert 5190

Disposition: false positive for `js/insufficient-password-hash` in
`src/lib/auth-abuse.ts`. Inspected CodeQL analysis `1971806796` (PR merge commit
`430bc36643459acdd77374cdaafd2f88d0277d69`) and its SARIF code flows.

The source is the object returned by `createEmergencyAccount()` in
`tests/integration/emergency-password-database.test.ts` (lines 67 and 69 in the
reviewed revision). The traced accesses are `first.id` and `second.id`, passed as
`accountId` to `passwordEmergencyLogin()`, then to `consumeAuthRateLimit()`.
CodeQL classifies the returned object as a password source although the selected
property is the database account identifier. The rate-limit helper HMACs that
identifier to avoid storing it in cleartext; its output is never a password
verifier. The concurrency test exercises the actual rate-limit implementation.

Actual emergency passwords are generated with 256 random bits, stored using
scrypt (`N=32768`, `r=8`, `p=3`) with an independent 128-bit salt, and verified
through `verifyEmergencyPassword()` with a timing-safe comparison. The password
crypto tests pass. No password-hashing algorithm, authentication check, scan
configuration, or global rule suppression was changed.

## Checkov alerts 5424–5429

The two Compose fixtures require an operator-supplied, URL-safe isolated database
password. PostgreSQL, PgBouncer, application processes and migration commands use
the same required value. Missing values fail Compose interpolation.

The k6 Pod uses the verified ARM64 image digest with `Always` pull policy,
`RuntimeDefault` seccomp, and probes for its idle process and writable work volume.
These probes do not certify load outcomes. The image architecture and registry
access requirements are documented.

A targeted Checkov scan reproduced both `CKV_SECRET_4` findings on the original
Compose files. The modified files have zero such findings; all four targeted
Kubernetes checks pass without skips or exemptions. The local repository-wide
scan additionally found an existing `CKV_K8S_15` finding in the agent deployment;
that is outside these six reviewed findings and is not presented as a full clean
repository scan.

## Scope accuracy

Automation is integrated in this branch. Settings GET/PATCH, service draft
GET/PUT and publication POST bring the registry to 89 operations. Effective
configuration, validation, simulation, modes, restore, history, diagnostics and
the remaining enterprise endpoint families are still unfinished. The workflow
inventory and implementation tracker retain those release blockers.

## Follow-up review of 53e86ca

Publication and restore now reject LIVE mode with 409 in the shared domain
command. UI and API use that command. Operators must explicitly leave LIVE,
publish, then qualify and acknowledge activation of the new revision. The service
lock serializes this check with mode changes; failed publication leaves the
previous version, mode and committed audit intact. Emergency disable remains
available. The UI disables publication while LIVE and explains the transition.

The capability catalog has a `partial` status and associates all five implemented
automation operation IDs. Publication returns immutable version identity without
an ETag. The OpenAPI description explains that the request uses the draft ETag
and the next draft mutation requires a fresh draft read. Success-oriented logs
inside caller-owned transactions are renamed to staged events.

Replay semantics are documented in `domain-command-standard.md`. Direct REST
tests cover a changed concrete revision header on replay, revoked credentials,
insufficient publication scope, stale/weak/wildcard validators, competing
publications, and publication while LIVE. The ingestion concurrency regression
verifies that rejected LIVE publication keeps all new decisions on the qualified
version. Fixture cutovers now explicitly disable, publish and reactivate.

The completed prior CI suite is recorded with individual check URLs in
`ci-53e86ca.json`: 50 successful, 10 skipped and one neutral. That certificate
applies to 53e86ca, not subsequent source changes. Full feature parity, 1/2/4
replica load/HA, rolling-version coexistence and the complete API-13–API-24
release gates remain outstanding.

Local follow-up verification: production build and TypeScript passed; changed-file
ESLint passed with zero warnings. REST transaction certification passed 21 tests;
automation lifecycle/dependency suites passed 51 with one opt-in scenario skipped.
The four-device production browser matrix passed all 32 tests against two
application replicas, including SDK settings/draft/publication, UI activation,
HTTP event ingestion, pinned decision/incident verification, LIVE publication
denial and credential revocation. This is functional cross-replica evidence,
not a sustained load or failover certificate. Focused component, capability,
workflow-inventory, OpenAPI, mutation-contract and SDK suites passed.

## Worker-backed review of 6ebbeb75

The failing browser job expected shadow evidence from web-only processes. The
production topology now includes two web replicas and a real general worker.
The browser waits for its incident-specific observation job to complete. A
fixture-owned trigger rejects the desktop observation's first aggregate write;
the test verifies queued backoff and absent evidence, then completion on attempt
two with one aggregate. Evidence is never inserted by the browser fixture.

Following the real chain exposed two UI defects: activation loaded an overview
representation without snapshots, and discard sent a precondition rejected by
its strict schema. Review now loads full snapshots, and discard sends only its
candidate precondition. Both have regression tests.

Activation requires an explicit material-difference approval and records current
seven-day counters and acknowledgments transactionally. Errors and fallbacks are
shown separately. Candidate REST/UI views expose daily evidence freshness and a
bounded pending observation sample. Activation/discard application logs are
staged events; the database audit remains authoritative.

All 32 production browser cases passed against two web replicas and a general
worker with no skips or flaky cases. The PostgreSQL checks passed 64 tests with
one opt-in skip; Python SDK checks passed nine tests. Local worst-count candidate
latency measurements and their limitations are committed separately. The source
input digests and observation job timing/attempt evidence are in
`candidate-worker-certification.json`. The trackers now report eight automation
operations and 92 total operations, with a drift check against the registry.

This does not close all M0 acceptance scenarios, M1–M5 endpoint work, production
latency approval or load/HA certification. The current source needs a new CI run.

### Automation control plane follow-up (local checks passed; CI pending)

The registry now contains 101 operations, including 17 automation operations. The
nine new operations cover effective configuration, validation, simulation, mode
changes, immutable history/detail, historical restoration into an editable draft,
routing decisions and safe observation metadata. This is implementation status;
production certification and the remaining enterprise domains are still open.

Mode writes use a dedicated configuration revision advanced by a database trigger
for every writer, independently of the draft revision. Restoration uses the draft
revision, service/team locks, canonical credential-attributed audit and durable
idempotency. Restoration does not publish or change active/candidate pointers;
subsequent edits preserve historical lineage for explicit publication.

Simulation and validation share the UI's domain functions and production evaluator.
They persist no operational state. Public simulation omits received/enrichment
values and provider payloads. Decision history requires both automation and incident
read scopes and applies the incident visibility filter. Observations expose field
metadata, unmapped flags and frequencies; raw previews and value hashes are never
selected. Discovery pagination uses immutable first-seen timestamps and IDs, with a
supporting index, so counter updates do not move rows between pages.


Verification: 36 browser cases passed across all four device profiles with two web
replicas and an actual general worker; 124 PostgreSQL tests passed with one opt-in
case skipped; 521 broad unit tests passed; 12 upgrade/authentication checks passed.
Both TypeScript and Python exercised the production application over HTTP, including
all nine new automation operations through Python. Generated clients, typecheck,
changed-source lint and the production build passed. Source digests and per-device
API-only/worker evidence are in `automation-m1-certification.json`. This remains
local verification; latest-commit CI and all remaining enterprise domains and
production acceptance gates remain open in the same PR.

### Deep audit at 654b0ed32 — suppression comparison

Candidate comparisons now compare intentional suppression in both directions and
resolve explicit/default policy choices to their effective policy identity.
Unchanged `NO_ESCALATION` is the same outcome; newly introduced or removed
suppression is a route/suppression difference, including when no default policy is
configured. A priority-only change does not manufacture a suppression difference.
Active evaluator fallback compares against the actual service-default route.

Verification: seven focused comparison cases and 144 automation unit cases passed.
Three PostgreSQL cases execute the real preparation/persistence and observation
worker handler, verify its aggregates, preserve LIVE routing, and verify the
canonical activation acknowledgment behavior. No aggregate rows are injected by
these regression cases. Existing historical aggregate rows are not rewritten;
the correction applies to newly evaluated traffic.

The Explorer's obsolete endpoint-count assertion and Teams queue-state race were
corrected in f33870f67. Its 708 Explorer tests and 12 provider/device browser cases
passed locally. Latest-commit CI, readiness policy, candidate isolation, storage
privacy and remaining enterprise API coverage are still separate open items.

### Deep audit — discovery storage minimization

Observation previews are now default-off and administrator-controlled through the
existing database/UI/REST settings command. New durable observation jobs omit raw
preview scalars by default; retained identities use a service-scoped keyed hash.
Configured mappings, discovery traversal and legacy worker input exclude recognized
contact/credential data. Preview opt-out scrubs stored rows and durable payloads;
shared settings locks fence concurrent enqueue/worker writes. The alias UI disables
mapping from a missing/redacted preview and preserves recorded normalization counts.

The upgrade intentionally resets legacy discovery sample rows and clears old job
observation arrays. This removes unkeyed hashes/raw samples; published routing,
active pointers and shadow aggregates are preserved. A populated upgrade from
35938aeb3 passed against isolated PostgreSQL; evidence is in
`automation-privacy-upgrade.json`. The classifier is deliberately bounded and is
not a general personal-data guarantee. Broader retention/export/deletion and
production privacy acceptance remain part of the overall release gates.

### Deep audit — shared automation mutation authorization

Draft writes, publication, candidate discard and candidate activation now use the
same `requireAutomationService` boundary as the newer mode/restoration operations.
It acquires the canonical service advisory lock, fences service reassignment with
a shared service-row lock, and holds the responder's team-membership row through
the transaction. Replay guards join the same transaction and repeat this check.

Thirteen PostgreSQL lifecycle cases passed, including successful draft replay,
revoked membership and reassigned service ownership denying the same cached result.
The 122 focused authorization/OpenAPI/mutation-contract tests, typecheck and changed
route lint passed. Applicable read permissions remain organization-wide under the
existing role policy; no new read restriction was invented by this refactor.

### Candidate readiness policy (follow-up to the 654b0ed32 audit)

Candidate activation now reads a database-managed policy shared by REST and the
Automation Workspace. Defaults require 100 evaluations within the seven-day
window, a latest daily evidence bucket no older than 48 hours, no pending or
processing observations for that service/candidate, and zero errors. Daily
buckets provide coarse freshness, not an event-time guarantee. These defaults
are a review floor, not proof that traffic represents a production workload.

Administrators can change the four bounded policy fields in system settings.
A database trigger advances the settings revision for direct policy writes as
well as application writes. The UI submits the reviewed settings revision; REST
clients can submit `expectedReadinessPolicyRevision` to reject stale reviews with
412. This field remains optional for existing client compatibility. Activation
rechecks the current policy under its transaction locks in either case.

An invalid stored policy or excess candidate backlog blocks activation. Existing
`acknowledgeNoShadow` explicitly accepts insufficient sample volume or stale
evidence; `acknowledgeShadowErrors` accepts an error-rate exception. Material
routing changes still require their separate acknowledgment. The canonical
activation audit records the exact policy, settings revision, evidence, pending
count and exception flags transactionally with the activation and API replay.
The error rate uses the maximum of overlapping error/fallback counters, avoiding
double-counting the same failed evaluation.

Upgrading installs the policy defaults without replacing published versions or
changing LIVE routing. Candidates with a single historical observation now need
an explicit insufficient-evidence exception. This policy governs candidate
activation; the separate mode-change command retains its existing contract.
Candidate isolation, deployment-specific load/HA acceptance and the remaining
enterprise domain APIs remain open.

### Runbook metadata and lifecycle endpoint delivery

Eight operations now wrap the shared UI lifecycle and comparison commands:
privileged metadata reads (including archived and unpublished runbooks), metadata
updates, archive, restore, deletion eligibility, permanent deletion, duplication
and redacted version comparison. These administrative operations require both
`runbooks:write` and the administrator runbook-management capability. The normal
published-library read contract remains available with `runbooks:read`.

Every lifecycle mutation requires an idempotency key and a concrete source
metadata ETag, checked under the same parent lock used by UI authoring and
execution. The existing database trigger advances that revision for all writers.
A duplicate's response ETag identifies the new copy, while its request If-Match
identifies the source. A successful delete can be replayed after the row is gone;
revoked credentials and demoted actors cannot retrieve the cached response.

Archive disables service bindings and dismisses outstanding suggestions. Natural
archive/restore repeats do not repeat audits or timestamp changes. Restore leaves
bindings disabled. Deletion eligibility is advisory: the command rechecks under
lock and permanently deletes only a never-published draft without bindings or
execution history, after typed confirmation. Published and retired evidence is
retained. Duplication creates a separate editable version and preserves canonical
input definitions, ownership and tags through the existing domain command.

Version comparison reuses the UI impact engine, validates both versions belong
to the parent, and returns only structural step summaries and input-key changes.
It omits executable configuration, input defaults and secret references. Service
rule impact is bounded to 500 records, with explicit truncation. Version diffs
are static review information, not execution approval or activation evidence.

This delivers the metadata/lifecycle endpoint set in section 3A of the plan;
service rules, approvals/reruns, agent and secret administration, and combined
runbook certification remain unfinished. The capability catalog and workflow
inventory retain that distinction and leave enterprise release gates open.

### Follow-up to the review of c8dfb154 (observation replay and emergency OFF)

Observation receipts now derive from service ID plus the immutable logical job
key, rather than mutable JSON. A PostgreSQL crash-window regression processes a
preview-enabled job, commits receipts/aggregates and payload scrubbing while the
source remains PROCESSING, reclaims it, and verifies both observed counts and
candidate aggregate totals remain one. This prevents new duplicate processing;
it cannot repair evidence already double-counted by older workers. Complete all
worker upgrades before relying on the corrected receipt contract.

Emergency OFF commits the switch, mode resets, canonical settings audit and a
durable AUTOMATION_PRIVACY_CLEANUP job without rewriting diagnostic tables. The
existing queue tracks pending/failed/completed cleanup and retries. Cleanup
failure cannot undo the OFF transaction. UI reads redact previews while storage
is disabled, and enqueue/worker writes retain their privacy fences. An unrelated
retention save while previews are already OFF skips historical cleanup. Explicit
preview opt-out while automation remains enabled keeps its existing atomic
cleanup contract. Invalid global enablement is a structured RESOURCE_CONFLICT.

Runbook creation returns the final updated row after draft attachment. The shared
metadata command accepts an expected revision; the UI form submits it and REST
retains its locked ETag check. Tests compare creation with immediate PostgreSQL
reads and reject stale UI/domain edits. UI discovery selects an explicit DTO
without internal HMACs. Recovery copies use actor-plus-service keys; legacy
service-only copies are discarded instead of offered to a different account.

These fixes do not certify mixed-version rollout, repair historical evidence,
prove production candidate isolation, or finish remaining enterprise API domains.

### Service runbook rules (coverage plan section 3B)

Twelve REST operations now expose shared binding, trigger, policy-check and
activation commands. Rule read, configuration and activation scopes are explicit
and ADMIN-only, matching existing UI authority; broad admin scope is insufficient.
Collection responses omit inputs and triggers; privileged details are bounded,
no-store representations and never resolve secret references. Policy-check lists
exclude frozen inputs, step definitions and raw Agent results. Requests return
durable pending check IDs. The authenticated private Agent protocol is unchanged.

Existing-resource mutations require concrete revision ETags and durable replay.
Configuration and nested trigger/condition writes advance database revisions and
pause Automatic rules. Activation rechecks immutable version, target authority and
current policy evidence under shared command locks. Detach retains evidence;
duplicates are independent paused configurations. Already-paused calls do not
repeat audit or revision side effects. Canonical audit and replay share the domain
transaction, including rollback when audit insertion fails.

Local evidence covers negative permissions, revocation/demotion on replay,
concurrent stale writes, nested legacy writes, current/stale Agent policy hashes,
rollback, schema/privacy bounds, both live SDKs and six Chromium/Firefox/WebKit
UI journeys. The populated upgrade preserves existing pinned configuration and
only fences subsequent writes. See runbook-rules-certification.json; this does
not certify mixed-version rollout, the remaining runbook control plane, or the
complete enterprise plan. Release gates remain open.

### Execution approval command preparation (section 3C)

The existing UI approval command can now join a caller-owned transaction and
attribute its canonical business audit to an API credential. Plan digest checks,
step compare-and-set, parent execution transition, advance job and audit remain
one atomic operation. The existing UI call signature and approval policy are
unchanged. PostgreSQL tests exercise outer rollback, one canonical attributed
event, repeated decisions and stale digests; the existing execution safety suite
checks cancellation/approval races. This is shared-domain preparation, not a
claim that the seven approval/intervention REST endpoints are implemented.

The rule revision fence also requires older execution fixtures to explicitly
activate their completed configuration and read the resulting database-owned
revision. Runtime safety and preview authorization assertions remain intact;
negative preview cases now refresh unrelated revision state so each rejection
exercises its intended boundary. Coverage: 176 passing cases in the other 14
PostgreSQL suites plus all 37 passing preview authorization cases, and 31 UI
action unit cases. Evidence is in runbook-approval-transaction-preparation.json.

GitHub CI initially tested a cleanly merged tree with duplicate imports because
main and this branch added the same domain error import in different places.
Matching main's import placement removes that duplicate without changing either
branch's business behavior. A disposable merged worktree passes strict typecheck and production build;
latest remote CI must still rerun successfully before readiness.

### Follow-up to review of 048a33fd8 / 4b6b0fe9

The trigger contract is one enabled configuration per rule/event. Disabled
historical trigger identities remain for execution and suggestion references.
A partial PostgreSQL unique index enforces the active invariant for every writer.
The populated upgrade pauses every ambiguous group and its parent rule, records
a system audit with the previous identities, and preserves conditions. It never
chooses which legacy conditions should win. Explicit trigger replacement prefers
the existing active record and retires any competing enabled records under the
shared lock. Operators must review and reactivate paused ambiguous rules.

Deferred emergency-OFF privacy cleanup now processes at most 200 observations
and 200 queued payloads per transaction. Partial indexes locate remaining work.
A durable batch receipt and deterministic continuation commit with scrubbing,
so failures roll back only one batch and post-commit redelivery cannot duplicate
continuations. The settings lock fences opt-in changes; later opt-in supersedes
old cleanup. The administrator System Settings UI displays pending/completed/
failed status and batch progress, with an authorized audited retry action. Raw
worker errors and diagnostic values are not exposed in status responses. Explicit
preview opt-out retains its existing synchronous transaction behavior.

Fault injection covers three failed attempts after a completed batch, recovery,
post-commit replay, exact clearing, superseded cleanup and manual retry rejection
while opted in. Browser coverage includes failed-state visibility, administrator
retry, real worker completion and opt-out across four device profiles. The live
HTTPS Compose Agent workflow now explicitly activates its configured Automatic
fixture. UI revision assertions read committed revisions rather than assuming
that nested trigger writes advance exactly once.

The source inventory labels local rule sources as baseline, matching its existing
admission contract. Repository-wide lint failures also exist in files and lint
configuration unchanged from current main; those release blockers are recorded
separately, without relaxing checks. The complete endpoint plan, candidate
isolation and production certification remain unfinished. Daily readiness
evidence continues to mean conservative daily-bucket freshness, not exact event
freshness. See review-048a33fd8-remediation.json and runbook-trigger-upgrade.json.
