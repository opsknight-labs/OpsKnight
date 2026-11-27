'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v4';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import { businessServiceReadWhere } from '@/lib/business-services/commands';
import { getBusinessServiceHealth } from '@/lib/business-services/contract';
import { activeIncidentStatuses } from '@/lib/incident-status';
import {
  declareDependency,
  removeDependency,
  reviewDependency,
} from '@/lib/intelligence/dependencies/service';
import {
  getGraphStatusesForActor,
  getServiceGraphForActor,
  type GraphStatuses,
  type ServiceGraphView,
} from '@/lib/intelligence/dependencies/graph-view';
import { onCallFor } from '@/lib/business-services/on-call';
import { CAPABILITIES } from '@/lib/authorization';
import { actorHasCapability, type AuthorizationActor } from '@/lib/authorization-policy';
import {
  diffGraph,
  findSinglePointsOfFailure,
  getGraphAt,
  graphTimeline,
  simulateFailure,
} from '@/lib/intelligence/dependencies/insights/service';
import {
  createView,
  deleteView,
  listViews,
  revokeShare,
  setEmbedEnabled,
  shareView,
  updateView,
  viewInputSchema,
} from '@/lib/intelligence/dependencies/insights/views';
import { assertCanModifyService, getCurrentAuthorizationActor } from '@/lib/rbac';

export type GraphActionResult = { ok: boolean; message: string };

const id = z.string().trim().min(1).max(100);
const connectSchema = z
  .object({
    downstreamServiceId: id,
    upstreamServiceId: id,
    dependencyType: z.enum(['HARD', 'SOFT']).optional(),
    note: z.string().trim().max(500, 'A note can be at most 500 characters.').nullable().optional(),
    criticality: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable().optional(),
  })
  .strict()
  .refine(input => input.downstreamServiceId !== input.upstreamServiceId, {
    message: 'A service cannot depend on itself.',
  });
const edgeSchema = z.object({ dependencyId: id }).strict();
const reviewSchema = z
  .object({ dependencyId: id, decision: z.enum(['APPROVE', 'REJECT']) })
  .strict();
const statusesSchema = z
  .object({
    services: z.array(id).max(2500),
    businessServices: z.array(id).max(500),
  })
  .strict();
const expandSchema = z.object({ serviceId: id }).strict();
const detailsSchema = z.object({ kind: z.enum(['bs', 'svc']), id }).strict();

