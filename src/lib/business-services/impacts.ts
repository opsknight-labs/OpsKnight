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
} from './health';

/**
 * Impact history. Rows are written off the paging path by the BUSINESS_SERVICE_IMPACT outbox
 * effect (trigger, acknowledge, resolve and every other lifecycle change) and a 60 s reconcile;
 * both run the same idempotent diff, so replays and overlaps converge on the same rows.
 */

export const BUSINESS_SERVICE_IMPACT_RECONCILE_TASK = 'BUSINESS_SERVICE_IMPACT_RECONCILE';
const RECONCILE_INTERVAL_MS = 60_000;
const SYNC_BATCH = 500;

type Update = {
  incidentId: string;
  businessServiceIds: string[];
  data: Prisma.IncidentBusinessServiceImpactUpdateManyMutationInput;
};

/** Brings the impact rows of these incidents in line with the current health rules. */
export async function syncIncidentImpacts(
  incidentIds: readonly string[],
  now = new Date()
): Promise<{ created: number; updated: number }> {
  const ids = [...new Set(incidentIds)];
  if (!ids.length) return { created: 0, updated: 0 };
  const [snapshot, incidents, rows] = await Promise.all([
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
    prisma.incidentBusinessServiceImpact.findMany({
      where: { incidentId: { in: ids } },
      select: {
        incidentId: true,
        businessServiceId: true,
        source: true,
        excluded: true,
        createdById: true,
        endedAt: true,
      },
    }),
  ]);
  const rowsByIncident = new Map<string, typeof rows>();
  for (const row of rows) {
    rowsByIncident.set(row.incidentId, [...(rowsByIncident.get(row.incidentId) ?? []), row]);
  }
  const creates: Prisma.IncidentBusinessServiceImpactCreateManyInput[] = [];
  const updates: Update[] = [];
  const queue = (incidentId: string, data: Update['data'], bsId: string) => {
    const key = JSON.stringify(data);
    const existing = updates.find(
      u => u.incidentId === incidentId && JSON.stringify(u.data) === key
    );
    if (existing) existing.businessServiceIds.push(bsId);
    else updates.push({ incidentId, businessServiceIds: [bsId], data });
  };

  for (const incident of incidents) {
    const active = isActiveIncidentStatus(incident.status);
    const existing = rowsByIncident.get(incident.id) ?? [];
    const desired: Map<string, BusinessServiceImpactSource> = active
      ? incidentImpactSources({ ...snapshot.inputs, impactRows: existing }, incident)
      : new Map();
    const endedAt = active ? now : (incident.resolvedAt ?? now);
    const end = { endedAt };
    const reopen = { endedAt: null };
    for (const row of existing) {
      const want = desired.get(row.businessServiceId);
      const open = row.endedAt === null;
      if (row.excluded || (row.source === 'MANUAL' ? !active : !want)) {
        if (open) queue(incident.id, end, row.businessServiceId);
        continue;
      }
      if (row.source !== 'MANUAL' && want && want !== row.source) {
        const data = { source: want, endedAt: null };
        queue(incident.id, data, row.businessServiceId);
      } else if (!open) {
        queue(incident.id, reopen, row.businessServiceId);
      }
    }
    const known = new Set(existing.map(row => row.businessServiceId));
    for (const [businessServiceId, source] of desired) {
      if (known.has(businessServiceId) || !snapshot.byId.has(businessServiceId)) continue;
      creates.push({
        incidentId: incident.id,
        businessServiceId,
        source,
        startedAt: incident.createdAt,
      });
    }
  }

  let updated = 0;
  const created = creates.length
    ? (
        await prisma.incidentBusinessServiceImpact.createMany({
          data: creates,
          skipDuplicates: true,
        })
      ).count
    : 0;
  for (const update of updates) {
    const result = await prisma.incidentBusinessServiceImpact.updateMany({
      where: {
        incidentId: update.incidentId,
        businessServiceId: { in: update.businessServiceIds },
      },
      data: update.data,
    });
    updated += result.count;
  }
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
      select: {
        incidentId: true,
        businessServiceId: true,
        source: true,
        excluded: true,
        createdById: true,
        endedAt: true,
      },
    }),
  ]);
  const views = new Map<
    string,
    { source: BusinessServiceImpactSource; excluded: boolean; active: boolean }
  >();
  if (!incident) return views;
  const open = isActiveIncidentStatus(incident.status);
  for (const row of rows) {
    views.set(row.businessServiceId, {
      source: row.source,
      excluded: row.excluded,
      active: open && !row.excluded && !row.endedAt,
    });
  }
  if (open) {
    const snapshot = await getHealthSnapshot();
    for (const [id, source] of incidentImpactSources(
      { ...snapshot.inputs, impactRows: rows },
      incident
    )) {
      if (!views.has(id)) views.set(id, { source, excluded: false, active: true });
    }
  }
  return views;
}

