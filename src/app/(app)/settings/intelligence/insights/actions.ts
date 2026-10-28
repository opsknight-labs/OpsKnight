'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import type { PolicyDefinition } from '@/lib/intelligence/contract';
import { getFeedbackCalibration } from '@/lib/intelligence/insights/service';
import { publishPolicyVersion, resolveEffectivePolicy } from '@/lib/intelligence/settings/service';
import { DIGEST_DAYS } from '@/lib/intelligence/digest/contract';
import { sendTestDigest, updateDigestSettings } from '@/lib/intelligence/digest/service';
import { checkRateLimit } from '@/lib/rate-limit';
import { adoptRuleSuggestion, suggestCorrelationRules } from '@/lib/intelligence/learning/service';

export type InsightsActionState = { message: string; ok: boolean };

const PATH = '/settings/intelligence/insights';

function failure(error: unknown): InsightsActionState {
  if (error instanceof AppError) {
    return {
      message:
        error.code === 'PRECONDITION_FAILED'
          ? 'The global policy changed since you opened the page. Refresh and try again.'
          : error.userMessage,
      ok: false,
    };
  }
  logger.error('[Intelligence] Applying a suggestion failed', { error: error instanceof Error ? error.message : String(error) });
  return { message: 'Unable to apply. Refresh and try again.', ok: false };
}

/**
 * Applies the similarity-threshold suggestion as a new audited global policy version. The suggestion is
 * recomputed here from current feedback and must match what the person was shown, so a stale page or a
 * hand-crafted request can never set an arbitrary value through this path.
 */
export async function applyMinScoreSuggestion(
  _state: InsightsActionState,
  form: FormData
): Promise<InsightsActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const shown = Number(form.get('suggested'));
    const calibration = await getFeedbackCalibration();
    if (!calibration.suggestion || Math.abs(calibration.suggestion.suggested - shown) > 1e-9) {
      return { message: 'The suggestion changed as new feedback arrived. Refresh to review it.', ok: false };
    }
    const current = await resolveEffectivePolicy(null);
    const definition: PolicyDefinition = {
      ...current.definition,
      similarity: { ...current.definition.similarity, minScore: calibration.suggestion.suggested },
    };
    const result = await publishPolicyVersion(
      {},
      {
        mode: current.mode,
        definition,
        reason: `Applied suggested similarity threshold ${calibration.suggestion.suggested} from feedback`,
        expectedHeadVersion: Number(form.get('expectedHeadVersion')),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(PATH);
    revalidatePath('/settings/intelligence');
    return { message: `Similarity threshold set to ${calibration.suggestion.suggested}. Policy version ${result.version} published.`, ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** Saves the weekly digest schedule. Revision-locked, so two admins cannot silently overwrite each other. */
export async function saveDigestSettingsAction(_state: InsightsActionState, form: FormData): Promise<InsightsActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const next = await updateDigestSettings(
      {
        enabled: form.get('enabled') === 'on',
        dayOfWeek: Number(form.get('dayOfWeek')),
        hourUtc: Number(form.get('hourUtc')),
        expectedRevision: Number(form.get('expectedRevision')),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(PATH);
    return {
      message: next.enabled
        ? `Saved. The digest goes out every ${DIGEST_DAYS[next.dayOfWeek] ?? 'week'} at ${String(next.hourUtc).padStart(2, '0')}:00 UTC.`
        : 'Saved. The weekly digest is off.',
      ok: true,
    };
  } catch (error) {
    if (error instanceof AppError && error.code === 'PRECONDITION_FAILED') {
      return { message: 'The digest settings changed since you opened the page. Refresh and try again.', ok: false };
    }
    return failure(error);
  }
}

/** Emails the current digest to the signed-in admin only. Rate-limited so it cannot be used to spam. */
export async function sendTestDigestAction(_state: InsightsActionState): Promise<InsightsActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const limit = await checkRateLimit(`intelligence:digest-test:${actor.id}`, 3, 10 * 60_000);
    if (!limit.allowed) return { message: 'You can send 3 test digests every 10 minutes. Try again shortly.', ok: false };
    const sent = await sendTestDigest(actor.id);
    return sent
      ? { message: 'Queued. It should arrive within a minute or two; delivery shows under Notifications.', ok: true }
      : { message: 'Could not send. Check that an email provider is configured under Notifications.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

export type RuleSuggestionView = {
  ruleId: string;
  kind: string;
  keys: string[];
  windowSeconds: number;
  maxWindowSeconds: number;
  support: number;
  conflicts: number;
  precision: number;
  coverage: number;
  replay: { incidentsEvaluated: number; groups: number; groupedIncidents: number; suggestedLinks: number };
};
export type RuleSuggestionsState = InsightsActionState & { suggestions?: RuleSuggestionView[] };

/** Learns candidate grouping rules from people's link decisions. Read-only; nothing is changed. */
export async function findRuleSuggestionsAction(_state: RuleSuggestionsState): Promise<RuleSuggestionsState> {
  try {
    await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const suggestions = await suggestCorrelationRules();
    return {
      ok: true,
      message:
        suggestions.length === 0
          ? 'No rule is well supported yet. Suggestions appear once people have confirmed at least 3 similar links.'
          : `${suggestions.length} ${suggestions.length === 1 ? 'rule' : 'rules'} found. Nothing has been changed.`,
      suggestions: suggestions.map(({ rule, support, conflicts, precision, coverage, replay }) => ({
        ruleId: rule.id,
        kind: rule.kind,
        keys: rule.keys,
        windowSeconds: rule.windowSeconds,
        maxWindowSeconds: rule.maxWindowSeconds,
        support,
        conflicts,
        precision,
        coverage,
        replay,
      })),
    };
  } catch (error) {
    return failure(error);
  }
}

/** Publishes one learned rule as a new global policy version, in the current mode. */
export async function adoptRuleSuggestionAction(_state: InsightsActionState, form: FormData): Promise<InsightsActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const result = await adoptRuleSuggestion(
      { ruleId: String(form.get('ruleId') ?? ''), expectedHeadVersion: Number(form.get('expectedHeadVersion')) },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(PATH);
    revalidatePath('/settings/intelligence');
    return { ok: true, message: `Rule ${result.suggestion.rule.id} added. Policy version ${result.version} published.` };
  } catch (error) {
    return failure(error);
  }
}