async function guarded(
  label: string,
  run: () => Promise<GraphActionResult>
): Promise<GraphActionResult> {
  try {
    const result = await run();
    if (result.ok) revalidatePath('/services/graph');
    return result;
  } catch (error) {
    if (error instanceof AppError) return { ok: false, message: error.userMessage };
    logger.error(`[ServiceGraph] ${label} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, message: 'Unable to save. Refresh and try again.' };
  }
}

/** A readable dependency edge, so ids from the client never reach edges the caller cannot see. */
async function readableEdge(dependencyId: string, status?: 'SUGGESTED') {
  const readable = serviceReadWhere(await getCurrentAuthorizationActor());
  return prisma.serviceDependency.findFirst({
    where: { id: dependencyId, status, upstream: readable, downstream: readable },
    select: { id: true, downstreamServiceId: true },
  });
}

/**
 * Drag-to-connect: "downstream depends on upstream". The caller must be able to change the
 * dependent service (responders their teams' services, admins any) and read both; the write and its
 * audit entry are the existing `declareDependency`.
 */
export async function connectServicesAction(input: unknown): Promise<GraphActionResult> {
  return guarded('connect', async () => {
    const parsed = connectSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid request.' };
    const { downstreamServiceId, upstreamServiceId, ...semantics } = parsed.data;
    const user = await assertCanModifyService(downstreamServiceId);
    const readable = serviceReadWhere(await getCurrentAuthorizationActor());
    const count = await prisma.service.count({
      where: { AND: [{ id: { in: [downstreamServiceId, upstreamServiceId] } }, readable] },
    });
    if (count !== 2) return { ok: false, message: 'That service no longer exists.' };
    await declareDependency(
      { downstreamServiceId, upstreamServiceId, ...semantics },
      {
        actorId: user.id,
        source: 'UI',
      }
    );
    return { ok: true, message: 'Dependency added.' };
  });
}

export async function disconnectDependencyAction(input: unknown): Promise<GraphActionResult> {
  return guarded('disconnect', async () => {
    const parsed = edgeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: 'Invalid request.' };
    const edge = await readableEdge(parsed.data.dependencyId);
    if (!edge) return { ok: false, message: 'That dependency no longer exists.' };
    const user = await assertCanModifyService(edge.downstreamServiceId);
    const result = await removeDependency(edge.id, { actorId: user.id, source: 'UI' });
    return result === 'removed'
      ? { ok: true, message: 'Dependency removed.' }
      : { ok: false, message: 'That dependency no longer exists.' };
  });
}

export async function reviewSuggestedDependencyAction(input: unknown): Promise<GraphActionResult> {
  return guarded('review', async () => {
    const parsed = reviewSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: 'Choose accept or reject.' };
    const edge = await readableEdge(parsed.data.dependencyId, 'SUGGESTED');
    if (!edge) return { ok: false, message: 'That suggestion no longer exists.' };
    const user = await assertCanModifyService(edge.downstreamServiceId);
    const result = await reviewDependency(edge.id, parsed.data.decision, {
      actorId: user.id,
      source: 'UI',
    });
    if (result !== 'updated') return { ok: false, message: 'That suggestion no longer exists.' };
    return {
      ok: true,
      message: parsed.data.decision === 'APPROVE' ? 'Dependency accepted.' : 'Suggestion rejected.',
    };
  });
}

export type GraphNodeDetails = {
  owner: { id: string; name: string } | null;
  /** Who the first escalation step reaches now; null when there is none or it cannot be read. */
  onCall: { label: string; names: string[] } | null;
  incidents: Array<{
    id: string;
    title: string;
    urgency: 'HIGH' | 'MEDIUM' | 'LOW';
    status: string;
    createdAt: string;
  }>;
};

/** Side-panel details for one node: owner, on call now and up to three open incidents (scoped). */
export async function getGraphNodeDetailsAction(input: unknown): Promise<GraphNodeDetails | null> {
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return null;
  try {
    const actor = await getCurrentAuthorizationActor();
    if (actor.status !== 'ACTIVE') return null;
    const services = serviceReadWhere(actor);
    let incidentScope: ReturnType<typeof incidentReadWhere> | null;
    try {
      incidentScope = incidentReadWhere(actor);
    } catch {
      incidentScope = null;
    }
    const open = { status: { in: activeIncidentStatuses() } };
    const incidentSelect = {
      id: true,
      title: true,
      urgency: true,
      status: true,
      createdAt: true,
    } as const;
    if (parsed.data.kind === 'bs') {
      const bs = await prisma.businessService.findFirst({
        where: { AND: [{ id: parsed.data.id }, businessServiceReadWhere(actor)] },
        select: { ownerTeam: { select: { id: true, name: true } } },
      });
      if (!bs) return null;
      // The engine's reasons are the incidents impacting it now (unmarked ones already dropped,
      // one entry per incident however many impact intervals it has had).
      const health = (await getBusinessServiceHealth([parsed.data.id], actor)).get(parsed.data.id);
      const impacting = [
        ...new Set(
          (health?.reasons ?? []).flatMap(reason =>
            'incidentId' in reason ? [reason.incidentId] : []
          )
        ),
      ];
      const incidents =
        incidentScope && impacting.length
          ? await prisma.incident.findMany({
              where: { AND: [{ id: { in: impacting } }, open, incidentScope] },
              orderBy: { createdAt: 'desc' },
              take: 3,
              select: incidentSelect,
            })
          : [];
      return { owner: bs.ownerTeam, onCall: null, incidents: incidents.map(serialize) };
    }
    const service = await prisma.service.findFirst({
      where: { AND: [{ id: parsed.data.id }, services] },
      select: {
        team: { select: { id: true, name: true } },
        policy: {
          select: {
            steps: {
              orderBy: { stepOrder: 'asc' },
              take: 1,
              select: {
                targetType: true,
                targetUser: { select: { name: true, email: true } },
                targetTeam: { select: { name: true } },
                targetScheduleId: true,
                targetSchedule: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!service) return null;
    const [incidents, onCall] = await Promise.all([
      incidentScope
        ? prisma.incident.findMany({
            where: { AND: [{ serviceId: parsed.data.id }, open, incidentScope] },
            orderBy: { createdAt: 'desc' },
            take: 3,
            select: incidentSelect,
          })
        : [],
      onCallFor(service.policy?.steps[0] ?? null, actor),
    ]);
    return { owner: service.team, onCall, incidents: incidents.map(serialize) };
  } catch (error) {
    if (!(error instanceof AppError))
      logger.error('[ServiceGraph] details failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    return null;
  }
}

function serialize(incident: {
  id: string;
  title: string;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  status: string;
  createdAt: Date;
}) {
  return { ...incident, createdAt: incident.createdAt.toISOString() };
}

/**
 * Live statuses for the nodes the client already shows, polled by the explorer. Read-only and scoped
 * to what the caller may read; it never revalidates the page, so the layout is not recomputed.
 */
export async function getGraphStatusesAction(input: unknown): Promise<GraphStatuses | null> {
  const parsed = statusesSchema.safeParse(input);
  if (!parsed.success) return null;
  try {
    const actor = await getCurrentAuthorizationActor();
    if (actor.status !== 'ACTIVE') return null;
    return await getGraphStatusesForActor(actor, parsed.data);
  } catch (error) {
    if (!(error instanceof AppError))
      logger.error('[ServiceGraph] statuses failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    return null;
  }
}

/** One hop of neighbours around a service, to merge into the loaded graph ("Load neighbours"). */
export async function expandNeighboursAction(input: unknown): Promise<ServiceGraphView | null> {
  const parsed = expandSchema.safeParse(input);
  if (!parsed.success) return null;
  try {
    const actor = await getCurrentAuthorizationActor();
    if (actor.status !== 'ACTIVE') return null;
    return await getServiceGraphForActor(actor, prisma, {
      focus: { kind: 'svc', id: parsed.data.serviceId },
      hops: 1,
      access: 'service',
    });
  } catch (error) {
    if (!(error instanceof AppError))
      logger.error('[ServiceGraph] expand failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    return null;
  }
}

// ---- Insights: time travel, changes, single points of failure, failure simulation, saved views ----

export type InsightResult<T> = { ok: true; data: T } | { ok: false; message: string };

/** Session actor, active users only. Reads never revalidate; the page is not stale after them. */
async function insight<T>(
  label: string,
  run: (actor: AuthorizationActor) => Promise<T>,
  options: { admin?: boolean; revalidate?: string } = {}
): Promise<InsightResult<T>> {
  try {
    const actor = await getCurrentAuthorizationActor();
    if (actor.status !== 'ACTIVE') return { ok: false, message: 'You do not have access to this.' };
    if (options.admin && !actorHasCapability(actor, CAPABILITIES.ADMIN_MANAGE))
      return { ok: false, message: 'Only administrators can do this.' };
    const data = await run(actor);
    if (options.revalidate) revalidatePath(options.revalidate);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof AppError) return { ok: false, message: error.userMessage };
    logger.error(`[ServiceGraph] ${label} failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, message: 'Something went wrong. Refresh and try again.' };
  }
}

