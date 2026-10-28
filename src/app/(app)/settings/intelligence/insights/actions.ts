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
