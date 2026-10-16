'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCapability } from '@/lib/rbac';
import { RunbookDefinitionError, RunbookError } from '@/lib/runbooks/errors';
import { ensureUniqueSlug } from '@/lib/runbooks/lifecycle';
import { MAX_PORTABLE_RUNBOOK_BYTES, parsePortableRunbook } from '@/lib/runbooks/portable';
import { createRunbook, retireRunbookVersion } from '@/lib/runbooks/versioning';

const idSchema = z.string().cuid();

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

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

async function readImportPayload(formData: FormData): Promise<string> {
  const file = formData.get('file');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_PORTABLE_RUNBOOK_BYTES) {
      throw new RunbookDefinitionError('Runbook files must be 512 KiB or smaller.');
    }
    return file.text();
  }
  const json = formData.get('json');
  if (typeof json === 'string' && json.trim()) return json;
  throw new RunbookDefinitionError('Choose a runbook JSON file or paste its contents.');
}

export async function importRunbookAction(formData: FormData) {
  let createdId: string;
  try {
    const actor = await assertCapability(CAPABILITIES.RUNBOOK_MANAGE);
    const portable = parsePortableRunbook(await readImportPayload(formData));
    let created: { id: string } | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt++) {
      const slug = await ensureUniqueSlug(portable.slug);
      try {
        created = await createRunbook(
          {
            name: portable.name,
            slug,
            description: portable.description,
            tags: portable.tags,
            definition: portable.definition,
            inputs: portable.inputs,
          },
          actor.id
        );
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 4) throw error;
      }
    }
    if (!created) throw new RunbookDefinitionError('Could not allocate a unique slug for import.');
    createdId = created.id;
  } catch (error) {
    if (error instanceof RunbookError) return { error: error.userMessage };
    if (error instanceof z.ZodError) {
      return { error: 'The runbook file does not match the supported definition format.' };
    }
    throw error;
  }
  revalidatePath('/runbooks');
  redirect(`/runbooks/${createdId}`);
}
