'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertResponderOrAbove, getCurrentUser } from '@/lib/rbac';
import { IncidentUrgency } from '@prisma/client';
import { assertIncidentTemplateNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';

export async function createTemplate(formData: FormData) {
  try {
    await assertResponderOrAbove();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  const user = await getCurrentUser();
  const name = formData.get('name') as string;
  const description = formData.get('description') as string | null;
  const title = formData.get('title') as string;
  const descriptionText = formData.get('descriptionText') as string | null;
  const defaultUrgency = (formData.get('defaultUrgency') as IncidentUrgency) || 'HIGH';
  const defaultPriority = formData.get('defaultPriority') as string | null;
  const defaultServiceId = formData.get('defaultServiceId') as string | null;
  const isPublic = formData.get('isPublic') === 'on';

  let normalizedName = name;
  try {
    normalizedName = await assertIncidentTemplateNameAvailable(name);
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      redirect('/incidents/templates/create?error=duplicate-template');
    }
    throw error;
  }

  await prisma.incidentTemplate.create({
    data: {
      name: normalizedName,
      description,
      title,
      descriptionText,
      defaultUrgency,
      defaultPriority: defaultPriority || null,
      defaultServiceId: defaultServiceId || null,
      createdById: user.id,
      isPublic,
    },
  });

  revalidatePath('/incidents/templates');
  revalidatePath('/incidents/create');

  redirect('/incidents/templates');
}

// Wrapper for useActionState compatibility
export async function createTemplateAction(_prevState: null, formData: FormData): Promise<null> {
  await createTemplate(formData);
  return null; // Won't be reached due to redirect
}

export async function getAllTemplates(userId?: string) {
  const where = userId
    ? {
        OR: [{ isPublic: true }, { createdById: userId }],
      }
    : { isPublic: true };

  const templates = await prisma.incidentTemplate.findMany({
    where,
    include: {
      createdBy: { select: { id: true, name: true } },
      defaultService: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return templates;
}

export async function deleteTemplate(templateId: string) {
  let user;
  try {
    user = await assertResponderOrAbove();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Unauthorized');
  }

  const template = await prisma.incidentTemplate.findUnique({
    where: { id: templateId },
    select: { createdById: true },
  });

  if (!template) {
    throw new Error('Template not found');
  }

  if (user.role !== 'ADMIN' && template.createdById !== user.id) {
    throw new Error('Unauthorized. You can only delete templates you created.');
  }

  await prisma.incidentTemplate.delete({
    where: { id: templateId },
  });

  revalidatePath('/incidents/templates');
}
