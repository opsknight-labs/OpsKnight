import 'server-only';

import type { BusinessServiceImpactSource, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { emitAuditEvent, type AuditEventSource } from '@/lib/audit';
import { incidentReadWhere } from '@/lib/authorization-filters';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { activeIncidentStatuses, isActiveIncidentStatus } from '@/lib/incident-status';
import { logger } from '@/lib/logger';
import type { SetIncidentImpactInput } from './contract';
import {
  getHealthSnapshot,
  incidentImpactSources,
  invalidateBusinessServiceHealth,
  latestImpactRows,
} from './health';

/**
 * Impact history. Rows are written off the paging path by the BUSINESS_SERVICE_IMPACT outbox
 * effect (trigger, acknowledge, resolve and every other lifecycle change) and a 60 s reconcile;
 * both run the same idempotent diff, so replays and overlaps converge on the same rows.
 */

export const BUSINESS_SERVICE_IMPACT_RECONCILE_TASK = 'BUSINESS_SERVICE_IMPACT_RECONCILE';
const RECONCILE_INTERVAL_MS = 60_000;
const SYNC_BATCH = 500;

const IMPACT_ROW_SELECT = {
  id: true,
  incidentId: true,
  businessServiceId: true,
  source: true,
  excluded: true,
  createdById: true,
  startedAt: true,
  endedAt: true,
} satisfies Prisma.IncidentBusinessServiceImpactSelect;

/**
 * Brings the impact intervals of these incidents in line with the current health rules. The
 * latest interval per business service carries its state: an open one is kept (its source
 * follows the rules), a closed one that should be impacting starts a new interval from now, so a
 * reopened incident never counts its healthy gap as downtime. Exclusions and manual marks win.
 */
export async function syncIncidentImpacts(
  incidentIds: readonly string[],
  now = new Date()
): Promise<{ created: number; updated: number }> {
  const ids = [...new Set(incidentIds)];
  if (!ids.length) return { created: 0, updated: 0 };
  const [snapshot, incidents] = await Promise.all([
    getHealthSnapshot(),
    prisma.incident.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        serviceId: true,
        urgency: true,
        priority: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
      },
    }),
  ]);
  const readRows = (db: Prisma.TransactionClient | typeof prisma) =>
    db.incidentBusinessServiceImpact.findMany({
      where: { incidentId: { in: ids } },
      select: IMPACT_ROW_SELECT,
    });

  const plan = (rows: Awaited<ReturnType<typeof readRows>>) => {
    const rowsByIncident = new Map<string, typeof rows>();
    for (const row of rows) {
      rowsByIncident.set(row.incidentId, [...(rowsByIncident.get(row.incidentId) ?? []), row]);
    }
    const creates: Prisma.IncidentBusinessServiceImpactCreateManyInput[] = [];
    const updates = new Map<
      string,
      { ids: string[]; data: Prisma.IncidentBusinessServiceImpactUpdateManyMutationInput }
    >();
    const lockKeys = new Set<string>();
    const queue = (
      id: string,
      data: Prisma.IncidentBusinessServiceImpactUpdateManyMutationInput
    ) => {
      const key = JSON.stringify(data);
      const entry = updates.get(key);
      if (entry) entry.ids.push(id);
      else updates.set(key, { ids: [id], data });
    };

    for (const incident of incidents) {
      const active = isActiveIncidentStatus(incident.status);
      const existing = rowsByIncident.get(incident.id) ?? [];
      // An incident resolved before its first sync has no rows yet: compute what it impacted
      // while it was open, so its downtime still reaches stats, SLOs and reviews.
      const resolvedUnseen = !active && incident.status === 'RESOLVED' && existing.length === 0;
      const desired: Map<string, BusinessServiceImpactSource> =
        active || resolvedUnseen
          ? incidentImpactSources({ ...snapshot.inputs, impactRows: existing }, incident)
          : new Map();
      const endedAt = active ? now : (incident.resolvedAt ?? now);
      // Any stray open interval that is not the latest is closed (concurrent writers).
      const latest = latestImpactRows(existing);
      const latestIds = new Set([...latest.values()].map(row => row.id));
      for (const row of existing) {
        lockKeys.add(`${incident.id}:${row.businessServiceId}`);
        if (row.endedAt === null && !latestIds.has(row.id)) queue(row.id, { endedAt: now });
      }
      for (const row of latest.values()) {
        const open = row.endedAt === null;
        const want = desired.get(row.businessServiceId);
        const impacting = !row.excluded && (row.source === 'MANUAL' ? active : !!want);
        if (!impacting) {
          if (open) queue(row.id, { endedAt });
          continue;
        }
        const source = row.source === 'MANUAL' ? 'MANUAL' : want!;
        if (!open) {
          creates.push({
            incidentId: incident.id,
            businessServiceId: row.businessServiceId,
            source,
            startedAt: now,
            createdById: row.source === 'MANUAL' ? row.createdById : null,
          });
        } else if (source !== row.source) {
          queue(row.id, { source });
        }
      }
      const known = new Set(existing.map(row => row.businessServiceId));
      for (const [businessServiceId, source] of desired) {
        lockKeys.add(`${incident.id}:${businessServiceId}`);
        if (known.has(businessServiceId) || !snapshot.byId.has(businessServiceId)) continue;
        // The first interval starts with the incident, even when this sync runs late.
        creates.push({
          incidentId: incident.id,
          businessServiceId,
          source,
          startedAt: incident.createdAt,
          ...(resolvedUnseen ? { endedAt: incident.resolvedAt ?? incident.createdAt } : {}),
        });
      }
    }
    return { creates, updates, lockKeys };
  };

  const first = plan(await readRows(prisma));
  if (!first.creates.length && !first.updates.size) return { created: 0, updated: 0 };
  // Pair locks (shared with setIncidentImpactCommand) keep a concurrent unmark from being undone
  // by a stale plan: rows are re-read under the locks and the plan is rebuilt from them.
  const keys = [...first.lockKeys].sort();
  const { created, updated } = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(k, 0)) FROM (SELECT k FROM unnest(${keys.map(key => `bs-impact:${key}`)}::text[]) AS t(k) ORDER BY k) AS locks`;
    const { creates, updates } = plan(await readRows(tx));
    let updated = 0;
    for (const update of updates.values()) {
      const result = await tx.incidentBusinessServiceImpact.updateMany({
        where: { id: { in: update.ids } },
        data: update.data,
      });
      updated += result.count;
    }
    // skipDuplicates rides the open-interval unique index, so a concurrent sync cannot double-open.
    const created = creates.length
      ? (await tx.incidentBusinessServiceImpact.createMany({ data: creates, skipDuplicates: true }))
          .count
      : 0;
    return { created, updated };
  });
  return { created, updated };
}

/**
 * Business services an incident impacts, unscoped: its recorded rows plus what the engine
 * computes now for an open incident (the outbox effect may not have written them yet).
 */
export async function incidentImpactViews(incidentId: string) {
  const [incident, rows] = await Promise.all([
    prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        id: true,
        serviceId: true,
        urgency: true,
        priority: true,
        status: true,
        createdAt: true,
      },
    }),
    prisma.incidentBusinessServiceImpact.findMany({
      where: { incidentId },
      select: IMPACT_ROW_SELECT,
    }),
  ]);
  const views = new Map<
    string,
    { source: BusinessServiceImpactSource; excluded: boolean; active: boolean }
  >();
  if (!incident) return views;
  const open = isActiveIncidentStatus(incident.status);
  const live = open
    ? incidentImpactSources({ ...(await getHealthSnapshot()).inputs, impactRows: rows }, incident)
    : new Map<string, BusinessServiceImpactSource>();
  for (const row of latestImpactRows(rows).values()) {
    views.set(row.businessServiceId, {
      source: row.source,
      excluded: row.excluded,
      active:
        open &&
        !row.excluded &&
        (row.endedAt === null || row.source === 'MANUAL' || live.has(row.businessServiceId)),
    });
  }
  for (const [id, source] of live) {
    if (!views.has(id)) views.set(id, { source, excluded: false, active: true });
  }
  return views;
}

/** Every open incident plus every incident that still has an open impact row, in batches. */
export async function reconcileBusinessServiceImpacts(now = new Date(), pageSize = 5000) {
  // Keyset pages by incident id so no incident is skipped however many are open.
  const ids = new Set<string>();
  for (let after: string | undefined; ;) {
    const page = await prisma.incident.findMany({
      where: { status: { in: activeIncidentStatuses() } },
      orderBy: { id: 'asc' },
      take: pageSize,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: { id: true },
    });
    page.forEach(row => ids.add(row.id));
    if (page.length < pageSize) break;
    after = page[page.length - 1].id;
  }
  for (let after: string | undefined; ;) {
    const page = await prisma.incidentBusinessServiceImpact.findMany({
      where: { endedAt: null, ...(after ? { incidentId: { gt: after } } : {}) },
      distinct: ['incidentId'],
      orderBy: { incidentId: 'asc' },
      take: pageSize,
      select: { incidentId: true },
    });
    page.forEach(row => ids.add(row.incidentId));
    if (page.length < pageSize) break;
    after = page[page.length - 1].incidentId;
  }
  const all = [...ids];
  const totals = { incidents: all.length, created: 0, updated: 0 };
  for (let index = 0; index < all.length; index += SYNC_BATCH) {
    const result = await syncIncidentImpacts(all.slice(index, index + SYNC_BATCH), now);
    totals.created += result.created;
    totals.updated += result.updated;
  }
  if (totals.created || totals.updated) invalidateBusinessServiceHealth();
  return totals;
}

/** One reconcile job per minute bucket; the deterministic id makes the enqueue idempotent. */
export async function enqueueBusinessServiceImpactReconcile(now = new Date()) {
  const bucket = Math.floor(now.getTime() / RECONCILE_INTERVAL_MS);
  await prisma.backgroundJob.createMany({
    data: [
      {
        id: `business-service-impact-reconcile:${bucket}`,
        type: 'SCHEDULED_TASK',
        status: 'PENDING',
        scheduledAt: now,
        maxAttempts: 1,
        payload: { task: BUSINESS_SERVICE_IMPACT_RECONCILE_TASK },
      },
    ],
    skipDuplicates: true,
  });
}

export async function processBusinessServiceImpactReconcile() {
  const result = await reconcileBusinessServiceImpacts();
  if (result.created || result.updated) logger.info('business_services.impacts_reconciled', result);
  // Status can change without impact rows changing (maintenance, overrides, edits), so always check.
  const { emitBusinessServiceStatusChanges } = await import('./status-events');
  const announced = await emitBusinessServiceStatusChanges().catch(error => {
    logger.warn('business_services.status_events_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  });
  return { ...result, announced };
}

/**
 * A responder marks an incident as impacting a business service (MANUAL) or unmarks it. An
 * unmark is kept as an excluded row so the outbox effect and reconcile never re-add it.
 */
export async function setIncidentImpactCommand(
  input: SetIncidentImpactInput,
  actor: AuthorizationActor,
  source: AuditEventSource = 'UI',
  client?: Prisma.TransactionClient
): Promise<{ changed: boolean }> {
  if (!authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE }).allowed) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'Only Responders and Admins can change business impact.',
    });
  }
  const { businessServiceReadWhere } = await import('./commands');
  const db = client ?? prisma;
  const [incident, businessService] = await Promise.all([
    db.incident.findFirst({
      where: { AND: [{ id: input.incidentId }, incidentReadWhere(actor)] },
      select: { id: true, status: true },
    }),
    db.businessService.findFirst({
      where: { AND: [{ id: input.businessServiceId }, businessServiceReadWhere(actor)] },
      select: { id: true },
    }),
  ]);
  if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
  if (!businessService) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  const pair = { incidentId: input.incidentId, businessServiceId: input.businessServiceId };
  const now = new Date();
  const active = isActiveIncidentStatus(incident.status);
  const run = async (tx: Prisma.TransactionClient) => {
    // Serializes marks on one pair so two requests cannot both open an interval.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bs-impact:${pair.incidentId}:${pair.businessServiceId}`}, 0))`;
    const latest = await tx.incidentBusinessServiceImpact.findFirst({
      where: pair,
      orderBy: [{ startedAt: 'desc' }, { createdAt: 'desc' }],
    });
    if (input.impacted) {
      if (latest && !latest.excluded && (latest.endedAt === null || !active)) return false;
      await tx.incidentBusinessServiceImpact.updateMany({
        where: { ...pair, endedAt: null },
        data: { endedAt: now },
      });
      // A new interval from now: earlier (possibly unmarked) intervals keep their own flags.
      await tx.incidentBusinessServiceImpact.create({
        data: {
          ...pair,
          source: 'MANUAL',
          startedAt: now,
          endedAt: active ? null : now,
          createdById: actor.id,
        },
      });
    } else {
      if (latest?.excluded) return false;
      // Unmarking says the incident never impacted it: every interval leaves the numbers.
      await tx.incidentBusinessServiceImpact.updateMany({
        where: { ...pair, endedAt: null },
        data: { endedAt: now },
      });
      await tx.incidentBusinessServiceImpact.updateMany({
        where: pair,
        data: { excluded: true },
      });
      if (!latest)
        await tx.incidentBusinessServiceImpact.create({
          data: {
            ...pair,
            source: 'MANUAL',
            excluded: true,
            startedAt: now,
            endedAt: now,
            createdById: actor.id,
          },
        });
    }
    await emitAuditEvent(
      {
        action: input.impacted
          ? 'business_service.impact_marked'
          : 'business_service.impact_unmarked',
        source,
        target: { type: 'BUSINESS_SERVICE', id: input.businessServiceId },
        actor: { type: 'USER', id: actor.id },
        newValue: { incidentId: input.incidentId, impacted: input.impacted },
      },
      tx
    );
    return true;
  };
  const changed = await (client ? run(client) : prisma.$transaction(run));
  if (changed) invalidateBusinessServiceHealth();
  return { changed };
}

export type ImpactBackfillCursor = { createdAt: Date; id: string };

/**
 * One batch of the historical backfill: DIRECT rows for incidents created since `since`, using
 * today's membership and thresholds. Never touches existing rows (exclusions and manual marks
 * win), so reruns are no-ops. Dry runs only count what would be written.
 */
export async function backfillDirectImpacts(input: {
  since: Date;
  limit: number;
  after?: ImpactBackfillCursor;
  apply: boolean;
}) {
  const { meetsThreshold, impactThreshold } = await import('./health');
  const [services, incidents] = await Promise.all([
    prisma.businessService.findMany({
      select: {
        id: true,
        criticality: true,
        impactMinUrgency: true,
        impactMaxPriority: true,
        members: { select: { serviceId: true } },
      },
    }),
    prisma.incident.findMany({
      where: {
        createdAt: { gte: input.since },
        // Same as the live engine: held, suppressed and snoozed incidents never impact.
        status: { notIn: ['SUPPRESSED', 'SNOOZED'] },
        ...(input.after
          ? {
              OR: [
                { createdAt: { gt: input.after.createdAt } },
                { createdAt: input.after.createdAt, id: { gt: input.after.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: input.limit,
      select: {
        id: true,
        serviceId: true,
        urgency: true,
        priority: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
      },
    }),
  ]);
  const byService = new Map<string, Array<(typeof services)[number]>>();
  for (const service of services) {
    for (const member of service.members) {
      byService.set(member.serviceId, [...(byService.get(member.serviceId) ?? []), service]);
    }
  }
  const rows: Prisma.IncidentBusinessServiceImpactCreateManyInput[] = [];
  for (const incident of incidents) {
    for (const service of byService.get(incident.serviceId) ?? []) {
      if (!meetsThreshold(incident, impactThreshold(service))) continue;
      rows.push({
        incidentId: incident.id,
        businessServiceId: service.id,
        source: 'DIRECT',
        startedAt: incident.createdAt,
        endedAt:
          incident.status === 'RESOLVED' ? (incident.resolvedAt ?? incident.createdAt) : null,
      });
    }
  }
  // Intervals have no pair-unique key, so pairs that already have any row are skipped explicitly.
  const existing = rows.length
    ? await prisma.incidentBusinessServiceImpact.findMany({
        where: { incidentId: { in: [...new Set(rows.map(row => row.incidentId))] } },
        distinct: ['incidentId', 'businessServiceId'],
        select: { incidentId: true, businessServiceId: true },
      })
    : [];
  const known = new Set(existing.map(row => `${row.incidentId}:${row.businessServiceId}`));
  const missing = rows.filter(row => !known.has(`${row.incidentId}:${row.businessServiceId}`));
  const written =
    missing.length && input.apply
      ? (
          await prisma.incidentBusinessServiceImpact.createMany({
            data: missing,
            skipDuplicates: true,
          })
        ).count
      : missing.length;
  const last = incidents.at(-1);
  return {
    scanned: incidents.length,
    candidates: rows.length,
    written,
    after: last ? { createdAt: last.createdAt, id: last.id } : undefined,
    done: incidents.length < input.limit,
  };
}
