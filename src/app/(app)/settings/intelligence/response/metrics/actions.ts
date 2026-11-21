'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import {
  deleteMetricTemplate,
  requestMetricEvaluation,
  saveMetricTemplate,
} from '@/lib/intelligence/metric-anomaly/service';

export type MetricTemplateActionState = { message: string; ok: boolean };

const PATH = '/settings/intelligence/response/metrics';

function failure(error: unknown): MetricTemplateActionState {
  if (error instanceof AppError) {
    const detail = error.fields?.[0];
    return {
      message: detail ? `${error.userMessage} (${detail.message})` : error.userMessage,
      ok: false,
    };
  }
  logger.error('[Intelligence] Metric template action failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return { message: 'Unable to save. Refresh and try again.', ok: false };
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

/** Blank numeric fields fall back to the schema default; anything else is validated by the schema. */
const number = (form: FormData, name: string) => {
  const value = text(form, name);
  return value === '' ? undefined : Number(value);
};

export async function saveMetricTemplateAction(
  _state: MetricTemplateActionState,
  form: FormData
): Promise<MetricTemplateActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id') || null;
    await saveMetricTemplate(
      id,
      {
        serviceId: text(form, 'serviceId'),
        connectionId: text(form, 'connectionId'),
        name: text(form, 'name'),
        query: text(form, 'query'),
        enabled: form.get('enabled') === 'on',
        direction: text(form, 'direction') || undefined,
        thresholdMad: number(form, 'thresholdMad'),
        baselineWeeks: number(form, 'baselineWeeks'),
        windowMinutes: number(form, 'windowMinutes'),
        stepSeconds: number(form, 'stepSeconds'),
        intervalMinutes: number(form, 'intervalMinutes'),
        minDeviation: number(form, 'minDeviation'),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(PATH);
    return {
      message: id ? 'Template saved.' : 'Template added. Enabled templates run on their schedule.',
      ok: true,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteMetricTemplateAction(
  _state: MetricTemplateActionState,
  form: FormData
): Promise<MetricTemplateActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const result = await deleteMetricTemplate(text(form, 'id'), {
      actorId: actor.id,
      source: 'UI',
    });
    revalidatePath(PATH);
    return result === 'deleted'
      ? { message: 'Template removed with the anomalies it found.', ok: true }
      : { message: 'That template no longer exists.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

export async function evaluateMetricTemplateAction(
  _state: MetricTemplateActionState,
  form: FormData
): Promise<MetricTemplateActionState> {
  try {
    await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const queued = await requestMetricEvaluation(text(form, 'id'));
    revalidatePath(PATH);
    return queued
      ? {
          message: 'Evaluation queued; the result appears here once the lane has run it.',
          ok: true,
        }
      : { message: 'Enable the template first.', ok: false };
  } catch (error) {
    return failure(error);
  }
}
