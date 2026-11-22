'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v4';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import {
  incidentReadWhere,
  scheduleReadWhere,
  serviceReadWhere,
} from '@/lib/authorization-filters';
import { businessServiceReadWhere } from '@/lib/business-services/commands';
import { activeIncidentStatuses } from '@/lib/incident-status';
import {
  declareDependency,
  removeDependency,
  reviewDependency,
} from '@/lib/intelligence/dependencies/service';
import { getActiveOnCallShifts } from '@/lib/oncall-shifts';
import { assertCanModifyService, getCurrentAuthorizationActor } from '@/lib/rbac';

export type GraphActionResult = { ok: boolean; message: string };

const id = z.string().trim().min(1).max(100);
const connectSchema = z
  .object({ downstreamServiceId: id, upstreamServiceId: id })
  .strict()
  .refine(input => input.downstreamServiceId !== input.upstreamServiceId, {
    message: 'A service cannot depend on itself.',
  });
const edgeSchema = z.object({ dependencyId: id }).strict();
const reviewSchema = z
  .object({ dependencyId: id, decision: z.enum(['APPROVE', 'REJECT']) })
  .strict();
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
    const { downstreamServiceId, upstreamServiceId } = parsed.data;
    const user = await assertCanModifyService(downstreamServiceId);
    const readable = serviceReadWhere(await getCurrentAuthorizationActor());
    const count = await prisma.service.count({
      where: { AND: [{ id: { in: [downstreamServiceId, upstreamServiceId] } }, readable] },
    });
    if (count !== 2) return { ok: false, message: 'That service no longer exists.' };
    await declareDependency(
      { downstreamServiceId, upstreamServiceId },
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
      const incidents = incidentScope
        ? await prisma.incident.findMany({
            where: {
              AND: [
                open,
                incidentScope,
                {
                  OR: [
                    {
                      service: {
                        businessServiceMemberships: {
                          some: { businessServiceId: parsed.data.id },
                        },
                      },
                    },
                    {
                      businessServiceImpacts: {
                        some: { businessServiceId: parsed.data.id, excluded: false },
                      },
                    },
                  ],
                },
              ],
            },
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

async function onCallFor(
  step: {
    targetType: string;
    targetUser: { name: string | null; email: string } | null;
    targetTeam: { name: string } | null;
    targetScheduleId: string | null;
    targetSchedule: { name: string } | null;
  } | null,
  actor: Awaited<ReturnType<typeof getCurrentAuthorizationActor>>
): Promise<GraphNodeDetails['onCall']> {
  if (!step) return null;
  if (step.targetUser)
    return { label: 'Escalation target', names: [step.targetUser.name || step.targetUser.email] };
  if (step.targetTeam) return { label: 'Team', names: [step.targetTeam.name] };
  if (!step.targetScheduleId) return null;
  let where;
  try {
    where = scheduleReadWhere(actor);
  } catch {
    return null;
  }
  const shifts = await getActiveOnCallShifts(new Date(), {
    scheduleId: step.targetScheduleId,
    where,
  });
  return {
    label: step.targetSchedule?.name ?? 'Schedule',
    names: [...new Set(shifts.map(shift => shift.user.name || 'Unnamed responder'))],
  };
}
