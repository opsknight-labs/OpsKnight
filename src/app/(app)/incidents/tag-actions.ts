'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { assertResponderOrAbove, getCurrentUser } from '@/lib/rbac';
import { isPrismaErrorCode } from '@/lib/prisma-errors';

export async function addTagToIncident(incidentId: string, tagName: string) {
  await assertResponderOrAbove();

  const tag = await prisma.tag.upsert({
    where: { name: tagName },
    create: { name: tagName },
    update: {},
  });

  try {
    await prisma.incidentTag.create({
      data: { incidentId, tagId: tag.id },
    });

    const user = await getCurrentUser();
    await prisma.incidentEvent.create({
      data: {
        incidentId,
        message: `Tag "${tagName}" added${user ? ` by ${user.name}` : ''}`,
      },
    });
  } catch (error) {
    // Adding an already-associated tag is intentionally idempotent. Interpret
    // the structured Prisma code centrally; never infer this from DB text.
    if (!isPrismaErrorCode(error, 'P2002')) {
      throw error;
    }
  }

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath('/incidents');
}

export async function removeTagFromIncident(incidentId: string, tagId: string) {
  await assertResponderOrAbove();

  const tag = await prisma.tag.findUnique({ where: { id: tagId } });
  await prisma.incidentTag.delete({
    where: {
      incidentId_tagId: { incidentId, tagId },
    },
  });

  const user = await getCurrentUser();
  await prisma.incidentEvent.create({
    data: {
      incidentId,
      message: `Tag "${tag?.name || 'Unknown'}" removed${user ? ` by ${user.name}` : ''}`,
    },
  });

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath('/incidents');
}

export async function getAllTags() {
  return prisma.tag.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: { incidents: true },
      },
    },
  });
}
