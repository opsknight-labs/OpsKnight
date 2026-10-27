'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { z } from 'zod/v4';
import {
  INTELLIGENCE_MODES,
  MAX_CORRELATION_RULES_PER_POLICY,
  correlationRuleSchema,
  type CorrelationRule,
  type IntelligenceModeValue,
  type PolicyDefinition,
} from '@/lib/intelligence/contract';
import { replayPolicyRules } from '@/lib/intelligence/evaluation/replay';
import { replayDeadLetter } from '@/lib/intelligence/jobs/work-queue';
import {
  getIntelligenceSettings,
  publishPolicyVersion,
  resolveEffectivePolicy,
  rollbackPolicy,
  updateIntelligenceSettings,
} from '@/lib/intelligence/settings/service';

export type IntelligenceActionState = { message: string; ok: boolean };

const SETTINGS_PATH = '/settings/intelligence';

function failure(error: unknown): IntelligenceActionState {
  if (error instanceof AppError) {
    const detail = error.fields?.[0];
    const message =
      error.code === 'PRECONDITION_FAILED'
        ? 'These settings changed since you opened the page. Refresh and try again.'
        : detail
          ? `${error.userMessage} (${detail.field}: ${detail.message})`
          : error.userMessage;
    return { message, ok: false };
  }
  // Anything unexpected is logged server-side and surfaced generically; details never reach the client.
  logger.error('[Intelligence] Settings action failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return { message: 'Unable to save. Refresh and try again.', ok: false };
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
const integer = (form: FormData, name: string) => Number(text(form, name));

export async function saveIntelligenceSettings(
  _state: IntelligenceActionState,
  form: FormData
): Promise<IntelligenceActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    await updateIntelligenceSettings(
      {
        enabled: form.get('enabled') === 'on',
        maxConcurrency: integer(form, 'maxConcurrency'),
        batchSize: integer(form, 'batchSize'),
        maxJobMs: integer(form, 'maxJobMs'),
        maxDbMs: integer(form, 'maxDbMs'),
        candidateCap: integer(form, 'candidateCap'),
        lookbackDays: integer(form, 'lookbackDays'),
        backpressureEscalationLagMs: integer(form, 'backpressureEscalationLagMs'),
        fingerprintRetentionDays: integer(form, 'fingerprintRetentionDays'),
        correlationRetentionDays: integer(form, 'correlationRetentionDays'),
        findingRetentionDays: integer(form, 'findingRetentionDays'),
        feedbackRetentionDays: integer(form, 'feedbackRetentionDays'),
        expectedRevision: integer(form, 'expectedRevision'),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(SETTINGS_PATH);
    return { message: 'Intelligence settings saved.', ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function publishGlobalPolicy(
  _state: IntelligenceActionState,
  form: FormData
): Promise<IntelligenceActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const mode = text(form, 'mode') as IntelligenceModeValue;
    if (!INTELLIGENCE_MODES.includes(mode)) {
      return { message: 'Choose a valid mode.', ok: false };
    }
    // The form edits only what it shows; rules authored elsewhere are carried over unchanged.
    const current = await resolveEffectivePolicy(null);
    const definition: PolicyDefinition = {
      ...current.definition,
      similarity: {
        enabled: form.get('similarityEnabled') === 'on',
        minScore: Number(text(form, 'minScore')),
      },
      response: { enabled: form.get('responseEnabled') === 'on' },
    };
    const result = await publishPolicyVersion(
      {},
      {
        mode,
        definition,
        reason: text(form, 'reason') || undefined,
        expectedHeadVersion: integer(form, 'expectedHeadVersion'),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(SETTINGS_PATH);
    return { message: `Policy version ${result.version} published.`, ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function rollbackGlobalPolicy(
  _state: IntelligenceActionState,
  form: FormData
): Promise<IntelligenceActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const result = await rollbackPolicy(
      {},
      {
        targetVersion: integer(form, 'targetVersion'),
        expectedHeadVersion: integer(form, 'expectedHeadVersion'),
        reason: text(form, 'reason'),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(SETTINGS_PATH);
    return {
      message: `Published version ${result.version}, restored from version ${result.restoredFrom}.`,
      ok: true,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function replayIntelligenceDeadLetter(
  _state: IntelligenceActionState,
  form: FormData
): Promise<IntelligenceActionState> {
  try {
    await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { message: 'Invalid work item.', ok: false };
    const replayed = await replayDeadLetter(id);
    revalidatePath(SETTINGS_PATH);
    return replayed
      ? { message: 'Work item queued for another attempt.', ok: true }
      : { message: 'That item is no longer a dead letter.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

const rulesSchema = z.array(correlationRuleSchema).max(MAX_CORRELATION_RULES_PER_POLICY);

function parseRules(form: FormData): { rules: CorrelationRule[] } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text(form, 'rulesJson') || '[]');
  } catch {
    return { error: 'The rules could not be read. Reload the page and try again.' };
  }
  const parsed = rulesSchema.safeParse(raw);
  if (parsed.success) {
    const ids = parsed.data.map(rule => rule.id);
    if (new Set(ids).size !== ids.length) return { error: 'Each rule needs a unique id.' };
    return { rules: parsed.data };
  }
  const issue = parsed.error.issues[0];
  return { error: `Check the rules: ${issue.path.map(String).join('.') || 'input'} — ${issue.message}` };
}

export type RulePreviewState = {
  message: string;
  ok: boolean;
  preview?: {
    days: number;
    incidentsEvaluated: number;
    criticalExcluded: number;
    groups: number;
    groupedIncidents: number;
    suggestedLinks: number;
    truncated: boolean;
    perRule: Array<{ ruleId: string; groups: number; groupedIncidents: number }>;
  };
};

/** Replays the edited rules over recent history so the effect is known before anything is published. */
export async function previewCorrelationRules(
  _state: RulePreviewState,
  form: FormData
): Promise<RulePreviewState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const parsed = parseRules(form);
    if ('error' in parsed) return { message: parsed.error, ok: false };
    const days = Number(text(form, 'days'));
    if (!Number.isInteger(days) || days < 1 || days > 90) return { message: 'Choose between 1 and 90 days.', ok: false };
    const settings = await getIntelligenceSettings();
    const result = await replayPolicyRules(settings, { rules: parsed.rules, days, createdById: actor.id });
    return {
      ok: true,
      message: 'Preview complete. Nothing has been changed.',
      preview: {
        days: result.days,
        incidentsEvaluated: result.incidentsEvaluated,
        criticalExcluded: result.criticalExcluded,
        groups: result.groups,
        groupedIncidents: result.groupedIncidents,
        suggestedLinks: result.suggestedLinks,
        truncated: result.truncated,
        perRule: result.perRule,
      },
    };
  } catch (error) {
    return failure(error);
  }
}

/** Publishes the edited rules as a new policy version, keeping the current mode and similarity settings. */
export async function publishCorrelationRules(
  _state: IntelligenceActionState,
  form: FormData
): Promise<IntelligenceActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const parsed = parseRules(form);
    if ('error' in parsed) return { message: parsed.error, ok: false };
    const current = await resolveEffectivePolicy(null);
    const definition: PolicyDefinition = {
      ...current.definition,
      correlation: { ...current.definition.correlation, rules: parsed.rules },
    };
    const result = await publishPolicyVersion(
      {},
      {
        mode: current.mode,
        definition,
        reason: text(form, 'reason') || 'Updated correlation rules',
        expectedHeadVersion: integer(form, 'expectedHeadVersion'),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(SETTINGS_PATH);
    return { message: `Rules published as policy version ${result.version}.`, ok: true };
  } catch (error) {
    return failure(error);
  }
}
