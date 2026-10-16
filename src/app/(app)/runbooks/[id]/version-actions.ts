'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { RunbookError } from '@/lib/runbooks/errors';
import { retireRunbookVersion } from '@/lib/runbooks/versioning';

const idSchema = z.string().cuid();

export async function retireVersionAction(versionId: string, runbookId: string) {
  try {
    const actor = await assertCapability(CAPABILITIES.RUNBOOK_PUBLISH);
    const parsedRunbookId = idSchema.parse(runbookId);
    await retireRunbookVersion(idSchema.parse(versionId), actor.id);
    revalidatePath(`/runbooks/${parsedRunbookId}`);
    return { saved: true };
  } catch (error) {
    if (error instanceof RunbookError) return { error: error.userMessage };
    if (error instanceof z.ZodError) return { error: 'The selected version is invalid.' };
    throw error;
  }
}

import { importRunbookAction as importAction } from '@/app/(app)/runbooks/actions';

export async function importRunbookAction(formData: FormData) {
  return importAction(formData);
}
