import 'server-only';

import type { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { emitAuditEvent, type AuditEventSource } from '@/lib/audit';
import { requireOperationalUser } from '@/lib/users/operational-eligibility';
import { enqueueIncidentUpdateSideEffects, enqueueWarRoomSideEffects } from '@/lib/event-outbox';
import { logger } from '@/lib/logger';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { authorizationActorFromUser } from '@/lib/authorization-actors';
import { effectiveAccessSelect } from '@/lib/access/effective';
import {
  INCIDENT_ROLE_KEYS,
  getIncidentRole,
  parseDefaultRoles,
  type IncidentRoleKey,
} from '@/lib/incidents/roles';

export const AssignIncidentRoleSchema = z
  .object({
    incidentId: z.string().trim().min(1).max(100),
    roleKey: z.enum(INCIDENT_ROLE_KEYS),
    /** `null` clears the role. */
    userId: z.string().trim().min(1).max(100).nullable(),
  })
  .strict();

export type AssignIncidentRoleInput = z.input<typeof AssignIncidentRoleSchema> & {
  actor: { id: string | null; name?: string | null };
  /** ChatOps passes INTEGRATION, API and MCP pass API. */
  source?: AuditEventSource;
};

export type AssignIncidentRoleResult = {
  incidentId: string;
  roleKey: IncidentRoleKey;
  userId: string | null;
  userName: string | null;
  previousUserId: string | null;
  changed: boolean;
};

/**
 * Canonical incident role command (modelled on `assignIncidentDomainCommand`). One transaction
 * writes the assignment, the timeline event, the audit record, the webhook/war-room outbox rows
 * and a FOLLOWER watcher for the holder so their notifications keep working.
 */
export async function assignIncidentRoleCommand(
  raw: AssignIncidentRoleInput,
  externalTx?: Prisma.TransactionClient
): Promise<AssignIncidentRoleResult> {
  const { actor, source = 'UI', ...fields } = raw;
  const input = AssignIncidentRoleSchema.parse(fields);
  const role = getIncidentRole(input.roleKey);
  const by = actor.name?.trim() ? ` by ${actor.name.trim()}` : '';

  const runner = async (tx: Prisma.TransactionClient): Promise<AssignIncidentRoleResult> => {
    const incident = await tx.incident.findUnique({
      where: { id: input.incidentId },
      select: { id: true },
    });
    if (!incident) {
      throw new AppError({
        code: 'INCIDENT_NOT_FOUND',
        userMessage: `Incident with id '${input.incidentId}' was not found.`,
        details: { resource: 'incident', incidentId: input.incidentId },
      });
    }
    const where = {
      incidentId_roleKey: { incidentId: input.incidentId, roleKey: input.roleKey },
    };
    const existing = await tx.incidentRoleAssignment.findUnique({
      where,
      select: { userId: true, user: { select: { name: true } } },
    });
    const previousUserId = existing?.userId ?? null;
    const unchanged = (payload: { userName: string | null }) => ({
      incidentId: input.incidentId,
      roleKey: input.roleKey,
      userId: input.userId,
      previousUserId,
      changed: false,
      ...payload,
    });

    if (!input.userId) {
      if (!existing) return unchanged({ userName: null });
      await tx.incidentRoleAssignment.delete({ where });
      await tx.incidentEvent.create({
        data: {
          incidentId: input.incidentId,
          type: 'ROLE_UNASSIGNED',
          message: `${existing.user.name} is no longer ${role.label.toLowerCase()}${by}`,
        },
      });
      await audit(tx, input, actor, source, previousUserId);
      await enqueueIncidentUpdateSideEffects(tx, input.incidentId, ['INCIDENT_UPDATE_WEBHOOK']);
      await enqueueWarRoomSideEffects(tx, input.incidentId, [
        { effect: 'WAR_ROOM_MESSAGE', message: `🎖️ *${role.label}* role cleared${by}` },
        { effect: 'WAR_ROOM_TOPIC' },
      ]);
      return { ...unchanged({ userName: null }), userId: null, changed: true };
    }

    let holder: { id: string; name: string };
    try {
      holder = await requireOperationalUser(tx, input.userId);
    } catch {
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: `User with id '${input.userId}' was not found or is not eligible for incident roles.`,
        details: { resource: 'user', userId: input.userId },
      });
    }
    if (previousUserId === holder.id) return unchanged({ userName: holder.name });

    await tx.incidentRoleAssignment.upsert({
      where,
      update: { userId: holder.id, assignedById: actor.id, assignedAt: new Date() },
      create: {
        incidentId: input.incidentId,
        roleKey: input.roleKey,
        userId: holder.id,
        assignedById: actor.id,
      },
    });
    // Keep an existing watcher role (stakeholder, exec); only add a follower when missing.
    await tx.incidentWatcher.upsert({
      where: { incidentId_userId: { incidentId: input.incidentId, userId: holder.id } },
      update: {},
      create: { incidentId: input.incidentId, userId: holder.id, role: 'FOLLOWER' },
    });
    await tx.incidentEvent.create({
      data: {
        incidentId: input.incidentId,
        type: 'ROLE_ASSIGNED',
        message: `${holder.name} is now ${role.label.toLowerCase()}${by}`,
      },
    });
    await audit(tx, input, actor, source, previousUserId);
    await enqueueIncidentUpdateSideEffects(tx, input.incidentId, ['INCIDENT_UPDATE_WEBHOOK']);
    await enqueueWarRoomSideEffects(tx, input.incidentId, [
      { effect: 'WAR_ROOM_MESSAGE', message: `🎖️ *${holder.name}* is now *${role.label}*${by}` },
      { effect: 'WAR_ROOM_INVITE_USER', userId: holder.id },
      { effect: 'WAR_ROOM_TOPIC' },
    ]);
    return {
      incidentId: input.incidentId,
      roleKey: input.roleKey,
      userId: holder.id,
      userName: holder.name,
      previousUserId,
      changed: true,
    };
  };

  if (externalTx) return runner(externalTx);
  return prisma.$transaction(runner, { isolationLevel: 'Serializable' });
}

