'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import {
  addAiModel,
  applyRecommendedPreset,
  SETUP_AI_PROVIDERS,
  switchOnSuggestions,
  type SetupAiKind,
} from '@/lib/intelligence/settings/setup';
import { invalidateGatewayCache, testProviderConnection } from '@/lib/intelligence/ai/gateway';
import { intelligenceSettingsPath } from '@/lib/intelligence/settings/routes';
import type { IntelligenceActionState } from './actions';

const revision = (form: FormData, name: string) => {
  const value = Number(form.get(name));
  return Number.isInteger(value) && value >= 0 ? value : -1;
};

/** The setup checklist's "Turn on recommended" button: safe switches only, revision-checked and audited. */
export async function applyRecommendedSetup(
  _state: IntelligenceActionState,
  form: FormData
): Promise<IntelligenceActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const changed = await applyRecommendedPreset(
      {
        settingsRevision: revision(form, 'settingsRevision'),
        policyVersion: revision(form, 'policyVersion'),
        noiseRevision: revision(form, 'noiseRevision'),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(intelligenceSettingsPath('engine'));
    revalidatePath(intelligenceSettingsPath('noise'));
    revalidatePath('/settings/intelligence/setup');
    revalidatePath('/intelligence');
    return {
      ok: true,
      message: changed.length > 0 ? 'Intelligence is now watching.' : 'Already set up.',
    };
  } catch (error) {
    if (error instanceof AppError) {
      return {
        ok: false,
        message:
          error.code === 'PRECONDITION_FAILED'
            ? 'These settings changed since you opened the page. Refresh and try again.'
            : error.userMessage,
      };
    }
    logger.error('[Intelligence] Recommended setup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { message: 'Unable to save. Refresh and try again.', ok: false };
  }
}

const revisionsOf = (form: FormData) => ({
  settingsRevision: revision(form, 'settingsRevision'),
  policyVersion: revision(form, 'policyVersion'),
  noiseRevision: revision(form, 'noiseRevision'),
});

function failure(error: unknown): IntelligenceActionState {
  if (error instanceof AppError) {
    return {
      ok: false,
      message:
        error.code === 'PRECONDITION_FAILED'
          ? 'These settings changed since you opened the page. Reload and try again.'
          : error.userMessage,
    };
  }
  logger.error('[Intelligence] Setup step failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return { message: 'Unable to save. Reload and try again.', ok: false };
}

/** "Switch on": show suggestions to the team and, once the evidence is enough, turn noise controls on. */
export async function switchOnIntelligence(
  _state: IntelligenceActionState,
  form: FormData
): Promise<IntelligenceActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const changed = await switchOnSuggestions(revisionsOf(form), {
      actorId: actor.id,
      source: 'UI',
    });
    revalidatePath(intelligenceSettingsPath('engine'));
    revalidatePath(intelligenceSettingsPath('noise'));
    revalidatePath('/intelligence');
    return {
      ok: true,
      message: changed.includes('noiseOn')
        ? 'Suggestions are on for your team, and noise controls are now applied.'
        : changed.includes('suggestions')
          ? 'Suggestions are on for your team. Noise controls keep watching until there is enough evidence.'
          : 'Already switched on.',
    };
  } catch (error) {
    return failure(error);
  }
}

const TEST_FAILED = {
  NOT_FOUND: 'The model was saved, but it could not be found again. Reload and try again.',
  MISSING_KEY: 'Paste the API key and try again.',
  UNREACHABLE: 'Could not reach the provider. Check your network and try again.',
  REJECTED: 'The provider rejected the key or the model name. Check them and try again.',
  TIMEOUT: 'The provider did not answer in time. Try again.',
  FAILED: 'The provider returned an error. Try again in a moment.',
  RATE_LIMITED: 'The provider says too many requests. Try again shortly.',
  BUDGET_EXHAUSTED: 'The daily AI budget is used up.',
} as const;

/** Guided setup, "Add an AI model": saves the provider, switches AI on, then tests the connection. */
export async function addAiModelAction(
  _state: IntelligenceActionState,
  form: FormData
): Promise<IntelligenceActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const kind = String(form.get('kind') ?? '');
    if (!(kind in SETUP_AI_PROVIDERS)) return { ok: false, message: 'Choose a provider.' };
    const apiKey = String(form.get('apiKey') ?? '').trim();
    if (!apiKey) return { ok: false, message: 'Paste your API key.' };
    const id = await addAiModel(
      {
        kind: kind as SetupAiKind,
        apiKey,
        model: String(form.get('model') ?? ''),
        incidentText: form.get('incidentText') !== 'titles',
      },
      { actorId: actor.id, source: 'UI' }
    );
    invalidateGatewayCache();
    revalidatePath(intelligenceSettingsPath('engine'));
    revalidatePath(intelligenceSettingsPath('assistant'));
    revalidatePath('/settings/intelligence/setup');
    const result = await testProviderConnection(id, actor.id);
    return result.ok
      ? { ok: true, message: `Connected in ${result.latencyMs} ms.` }
      : { ok: false, message: TEST_FAILED[result.reason] };
  } catch (error) {
    return failure(error);
  }
}
