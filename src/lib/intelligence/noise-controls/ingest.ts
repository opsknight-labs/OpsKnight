import 'server-only';
import type { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { INTELLIGENCE_ENGINE_VERSION } from '../contract';
import type { PrePagingDecisionResult, PrePagingInput } from './contract';
import {
  evaluatePrePagingControls,
  resolvePolicy,
  type CompiledPolicy,
  type PrePagingLookups,
  type PrePagingSnapshot,
} from './evaluate';
import {
  getPrePagingSnapshot,
  peekPrePagingSnapshot,
  prefetchedLookups,
  type PrePagingLookupPlan,
} from './cache';
import { NOISE_CONTROL_REVERSAL_INTEGRATION_ID, recordPrePagingDecision } from './decisions';
import { getNoiseLookupClient, lookupTimeoutMs, prePagingDeadlineMs } from './lookup-client';

/**
 * The ingestion side of the pre-paging controls: the only noise-control code `processEvent` reaches
 * (through `ingest-hooks`). It runs inside the event transaction, before the incident is written.
 *
 * - Policy OFF (the default) or no snapshot yet: one in-process map lookup, no database access.
 * - SHADOW / ON: every read the policy can need is fetched in one index-backed statement. By default it
 *   runs on the dedicated lookup pool (`lookup-client.ts`), whose connections carry a server-side
 *   statement timeout equal to the shared deadline: one round trip, and an abandoned or failing lookup
 *   never touches the event transaction. Behind a transaction pooler (or with no datasource) it runs on the
 *   event transaction inside a savepoint with the same server-side timeout, so an abandoned lookup can
 *   delay the transaction by at most one deadline and never leaves it aborted; the savepoint is always
 *   rolled back (the lookups only read). Three round trips inside the deadline, one after.
 * - On the pool route `processEvent` starts that statement early (`beginIngestNoiseLookups`: after the
 *   dedup-key lock and the open-incident check, when the event is known to open a new incident) so it
 *   overlaps the classification reads the transaction makes anyway. Time the hook spends waiting holds the
 *   event's pooled connection, and with more events in flight than connections every such millisecond
 *   delays the queue behind it several times over; overlapped, the wait is usually already over when the
 *   hook runs. The deadline counts from the moment the statement was sent, so the lookup never gets more
 *   than the one deadline it had before and the hook itself waits for at most what is left of it.
 * - Any error, timeout or cold cache returns `null`: the caller pages exactly as it does without controls.
 */

type Tx = Prisma.TransactionClient;
const SAVEPOINT = 'opsknight_prepaging';

export { setPrePagingDeadlineMs } from './lookup-client';

export interface IngestNoiseOptions {
  integrationId: string;
  /** Tests and benchmarks may inject these; production always uses the process snapshot and the tx. */
  snapshot?: PrePagingSnapshot | null;
  lookups?: PrePagingLookups;
  deadlineMs?: number;
  now?: Date;
  /** The lookups `beginIngestNoiseLookups` started for this event; ignored unless they match it. */
  prefetch?: IngestNoisePrefetch | null;
}

/** Lookups already under way for one event, with everything needed to tell whether they still apply. */
export interface IngestNoisePrefetch {
  readonly snapshot: PrePagingSnapshot;
  readonly serviceId: string;
  readonly fingerprintHash: string | null;
  readonly dedupKey: string;
  readonly now: Date;
  readonly deadlineMs: number;
  /** `performance.now()` when the statement was sent; the deadline counts from here. */
  readonly startedAt: number;
  readonly lookups: PrePagingLookups;
}

let prefetchEnabled = true;

/** Turns the early start off (null/true restores it). For tests and benchmarks that compare the two. */
export function setIngestNoisePrefetch(enabled: boolean | null): void {
  prefetchEnabled = enabled ?? true;
}

/** What `processEvent` acts on. `null` means "page normally and record nothing". */
export interface IngestNoiseDecision extends PrePagingDecisionResult {
  /** The policy allows dedup / flapping / storm to act on HIGH urgency. Holds never apply to HIGH. */
  allowHighUrgency: boolean;
}

/** The reads `evaluatePrePagingControls` will make, computed exactly as it computes them. */
export function lookupPlan(
  input: Pick<PrePagingInput, 'serviceId' | 'fingerprintHash' | 'dedupKey'>,
  policy: CompiledPolicy,
  snapshot: PrePagingSnapshot,
  now: Date
): PrePagingLookupPlan {
  const definition = policy.definition;
  const since = (seconds: number) => new Date(now.getTime() - seconds * 1000);
  return {
    serviceId: input.serviceId,
    dedup:
      definition.contentDedup.enabled && input.fingerprintHash
        ? {
            fingerprintHash: input.fingerprintHash,
            since: since(definition.contentDedup.windowSeconds),
          }
        : null,
    flapping: definition.flapping.enabled
      ? {
          dedupKey: input.dedupKey,
          fingerprintHash: definition.flapping.keyOnFingerprint ? input.fingerprintHash : null,
          since: since(definition.flapping.windowSeconds),
          limit: 20,
        }
      : null,
    storm: definition.storm.enabled
      ? {
          serviceIds: definition.storm.topology
            ? (snapshot.topology.get(input.serviceId) ?? [input.serviceId])
            : [input.serviceId],
          since: since(definition.storm.windowSeconds),
        }
      : null,
  };
}

/**
 * The prefetched lookups on the dedicated pool (server-side timeout set per connection; nothing to
 * open or close), or on the event transaction inside a lazily opened, timeout-bounded savepoint.
 */
function boundedLookups(tx: Tx, deadlineMs: number, plan: PrePagingLookupPlan) {
  const timeoutMs = lookupTimeoutMs(deadlineMs);
  const pool = getNoiseLookupClient(timeoutMs);
  if (pool) return { lookups: prefetchedLookups(pool, plan), async close() {} };
  const base = prefetchedLookups(tx, plan);
  let opening: Promise<void> | null = null;
  let closed = false;
  const open = async () => {
    if (closed) throw new Error('pre-paging lookups closed');
    opening ??= (async () => {
      await tx.$executeRawUnsafe(`SAVEPOINT ${SAVEPOINT}`);
      // Local to the savepoint: rolled back with it, so the event transaction keeps its own timeout.
      await tx.$queryRawUnsafe(`SELECT set_config('statement_timeout', '${timeoutMs}ms', true)`);
    })();
    await opening;
    if (closed) throw new Error('pre-paging lookups closed');
  };
  const lookups: PrePagingLookups = {
    async findOpenIncidentByFingerprint(...args) {
      await open();
      return base.findOpenIncidentByFingerprint(...args);
    },
    async countRecentIncidents(...args) {
      await open();
      return base.countRecentIncidents(...args);
    },
    async findStormParent(...args) {
      await open();
      return base.findStormParent(...args);
    },
    async recentAlertStatuses(...args) {
      await open();
      return base.recentAlertStatuses(...args);
    },
  };
  return {
    lookups,
    /** Statements on one transaction run in order, so this rollback waits for any abandoned lookup. */
    async close() {
      closed = true;
      if (!opening) return;
      await opening.catch(() => undefined);
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
    },
  };
}

/**
 * Starts the event's lookups on the dedicated pool before the hook needs them, or returns null when there
 * is nothing to start: reversal re-ingest, cold cache, policy OFF, no lookup enabled, or no lookup pool
 * (the savepoint route reads on the event transaction, where statements cannot overlap). Never throws
 * and never touches the event transaction; a prefetch that is not used is simply dropped.
 *
 * Call it only once the event is known to open a new incident and after the dedup-key lock, so events for
 * one key still read in order. `receivedAt` must be the instant later passed to
 * `evaluateIngestNoiseControls`: the windows are computed from it.
 */
export function beginIngestNoiseLookups(
  input: Pick<PrePagingInput, 'serviceId' | 'fingerprintHash' | 'dedupKey' | 'receivedAt'>,
  options: Pick<IngestNoiseOptions, 'integrationId' | 'deadlineMs'>
): IngestNoisePrefetch | null {
  if (!prefetchEnabled) return null;
  if (options.integrationId === NOISE_CONTROL_REVERSAL_INTEGRATION_ID) return null;
  try {
    const snapshot = peekPrePagingSnapshot();
    if (!snapshot) return null;
    const policy = resolvePolicy(snapshot, input.serviceId);
    if (!policy || policy.mode === 'OFF') return null;
    const now = input.receivedAt;
    const plan = lookupPlan(input, policy, snapshot, now);
    if (!plan.dedup && !plan.flapping && !plan.storm) return null;
    const deadlineMs = options.deadlineMs ?? prePagingDeadlineMs();
    const pool = getNoiseLookupClient(lookupTimeoutMs(deadlineMs));
    if (!pool) return null;
    const lookups = prefetchedLookups(pool, plan);
    const startedAt = performance.now();
    lookups.start();
    return {
      snapshot,
      serviceId: input.serviceId,
      fingerprintHash: input.fingerprintHash ?? null,
      dedupKey: input.dedupKey,
      now,
      deadlineMs,
      startedAt,
      lookups,
    };
  } catch {
    return null;
  }
}

/** The prefetch applies only to the very event, instant, deadline and snapshot it was started for. */
function usablePrefetch(
  prefetch: IngestNoisePrefetch | null | undefined,
  input: PrePagingInput,
  snapshot: PrePagingSnapshot,
  now: Date,
  deadlineMs: number
): IngestNoisePrefetch | null {
  return prefetch &&
    prefetch.snapshot === snapshot &&
    prefetch.serviceId === input.serviceId &&
    prefetch.fingerprintHash === (input.fingerprintHash ?? null) &&
    prefetch.dedupKey === input.dedupKey &&
    prefetch.now.getTime() === now.getTime() &&
    prefetch.deadlineMs === deadlineMs
    ? prefetch
    : null;
}

/**
 * Evaluates the controls for a new alert. Returns null when nothing should be recorded or applied:
 * OFF, fail-open, no control matched, or the event is a reversal re-ingest (which must page).
 */
export async function evaluateIngestNoiseControls(
  tx: Tx,
  input: PrePagingInput,
  options: IngestNoiseOptions
): Promise<IngestNoiseDecision | null> {
  // An operator's "un-group and page" must page; it is never re-evaluated.
  if (options.integrationId === NOISE_CONTROL_REVERSAL_INTEGRATION_ID) return null;
  try {
    const snapshot =
      options.snapshot !== undefined ? options.snapshot : getPrePagingSnapshot(Date.now());
    if (!snapshot) {
      addOperationalMetric('opsknight_prepaging_fail_open_total', 1, { reason: 'cache_cold' });
      return null;
    }
    const policy = resolvePolicy(snapshot, input.serviceId);
    // OFF is the default: decided from the in-process snapshot alone, nothing else runs.
    if (!policy || policy.mode === 'OFF') return null;

    const deadlineMs = options.deadlineMs ?? prePagingDeadlineMs();
    const now = options.now ?? input.receivedAt;
    const prefetch = options.lookups
      ? null
      : usablePrefetch(options.prefetch, input, snapshot, now, deadlineMs);
    const bounded =
      options.lookups || prefetch
        ? null
        : boundedLookups(tx, deadlineMs, lookupPlan(input, policy, snapshot, now));
    let decision: PrePagingDecisionResult;
    try {
      decision = await evaluatePrePagingControls(
        input,
        snapshot,
        options.lookups ?? prefetch?.lookups ?? bounded!.lookups,
        {
          // The early statement has been running since it was sent: only the rest of its deadline is left.
          deadlineMs: prefetch
            ? Math.max(0, deadlineMs - (performance.now() - prefetch.startedAt))
            : deadlineMs,
          now,
        }
      );
    } finally {
      await bounded?.close();
    }
    if (decision.failOpen || decision.action === 'NONE' || decision.mode === 'OFF') return null;
    return { ...decision, allowHighUrgency: policy.definition.allowHighUrgency };
  } catch (error) {
    addOperationalMetric('opsknight_prepaging_fail_open_total', 1, { reason: 'error' });
    logger.debug('[Intelligence] Pre-paging controls failed open', {
      serviceId: input.serviceId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Stores the decision for the alert it was made for. SHADOW keeps the would-be target as evidence. */
export async function recordIngestNoiseDecision(
  tx: Tx,
  decision: IngestNoiseDecision,
  context: { serviceId: string; alertId: string | null; incidentId: string | null }
): Promise<string | null> {
  const { allowHighUrgency: _allowHighUrgency, ...result } = decision;
  return recordPrePagingDecision(
    tx,
    {
      ...result,
      evidence: {
        ...result.evidence,
        ...(result.targetIncidentId ? { targetIncidentId: result.targetIncidentId } : {}),
      },
    },
    context
  );
}

/**
 * Records the storm grouping as an accepted PARENT_CHILD relationship (child → parent) with its
 * provenance event. Idempotent: a second grouping of the same pair is a no-op.
 */
export async function linkStormChild(
  tx: Tx,
  input: { parentIncidentId: string; childIncidentId: string; evidence: Record<string, unknown> }
): Promise<void> {
  const created = await tx.incidentRelationship.createManyAndReturn({
    data: [
      {
        sourceIncidentId: input.childIncidentId,
        targetIncidentId: input.parentIncidentId,
        type: 'PARENT_CHILD',
        origin: 'RULE',
        decision: 'ACCEPTED',
        score: 1,
        evidence: { kind: 'prepaging_storm', ...input.evidence } as Prisma.InputJsonObject,
        engineVersion: INTELLIGENCE_ENGINE_VERSION,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  if (created[0])
    await tx.incidentRelationshipEvent.create({
      data: {
        relationshipId: created[0].id,
        fromDecision: null,
        toDecision: 'ACCEPTED',
        actorType: 'SYSTEM',
        reasonCode: 'PREPAGING_STORM_GROUPED',
      },
    });
}