/** Every open incident plus every incident that still has an open impact row, in batches. */
export async function reconcileBusinessServiceImpacts(now = new Date()) {
  const [active, open] = await Promise.all([
    prisma.incident.findMany({
      where: { status: { in: activeIncidentStatuses() } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
      select: { id: true },
    }),
    prisma.incidentBusinessServiceImpact.findMany({
      where: { endedAt: null },
      distinct: ['incidentId'],
      take: 5000,
      select: { incidentId: true },
    }),
  ]);
  const ids = [...new Set([...active.map(row => row.id), ...open.map(row => row.incidentId)])];
  const totals = { incidents: ids.length, created: 0, updated: 0 };
  for (let index = 0; index < ids.length; index += SYNC_BATCH) {
    const result = await syncIncidentImpacts(ids.slice(index, index + SYNC_BATCH), now);
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
  return result;
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
  const key = {
    incidentId_businessServiceId: {
      incidentId: input.incidentId,
      businessServiceId: input.businessServiceId,
    },
  };
  const now = new Date();
  const active = isActiveIncidentStatus(incident.status);
  const run = async (tx: Prisma.TransactionClient) => {
    const current = await tx.incidentBusinessServiceImpact.findUnique({ where: key });
    if (input.impacted) {
      if (current && !current.excluded && (current.endedAt === null || !active)) return false;
      await tx.incidentBusinessServiceImpact.upsert({
        where: key,
        create: {
          ...key.incidentId_businessServiceId,
          source: 'MANUAL',
          startedAt: now,
          endedAt: active ? null : now,
          createdById: actor.id,
        },
        update: {
          source: 'MANUAL',
          excluded: false,
          endedAt: active ? null : now,
          createdById: actor.id,
        },
      });
    } else {
      if (current?.excluded) return false;
      await tx.incidentBusinessServiceImpact.upsert({
        where: key,
        create: {
          ...key.incidentId_businessServiceId,
          source: 'MANUAL',
          excluded: true,
          startedAt: now,
          endedAt: now,
          createdById: actor.id,
        },
        update: { excluded: true, endedAt: current?.endedAt ?? now, createdById: actor.id },
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
        status: { not: 'SUPPRESSED' },
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
  let written = 0;
  if (rows.length && input.apply) {
    written = (
      await prisma.incidentBusinessServiceImpact.createMany({ data: rows, skipDuplicates: true })
    ).count;
  } else if (rows.length) {
    const existing = await prisma.incidentBusinessServiceImpact.count({
      where: {
        OR: rows.map(row => ({
          incidentId: row.incidentId,
          businessServiceId: row.businessServiceId,
        })),
      },
    });
    written = rows.length - existing;
  }
  const last = incidents.at(-1);
  return {
    scanned: incidents.length,
    candidates: rows.length,
    written,
    after: last ? { createdAt: last.createdAt, id: last.id } : undefined,
    done: incidents.length < input.limit,
  };
}
