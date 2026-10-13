import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { requireOperationalUser } from '@/lib/users/operational-eligibility';
import {
  enqueueIncidentUpdateSideEffects,
  enqueueWarRoomSideEffects,
} from '@/lib/event-outbox';

export interface AssignIncidentInput {
  incidentId: string;
  assigneeId?: string | null;
  teamId?: string | null;
  actor: { id: string; name?: string };
}

export interface AssignIncidentResult {
  incidentId: string;
  assigneeId: string | null;
  teamId: string | null;
  assigneeName?: string | null;
  teamName?: string | null;
}

/**
 * Certified canonical incident assignment domain command.
 * Enforces transactional consistency across database state, timeline audit events,
 * notification outbox dispatch, war-room membership and channel updates, and
 * mutually exclusive user/team assignment fields.
 */
export async function assignIncidentDomainCommand(
  input: AssignIncidentInput,
  externalTx?: Prisma.TransactionClient
): Promise<AssignIncidentResult> {
  const runner = async (tx: Prisma.TransactionClient): Promise<AssignIncidentResult> => {
    const { incidentId } = input;
    const assigneeId = input.assigneeId?.trim() || null;
    const teamId = input.teamId?.trim() || null;

    const incident = await tx.incident.findUnique({
      where: { id: incidentId },
      select: { id: true, title: true, assigneeId: true, teamId: true },
    });

    if (!incident) {
      throw new AppError({
        code: 'INCIDENT_NOT_FOUND',
        userMessage: `Incident with id '${incidentId}' was not found.`,
      });
    }

    // 1. Handle unassigning (empty/null assigneeId and teamId)
    if (!assigneeId && !teamId) {
      await tx.incident.update({
        where: { id: incidentId },
        data: {
          assigneeId: null,
          teamId: null,
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId,
          type: 'ASSIGNMENT',
          message: 'Incident unassigned',
        },
      });

      await enqueueWarRoomSideEffects(tx, incidentId, [
        { effect: 'WAR_ROOM_MESSAGE', message: '👤 *Incident unassigned*' },
        { effect: 'WAR_ROOM_TOPIC' },
      ]);

      return { incidentId, assigneeId: null, teamId: null };
    }

    // 2. Handle assigning to a team
    if (teamId) {
      const teamRecord = await tx.team.findUnique({
        where: { id: teamId },
        select: { id: true, name: true },
      });

      if (!teamRecord) {
        throw new AppError({
          code: 'TEAM_NOT_FOUND',
          userMessage: `Team with id '${teamId}' was not found.`,
          details: { resource: 'team', teamId },
        });
      }

      await tx.incident.update({
        where: { id: incidentId },
        data: {
          teamId,
          assigneeId: null, // Clear user assignment when assigning to team
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId,
          type: 'ASSIGNMENT',
          message: `Incident assigned to team: ${teamRecord.name}`,
        },
      });

      await enqueueIncidentUpdateSideEffects(tx, incidentId, [
        'INCIDENT_ASSIGNED_TO_TEAM_NOTIFICATION',
      ]);

      await enqueueWarRoomSideEffects(tx, incidentId, [
        {
          effect: 'WAR_ROOM_MESSAGE',
          message: `👥 *Incident assigned to team: ${teamRecord.name}*`,
        },
        { effect: 'WAR_ROOM_INVITE_TEAM', teamId },
        { effect: 'WAR_ROOM_TOPIC' },
      ]);

      return {
        incidentId,
        assigneeId: null,
        teamId,
        teamName: teamRecord.name,
      };
    }

    // 3. Handle assigning to a user
    let assigneeRecord;
    try {
      assigneeRecord = await requireOperationalUser(tx, assigneeId!);
    } catch {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        userMessage: `User with id '${assigneeId}' was not found or is not eligible for incident assignment.`,
        details: { resource: 'user', userId: assigneeId },
      });
    }

    await tx.incident.update({
      where: { id: incidentId },
      data: {
        assigneeId,
        teamId: null, // Clear team assignment when assigning to user
      },
    });

    await tx.incidentEvent.create({
      data: {
        incidentId,
        type: 'ASSIGNMENT',
        message: `Incident manually reassigned to ${assigneeRecord.name}`,
      },
    });

    await enqueueIncidentUpdateSideEffects(tx, incidentId, [
      'INCIDENT_ASSIGNED_TO_USER_NOTIFICATION',
    ]);

    await enqueueWarRoomSideEffects(tx, incidentId, [
      {
        effect: 'WAR_ROOM_MESSAGE',
        message: `👤 *Incident reassigned to ${assigneeRecord.name}*`,
      },
      { effect: 'WAR_ROOM_INVITE_USER', userId: assigneeId! },
      { effect: 'WAR_ROOM_TOPIC' },
    ]);

    return {
      incidentId,
      assigneeId,
      teamId: null,
      assigneeName: assigneeRecord.name,
    };
  };

  if (externalTx) {
    return runner(externalTx);
  }
  return prisma.$transaction(runner, { isolationLevel: 'Serializable' });
}
