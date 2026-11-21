import 'server-only';

import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { getCoverageGapSummary } from '@/lib/dashboard/live-incidents';
import { readStatusPageSnapshot } from '@/lib/status-pages/snapshot';
import {
  incidentReadWhere,
  runbookExecutionReadWhere,
  scheduleReadWhere,
  serviceReadWhere,
} from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { getMyOnCallShifts } from '@/lib/oncall-my-shifts';
import { logger } from '@/lib/logger';
import {
  computeSlaSignal,
  isSlaAtRisk,
  type LiveSetRow,
} from '@/lib/dashboard/live-incidents-engine';
import {
  EMPTY_HEALTH,
  type MyIncidentCounts,
  type StatusBarShift,
  type StatusPageSeverity,
  type WorkspaceHealth,
} from '@/lib/status-bar';

/** Active incidents assigned to the actor, and how many of those are still unacknowledged. */
export async function getMyIncidentCounts(actor: AuthorizationActor): Promise<MyIncidentCounts> {
  // One groupBy on the (assigneeId, status) index; same scope as `/incidents?filter=mine`.
  const rows = await prisma.incident.groupBy({
    by: ['status'],
    where: {
      AND: [
        incidentReadWhere(actor),
        { assigneeId: actor.id, status: { in: activeIncidentStatuses() } },
      ],
    },
    _count: { _all: true },
  });
  let assigned = 0;
  let unacked = 0;
  for (const row of rows) {
    const count = row._count?._all ?? 0;
    if (!row.status) continue;
    assigned += count;
    if (row.status === 'OPEN') unacked += count;
  }
  return { assigned, unacked };
}

const SLA_SCAN_CAP = 500;

/**
 * Awaiting-ack and SLA-at-risk counts, plus active maintenance, all inside the actor's read scope.
 * SLA risk runs the dashboard's own `computeSlaSignal` + `isSlaAtRisk` over a capped, SLA-columns-only
 * read of active incidents, so the definition matches the command strip.
 */
export async function getWorkspaceHealth(actor: AuthorizationActor): Promise<WorkspaceHealth> {
  const now = new Date();
  const isAdmin = hasCapability(actor.role, CAPABILITIES.ADMIN_MANAGE);
  const [
    awaitingAck,
    active,
    windows,
    coverage,
    warRooms,
    statusPage,
    runbooksRunning,
    ingestionDelayed,
  ] = await Promise.all([
    prisma.incident.count({ where: { AND: [incidentReadWhere(actor), { status: 'OPEN' }] } }),
    prisma.incident.findMany({
      where: { AND: [incidentReadWhere(actor), { status: { in: activeIncidentStatuses() } }] },
      select: {
        status: true,
        createdAt: true,
        acknowledgedAt: true,
        slaFirstAcknowledgedAt: true,
        slaAckTargetMs: true,
        slaResolveTargetMs: true,
        slaTargetSource: true,
        slaTargetCapturedAt: true,
        slaPausedMs: true,
        slaPauseStartedAt: true,
        slaAckElapsedMs: true,
        slaResolveElapsedMs: true,
      },
      take: SLA_SCAN_CAP,
    }),
    // Bounded: windows spanning now (index on startsAt), a few visible services each.
    prisma.maintenanceWindow.findMany({
      where: { startsAt: { lte: now }, endsAt: { gt: now }, endProcessedAt: null },
      select: {
        endsAt: true,
        services: {
          where: { service: serviceReadWhere(actor) },
          take: 5,
          select: { service: { select: { id: true, name: true } } },
        },
      },
      orderBy: { endsAt: 'asc' },
      take: 10,
    }),
    getCoverageGapSummary(actor).catch(() => null),
    getWarRooms(actor),
    getWorstStatusPage(isAdmin),
    getRunningRunbooks(actor),
    isAdmin ? getIngestionDelayed(now) : Promise.resolve(false),
  ]);

  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const nowMs = now.getTime();
  const slaAtRisk = active.filter(row =>
    // computeSlaSignal only reads these fields; the rest of LiveSetRow is display data.
    isSlaAtRisk(
      {
        sla: computeSlaSignal(
          {
            ...row,
            createdAt: row.createdAt.toISOString(),
            acknowledgedAt: iso(row.acknowledgedAt),
            slaFirstAcknowledgedAt: iso(row.slaFirstAcknowledgedAt),
            slaTargetCapturedAt: iso(row.slaTargetCapturedAt),
            slaPauseStartedAt: iso(row.slaPauseStartedAt),
          } as unknown as LiveSetRow,
          nowMs
        ),
      },
      nowMs
    )
  ).length;

  const services = new Map<string, { name: string; endsAt: string }>();
  for (const window of windows)
    for (const { service } of window.services)
      if (!services.has(service.id))
        services.set(service.id, { name: service.name, endsAt: window.endsAt.toISOString() });
  const [first] = [...services.entries()];
  return {
    ...EMPTY_HEALTH,
    awaitingAck,
    slaAtRisk,
    coverageGap:
      coverage?.first && coverage.count > 0
        ? {
            count: coverage.count,
            scheduleId: coverage.first.id,
            scheduleName: coverage.first.name,
          }
        : null,
    warRooms,
    statusPage,
    runbooksRunning,
    ingestionDelayed,
    asOf: nowMs,
    maintenance: first
      ? {
          count: services.size,
          serviceId: first[0],
          serviceName: first[1].name,
          endsAt: first[1].endsAt,
        }
      : null,
  };
}

