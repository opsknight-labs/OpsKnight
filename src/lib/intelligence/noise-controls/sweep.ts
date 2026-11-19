import 'server-only';
import type { IncidentStatus, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { applyIncidentLifecycleCommand, repageOpenIncident } from '@/lib/incidents/lifecycle';
import { withDbBudget } from '../jobs/db-budget';
import {
  enqueueWorkItems,
  WORK_KINDS,
  type ClaimedWorkItem,
  type WorkKind,
} from '../jobs/work-queue';
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
/** Ingestion opens these pauses; a manual SUPPRESS opens one named after the command. */
const NOISE_PAUSE_REASONS = ['noise-control-suppression', 'flapping-suppression'];
/** Quiet period for incidents suppressed by the removed fixed-threshold flapping check (its window). */
const LEGACY_FLAP_QUIET_SECONDS = 180;
/** shortcut: parents resolved longer ago than this are not cascaded; widen if the lane can lag that long. */
const CASCADE_LOOKBACK_MS = 24 * 60 * 60_000;
/** shortcut: storm links older than this are not probed for a cascade; widen if storm parents stay open longer. */
const STORM_LINK_LOOKBACK_MS = 7 * 24 * 60 * 60_000;

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
}

function flapQuietSeconds(evidence: Prisma.JsonValue): number {
  const seconds =
    evidence && typeof evidence === 'object' && !Array.isArray(evidence)
      ? evidence.windowSeconds
      : null;
  return typeof seconds === 'number' && seconds > 0 ? seconds : LEGACY_FLAP_QUIET_SECONDS;
}

/** Why a suppression no longer holds, or null while it still does (or is not ours to lift). */
async function endedReason(
  rows: readonly SuppressedCandidate[],
  now: Date
): Promise<Map<string, string>> {
  const eligible = rows.filter(
    row =>
      row.pauseReason !== null &&
      NOISE_PAUSE_REASONS.includes(row.pauseReason) &&
      row.alertStatus === 'TRIGGERED'
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
          await prisma.maintenanceWindow.findMany({
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
    } else if (
      row.control === 'FLAPPING' ||
      (row.control === null && row.pauseReason === 'flapping-suppression')
    ) {
      const quiet = flapQuietSeconds(row.evidence);
      if (row.alertAt && row.alertAt.getTime() <= now.getTime() - quiet * 1000)
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
             a.status AS "alertStatus", a."createdAt" AS "alertAt"
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
        SELECT status, "createdAt" FROM "Alert"
        WHERE "incidentId" = i.id
        ORDER BY "createdAt" DESC, id DESC LIMIT 1
      ) a ON true
      WHERE i.status = 'SUPPRESSED'
        AND (i."createdAt", i.id) > (${after.watermarkAt}, ${after.lastId})
      ORDER BY i."createdAt", i.id
      LIMIT ${PAGE_SIZE}`
  );

  const ended = await endedReason(page, now);
  for (const row of page) {
    const reason = ended.get(row.id);
    if (!reason) continue;
    await withDbBudget(budget, async tx => {
      const [current] = await tx.$queryRaw<Array<{ status: IncidentStatus; generation: number }>>`
        SELECT status, "escalationGeneration" AS generation FROM "Incident"
        WHERE id = ${row.id} FOR UPDATE`;
      if (current?.status !== 'SUPPRESSED' || current.generation !== row.generation) return;
      await applyIncidentLifecycleCommand(tx, {
        incidentId: row.id,
        command: 'UNSUPPRESS',
        source: 'SYSTEM',
        expectedStatus: 'SUPPRESSED',
        eventMessage: `Unsuppressed by noise controls: ${reason} and the alert is still firing. Paging now.`,
        now,
      });
    });
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
}

/** One page of the storm cascade. Every row it reads is marked, so it never repeats. Returns whether more remain. */
export async function runStormCascadeSweep(
  budget: Budget,
  options: { now?: Date } = {}
): Promise<boolean> {
  const now = options.now ?? new Date();
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
              ) latest WHERE latest.status = 'TRIGGERED') AS "firingKeys"
      FROM "Incident" p
      JOIN "IncidentRelationship" r
        ON r."targetIncidentId" = p.id AND r.type = 'PARENT_CHILD'
       AND r.evidence->>'kind' = 'prepaging_storm' AND r.evidence->>'cascadedAt' IS NULL
      JOIN "Incident" c ON c.id = r."sourceIncidentId" AND c.status IN ('OPEN', 'ACKNOWLEDGED')
      WHERE p.status = 'RESOLVED' AND p."resolvedAt" >= ${new Date(now.getTime() - CASCADE_LOOKBACK_MS)}
      ORDER BY r.id
      LIMIT ${PAGE_SIZE}`
  );

  for (const row of page) {
    await withDbBudget(budget, async tx => {
      // The mark is the idempotency claim: a concurrent pass that already took this row stops here.
      const claimed = await tx.$executeRaw`
        UPDATE "IncidentRelationship"
        SET evidence = evidence::jsonb || jsonb_build_object('cascadedAt', ${now.toISOString()}::text),
            "updatedAt" = now()
        WHERE id = ${row.relationshipId} AND evidence->>'cascadedAt' IS NULL`;
      if (claimed === 0) return;
      if (row.alerts > 0 && row.firingKeys === 0) {
        await applyIncidentLifecycleCommand(tx, {
          incidentId: row.id,
          command: 'RESOLVE',
          source: 'SYSTEM',
          expectedStatus: row.status,
          eventMessage: 'Resolved with its storm parent: all of its alerts are clear.',
          now,
        });
      } else if (row.status === 'OPEN' && row.escalationStatus === 'COMPLETED') {
        // Never paged (grouped under the parent) and still firing: page it on its own now.
        await repageOpenIncident(tx, {
          incidentId: row.id,
          generation: row.generation,
          eventMessage:
            'Storm parent resolved while this incident is still firing: paging it on its own.',
          now,
        });
      }
    });
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
  const [due] = await prisma.$queryRaw<Array<{ unsuppress: boolean; cascade: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM "Incident" WHERE status = 'SUPPRESSED') AS unsuppress,
           EXISTS (
             SELECT 1 FROM "IncidentRelationship"
             WHERE "updatedAt" >= ${new Date(now - STORM_LINK_LOOKBACK_MS)}
               AND type = 'PARENT_CHILD' AND evidence->>'kind' = 'prepaging_storm'
               AND evidence->>'cascadedAt' IS NULL
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
