import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { enqueueWarRoomSideEffects } from '@/lib/event-outbox';

export interface AddIncidentNoteInput {
  incidentId: string;
  content: string;
  actor: { id: string; name?: string };
}

export interface AddIncidentNoteResult {
  id: string;
  incidentId: string;
  userId: string | null;
  content: string;
  createdAt: Date;
  author: {
    id: string;
    name: string;
    email: string;
  } | null;
}

/**
 * Certified canonical incident note domain command.
 * Enforces transactional consistency across database note records, timeline comment events,
 * external Jira comment synchronizations, and war-room collaboration notifications.
 */
export async function addIncidentNoteDomainCommand(
  input: AddIncidentNoteInput,
  externalTx?: Prisma.TransactionClient
): Promise<AddIncidentNoteResult> {
  const runner = async (tx: Prisma.TransactionClient): Promise<AddIncidentNoteResult> => {
    const { incidentId, content, actor } = input;
    const actorName = actor.name || 'API User';

    const incident = await tx.incident.findUnique({
      where: { id: incidentId },
      select: { id: true },
    });

    if (!incident) {
      throw new AppError({
        code: 'INCIDENT_NOT_FOUND',
        userMessage: `Incident with id '${incidentId}' was not found.`,
      });
    }

    const note = await tx.incidentNote.create({
      data: {
        incidentId,
        userId: actor.id,
        content,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    await tx.incidentEvent.create({
      data: {
        incidentId,
        type: 'COMMENT',
        message: `Note added by ${actorName}`,
      },
    });

    const links = await tx.externalIssueLink.findMany({
      where: { incidentId, provider: 'JIRA' },
      select: { externalKey: true },
    });
    if (links.length > 0) {
      const { enqueueJiraCommentOperationsInTransaction } =
        await import('@/lib/external-operations');
      await enqueueJiraCommentOperationsInTransaction(
        tx,
        links.map(link => ({
          incidentId,
          externalKey: link.externalKey,
          eventId: `note:${note.id}`,
          comment: `[OpsKnight Note by ${actorName}]:\n${content}`,
        }))
      );
    }

    await enqueueWarRoomSideEffects(tx, incidentId, [
      { effect: 'WAR_ROOM_MESSAGE', message: `📝 *Note by ${actorName}:*\n> ${content}` },
    ]);

    return {
      id: note.id,
      incidentId: note.incidentId,
      userId: note.userId,
      content: note.content,
      createdAt: note.createdAt,
      author: note.user,
    };
  };

  if (externalTx) {
    return runner(externalTx);
  }
  return prisma.$transaction(runner, { isolationLevel: 'Serializable' });
}