/** READY war rooms on active incidents the actor can read: state-led index, 5 rows max. */
async function getWarRooms(actor: AuthorizationActor): Promise<WorkspaceHealth['warRooms']> {
  const rooms = await prisma.incidentWarRoom
    .findMany({
      where: {
        state: 'READY',
        incident: { AND: [incidentReadWhere(actor), { status: { in: activeIncidentStatuses() } }] },
      },
      select: { readyAt: true, createdAt: true, incident: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'asc' },
      take: 5,
    })
    .catch(() => []);
  const [oldest] = rooms;
  return oldest
    ? {
        count: rooms.length,
        incidentId: oldest.incident.id,
        title: oldest.incident.title,
        since: (oldest.readyAt ?? oldest.createdAt).toISOString(),
      }
    : null;
}

const SEVERITY_RANK: Record<StatusPageSeverity, number> = {
  DEGRADED: 1,
  PARTIAL_OUTAGE: 2,
  MAJOR_OUTAGE: 3,
};

/** Worst enabled status page, from the published snapshot (one primary-key read per page, max 10). */
async function getWorstStatusPage(isAdmin: boolean): Promise<WorkspaceHealth['statusPage']> {
  const pages = await prisma.statusPage
    .findMany({ where: { enabled: true }, select: { id: true, name: true }, take: 10 })
    .catch(() => []);
  const snapshots = await Promise.all(
    pages.map(async page => ({
      name: page.name,
      status: (await readStatusPageSnapshot(page.id).catch(() => null))?.status,
    }))
  );
  const bad = snapshots
    .filter(
      (p): p is { name: string; status: StatusPageSeverity } =>
        !!p.status && p.status in SEVERITY_RANK
    )
    .sort((a, b) => SEVERITY_RANK[b.status] - SEVERITY_RANK[a.status]);
  return bad[0]
    ? {
        status: bad[0].status,
        pageName: bad[0].name,
        more: bad.length - 1,
        href: isAdmin ? '/settings/status-pages' : null,
      }
    : null;
}

/** In-progress executions in the actor's runbook scope; (status, updatedAt) index, not a full scan. */
async function getRunningRunbooks(actor: AuthorizationActor) {
  try {
    return await prisma.runbookExecution.count({
      where: {
        AND: [
          runbookExecutionReadWhere(actor),
          { status: { in: ['RUNNING', 'WAITING_AGENT', 'WAITING_APPROVAL'] } },
        ],
      },
    });
  } catch {
    return 0; // no runbook read access (the filter throws) or a failed read
  }
}

const INGESTION_DELAY_MS = 5 * 60 * 1000;

/** Oldest PENDING receipt via the (status, availableAt) index: one row, no count. */
async function getIngestionDelayed(now: Date) {
  const oldest = await prisma.ingestionReceipt
    .findFirst({
      where: {
        status: 'PENDING',
        availableAt: { lt: new Date(now.getTime() - INGESTION_DELAY_MS) },
      },
      select: { id: true },
    })
    .catch(() => null);
  return oldest !== null;
}

/** The actor's current and next week of on-call shifts, trimmed for the status bar. */
async function getStatusBarShifts(actor: AuthorizationActor, now: Date): Promise<StatusBarShift[]> {
  const { shifts } = await getMyOnCallShifts({
    userId: actor.id,
    now,
    readWhere: scheduleReadWhere(actor),
    days: 7,
    limit: 10,
  });
  return shifts.map(({ scheduleId, scheduleName, start, end, endClamped }) => ({
    scheduleId,
    scheduleName,
    start,
    end,
    endClamped,
  }));
}

export type StatusBarData = {
  counts: MyIncidentCounts;
  shifts: StatusBarShift[];
  health: WorkspaceHealth;
  /** When the data was read, so the client's first render matches the server HTML. */
  renderedAt: number;
};

/** Initial status bar data for the app layout. Never rejects: a failed read hides its item. */
export async function getStatusBarData(actor: AuthorizationActor): Promise<StatusBarData> {
  const now = new Date();
  const [counts, shifts, health] = await Promise.allSettled([
    getMyIncidentCounts(actor),
    getStatusBarShifts(actor, now),
    getWorkspaceHealth(actor),
  ]);
  if (counts.status === 'rejected' || shifts.status === 'rejected' || health.status === 'rejected')
    logger.warn('[Status Bar] Failed to load initial data', {
      component: 'status-bar',
      counts: counts.status === 'rejected' ? String(counts.reason) : 'ok',
      shifts: shifts.status === 'rejected' ? String(shifts.reason) : 'ok',
      health: health.status === 'rejected' ? String(health.reason) : 'ok',
    });
  return {
    counts: counts.status === 'fulfilled' ? counts.value : { assigned: 0, unacked: 0 },
    shifts: shifts.status === 'fulfilled' ? shifts.value : [],
    health: health.status === 'fulfilled' ? health.value : { ...EMPTY_HEALTH, asOf: now.getTime() },
    renderedAt: now.getTime(),
  };
}