async function audit(
  tx: Prisma.TransactionClient,
  input: z.output<typeof AssignIncidentRoleSchema>,
  actor: AssignIncidentRoleInput['actor'],
  source: AuditEventSource,
  previousUserId: string | null
) {
  await emitAuditEvent(
    {
      action: input.userId ? 'incident.role_assigned' : 'incident.role_unassigned',
      source,
      target: { type: 'INCIDENT', id: input.incidentId },
      actor: actor.id
        ? { type: 'USER', id: actor.id, name: actor.name ?? null }
        : { type: 'SYSTEM' },
      oldValue: { roleKey: input.roleKey, userId: previousUserId },
      newValue: { roleKey: input.roleKey, userId: input.userId },
    },
    tx
  );
}

/** Lists the incident's role holders in catalog order. */
export async function listIncidentRoles(
  incidentId: string,
  client: Prisma.TransactionClient = prisma
) {
  const rows = await client.incidentRoleAssignment.findMany({
    where: { incidentId },
    select: {
      roleKey: true,
      assignedAt: true,
      user: { select: { id: true, name: true, email: true, avatarUrl: true } },
    },
  });
  const byKey = new Map(rows.map(row => [row.roleKey, row]));
  return INCIDENT_ROLE_KEYS.map(key => {
    const row = byKey.get(key);
    const role = getIncidentRole(key);
    return {
      roleKey: key,
      label: role.label,
      rights: role.rights,
      holder: row ? { ...row.user, assignedAt: row.assignedAt } : null,
    };
  });
}

/** A role a new incident should start with, e.g. from `IncidentTemplate.defaultRoles`. */
export type IncidentDefaultRole = { roleKey: IncidentRoleKey; userId: string };

/**
 * Reads a template's default roles for the creator. Only templates the creator can read are
 * honoured; unknown role keys are dropped. Read before the creation transaction (configuration).
 */
export async function loadTemplateDefaultRoles(input: {
  templateId: string;
  actor: { id: string; isAdmin: boolean };
}): Promise<IncidentDefaultRole[]> {
  const template = await prisma.incidentTemplate.findFirst({
    where: {
      AND: [
        { id: input.templateId },
        input.actor.isAdmin ? {} : { OR: [{ isPublic: true }, { createdById: input.actor.id }] },
      ],
    },
    select: { defaultRoles: true },
  });
  return parseDefaultRoles(template?.defaultRoles);
}

/**
 * Applies default roles inside the incident creation transaction. A holder who is explicitly
 * ineligible (not an active user, or with no incident access at all) is skipped; any other
 * failure throws so the whole creation rolls back and a replay can apply everything.
 */
export async function applyDefaultRolesInTx(
  tx: Prisma.TransactionClient,
  input: {
    incidentId: string;
    roles: readonly IncidentDefaultRole[];
    actor: { id: string | null; name?: string | null };
  }
): Promise<number> {
  let applied = 0;
  for (const { roleKey, userId } of input.roles) {
    const holder = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        status: true,
        teamMemberships: { select: { teamId: true } },
        ...effectiveAccessSelect(),
      },
    });
    const holderActor = holder?.status === 'ACTIVE' ? authorizationActorFromUser(holder) : null;
    if (
      !holderActor ||
      !authorize({ actor: holderActor, action: AUTHORIZATION_ACTIONS.INCIDENT_READ }).allowed
    ) {
      logger.info('incident.default_role_skipped_ineligible', {
        incidentId: input.incidentId,
        roleKey,
        reason: holder ? 'NO_INCIDENT_ACCESS' : 'NOT_ACTIVE',
      });
      continue;
    }
    const result = await assignIncidentRoleCommand(
      {
        incidentId: input.incidentId,
        roleKey,
        userId,
        actor: {
          id: input.actor.id,
          name: input.actor.name ? `${input.actor.name} (template)` : null,
        },
      },
      tx
    );
    if (result.changed) applied += 1;
  }
  return applied;
}
