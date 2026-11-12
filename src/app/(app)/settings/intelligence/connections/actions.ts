'use server';

import { revalidatePath } from 'next/cache';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import {
  deleteObservabilityConnection,
  saveObservabilityConnection,
  testObservabilityConnection,
} from '@/lib/intelligence/connectors/service';
import type { ConnectorTestResult } from '@/lib/intelligence/connectors/contract';

export type ConnectionActionState = { message: string; ok: boolean };

const PATH = '/settings/intelligence/connections';

function failure(error: unknown): ConnectionActionState {
  if (error instanceof AppError) {
    const detail = error.fields?.[0];
    return {
      message: detail
        ? `${error.userMessage} (${detail.field}: ${detail.message})`
        : error.userMessage,
      ok: false,
    };
  }
  logger.error('[Intelligence] Connection action failed', {
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });
  return { message: 'Unable to save. Refresh and try again.', ok: false };
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** Every field is validated again by the service's zod schema; this only maps the form. */
export async function saveConnectionAction(
  _state: ConnectionActionState,
  form: FormData
): Promise<ConnectionActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const id = text(form, 'id');
    await saveObservabilityConnection(
      id || null,
      {
        name: text(form, 'name'),
        kind: text(form, 'kind'),
        baseUrl: text(form, 'baseUrl') || null,
        secret: text(form, 'secret') || null,
        secondary: text(form, 'secondary') || null,
        region: text(form, 'region') || null,
        org: text(form, 'org') || null,
        project: text(form, 'project') || null,
        allowedTeamIds: form
          .getAll('allowedTeamIds')
          .filter((value): value is string => typeof value === 'string' && value.length > 0),
        allowPrivateNetwork: form.get('allowPrivateNetwork') === 'on',
        enabled: form.get('enabled') === 'on',
        timeoutMs: Number(text(form, 'timeoutMs') || 10_000),
      },
      { actorId: actor.id, source: 'UI' }
    );
    revalidatePath(PATH);
    return { message: id ? 'Connection updated.' : 'Connection added.', ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteConnectionAction(
  _state: ConnectionActionState,
  form: FormData
): Promise<ConnectionActionState> {
  try {
    const actor = await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const result = await deleteObservabilityConnection(text(form, 'id'), {
      actorId: actor.id,
      source: 'UI',
    });
    revalidatePath(PATH);
    return result === 'deleted'
      ? { message: 'Connection removed.', ok: true }
      : { message: 'That connection no longer exists.', ok: false };
  } catch (error) {
    return failure(error);
  }
}

const TEST_MESSAGES: Record<Extract<ConnectorTestResult, { ok: false }>['reason'], string> = {
  NOT_FOUND: 'That connection no longer exists.',
  BLOCKED: 'This address is not allowed. Private addresses need explicit consent.',
  UNREACHABLE: 'Could not reach the endpoint. Check the address and network access.',
  REJECTED: 'The endpoint rejected the credentials.',
  TIMEOUT: 'The endpoint did not answer in time.',
  TOO_LARGE: 'The endpoint answered with more data than allowed.',
  FAILED: 'The endpoint returned an error. Check the address and settings.',
  UNSUPPORTED: 'This connection is missing a required setting.',
};

export async function testConnectionAction(
  _state: ConnectionActionState,
  form: FormData
): Promise<ConnectionActionState> {
  try {
    await assertCapability(CAPABILITIES.INTELLIGENCE_MANAGE);
    const result = await testObservabilityConnection(text(form, 'id'));
    return result.ok
      ? { message: `Connected in ${result.latencyMs} ms.`, ok: true }
      : { message: TEST_MESSAGES[result.reason], ok: false };
  } catch (error) {
    return failure(error);
  }
}
