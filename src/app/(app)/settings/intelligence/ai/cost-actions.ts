'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import {
  deleteBudget,
  deleteModelPrice,
  saveBudget,
  saveModelPrice,
} from '@/lib/intelligence/ai/cost';

export type CostActionState = { message: string; ok: boolean };

const PATH = '/settings/intelligence/ai';

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};
/** Empty means "no limit"; anything else must be a number (validated again by the service). */
const optionalNumber = (form: FormData, name: string) => {
  const value = text(form, name);
  return value === '' ? null : Number(value);
};

function failure(error: unknown, fallback: string): CostActionState {
  if (error instanceof AppError) {
    if (error.code === 'PRECONDITION_FAILED')
      return {
        message: 'This budget changed since you opened the page. Refresh and try again.',
        ok: false,
      };
    const detail = error.fields?.[0];
    return {
      message: detail
        ? `${error.userMessage} (${detail.field}: ${detail.message})`
        : error.userMessage,
      ok: false,
    };
  }
  logger.error('[Intelligence] AI cost action failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return { message: fallback, ok: false };
}

export async function saveBudgetAction(
  _state: CostActionState,
  form: FormData
): Promise<CostActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const scope = text(form, 'scope');
    await saveBudget(
      {
        scope,
        teamId: scope === 'TEAM' ? text(form, 'teamId') || undefined : undefined,
        capability: scope === 'CAPABILITY' ? text(form, 'capability') || undefined : undefined,
        dailyTokenLimit: optionalNumber(form, 'dailyTokenLimit'),
        dailyCostLimitUsd: optionalNumber(form, 'dailyCostLimitUsd'),
        enabled: form.get('enabled') === 'on',
        expectedRevision: Number(text(form, 'expectedRevision') || 0),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(PATH);
    return { message: 'Budget saved.', ok: true };
  } catch (error) {
    return failure(error, 'Unable to save the budget. Refresh and try again.');
  }
}

export async function deleteBudgetAction(
  _state: CostActionState,
  form: FormData
): Promise<CostActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { message: 'Invalid budget.', ok: false };
    const deleted = await deleteBudget(id, Number(text(form, 'expectedRevision') || 0), {
      actorId: actor.id,
      source: 'UI',
    });
    revalidatePath(PATH);
    return deleted
      ? { message: 'Budget removed.', ok: true }
      : { message: 'That budget no longer exists.', ok: false };
  } catch (error) {
    return failure(error, 'Unable to remove the budget. Refresh and try again.');
  }
}

export async function saveModelPriceAction(
  _state: CostActionState,
  form: FormData
): Promise<CostActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    await saveModelPrice(
      {
        providerKind: text(form, 'providerKind'),
        model: text(form, 'model'),
        inputUsdPerMTok: Number(text(form, 'inputUsdPerMTok')),
        outputUsdPerMTok: Number(text(form, 'outputUsdPerMTok') || 0),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(PATH);
    return { message: 'Price saved.', ok: true };
  } catch (error) {
    return failure(error, 'Unable to save the price. Refresh and try again.');
  }
}

export async function deleteModelPriceAction(
  _state: CostActionState,
  form: FormData
): Promise<CostActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const removed = await deleteModelPrice(text(form, 'providerKind'), text(form, 'model'), {
      actorId: actor.id,
      source: 'UI',
    });
    revalidatePath(PATH);
    return removed
      ? { message: 'Price override removed; the built-in price applies again.', ok: true }
      : { message: 'That price override no longer exists.', ok: false };
  } catch (error) {
    return failure(error, 'Unable to remove the price. Refresh and try again.');
  }
}
