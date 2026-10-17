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
 *                body returns 409 IDEMPOTENCY_KEY_CONFLICT.
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
  'POST /api/v2/services/[id]/automation/publish': {
    idempotency: 'required',
    concurrency: 'etag',
    responseEtag: false,
    preconditionRequired: true,
    rationale:
      'Publish checks the draft ETag and active version under the canonical service lock, validating dependencies and committing immutable version, audit and replay together.',
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
