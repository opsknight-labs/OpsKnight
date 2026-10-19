/**
 * Mutation safety contract for REST v2.
 *
 * Every POST, PATCH, PUT and DELETE operation is classified by what a retry can
 * do, so retry behaviour is a reviewed decision rather than an accident of how a
 * route happened to be written. tests/unit/api-v2-mutation-contract.test.ts fails
 * if a mutating route exists without an entry here, or if an entry's declared
 * idempotency is not backed by the route's implementation.
 *
 * Idempotency
 * - `required`   A duplicate would cause dangerous repeated work; the request is
 *                rejected without an Idempotency-Key.
 * - `supported`  Idempotency-Key is honoured. A replay returns the original result
 *                with `Idempotency-Replayed: true`, with no second side effect or
 *                audit record. Keys are scoped to (credential, operation) and
 *                retained for 7 days (the completed-job retention window); after
 *                that a reused key executes again. Reusing a key with a different
 *                body or a different normalized required If-Match revision returns 409 IDEMPOTENCY_KEY_CONFLICT.
 * - `natural`    Repeating the request cannot duplicate work: it sets state to the
 *                same value, is a compare-and-set, or is rejected by a uniqueness
 *                rule (409/404 on repeat).
 * - `never`      Deliberately not replayable. Used when the response carries a
 *                one-time secret that must not be stored for replay.
 *
 * Concurrency
 * - `etag`  Detail reads return an ETag; If-Match makes the write conditional
 *           (412 PRECONDITION_FAILED if the resource changed).
 * - `none`  Last write wins, or the operation does not edit shared state.
 */
export type IdempotencyMode = 'required' | 'supported' | 'natural' | 'never';
export type ConcurrencyMode = 'etag' | 'none';

export interface MutationContract {
  idempotency: IdempotencyMode;
  concurrency: ConcurrencyMode;
  preconditionRequired?: boolean;
  /** False when a conditional command returns a different resource than its input validator. */
  responseEtag?: boolean;
  rationale: string;
}

const natural = (rationale: string, concurrency: ConcurrencyMode = 'none'): MutationContract => ({
  idempotency: 'natural',
  concurrency,
  rationale,
});
const supported = (rationale: string): MutationContract => ({
  idempotency: 'supported',
  concurrency: 'none',
  rationale,
});

