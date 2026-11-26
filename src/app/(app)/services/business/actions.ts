'use server';
/* eslint-disable security/detect-object-injection -- keys are Zod issue paths of our own schema */

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v3';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { getCurrentAuthorizationActor, getUserPermissions } from '@/lib/rbac';
import {
  BusinessServiceInputSchema,
  createBusinessService,
  deleteBusinessService,
  setBusinessServiceFollow,
  updateBusinessService,
} from '@/lib/business-services/commands';
import { previewBusinessServiceImpact } from '@/lib/business-services/impact-preview';
import { listTeamServiceOptions, searchBusinessServiceFormOptions } from './form-options';

export type BusinessServiceActionResult =
  | { ok: true; id: string }
  /** `fieldErrors` maps a payload key (`sloTarget`, `name`, ...) to its first message. */
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

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
  if (error instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const key = String(issue.path[0] ?? '');
      if (key && !(key in fieldErrors)) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: 'Check the highlighted fields.', fieldErrors };
  }
  if (error instanceof AppError) return { ok: false, error: error.userMessage };
  // Unexpected: log it and return a result, so callers never see a rejected action (prod redacts the message).
  logger.error('Business service action failed', { component: 'business-service-actions', error });
  return { ok: false, error: 'Something went wrong. Try again.' };
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

export async function deleteBusinessServiceAction(
  id: string
): Promise<BusinessServiceActionResult> {
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
export async function searchBusinessServiceOptionsAction(
  kind: 'services' | 'users',
  query: string
) {
  const actor = await managerActor();
  return searchBusinessServiceFormOptions(
    actor,
    z.enum(['services', 'users']).parse(kind),
    z.string().max(120).parse(query)
  );
}

const previewSchema = z.object({
  criticality: z.enum(['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3']).nullable(),
  impactMinUrgency: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable(),
  impactMaxPriority: z
    .string()
    .max(4)
    .regex(/^P[1-9]$/i)
    .nullable(),
  memberServiceIds: z.array(idSchema).max(500),
});

/** "This tier and these thresholds would have counted N incidents in the last 30 days" for the form draft. */
export async function previewBusinessServiceImpactAction(raw: z.input<typeof previewSchema>) {
  const actor = await managerActor();
  const draft = previewSchema.safeParse(raw);
  if (!draft.success) return null;
  return previewBusinessServiceImpact(draft.data, actor);
}

/** Visible services of a team, to add them all as members. */
export async function listTeamServicesAction(teamId: string) {
  const actor = await managerActor();
  return listTeamServiceOptions(actor, idSchema.parse(teamId));
}

/** Unmarks a manual impact from the detail timeline; the command re-checks incident access. */
export async function unmarkImpactAction(
  incidentId: string,
  businessServiceId: string
): Promise<BusinessServiceActionResult> {
  try {
    const actor = await managerActor();
    const parsedId = idSchema.parse(businessServiceId);
    const { setIncidentImpactCommand } = await import('@/lib/business-services/impacts');
    await setIncidentImpactCommand(
      { incidentId: idSchema.parse(incidentId), businessServiceId: parsedId, impacted: false },
      actor
    );
    revalidate(parsedId);
    return { ok: true, id: parsedId };
  } catch (error) {
    return failure(error);
  }
}