const scope = {
  focus: z.string().trim().max(110).optional(),
  hops: z.number().int().min(1).max(3).optional(),
};
const atSchema = z.object({ at: z.iso.datetime({ offset: true }), ...scope }).strict();
const diffSchema = z.object({ since: z.iso.datetime({ offset: true }), ...scope }).strict();
const spofSchema = z
  .object({ threshold: z.number().int().min(1).max(200).optional(), ...scope })
  .strict();
const simulateSchema = z
  .object({
    serviceIds: z.array(id).min(1).max(20),
    maxDepth: z.number().int().min(1).max(10).optional(),
  })
  .strict();
const timelineSchema = z.object({ ...scope }).strict();
const viewIdSchema = z.object({ id }).strict();
const shareSchema = z
  .object({ id, expiresInDays: z.number().int().min(1).max(90).default(30) })
  .strict();
const embedSchema = z.object({ enabled: z.boolean() }).strict();

const invalid = <T>(): InsightResult<T> => ({ ok: false, message: 'That request was not valid.' });

export async function getGraphAtAction(input: unknown) {
  const p = atSchema.safeParse(input);
  if (!p.success) return invalid<Awaited<ReturnType<typeof getGraphAt>>>();
  return insight('time travel', actor =>
    getGraphAt(actor, new Date(p.data.at), { focus: p.data.focus, hops: p.data.hops })
  );
}

