'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v4';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { logger } from '@/lib/logger';
import {
  deleteCheckTemplate,
  saveCheckTemplate,
} from '@/lib/intelligence/assistant/check-templates';

export type CheckTemplateActionState = { message: string; ok: boolean };

const PATH = '/settings/intelligence/ai';
const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Administrators manage the "suggested checks" the assistant shows with incident answers. */
export async function saveCheckTemplateAction(
  _state: CheckTemplateActionState,
  form: FormData
): Promise<CheckTemplateActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id');
    const input = {
      title: text(form, 'title'),
      pattern: text(form, 'pattern'),
      checks: text(form, 'checks')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean),
      enabled: form.get('enabled') === 'on',
      position: Number(text(form, 'position') || 100),
    };
    await saveCheckTemplate(/^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null, input, actor.id);
    revalidatePath(PATH);
    return { message: 'Suggested checks saved.', ok: true };
  } catch (error) {
    if (error instanceof z.ZodError)
      return {
        message: `Check the template: ${error.issues[0]?.message ?? 'invalid input'}.`,
        ok: false,
      };
    logger.error('[Intelligence] Check template action failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { message: 'Unable to save. Refresh and try again.', ok: false };
  }
}

export async function deleteCheckTemplateAction(
  _state: CheckTemplateActionState,
  form: FormData
): Promise<CheckTemplateActionState> {
  try {
    await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { message: 'Invalid template.', ok: false };
    const deleted = await deleteCheckTemplate(id);
    revalidatePath(PATH);
    return deleted
      ? { message: 'Template removed.', ok: true }
      : { message: 'That template no longer exists.', ok: false };
  } catch (error) {
    logger.error('[Intelligence] Check template delete failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { message: 'Unable to remove. Refresh and try again.', ok: false };
  }
}
