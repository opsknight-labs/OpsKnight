'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { assertResponderOrAbove, getCurrentUser } from '@/lib/rbac';
import { addIncidentTag, removeIncidentTag } from '@/lib/incidents/tags';

export async function addTagToIncident(incidentId: string, tagName: string) {
  await assertResponderOrAbove();

  const user = await getCurrentUser();
  await addIncidentTag(incidentId, tagName, user?.name);

  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath('/incidents');
}

export async function removeTagFromIncident(incidentId: string, tagId: string) {
  await assertResponderOrAbove();

  const user = await getCurrentUser();
  await removeIncidentTag(incidentId, tagId, user?.name);

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
