import type { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import { AppError } from '@/lib/errors';
import {
  getStoredActionItemId,
  normalizeActionItems,
  resolveStoredActionItems,
  parseActionItemDueDate,
} from '@/lib/action-items';

export const actionItemInputSchema = z
  .object({
    id: z.string().trim().min(1).max(200).optional(),
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(5000).default(''),
    ownerId: z.string().trim().min(1).max(100).nullable().default(null),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .default(null),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED']).default('OPEN'),
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  })
  .strict();
export const actionItemCollectionSchema = z
  .object({
    items: z.array(actionItemInputSchema).max(100),
  })
  .strict()
  .refine(value => {
    const ids = value.items.flatMap(item => (item.id ? [item.id] : []));
    return new Set(ids).size === ids.length;
  }, 'Action item identifiers must be unique.');

type ActionItemInput = z.infer<typeof actionItemInputSchema>;

const recordSelect = {
  id: true,
  title: true,
  description: true,
  ownerId: true,
  dueDate: true,
  status: true,
  priority: true,
  completedAt: true,
  externalIssueLinks: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      id: true,
      provider: true,
      externalKey: true,
      externalUrl: true,
      externalStatus: true,
      externalAssignee: true,
      syncState: true,
    },
  },
};

export async function getPostmortemActionItems(db: Prisma.TransactionClient, postmortemId: string) {
  const postmortem = await db.postmortem.findUnique({
    where: { id: postmortemId },
    select: {
      id: true,
      revision: true,
      actionItems: true,
      actionItemRecords: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 101,
        select: recordSelect,
      },
    },
  });
  if (!postmortem) throw new AppError({ code: 'POSTMORTEM_NOT_FOUND' });
  if (
    postmortem.actionItemRecords.length > 100 ||
    (Array.isArray(postmortem.actionItems) && postmortem.actionItems.length > 100)
  ) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Action item collection exceeds the 100-item API limit.',
    });
  }
  return {
    postmortemId: postmortem.id,
    revision: postmortem.revision,
    items: resolveStoredActionItems({
      records: postmortem.actionItemRecords,
      legacy: postmortem.actionItems,
      legacyIdPrefix: `postmortem-${postmortem.id}`,
    }),
  };
}

export async function replacePostmortemActionItems(
  tx: Prisma.TransactionClient,
  postmortemId: string,
  expectedRevision: number,
  items: ActionItemInput[]
) {
  await tx.$queryRaw`SELECT "id" FROM "Postmortem" WHERE "id" = ${postmortemId} FOR UPDATE`;
  const parent = await tx.postmortem.findUnique({
    where: { id: postmortemId },
    select: { id: true, incidentId: true, revision: true, actionItems: true },
  });
  if (!parent) throw new AppError({ code: 'POSTMORTEM_NOT_FOUND' });
  if (parent.revision !== expectedRevision) throw new AppError({ code: 'PRECONDITION_FAILED' });
  const existing = await tx.actionItem.findMany({
    where: { postmortemId },
    select: { id: true, status: true, completedAt: true },
  });
  const existingById = new Map(existing.map(item => [item.id, item]));
  const legacy = normalizeActionItems(parent.actionItems, {
    legacyIdPrefix: `postmortem-${postmortemId}`,
  });
  if (
    !existing.length &&
    legacy.some(item => item.externalIssue && items.some(input => input.id === item.id))
  ) {
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      userMessage:
        'Legacy action items with external issue links must be migrated before replacement.',
    });
  }
  const legacyIds = new Set(legacy.map(item => item.id));
  const ownerIds = [...new Set(items.flatMap(item => (item.ownerId ? [item.ownerId] : [])))];
  const owners = await tx.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true } });
  if (owners.length !== ownerIds.length)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Action item owner does not exist.',
    });
  const normalized = items.map((item, index) => {
    if (item.id && !existingById.has(item.id) && !legacyIds.has(item.id)) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'An action item identifier does not belong to this postmortem.',
      });
    }
    const id =
      item.id && existingById.has(item.id)
        ? item.id
        : getStoredActionItemId({ postmortemId, legacyId: item.id ?? crypto.randomUUID(), index });
    const date = item.dueDate ? parseActionItemDueDate(item.dueDate) : undefined;
    if (item.dueDate && (!date || date.toISOString().slice(0, 10) !== item.dueDate)) {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        userMessage: 'Action item due date is invalid.',
      });
    }
    return { ...item, id, dueDate: date ?? null };
  });
  if (new Set(normalized.map(item => item.id)).size !== normalized.length) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'Action item identifiers must be unique.',
    });
  }
  await tx.actionItem.deleteMany({
    where: { postmortemId, id: { notIn: normalized.map(item => item.id) } },
  });
  for (const item of normalized) {
    const prior = existingById.get(item.id);
    const completedAt = item.status === 'COMPLETED' ? (prior?.completedAt ?? new Date()) : null;
    await tx.actionItem.upsert({
      where: { id: item.id },
      create: {
        id: item.id,
        postmortemId,
        incidentId: parent.incidentId,
        title: item.title,
        description: item.description || null,
        ownerId: item.ownerId,
        dueDate: item.dueDate,
        status: item.status,
        priority: item.priority,
        completedAt,
        source: 'POSTMORTEM',
      },
      update: {
        title: item.title,
        description: item.description || null,
        ownerId: item.ownerId,
        dueDate: item.dueDate,
        status: item.status,
        priority: item.priority,
        completedAt,
      },
    });
  }
  const legacyById = new Map<string, Record<string, unknown>>();
  for (const value of Array.isArray(parent.actionItems) ? parent.actionItems : []) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const entry = value as Record<string, unknown>;
      if (typeof entry.id === 'string') legacyById.set(entry.id, entry);
    }
  }
  await tx.postmortem.update({
    where: { id: postmortemId },
    data: {
      actionItems: normalized.map(item => ({
        ...(legacyById.get(item.id) ?? {}),
        id: item.id,
        title: item.title,
        description: item.description,
        owner: item.ownerId,
        dueDate: item.dueDate?.toISOString().slice(0, 10) ?? null,
        status: item.status,
        priority: item.priority,
        completedAt:
          item.status === 'COMPLETED'
            ? (existingById.get(item.id)?.completedAt ?? new Date()).toISOString()
            : null,
      })),
    },
  });
  return getPostmortemActionItems(tx, postmortemId);
}
