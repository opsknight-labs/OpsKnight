'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v3';
import { AppError } from '@/lib/errors';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  createStatusDashboard,
  deleteStatusDashboard,
  updateStatusDashboard,
  type StatusDashboardInput,
} from '@/lib/business-services/dashboards';

export type StatusDashboardActionResult = { ok: true; slug: string } | { ok: false; error: string };

const idSchema = z.string().trim().min(1).max(100);

function failure(error: unknown): StatusDashboardActionResult {
  if (error instanceof z.ZodError) {
    return { ok: false, error: error.issues[0]?.message ?? 'Check the highlighted fields.' };
  }
  if (error instanceof AppError) return { ok: false, error: error.userMessage };
  throw error;
}

/** Creates a dashboard when `id` is null, else updates it. Permission checks live in the command. */
export async function saveStatusDashboardAction(
  id: string | null,
  input: StatusDashboardInput
): Promise<StatusDashboardActionResult> {
  try {
    const actor = await getCurrentAuthorizationActor();
    const saved = id
      ? await updateStatusDashboard(idSchema.parse(id), input, { actor })
      : await createStatusDashboard(input, { actor });
    revalidatePath('/status-dashboard', 'layout');
    return { ok: true, slug: saved.slug };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteStatusDashboardAction(
  id: string
): Promise<StatusDashboardActionResult> {
  try {
    await deleteStatusDashboard(idSchema.parse(id), {
      actor: await getCurrentAuthorizationActor(),
    });
    revalidatePath('/status-dashboard', 'layout');
    return { ok: true, slug: '' };
  } catch (error) {
    return failure(error);
  }
}
