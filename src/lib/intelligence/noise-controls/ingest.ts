import 'server-only';
import type { Prisma } from '@prisma/client';
import { logger } from '@/lib/logger';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { INTELLIGENCE_ENGINE_VERSION } from '../contract';
import { PREPAGING_LIMITS, type PrePagingDecisionResult, type PrePagingInput } from './contract';
import {
  evaluatePrePagingControls,
  resolvePolicy,
  type CompiledPolicy,
  type PrePagingLookups,
  type PrePagingSnapshot,
} from './evaluate';
import { getPrePagingSnapshot, prefetchedLookups, type PrePagingLookupPlan } from './cache';
import { NOISE_CONTROL_REVERSAL_INTEGRATION_ID, recordPrePagingDecision } from './decisions';

/**
 * The ingestion side of the pre-paging controls: the only noise-control code `processEvent` reaches
 * (through `ingest-hooks`). It runs inside the event transaction, before the incident is written.
 *
 * - Policy OFF (the default) or no snapshot yet: one in-process map lookup, no database access.
 * - SHADOW / ON: every read the policy can need is fetched in one index-backed statement, inside a
 *   savepoint with a server-side statement timeout equal to the shared deadline, so an abandoned lookup
 *   can delay the transaction by at most one deadline and never leaves it aborted. The savepoint is
 *   always rolled back (the lookups only read). Three round trips inside the deadline, one after.
 * - Any error, timeout or cold cache returns `null`: the caller pages exactly as it does without controls.
 */

type Tx = Prisma.TransactionClient;
const SAVEPOINT = 'opsknight_prepaging';
const MAX_DEADLINE_MS = 50;
let deadlineOverrideMs: number | null = null;

/**
 * Process-level override of the shared deadline (1–50 ms; null restores the 5 ms default). For
 * benchmarks and tests that must not depend on host timing; production code never calls it.
 */
export function setPrePagingDeadlineMs(ms: number | null): void {
  deadlineOverrideMs = ms === null ? null : Math.min(MAX_DEADLINE_MS, Math.max(1, Math.round(ms)));
}

export interface IngestNoiseOptions {
  integrationId: string;
  /** Tests and benchmarks may inject these; production always uses the process snapshot and the tx. */
  snapshot?: PrePagingSnapshot | null;
  lookups?: PrePagingLookups;
  deadlineMs?: number;
  now?: Date;
}

/** What `processEvent` acts on. `null` means "page normally and record nothing". */
export interface IngestNoiseDecision extends PrePagingDecisionResult {
  /** The policy allows dedup / flapping / storm to act on HIGH urgency. Holds never apply to HIGH. */
  allowHighUrgency: boolean;
}

/** The reads `evaluatePrePagingControls` will make, computed exactly as it computes them. */
export function lookupPlan(
  input: PrePagingInput,
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

/** Wraps the prefetched lookups in a lazily opened, timeout-bounded savepoint. */
function boundedLookups(tx: Tx, deadlineMs: number, plan: PrePagingLookupPlan) {
  const base = prefetchedLookups(tx, plan);
  let opening: Promise<void> | null = null;
  let closed = false;
  const timeoutMs = Math.max(1, Math.ceil(deadlineMs));
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

    const deadlineMs = options.deadlineMs ?? deadlineOverrideMs ?? PREPAGING_LIMITS.deadlineMs;
    const now = options.now ?? input.receivedAt;
    const bounded = options.lookups
      ? null
      : boundedLookups(tx, deadlineMs, lookupPlan(input, policy, snapshot, now));
    let decision: PrePagingDecisionResult;
    try {
      decision = await evaluatePrePagingControls(
        input,
        snapshot,
        options.lookups ?? bounded!.lookups,
        { deadlineMs, now }
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
