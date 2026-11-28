'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { assertResponderOrAbove, getCurrentUser } from '@/lib/rbac';
import { IncidentUrgency } from '@prisma/client';
import { assertIncidentTemplateNameAvailable, UniqueNameConflictError } from '@/lib/unique-names';
import {
  createIncidentTemplate,
  deleteIncidentTemplate,
  incidentTemplateReadWhere,
  IncidentTemplateInputSchema,
} from '@/lib/incidents/templates';
import { INCIDENT_ROLE_KEYS } from '@/lib/incidents/roles';

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
  const defaultRoles = Object.fromEntries(
    INCIDENT_ROLE_KEYS.flatMap(roleKey => {
      const userId = formData.get(`defaultRole_${roleKey}`);
      return typeof userId === 'string' && userId.trim() ? [[roleKey, userId.trim()]] : [];
    })
  );

  let normalizedName = name;
  try {
    normalizedName = await assertIncidentTemplateNameAvailable(name);
  } catch (error) {
    if (error instanceof UniqueNameConflictError) {
      redirect('/incidents/templates/create?error=duplicate-template');
    }
    throw error;
  }

  await createIncidentTemplate(
    prisma,
    IncidentTemplateInputSchema.parse({
      name: normalizedName,
      description,
      title,
      descriptionText,
      defaultUrgency,
      defaultPriority: defaultPriority || null,
      defaultServiceId: defaultServiceId || null,
      isPublic,
      ...(Object.keys(defaultRoles).length ? { defaultRoles } : {}),
    }),
    user.id
  );

  revalidatePath('/incidents/templates');
  revalidatePath('/incidents');

  redirect('/incidents/templates');
}

// Wrapper for useActionState compatibility
export async function createTemplateAction(_prevState: null, formData: FormData): Promise<null> {
  await createTemplate(formData);
  return null; // Won't be reached due to redirect
}

export async function getAllTemplates(userId?: string, admin = false) {
  let effectiveUserId = userId;
  if (!effectiveUserId) {
    const user = await getCurrentUser();
    effectiveUserId = user?.id;
  }

  const where = effectiveUserId
    ? incidentTemplateReadWhere(effectiveUserId, admin)
    : { isPublic: true };

  const templates = await prisma.incidentTemplate.findMany({
    where,
    include: {
      createdBy: { select: { id: true, name: true, avatarUrl: true, gender: true } },
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

  await deleteIncidentTemplate(prisma, templateId, user.id, user.role === 'ADMIN');

  revalidatePath('/incidents/templates');
}
