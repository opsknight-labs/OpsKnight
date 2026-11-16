import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import { CAPABILITIES } from '@/lib/authorization';
import {
  actorHasCapability,
  authorize,
  AUTHORIZATION_ACTIONS,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors/app-error';
import {
  maintenanceWindowPhase,
  maintenanceWindowSelect,
  type MaintenanceWindowRecord,
} from '@/lib/service-maintenance/windows';

export const MaintenanceWindowParams = z
  .object({ id: z.string().regex(/^[a-z0-9_-]{1,64}$/i) })
  .strict();

// The domain command re-validates with its own schema; this is the public wire contract.
const fields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  serviceIds: z.array(z.string().trim().min(1).max(64)).min(1).max(200),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  endBehavior: z.enum(['RESUME_FIRING', 'RESOLVE_HELD']),
  publishToStatusPage: z.boolean(),
};

export const MaintenanceWindowCreateBody = z
  .object({
    ...fields,
    endBehavior: fields.endBehavior.optional(),
    publishToStatusPage: fields.publishToStatusPage.optional(),
  })
  .strict();

export const MaintenanceWindowPatchBody = z
  .object(fields)
  .partial()
  .strict()
  .refine(body => Object.keys(body).length > 0, 'Send at least one field to change.');

/**
 * Projects a window for an API caller. Services outside the caller's read scope are
 * left out, so a window shared with another team never reveals that team's services.
 */
export function projectMaintenanceWindow(
  row: MaintenanceWindowRecord,
  actor: AuthorizationActor,
  now = new Date()
) {
  const decision = authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_READ });
  const teams = new Set(actor.teamIds);
  const visible = row.services.filter(
    s =>
      decision.allowed &&
      (decision.scope === 'global' || (s.service.teamId !== null && teams.has(s.service.teamId)))
  );
  return {
    id: row.id,
    revision: row.revision,
    title: row.title,
    description: row.description,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    endBehavior: row.endBehavior,
    publishToStatusPage: row.publishToStatusPage,
    phase: maintenanceWindowPhase(row, now),
    serviceIds: visible.map(s => s.serviceId),
    heldIncidentCount: row._count.heldIncidents,
    endProcessedAt: row.endProcessedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Windows touching at least one service the actor can read. */
export function maintenanceWindowReadWhere(
  actor: AuthorizationActor
): Prisma.MaintenanceWindowWhereInput {
  return { services: { some: { service: serviceReadWhere(actor) } } };
}

export async function requireReadableMaintenanceWindow(
  db: Prisma.TransactionClient,
  actor: AuthorizationActor,
  id: string
): Promise<MaintenanceWindowRecord> {
  const row = await db.maintenanceWindow.findFirst({
    where: { id, ...maintenanceWindowReadWhere(actor) },
    select: maintenanceWindowSelect,
  });
  if (!row) {
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      userMessage: 'Maintenance window not found.',
    });
  }
  return row;
}

/**
 * Mirrors assertCanModifyService: admins may touch any service, everyone else
 * (already holding operations.manage) only services owned by one of their teams.
 * Unknown IDs are denied for non-admins so the response never reveals existence.
 */
export async function assertCanManageMaintenanceServices(
  db: Prisma.TransactionClient,
  actor: AuthorizationActor,
  serviceIds: readonly string[]
): Promise<void> {
  if (actorHasCapability(actor, CAPABILITIES.ADMIN_MANAGE)) return;
  const ids = [...new Set(serviceIds)];
  const allowed = await db.service.count({
    where: { id: { in: ids }, teamId: { in: [...actor.teamIds] } },
  });
  if (allowed !== ids.length) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'You can only manage maintenance for services owned by your teams.',
    });
  }
}
