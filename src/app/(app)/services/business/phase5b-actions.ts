'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v3';
import { AppError } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor, getCurrentUser, getUserPermissions } from '@/lib/rbac';
import {
  BulkEditInputSchema,
  bulkEditBusinessServices,
  type BulkItemResult,
} from '@/lib/business-services/bulk';
import {
  CustomerImpactReportInputSchema,
  createCustomerImpactReport,
} from '@/lib/business-services/customer-reports';
import {
  BusinessServiceTemplateInputSchema,
  BusinessServiceTemplatePatchSchema,
  createBusinessServiceTemplate,
  deleteBusinessServiceTemplate,
  updateBusinessServiceTemplate,
} from '@/lib/business-services/templates';

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const id = z.string().trim().min(1).max(100);

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

function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof z.ZodError)
    return { ok: false, error: error.issues[0]?.message ?? 'Check the highlighted fields.' };
  if (error instanceof AppError) return { ok: false, error: error.userMessage };
  throw error;
}

const refresh = () => {
  revalidatePath('/services/business');
  revalidatePath('/services/business/templates');
};

export async function createTemplateAction(
  raw: z.input<typeof BusinessServiceTemplateInputSchema>
): Promise<ActionResult<{ id: string }>> {
  try {
    const created = await createBusinessServiceTemplate(raw, { actor: await managerActor() });
    refresh();
    return { ok: true, id: created.id };
  } catch (error) {
    return failure(error);
  }
}

export async function updateTemplateAction(
  templateId: string,
  raw: z.input<typeof BusinessServiceTemplatePatchSchema>
): Promise<ActionResult<{ id: string }>> {
  try {
    const parsedId = id.parse(templateId);
    await updateBusinessServiceTemplate(parsedId, BusinessServiceTemplatePatchSchema.parse(raw), {
      actor: await managerActor(),
    });
    refresh();
    return { ok: true, id: parsedId };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteTemplateAction(templateId: string): Promise<ActionResult> {
  try {
    await deleteBusinessServiceTemplate(id.parse(templateId), { actor: await managerActor() });
    refresh();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function bulkEditAction(
  raw: z.input<typeof BulkEditInputSchema>
): Promise<
  ActionResult<{
    dryRun: boolean;
    results: BulkItemResult[];
    summary: { ok: number; failed: number };
  }>
> {
  try {
    const result = await bulkEditBusinessServices(raw, { actor: await managerActor() });
    if (!result.dryRun) {
      revalidatePath('/services/business');
      revalidatePath('/status');
    }
    return { ok: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

export async function addCustomerReportAction(
  businessServiceId: string,
  raw: z.input<typeof CustomerImpactReportInputSchema>
): Promise<ActionResult> {
  try {
    const parsedId = id.parse(businessServiceId);
    await createCustomerImpactReport(parsedId, raw, { actor: await managerActor() });
    revalidatePath(`/services/business/${parsedId}`);
    revalidatePath('/services/business');
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** Admin switch for the scheduled ownership hygiene sweep. */
export async function setHygieneEnabledAction(enabled: boolean): Promise<ActionResult> {
  try {
    const permissions = await getUserPermissions();
    if (!permissions.isAdmin)
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'Only Admins can change ownership hygiene settings.',
      });
    const next = z.boolean().parse(enabled);
    const actor = await getCurrentUser();
    await prisma.$transaction(async tx => {
      const existing = await tx.systemSettings.findUnique({
        where: { id: 'default' },
        select: { businessServiceHygieneEnabled: true },
      });
      await tx.systemSettings.upsert({
        where: { id: 'default' },
        update: { businessServiceHygieneEnabled: next },
        create: { id: 'default', businessServiceHygieneEnabled: next },
      });
      await logAudit(
        {
          action: 'settings.business_service_hygiene.updated',
          entityType: 'SYSTEM_CONFIG',
          entityId: 'business_service_hygiene',
          actorId: actor.id,
          oldValue: { enabled: existing?.businessServiceHygieneEnabled ?? false },
          newValue: { enabled: next },
        },
        tx
      );
    });
    revalidatePath('/services/business');
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
