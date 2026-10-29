'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { invalidateGatewayCache, testProviderConnection } from '@/lib/intelligence/ai/gateway';
import { deleteAiProvider, saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import { setGuidance } from '@/lib/intelligence/ai/prompts';

export type AiActionState = { message: string; ok: boolean };

const PATH = '/settings/intelligence/ai';

function failure(error: unknown): AiActionState {
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
  logger.error('[Intelligence] AI settings action failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return { message: 'Unable to save. Refresh and try again.', ok: false };
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};
const integer = (form: FormData, name: string) => Number(text(form, name));
const checked = (form: FormData, name: string) => form.get(name) === 'on';

export async function saveAiSettingsAction(
  _state: AiActionState,
  form: FormData
): Promise<AiActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    await updateAiSettings(
      {
        enabled: checked(form, 'enabled'),
        squireEnabled: checked(form, 'squireEnabled'),
        squireName: text(form, 'squireName'),
        squireAvatar: text(form, 'squireAvatar') || 'ICON',
        squireLauncher: text(form, 'squireLauncher') || 'FLOATING',
        squireAnimations: checked(form, 'squireAnimations'),
        allowExternalFallback: checked(form, 'allowExternalFallback'),
        requestsPerMinutePerUser: integer(form, 'requestsPerMinutePerUser'),
        dailyTokenBudget: integer(form, 'dailyTokenBudget'),
        userDailyTokenBudget: integer(form, 'userDailyTokenBudget'),
        maxOutputTokens: integer(form, 'maxOutputTokens'),
        requestTimeoutMs: integer(form, 'requestTimeoutMs'),
        allowedDataRegions: text(form, 'allowedDataRegions')
          .split(',')
          .map(region => region.trim())
          .filter(Boolean),
        embeddingsEnabled: checked(form, 'embeddingsEnabled'),
        squireHistoryEnabled: checked(form, 'squireHistoryEnabled'),
        squireHistoryRetentionDays: integer(form, 'squireHistoryRetentionDays') || 30,
        expectedRevision: integer(form, 'expectedRevision'),
      },
      { actorId: actor.id, source: 'UI' }
    );
    invalidateGatewayCache();
    revalidatePath(PATH);
    // The assistant lives in the app shell on every page.
    revalidatePath('/', 'layout');
    return { message: 'AI settings saved.', ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function saveAiProviderAction(
  _state: AiActionState,
  form: FormData
): Promise<AiActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id');
    await saveAiProvider(
      id || null,
      {
        name: text(form, 'name'),
        kind: text(form, 'kind'),
        model: text(form, 'model'),
        baseUrl: text(form, 'baseUrl') || null,
        apiKey: text(form, 'apiKey') || null,
        enabled: checked(form, 'enabled'),
        isExternal: checked(form, 'isExternal'),
        maxDataClass: text(form, 'maxDataClass'),
        allowPrivateNetwork: checked(form, 'allowPrivateNetwork'),
        priority: integer(form, 'priority'),
        dataRegion: text(form, 'dataRegion') || null,
        embeddingModel: text(form, 'embeddingModel') || null,
        azureResourceName: text(form, 'azureResourceName') || null,
        azureApiVersion: text(form, 'azureApiVersion') || null,
        awsRegion: text(form, 'awsRegion') || null,
        awsAccessKeyId: text(form, 'awsAccessKeyId') || null,
        awsSecretAccessKey: text(form, 'awsSecretAccessKey') || null,
        gcpProject: text(form, 'gcpProject') || null,
        gcpLocation: text(form, 'gcpLocation') || null,
        serviceAccountJson: text(form, 'serviceAccountJson') || null,
      },
      { actorId: actor.id, source: 'UI' }
    );
    invalidateGatewayCache();
    revalidatePath(PATH);
    return { message: id ? 'Provider updated.' : 'Provider added.', ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteAiProviderAction(
  _state: AiActionState,
  form: FormData
): Promise<AiActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const result = await deleteAiProvider(text(form, 'id'), { actorId: actor.id, source: 'UI' });
    invalidateGatewayCache();
    revalidatePath(PATH);
    return result === 'deleted'
      ? { message: 'Provider removed.', ok: true }
      : { message: 'That provider no longer exists.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

const TEST_MESSAGES = {
  NOT_FOUND: 'That provider no longer exists.',
  MISSING_KEY: 'No API key is stored for this provider.',
  UNREACHABLE: 'Could not reach the endpoint. Check the address and network access.',
  REJECTED: 'The provider rejected the request. Check the key and model name.',
  TIMEOUT: 'The provider did not answer in time.',
  FAILED: 'The provider returned an error. Try again later.',
} as const;

export async function testAiProviderAction(
  _state: AiActionState,
  form: FormData
): Promise<AiActionState> {
  try {
    await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const result = await testProviderConnection(text(form, 'id'));
    return result.ok
      ? { message: `Connected in ${result.latencyMs} ms.`, ok: true }
      : { message: TEST_MESSAGES[result.reason], ok: false };
  } catch (error) {
    return failure(error);
  }
}

export async function savePromptGuidanceAction(
  _state: AiActionState,
  form: FormData
): Promise<AiActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const result = await setGuidance(
      text(form, 'promptId'),
      { text: text(form, 'guidance'), expectedRevision: integer(form, 'expectedRevision') },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(PATH);
    return { message: `Guidance saved (revision ${result.revision}).`, ok: true };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unknown prompt'))
      return { message: 'Unknown prompt.', ok: false };
    return failure(error);
  }
}
