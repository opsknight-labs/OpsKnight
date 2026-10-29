import 'server-only';
import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import { runSerializableTransaction } from '@/lib/db-utils';

export const IncidentTagNameSchema = z.string().trim().min(1).max(100);

export async function addIncidentTag(
  incidentId: string,
  rawName: string,
  actorName?: string | null,
  client?: Prisma.TransactionClient
) {
  const name = IncidentTagNameSchema.parse(rawName);
  const command = async (tx: Prisma.TransactionClient) => {
    const tag = await tx.tag.upsert({ where: { name }, create: { name }, update: {} });
    const inserted = await tx.incidentTag.createMany({
      data: [{ incidentId, tagId: tag.id }],
      skipDuplicates: true,
    });
    if (inserted.count) {
      await tx.incidentEvent.create({
        data: {
          incidentId,
          type: 'LEGACY_OTHER',
          message: `Tag "${name}" added${actorName ? ` by ${actorName}` : ''}`,
        },
      });
    }
    return { tag, changed: inserted.count === 1 };
  };
  return client ? command(client) : runSerializableTransaction(command);
}

export async function removeIncidentTag(
  incidentId: string,
  tagId: string,
  actorName?: string | null,
  client?: Prisma.TransactionClient
) {
  const command = async (tx: Prisma.TransactionClient) => {
    const association = await tx.incidentTag.findUnique({
      where: { incidentId_tagId: { incidentId, tagId } },
      select: { tag: { select: { name: true } } },
    });
    const deleted = await tx.incidentTag.deleteMany({ where: { incidentId, tagId } });
    if (deleted.count) {
      await tx.incidentEvent.create({
        data: {
          incidentId,
          type: 'LEGACY_OTHER',
          message: `Tag "${association?.tag.name ?? 'Unknown'}" removed${actorName ? ` by ${actorName}` : ''}`,
        },
      });
    }
    return { id: tagId, incidentId, removed: deleted.count === 1 };
  };
  return client ? command(client) : runSerializableTransaction(command);
}