export async function diffGraphAction(input: unknown) {
  const p = diffSchema.safeParse(input);
  if (!p.success) return invalid<Awaited<ReturnType<typeof diffGraph>>>();
  return insight('changes', actor =>
    diffGraph(actor, new Date(p.data.since), { focus: p.data.focus, hops: p.data.hops })
  );
}

/** Per-day incident and change counts for the time-travel slider's tick marks. */
export async function getGraphTimelineAction(input: unknown) {
  const p = timelineSchema.safeParse(input);
  if (!p.success) return invalid<Awaited<ReturnType<typeof graphTimeline>>>();
  return insight('timeline', actor => graphTimeline(actor, p.data));
}

export async function findSpofAction(input: unknown) {
  const p = spofSchema.safeParse(input);
  if (!p.success) return invalid<Awaited<ReturnType<typeof findSinglePointsOfFailure>>>();
  return insight('single points of failure', actor => findSinglePointsOfFailure(actor, p.data));
}

export async function simulateFailureAction(input: unknown) {
  const p = simulateSchema.safeParse(input);
  if (!p.success) return invalid<Awaited<ReturnType<typeof simulateFailure>>>();
  return insight('failure simulation', actor =>
    simulateFailure(actor, p.data.serviceIds, { maxDepth: p.data.maxDepth })
  );
}

export async function listGraphViewsAction() {
  return insight('list views', actor => listViews(actor));
}

export async function createGraphViewAction(input: unknown) {
  const p = viewInputSchema.safeParse(input);
  if (!p.success) return invalid<Awaited<ReturnType<typeof createView>>>();
  return insight('create view', actor => createView(actor, p.data));
}

export async function renameGraphViewAction(input: unknown) {
  const p = z
    .object({ id, name: z.string().trim().min(1).max(120) })
    .strict()
    .safeParse(input);
  if (!p.success) return invalid<Awaited<ReturnType<typeof updateView>>>();
  return insight('rename view', actor => updateView(actor, p.data.id, { name: p.data.name }));
}

export async function deleteGraphViewAction(input: unknown) {
  const p = viewIdSchema.safeParse(input);
  if (!p.success) return invalid<null>();
  return insight('delete view', async actor => {
    await deleteView(actor, p.data.id);
    return null;
  });
}

/** Admin only. The token is returned once; only its hash is stored. */
export async function shareGraphViewAction(input: unknown) {
  const p = shareSchema.safeParse(input);
  if (!p.success) return invalid<Awaited<ReturnType<typeof shareView>>>();
  return insight('share view', actor => shareView(actor, p.data.id, p.data.expiresInDays), {
    admin: true,
  });
}

export async function revokeGraphShareAction(input: unknown) {
  const p = viewIdSchema.safeParse(input);
  if (!p.success) return invalid<null>();
  return insight('revoke share', async actor => {
    await revokeShare(actor, p.data.id);
    return null;
  });
}

/** Admin only: read-only embeds are off until an administrator turns them on. */
export async function setGraphEmbedEnabledAction(input: unknown) {
  const p = embedSchema.safeParse(input);
  if (!p.success) return invalid<null>();
  return insight(
    'embed setting',
    async actor => {
      await setEmbedEnabled(actor, p.data.enabled);
      return null;
    },
    { admin: true, revalidate: '/settings/intelligence/services' }
  );
}
