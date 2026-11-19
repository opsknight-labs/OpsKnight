import 'server-only';
import type { IncidentStatus, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { applyIncidentLifecycleCommand, repageOpenIncident } from '@/lib/incidents/lifecycle';
import { logger } from '@/lib/logger';
import { withDbBudget } from '../jobs/db-budget';
import {
  enqueueWorkItems,
  WORK_KINDS,
  type ClaimedWorkItem,
  type WorkKind,
} from '../jobs/work-queue';
import { PREPAGING_LIMITS } from './contract';
import { isWindowActiveAt } from './recurrence';

/**
 * Lane follow-ups for pre-paging decisions that kept an incident from paging (NOISE_SWEEP work):
 *
 * - `unsuppress`: an incident suppressed by noise controls (flapping, maintenance window) pages once the
 *   reason ended and its latest alert still fires. Manual suppressions are never touched: only incidents
 *   whose open SLA pause was opened by ingestion qualify.
 * - `storm-cascade`: once a storm parent resolves, children whose alerts are all clear resolve with it and
 *   children still firing (and never paged) are paged on their own.
 *
 * Each pass reads one bounded page and changes each incident in its own budgeted transaction, fenced on
 * the escalation generation it read, so a pass racing a responder or ingestion is a no-op.
 */

export const NOISE_SWEEP_SUBJECTS = {
  unsuppress: 'unsuppress',
  stormCascade: 'storm-cascade',
} as const;
export const NOISE_SWEEP_INTERVAL_MS = 30_000;
const PAGE_SIZE = 100;
const UNSUPPRESS_CURSOR = 'noise-sweep:unsuppress';
/**
 * Noise controls open this pause; a manual SUPPRESS opens one named after the command. Legacy
 * 'flapping-suppression' holds are released by releaseStableFlappingHolds (cron) under the dedup lock,
 * so this sweep leaves them alone. The literal is repeated in the SQL below so the partial index
 * idx_sla_pause_open_noise applies.
 */
const NOISE_PAUSE_REASON = 'noise-control-suppression';
/** shortcut: parents resolved longer ago than this are not cascaded; widen if the lane can lag that long. */
const CASCADE_LOOKBACK_MS = 24 * 60 * 60_000;

type Budget = { maxDbMs: number };

interface SuppressedCandidate {
  id: string;
  createdAt: Date;
  generation: number;
  pauseReason: string | null;
  control: string | null;
  sourceId: string | null;
  evidence: Prisma.JsonValue;
  alertStatus: string | null;
  alertAt: Date | null;
  alertDedupKey: string | null;
  /** The key's latest RESOLVED alert within the longest flapping window, if any. */
  lastResolvedAt: Date | null;
}

function flapQuietSeconds(evidence: Prisma.JsonValue): number {
  const seconds =
    evidence && typeof evidence === 'object' && !Array.isArray(evidence)
      ? evidence.windowSeconds
      : null;
  return typeof seconds === 'number' && seconds > 0
    ? seconds
    : PREPAGING_LIMITS.flapping.maxWindowSeconds;
}

/** Why a suppression no longer holds, or null while it still does (or is not ours to lift). */
async function endedReason(
  rows: readonly SuppressedCandidate[],
  now: Date
): Promise<Map<string, string>> {
  const eligible = rows.filter(
    row => row.pauseReason === NOISE_PAUSE_REASON && row.alertStatus === 'TRIGGERED'
  );
  const windowIds = [
    ...new Set(
      eligible
        .filter(row => row.control === 'MAINTENANCE' && row.sourceId)
        .map(row => row.sourceId!)
    ),
  ];
  const windows = windowIds.length
    ? new Map(
        (
          await prisma.noiseMaintenanceWindow.findMany({
            where: { id: { in: windowIds } },
            select: {
              id: true,
              enabled: true,
              startsAt: true,
              endsAt: true,
              recurrence: true,
              endedAt: true,
            },
          })
        ).map(window => [window.id, window])
      )
    : new Map();
  const ended = new Map<string, string>();
  for (const row of eligible) {
    if (row.control === 'MAINTENANCE') {
      const window = row.sourceId ? windows.get(row.sourceId) : undefined;
      if (
        !window ||
        !window.enabled ||
        (window.endedAt && window.endedAt <= now) ||
        !isWindowActiveAt(window, now)
      )
        ended.set(row.id, 'its maintenance window ended');
    } else if (row.control === 'FLAPPING') {
      // Quiet is measured from the key's last state change (its latest resolve), not its latest row:
      // a hard-down alert re-sending its trigger adds rows without ever changing state.
      const quiet = flapQuietSeconds(row.evidence);
      const lastChange = row.alertDedupKey ? row.lastResolvedAt : row.alertAt;
      if (!lastChange || lastChange.getTime() <= now.getTime() - quiet * 1000)
        ended.set(row.id, `the alert stopped flapping (no state change for ${quiet}s)`);
    }
  }
  return ended;
}

/** One page of the un-suppress sweep. Returns whether more pages remain. */
export async function runUnsuppressSweep(
  budget: Budget,
  options: { now?: Date } = {}
): Promise<boolean> {
  const now = options.now ?? new Date();
  const cursor = await prisma.intelligenceCursor.findUnique({ where: { name: UNSUPPRESS_CURSOR } });
  const after = cursor ?? { watermarkAt: new Date(0), lastId: '' };
  const page = await withDbBudget(
    budget,
    tx =>
      tx.$queryRaw<SuppressedCandidate[]>`
      SELECT i.id, i."createdAt", i."escalationGeneration" AS generation, p.reason AS "pauseReason",
             d.control::text AS control, d."sourceId", d.evidence,
             a.status AS "alertStatus", a."createdAt" AS "alertAt", a."dedupKey" AS "alertDedupKey",
             r."createdAt" AS "lastResolvedAt"
      FROM "Incident" i
      LEFT JOIN LATERAL (
        SELECT reason FROM "IncidentSlaPause"
        WHERE "incidentId" = i.id AND "endedAt" IS NULL
        ORDER BY "startedAt" DESC LIMIT 1
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT control, "sourceId", evidence FROM "PrePagingDecision"
        WHERE "incidentId" = i.id AND applied AND action = 'SUPPRESS' AND "reversedAt" IS NULL
        ORDER BY "createdAt" DESC LIMIT 1
      ) d ON true
      LEFT JOIN LATERAL (
        SELECT status, "createdAt", "dedupKey", "serviceId" FROM "Alert"
        WHERE "incidentId" = i.id
        ORDER BY "createdAt" DESC, id DESC LIMIT 1
      ) a ON true
      LEFT JOIN LATERAL (
        SELECT "createdAt" FROM "Alert"
        WHERE d.control = 'FLAPPING' AND "dedupKey" = a."dedupKey" AND "serviceId" = a."serviceId"
          AND status = 'RESOLVED'
          AND "createdAt" >= ${new Date(now.getTime() - PREPAGING_LIMITS.flapping.maxWindowSeconds * 1000)}
        ORDER BY "createdAt" DESC, id DESC LIMIT 1
      ) r ON true
      WHERE i.status = 'SUPPRESSED'
        AND EXISTS (
          SELECT 1 FROM "IncidentSlaPause"
          WHERE "incidentId" = i.id AND "endedAt" IS NULL AND reason = 'noise-control-suppression'
        )
        -- Held by product maintenance (service-maintenance): its own end sweep releases these.
        AND i."maintenanceWindowId" IS NULL
        AND (i."createdAt", i.id) > (${after.watermarkAt}, ${after.lastId})
      ORDER BY i."createdAt", i.id
      LIMIT ${PAGE_SIZE}`
  );

  const ended = await endedReason(page, now);
  for (const row of page) {
    const reason = ended.get(row.id);
    if (!reason) continue;
    // One failing incident must not stop the page (or the cursor) for the rest.
    await withDbBudget(budget, async tx => {
      const [current] = await tx.$queryRaw<
        Array<{ status: IncidentStatus; generation: number; maintenanceWindowId: string | null }>
      >`
        SELECT status, "escalationGeneration" AS generation, "maintenanceWindowId" FROM "Incident"
        WHERE id = ${row.id} FOR UPDATE`;
      if (
        current?.status !== 'SUPPRESSED' ||
        current.generation !== row.generation ||
        current.maintenanceWindowId !== null
      )
        return;
      await applyIncidentLifecycleCommand(tx, {
        incidentId: row.id,
        command: 'UNSUPPRESS',
        source: 'SYSTEM',
        expectedStatus: 'SUPPRESSED',
        eventMessage: `Unsuppressed by noise controls: ${reason} and the alert is still firing. Paging now.`,
        now,
      });
    }).catch(error =>
      logger.error('[NoiseSweep] Un-suppress failed', {
        incidentId: row.id,
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }

  const last = page.at(-1);
  const more = page.length === PAGE_SIZE && !!last;
  const next = more
    ? { watermarkAt: last.createdAt, lastId: last.id }
    : { watermarkAt: new Date(0), lastId: '' };
  await prisma.intelligenceCursor.upsert({
    where: { name: UNSUPPRESS_CURSOR },
    create: { name: UNSUPPRESS_CURSOR, ...next },
    update: next,
  });
  return more;
}

interface StormChildRow {
  relationshipId: string;
  id: string;
  status: IncidentStatus;
  generation: number;
  escalationStatus: string | null;
  alerts: number;
  firingKeys: number;
  /** Its GROUP_CHILD decision was reversed: the alert was re-ingested and paged on its own. */
  reversed: boolean;
}

/** One page of the storm cascade. Every row it reads is marked, so it never repeats. Returns whether more remain. */
export async function runStormCascadeSweep(
  budget: Budget,
  options: { now?: Date } = {}
): Promise<boolean> {
  const now = options.now ?? new Date();
  const resolvedSince = new Date(now.getTime() - CASCADE_LOOKBACK_MS);
  const mark = (tx: Prisma.TransactionClient, relationshipId: string) => tx.$executeRaw`
    UPDATE "IncidentRelationship"
    SET evidence = evidence::jsonb || jsonb_build_object('cascadedAt', ${now.toISOString()}::text),
        "updatedAt" = now()
    WHERE id = ${relationshipId} AND evidence->>'cascadedAt' IS NULL`;
  // Links whose child already resolved have nothing to cascade: mark them so the probe stops seeing them.
  await withDbBudget(
    budget,
    tx => tx.$executeRaw`
      UPDATE "IncidentRelationship" r
      SET evidence = r.evidence::jsonb || jsonb_build_object('cascadedAt', ${now.toISOString()}::text),
          "updatedAt" = now()
      FROM "Incident" p, "Incident" c
      WHERE p.id = r."targetIncidentId" AND c.id = r."sourceIncidentId"
        AND r.type = 'PARENT_CHILD' AND r.evidence->>'kind' = 'prepaging_storm'
        AND r.evidence->>'cascadedAt' IS NULL
        AND p.status = 'RESOLVED' AND c.status = 'RESOLVED'`
  );
  const page = await withDbBudget(
    budget,
    tx =>
      tx.$queryRaw<StormChildRow[]>`
      SELECT r.id AS "relationshipId", c.id, c.status, c."escalationGeneration" AS generation,
             c."escalationStatus"::text AS "escalationStatus",
             (SELECT count(*)::int FROM "Alert" WHERE "incidentId" = c.id) AS alerts,
             (SELECT count(*)::int FROM (
                SELECT DISTINCT ON ("dedupKey") status FROM "Alert"
                WHERE "incidentId" = c.id
                ORDER BY "dedupKey", "createdAt" DESC, id DESC
              ) latest WHERE latest.status = 'TRIGGERED') AS "firingKeys",
             EXISTS (
               SELECT 1 FROM "PrePagingDecision"
               WHERE "incidentId" = c.id AND action = 'GROUP_CHILD' AND "reversedAt" IS NOT NULL
             ) AS reversed
      FROM "Incident" p
      JOIN "IncidentRelationship" r
        ON r."targetIncidentId" = p.id AND r.type = 'PARENT_CHILD'
       AND r.evidence->>'kind' = 'prepaging_storm' AND r.evidence->>'cascadedAt' IS NULL
      JOIN "Incident" c ON c.id = r."sourceIncidentId" AND c.status IN ('OPEN', 'ACKNOWLEDGED')
      WHERE p.status = 'RESOLVED' AND p."resolvedAt" >= ${resolvedSince}
      ORDER BY r.id
      LIMIT ${PAGE_SIZE}`
  );

  for (const row of page) {
    const clear = !row.reversed && row.alerts > 0 && row.firingKeys === 0;
    const unpaged = !row.reversed && row.status === 'OPEN' && row.escalationStatus === 'COMPLETED';
    // The mark is the idempotency claim, committed with the action: a concurrent pass that already took
    // this row stops at it, and a failed action leaves the row for the next pass.
    const claimThen = (action?: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      withDbBudget(budget, async tx => {
        if ((await mark(tx, row.relationshipId)) > 0 && action) await action(tx);
      });
    const pageChild = () =>
      claimThen(tx =>
        // Never paged (grouped under the parent) and still firing: page it on its own now.
        repageOpenIncident(tx, {
          incidentId: row.id,
          generation: row.generation,
          eventMessage:
            'Storm parent resolved while this incident is still firing: paging it on its own.',
          now,
        })
      );
    try {
      if (clear) {
        try {
          await claimThen(tx =>
            applyIncidentLifecycleCommand(tx, {
              incidentId: row.id,
              command: 'RESOLVE',
              source: 'SYSTEM',
              resolutionKind: 'AUTOMATION',
              expectedStatus: row.status,
              eventMessage: 'Resolved with its storm parent: all of its alerts are clear.',
              now,
            })
          );
          continue;
        } catch (error) {
          if (!unpaged) throw error;
          // A child nobody was paged for must not stay silent because its resolve failed.
          logger.warn('[NoiseSweep] Storm child resolve failed; paging it instead', {
            incidentId: row.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await (unpaged ? pageChild() : claimThen());
    } catch (error) {
      logger.error('[NoiseSweep] Storm cascade failed for a child', {
        incidentId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return page.length === PAGE_SIZE;
}

/** Registered into the runner's DEFAULT_HANDLERS. */
export async function runNoiseSweep(
  item: Pick<ClaimedWorkItem, 'kind' | 'subjectKey'>,
  budget: Budget,
  signal?: AbortSignal
): Promise<void> {
  const more =
    item.subjectKey === NOISE_SWEEP_SUBJECTS.stormCascade
      ? await runStormCascadeSweep(budget)
      : await runUnsuppressSweep(budget);
  if (more && !signal?.aborted)
    await enqueueWorkItems([{ kind: item.kind as WorkKind, subjectKey: item.subjectKey }]);
}

const schedule = { checkedAt: 0 };

/** Tests only: forget when the sweeps were last scheduled. */
export function resetNoiseSweepSchedule(): void {
  schedule.checkedAt = 0;
}

/**
 * Called once per lane cycle: nothing between intervals, then one indexed existence probe, and a coalesced
 * item only for a sweep that has candidates (no suppressed incident / no open storm link: no work queued).
 */
export async function scheduleNoiseSweeps(now: number): Promise<number> {
  if (now - schedule.checkedAt < NOISE_SWEEP_INTERVAL_MS) return 0;
  schedule.checkedAt = now;
  // Both probes read only partial indexes (idx_sla_pause_open_noise, idx_incident_relationship_storm_open).
  const [due] = await prisma.$queryRaw<Array<{ unsuppress: boolean; cascade: boolean }>>`
    SELECT EXISTS (
             SELECT 1 FROM "IncidentSlaPause" sp JOIN "Incident" i ON i.id = sp."incidentId"
             WHERE sp."endedAt" IS NULL AND sp.reason = 'noise-control-suppression'
               AND i.status = 'SUPPRESSED' AND i."maintenanceWindowId" IS NULL
           ) AS unsuppress,
           EXISTS (
             SELECT 1 FROM "IncidentRelationship" r
             JOIN "Incident" p ON p.id = r."targetIncidentId"
             JOIN "Incident" c ON c.id = r."sourceIncidentId"
             WHERE r.type = 'PARENT_CHILD' AND r.evidence->>'kind' = 'prepaging_storm'
               AND r.evidence->>'cascadedAt' IS NULL
               AND p.status = 'RESOLVED' AND p."resolvedAt" >= ${new Date(now - CASCADE_LOOKBACK_MS)}
               AND c.status IN ('OPEN', 'ACKNOWLEDGED')
           ) AS cascade`;
  const subjects = [
    ...(due?.unsuppress ? [NOISE_SWEEP_SUBJECTS.unsuppress] : []),
    ...(due?.cascade ? [NOISE_SWEEP_SUBJECTS.stormCascade] : []),
  ];
  if (!subjects.length) return 0;
  return enqueueWorkItems(
    subjects.map(subjectKey => ({ kind: WORK_KINDS.NOISE_SWEEP, subjectKey }))
  );
}
