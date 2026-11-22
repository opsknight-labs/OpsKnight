'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v3';
import { AppError } from '@/lib/errors';
import { getCurrentAuthorizationActor, getUserPermissions } from '@/lib/rbac';
import {
  BusinessServiceInputSchema,
  createBusinessService,
  deleteBusinessService,
  setBusinessServiceFollow,
  updateBusinessService,
} from '@/lib/business-services/commands';
import { searchBusinessServiceFormOptions } from './form-options';

export type BusinessServiceActionResult = { ok: true; id: string } | { ok: false; error: string };

const idSchema = z.string().trim().min(1).max(100);

async function managerActor() {
  const permissions = await getUserPermissions();
  if (!permissions.isResponderOrAbove) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'Only Responders and Admins can manage business services.',
    });
  }
  return getCurrentAuthorizationActor();
}

function failure(error: unknown): BusinessServiceActionResult {
  if (error instanceof z.ZodError) return { ok: false, error: 'Check the highlighted fields.' };
  if (error instanceof AppError) return { ok: false, error: error.userMessage };
  throw error;
}

function revalidate(id?: string) {
  revalidatePath('/services/business');
  if (id) revalidatePath(`/services/business/${id}`);
  revalidatePath('/status');
}

export async function createBusinessServiceAction(
  raw: z.input<typeof BusinessServiceInputSchema>
): Promise<BusinessServiceActionResult> {
  try {
    const actor = await managerActor();
    const created = await createBusinessService(BusinessServiceInputSchema.parse(raw), { actor });
    revalidate(created.id);
    return { ok: true, id: created.id };
  } catch (error) {
    return failure(error);
  }
}

export async function updateBusinessServiceAction(
  id: string,
  raw: z.input<typeof BusinessServiceInputSchema>
): Promise<BusinessServiceActionResult> {
  try {
    const actor = await managerActor();
    const parsedId = idSchema.parse(id);
    await updateBusinessService(parsedId, BusinessServiceInputSchema.parse(raw), { actor });
    revalidate(parsedId);
    return { ok: true, id: parsedId };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteBusinessServiceAction(id: string): Promise<BusinessServiceActionResult> {
  try {
    const permissions = await getUserPermissions();
    if (!permissions.isAdmin) {
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'Only Admins can delete business services.',
      });
    }
    const parsedId = idSchema.parse(id);
    await deleteBusinessService(parsedId, { actor: await getCurrentAuthorizationActor() });
    revalidate();
    return { ok: true, id: parsedId };
  } catch (error) {
    return failure(error);
  }
}

export async function followBusinessServiceAction(
  id: string,
  follow: boolean
): Promise<BusinessServiceActionResult> {
  try {
    const permissions = await getUserPermissions();
    if (!permissions.authenticated) throw new AppError({ code: 'AUTHENTICATION_REQUIRED' });
    const parsedId = idSchema.parse(id);
    await setBusinessServiceFollow(parsedId, z.boolean().parse(follow), {
      actor: await getCurrentAuthorizationActor(),
    });
    revalidate(parsedId);
    return { ok: true, id: parsedId };
  } catch (error) {
    return failure(error);
  }
}

/** Server-side search for the form pickers; bounded to one page of matches. */
export async function searchBusinessServiceOptionsAction(kind: 'services' | 'users', query: string) {
  const actor = await managerActor();
  return searchBusinessServiceFormOptions(
    actor,
    z.enum(['services', 'users']).parse(kind),
    z.string().max(120).parse(query)
  );
}