export const V2_MUTATION_CONTRACT: Record<string, MutationContract> = {
  ...Object.fromEntries(
    [
      'PUT /api/v2/teams/[id]/members/[userId]',
      'DELETE /api/v2/teams/[id]/members/[userId]',
      'PUT /api/v2/teams/[id]/lead',
    ].map(operation => [
      operation,
      {
        idempotency: 'required' as const,
        concurrency: 'etag' as const,
        preconditionRequired: true,
        rationale:
          'Concrete parent Team revision covers all membership writers. Shared UI/REST commands preserve active owners and SCIM ownership. Mutation, attributed audit, notification and receipt commit together. Replay rechecks current role and team ownership.',
      },
    ])
  ),
  'POST /api/v2/runbooks/signing-identities/[id]/retire': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Reviewed active identity in the body and state compare-and-set fence rotation. Canonical attributed audit and public-metadata replay commit together under the signing lock. All Agent pin acknowledgements and 24-hour grace remain mandatory.',
  },
  'POST /api/v2/runbooks/signing-identities/[id]/activate': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Reviewed active identity in the body and state compare-and-set fence rotation. Canonical attributed audit and public-metadata replay commit together under the signing lock. All Agent pin acknowledgements and 24-hour grace remain mandatory.',
  },
  'POST /api/v2/runbooks/signing-identities': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Reviewed active identity in the body and state compare-and-set fence rotation. Canonical attributed audit and public-metadata replay commit together under the signing lock. All Agent pin acknowledgements and 24-hour grace remain mandatory.',
  },
  'POST /api/v2/runbooks/agent-pools/[id]/retire': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Retirement, disabled bindings, canonical audit and retry receipt commit together. History is preserved; database guards reject new assignments by older writers too.',
  },
  'POST /api/v2/runbooks/agent-pools': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Canonical audit and mutation commit with durable credential-scoped replay. Concrete configuration revision fences updates; secret input fingerprints are keyed by the authenticated credential and responses contain metadata only.',
  },
  'PATCH /api/v2/runbooks/agent-pools/[id]': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Canonical audit and mutation commit with durable credential-scoped replay. Concrete configuration revision fences updates; secret input fingerprints are keyed by the authenticated credential and responses contain metadata only.',
  },
  'DELETE /api/v2/runbooks/agent-pools/[id]': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    responseEtag: false,
    rationale:
      'Canonical audit and mutation commit with durable credential-scoped replay. Concrete configuration revision fences updates; secret input fingerprints are keyed by the authenticated credential and responses contain metadata only.',
  },
  'PUT /api/v2/runbooks/agent-pools/[id]/members/[agentId]': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Canonical audit and mutation commit with durable credential-scoped replay. Concrete configuration revision fences updates; secret input fingerprints are keyed by the authenticated credential and responses contain metadata only.',
  },
  'DELETE /api/v2/runbooks/agent-pools/[id]/members/[agentId]': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Canonical audit and mutation commit with durable credential-scoped replay. Concrete configuration revision fences updates; secret input fingerprints are keyed by the authenticated credential and responses contain metadata only.',
  },
  'PATCH /api/v2/runbooks/agents/[id]/configuration': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Canonical audit and mutation commit with durable credential-scoped replay. Concrete configuration revision fences updates; secret input fingerprints are keyed by the authenticated credential and responses contain metadata only.',
  },
  'POST /api/v2/runbooks/secrets': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Canonical audit and mutation commit with durable credential-scoped replay. Concrete configuration revision fences updates; secret input fingerprints are keyed by the authenticated credential and responses contain metadata only.',
  },
  'POST /api/v2/runbooks/secrets/[id]/rotate': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Canonical audit and mutation commit with durable credential-scoped replay. Concrete configuration revision fences updates; secret input fingerprints are keyed by the authenticated credential and responses contain metadata only.',
  },
  'POST /api/v2/runbooks/secrets/[id]/grants': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Canonical audit and mutation commit with durable credential-scoped replay. Concrete configuration revision fences updates; secret input fingerprints are keyed by the authenticated credential and responses contain metadata only.',
  },
  'DELETE /api/v2/runbooks/secrets/[id]/grants/[grantId]': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    responseEtag: false,
    rationale:
      'Canonical audit and mutation commit with durable credential-scoped replay. Concrete configuration revision fences updates; secret input fingerprints are keyed by the authenticated credential and responses contain metadata only.',
  },
  'PATCH /api/v2/settings/runbooks': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Canonical audit and mutation commit with durable credential-scoped replay. Concrete configuration revision fences updates; secret input fingerprints are keyed by the authenticated credential and responses contain metadata only.',
  },

  'POST /api/v2/runbooks/agent-enrollments': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Enrollment and canonical audit commit with a metadata-only replay receipt. Only the initial committed response discloses the token; every replay returns token null. No plaintext enrollment token is stored in the journal.',
  },
  'POST /api/v2/runbooks/agents/[id]/revoke': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Terminal conditional revocation, canonical audit and replay commit atomically. Requests with different keys do not repeat the business event. Existing lease reconciliation remains authoritative.',
  },

  'POST /api/v2/runbooks/executions/[id]/rerun-preview': natural(
    'Preview revalidates the current source/rule/target policy without starting execution.'
  ),
  'POST /api/v2/runbooks/executions/[id]/rerun': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Exact preview plan digest and authorization token fence the current execution plan. New run, canonical audit, durable job and replay commit together. Replays reauthorize source access.',
  },
  'POST /api/v2/runbooks/executions/[id]/steps/[stepId]/approve': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Reviewed planDigest body and waiting-state conditional transition fence the decision. State, canonical audit, job and replay commit atomically. Replays reauthorize source access.',
  },
  'POST /api/v2/runbooks/executions/[id]/steps/[stepId]/reject': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Reviewed planDigest body and waiting-state conditional transition fence the decision. State, canonical audit, job and replay commit atomically. Replays reauthorize source access.',
  },
  'POST /api/v2/service-objectives': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Explicit expectedActiveVersionId body fence (null for an empty slot). Slot lock, immutable definition, canonical audit and replay commit atomically; a mismatched active version returns 412.',
  },
  'PATCH /api/v2/service-objectives/[id]': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Concrete revision fences immutable version replacement. Definition retirement/new version, canonical audit and replay commit together.',
  },
  'POST /api/v2/service-objectives/[id]/archive': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Concrete revision fences retirement; archived state changes the strong ETag. Immutable history and snapshots remain readable. Canonical audit and replay commit with retirement.',
  },
  'POST /api/v2/service-objectives/[id]/evaluate': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Body identifies the immutable version to evaluate. Quota admission, durable job, request audit and replay commit together. The worker reauthorizes and commits its recorded outcome and audit together; inspect the job for eventual measurement availability.',
  },
  'POST /api/v2/status-pages/[id]/publication/retry': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    responseEtag: false,
    rationale:
      'Concrete configuration revision at acceptance. Queue job, request audit and replay record commit atomically. Publication executes after commit in the general worker; canonical business audit and completion receipt commit together. Replays return the accepted job; inspect job and publication state for eventual outcome.',
  },
  'PUT /api/v2/status-pages/[id]/services': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Absolute reviewed service membership replacement uses shared publication command and concrete all-writer revision. A new retry key with a stale revision returns 412; matching keys replay committed metadata. canonical audit commits with configuration/serving-state change.',
  },
  'PATCH /api/v2/status-pages/[id]/services/[serviceId]': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Page-wide revision fences the read-modify-write of supported service presentation. Nested ownership, bounded membership and publication privacy safeguards are enforced.',
  },
  'PATCH /api/v2/status-pages/[id]/appearance': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Absolute settings replacement uses the shared publication command. New keys with stale configuration revisions return 412; matching keys replay committed metadata. Canonical API-attributed audit commits with configuration and serving-state changes; persistence and public publication status are reported separately. The mandatory Idempotency-Key record commits in the same shared transaction as configuration and canonical audit. Publication is read after commit; replays do not repeat configuration changes.',
  },
  'PATCH /api/v2/status-pages/[id]/privacy': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Absolute settings replacement uses the shared publication command. New keys with stale configuration revisions return 412; matching keys replay committed metadata. Canonical API-attributed audit commits with configuration and serving-state changes; persistence and public publication status are reported separately. The mandatory Idempotency-Key record commits in the same shared transaction as configuration and canonical audit. Publication is read after commit; replays do not repeat configuration changes.',
  },
  'PATCH /api/v2/status-pages/[id]/content': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Absolute settings replacement uses the shared publication command. New keys with stale configuration revisions return 412; matching keys replay committed metadata. Canonical API-attributed audit commits with configuration and serving-state changes; persistence and public publication status are reported separately. The mandatory Idempotency-Key record commits in the same shared transaction as configuration and canonical audit. Publication is read after commit; replays do not repeat configuration changes.',
  },
  'PATCH /api/v2/status-pages/[id]/settings': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Absolute settings replacement uses the shared publication command. New keys with stale configuration revisions return 412; matching keys replay committed metadata. Canonical API-attributed audit commits with configuration and serving-state changes; persistence and public publication status are reported separately. The mandatory Idempotency-Key record commits in the same shared transaction as configuration and canonical audit. Publication is read after commit; replays do not repeat configuration changes.',
  },
  'DELETE /api/v2/status-pages/[id]/subscribers/[subscriberId]': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Administrator-only explicit subscriber scope. Revocation, pending notification suppression, canonical audit and durable replay commit atomically. Natural repeat does not renew consent or repeat audit.',
  },
  'POST /api/v2/services/[id]/runbook-rules': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Explicit rule administration scope. Nested parent, current revision and lifecycle references are checked under the shared Runbook-then-rule locks; canonical audit, durable work and replay commit together. Configuration edits pause Automatic rules; activation recomputes current target and local-policy evidence.',
  },
  'PATCH /api/v2/services/[id]/runbook-rules/[ruleId]': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Explicit rule administration scope. Nested parent, current revision and lifecycle references are checked under the shared Runbook-then-rule locks; canonical audit, durable work and replay commit together. Configuration edits pause Automatic rules; activation recomputes current target and local-policy evidence.',
  },
  'DELETE /api/v2/services/[id]/runbook-rules/[ruleId]': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    responseEtag: false,
    rationale:
      'Explicit rule administration scope. Nested parent, current revision and lifecycle references are checked under the shared Runbook-then-rule locks; canonical audit, durable work and replay commit together. Configuration edits pause Automatic rules; activation recomputes current target and local-policy evidence.',
  },
  'POST /api/v2/services/[id]/runbook-rules/[ruleId]/validate': {
    idempotency: 'natural',
    concurrency: 'none',
    rationale:
      'Read-only current domain readiness; does not execute, enqueue, audit or reserve a replay key.',
  },
  'POST /api/v2/services/[id]/runbook-rules/[ruleId]/policy-checks': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    responseEtag: false,
    rationale:
      'Explicit rule administration scope. Nested parent, current revision and lifecycle references are checked under the shared Runbook-then-rule locks; canonical audit, durable work and replay commit together. Configuration edits pause Automatic rules; activation recomputes current target and local-policy evidence.',
  },
  'POST /api/v2/services/[id]/runbook-rules/[ruleId]/activate': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Explicit rule administration scope. Nested parent, current revision and lifecycle references are checked under the shared Runbook-then-rule locks; canonical audit, durable work and replay commit together. Configuration edits pause Automatic rules; activation recomputes current target and local-policy evidence.',
  },
  'POST /api/v2/services/[id]/runbook-rules/[ruleId]/pause': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Explicit rule administration scope. Nested parent, current revision and lifecycle references are checked under the shared Runbook-then-rule locks; canonical audit, durable work and replay commit together. Configuration edits pause Automatic rules; activation recomputes current target and local-policy evidence.',
  },
  'POST /api/v2/services/[id]/runbook-rules/[ruleId]/duplicate': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Explicit rule administration scope. Nested parent, current revision and lifecycle references are checked under the shared Runbook-then-rule locks; canonical audit, durable work and replay commit together. Configuration edits pause Automatic rules; activation recomputes current target and local-policy evidence.',
  },
  'PUT /api/v2/services/[id]/runbook-rules/[ruleId]/triggers': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Explicit rule administration scope. Nested parent, current revision and lifecycle references are checked under the shared Runbook-then-rule locks; canonical audit, durable work and replay commit together. Configuration edits pause Automatic rules; activation recomputes current target and local-policy evidence.',
  },

  'PATCH /api/v2/runbooks/[id]': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Runbook parent revision is checked under the shared lifecycle lock; domain state, canonical audit and replay commit atomically. Existing lifecycle dependencies and disabled-binding restoration rules apply.',
  },
  'POST /api/v2/runbooks/[id]/archive': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Runbook parent revision is checked under the shared lifecycle lock; domain state, canonical audit and replay commit atomically. Existing lifecycle dependencies and disabled-binding restoration rules apply.',
  },
  'POST /api/v2/runbooks/[id]/restore': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Runbook parent revision is checked under the shared lifecycle lock; domain state, canonical audit and replay commit atomically. Existing lifecycle dependencies and disabled-binding restoration rules apply.',
  },
  'DELETE /api/v2/runbooks/[id]': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    responseEtag: false,
    rationale:
      'Runbook parent revision is checked under the shared lifecycle lock; domain state, canonical audit and replay commit atomically. Deletion preserves published/execution evidence and requires typed confirmation.',
  },
  'POST /api/v2/runbooks/[id]/duplicate': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Runbook parent revision is checked under the shared lifecycle lock; domain state, canonical audit and replay commit atomically. Duplicate checks the source revision and returns the new independent resource.',
  },

  'POST /api/v2/services/[id]/automation/validate': natural(
    'Read-only compilation and reference validation; creates no state or replay record.'
  ),
  'POST /api/v2/services/[id]/automation/simulate': natural(
    'Read-only evaluation; never creates incidents, notifications, observations or replay records.'
  ),
  'POST /api/v2/services/[id]/automation/restore': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Restores an immutable service-owned version to an editable draft under the service lock; draft revision, origin, audit and replay commit atomically.',
  },

  'PATCH /api/v2/services/[id]/automation/mode': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Uses the effective configuration ETag, not the draft revision. The canonical mode command fences global OFF, validates references and LIVE readiness, and commits state, audit and replay atomically.',
  },
  'POST /api/v2/services/[id]/automation/publish': {
    idempotency: 'required',
    concurrency: 'etag',
    responseEtag: false,
    preconditionRequired: true,
    rationale:
      'Publish checks the draft ETag and active version under the canonical service lock, validating dependencies and committing immutable version, audit and replay together.',
  },
  'DELETE /api/v2/services/[id]/automation/candidate': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Candidate discard clears candidateVersionId under service lock, committing clear, audit and replay together.',
  },
  'POST /api/v2/services/[id]/automation/candidates/activate': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Candidate activation validates global switch, live mode, policy safety and shadow metrics under service lock, committing atomic cutover, audit and replay together.',
  },
  'PUT /api/v2/services/[id]/automation/draft': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Shared versioning command, team authorization, revision check, audit and replay share one transaction.',
  },
  'PATCH /api/v2/settings/automation': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale:
      'Global kill switch, mode reset, audit and replay commit together under the settings lock.',
  },
  'POST /api/v2/incidents/[id]/watchers': {
    idempotency: 'required',
    concurrency: 'none',
    rationale: 'Shared watcher command, timeline and audit commit with replay record.',
  },
  'DELETE /api/v2/incidents/[id]/watchers/[watcherId]': {
    idempotency: 'required',
    concurrency: 'none',
    rationale: 'Parent-scoped removal and timeline event commit atomically.',
  },
  'POST /api/v2/runbooks/[id]/executions/preview': natural(
    'Preflight only; stores an expiring actor-bound preview authorization without creating jobs or execution.'
  ),
  'POST /api/v2/runbooks/executions/[id]/cancel': {
    idempotency: 'required',
    concurrency: 'none',
    rationale:
      'Records a cancellation request and durable reconciliation, without claiming an external command has stopped.',
  },
  'POST /api/v2/schedules/[id]/layers/[layerId]/participants': {
    idempotency: 'required',
    concurrency: 'none',
    rationale: 'Shared participant command, audit and replay commit together.',
  },
  'PATCH /api/v2/schedules/[id]/layers/[layerId]/participants/[userId]': {
    idempotency: 'required',
    concurrency: 'none',
    rationale: 'A relative move must not be repeated on retry.',
  },
  'DELETE /api/v2/schedules/[id]/layers/[layerId]/participants/[userId]': {
    idempotency: 'required',
    concurrency: 'none',
    rationale: 'Removal and position normalization are atomic.',
  },
  'POST /api/v2/incidents/[id]/reopen': {
    idempotency: 'required',
    concurrency: 'none',
    rationale: 'Canonical lifecycle command, audit, outbox and replay record share a transaction.',
  },
  'POST /api/v2/incidents/[id]/unacknowledge': {
    idempotency: 'required',
    concurrency: 'none',
    rationale: 'Canonical lifecycle command, audit, outbox and replay record share a transaction.',
  },
  'POST /api/v2/incidents/[id]/snooze': {
    idempotency: 'required',
    concurrency: 'none',
    rationale: 'Canonical lifecycle command, audit, outbox and replay record share a transaction.',
  },
  'POST /api/v2/incidents/[id]/unsnooze': {
    idempotency: 'required',
    concurrency: 'none',
    rationale: 'Canonical lifecycle command, audit, outbox and replay record share a transaction.',
  },
  'POST /api/v2/incidents/[id]/suppress': {
    idempotency: 'required',
    concurrency: 'none',
    rationale: 'Canonical lifecycle command, audit, outbox and replay record share a transaction.',
  },
  'POST /api/v2/incidents/[id]/unsuppress': {
    idempotency: 'required',
    concurrency: 'none',
    rationale: 'Canonical lifecycle command, audit, outbox and replay record share a transaction.',
  },
  'POST /api/v2/runbooks': {
    idempotency: 'required',
    concurrency: 'none',
    rationale: 'Shared versioning command and audit in the replay transaction.',
  },
  'POST /api/v2/runbooks/[id]/drafts': {
    idempotency: 'required',
    concurrency: 'none',
    rationale: 'Shared versioning command and audit in the replay transaction.',
  },
  'PATCH /api/v2/runbooks/[id]/drafts/[versionId]': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale: 'Shared versioning command and audit in the replay transaction.',
  },
  'POST /api/v2/runbooks/[id]/drafts/[versionId]/publish': {
    idempotency: 'required',
    concurrency: 'etag',
    preconditionRequired: true,
    rationale: 'Shared versioning command and audit in the replay transaction.',
  },
  'POST /api/v2/runbooks/[id]/drafts/[versionId]/validate': natural(
    'Validation only; does not publish, execute or enqueue work.'
  ),
  'POST /api/v2/incidents': supported('Creation; a duplicate would page twice.'),
  'PATCH /api/v2/incidents/[id]': {
    idempotency: 'supported',
    concurrency: 'none',
    rationale: 'Sets fields; lifecycle/assignment side effects are replay-guarded by the key.',
  },
  'POST /api/v2/incidents/[id]/acknowledge': supported('Lifecycle transition with notifications.'),
  'POST /api/v2/incidents/[id]/resolve': supported('Lifecycle transition with notifications.'),
  'POST /api/v2/incidents/[id]/assign': supported(
    'Assignment notifies and invites to the war room.'
  ),
  'POST /api/v2/incidents/[id]/notes': supported(
    'Appends a timeline entry; a duplicate would repeat it.'
  ),
  'POST /api/v2/notifications/[id]/retry': natural(
    'Compare-and-set FAILED to PENDING; a concurrent retry loses with 409.'
  ),
  'POST /api/v2/runbooks/[id]/execute': {
    idempotency: 'required',
    concurrency: 'none',
    rationale: 'Starts executable work against production systems.',
  },
  'POST /api/v2/postmortems': supported('Creation.'),
  'PATCH /api/v2/postmortems/[id]': natural('Sets fields to the requested values.'),
  'DELETE /api/v2/postmortems/[id]': natural('A repeat returns 404.'),
  'POST /api/v2/teams': supported('Creation.'),
  'PATCH /api/v2/teams/[id]': natural('Sets fields to the requested values.', 'etag'),
  'DELETE /api/v2/teams/[id]': natural('A repeat returns 404.'),
  'POST /api/v2/services': supported('Creation.'),
  'PATCH /api/v2/services/[id]': natural('Sets fields to the requested values.', 'etag'),
  'DELETE /api/v2/services/[id]': natural('A repeat returns 404.'),
  'POST /api/v2/schedules': supported('Creation.'),
  'PATCH /api/v2/schedules/[id]': natural('Sets fields to the requested values.', 'etag'),
  'DELETE /api/v2/schedules/[id]': natural('A repeat returns 404.'),
  'POST /api/v2/schedules/[id]/overrides': natural(
    'Exact duplicates and overlapping replacements are rejected with 409.'
  ),
  'POST /api/v2/escalation-policies': natural('Policy names are unique; a repeat returns 409.'),
  'PATCH /api/v2/escalation-policies/[id]': natural(
    'Replaces the step list with the requested one.',
    'etag'
  ),
  'DELETE /api/v2/escalation-policies/[id]': natural('A repeat returns 404.'),
  'PATCH /api/v2/integrations/[id]': natural('Sets name and enabled state.', 'etag'),
  'POST /api/v2/status-pages': natural('Slugs are unique; a repeat returns 409.'),
  'PATCH /api/v2/status-pages/[id]': natural('Sets configuration to the requested values.'),
  'POST /api/v2/status-pages/[id]/announcements': supported(
    'Announcements can notify subscribers.'
  ),
  'POST /api/v2/service-accounts': supported('Creation without secret material in the response.'),
  'DELETE /api/v2/service-accounts/[id]': natural('A repeat returns 404.'),
  'POST /api/v2/service-accounts/[id]/tokens': {
    idempotency: 'never',
    concurrency: 'none',
    rationale:
      'The response carries a one-time secret that is never stored, so it cannot be replayed. ' +
      'A retry after a lost response issues a second token; list tokens and revoke the extra one.',
  },
  'DELETE /api/v2/service-accounts/[id]/tokens/[tokenId]': natural('Revocation is idempotent.'),
};
