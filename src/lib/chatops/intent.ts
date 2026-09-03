import 'server-only';

import { createHash } from 'crypto';
import prisma from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { toSlackResponseUrl } from '@/lib/slack-signature';

export const CHATOPS_COMMAND_TASK = 'CHATOPS_COMMAND';
const MAX_CHATOPS_PAYLOAD_BYTES = 128 * 1024;

type ChatOpsIntentKind = 'SLASH_COMMAND' | 'INTERACTIVE_ACTION';

type PersistedChatOpsIntent = {
  task: typeof CHATOPS_COMMAND_TASK;
  kind: ChatOpsIntentKind;
  requestHash: string;
  workspaceId: string;
  encryptedPayload: string;
};

function stableIntentId(kind: ChatOpsIntentKind, workspaceId: string, requestIdentity: string): string {
  const digest = createHash('sha256')
    .update(`${kind}\0${workspaceId}\0${requestIdentity}`)
    .digest('hex');
  return `chatops:${digest}`;
}

export async function enqueueChatOpsIntent(input: {
  kind: ChatOpsIntentKind;
  workspaceId: string;
  requestIdentity: string;
  payload: unknown;
}): Promise<{ id: string; duplicate: boolean }> {
  if (!input.workspaceId.trim()) throw new Error('Slack workspace identity is required');
  if (!input.requestIdentity.trim()) throw new Error('Slack request identity is required');

  const serialized = JSON.stringify(input.payload);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CHATOPS_PAYLOAD_BYTES) {
    throw new Error('Slack payload exceeds the durable command limit');
  }

  const id = stableIntentId(input.kind, input.workspaceId, input.requestIdentity);
  const encryptedPayload = await encrypt(serialized);
  const requestHash = createHash('sha256').update(input.requestIdentity).digest('hex');

  try {
    await prisma.backgroundJob.create({
      data: {
        id,
        type: 'SCHEDULED_TASK',
        status: 'PENDING',
        scheduledAt: new Date(),
        maxAttempts: 5,
        payload: {
          task: CHATOPS_COMMAND_TASK,
          kind: input.kind,
          requestHash,
          workspaceId: input.workspaceId,
          encryptedPayload,
        },
      },
    });
    return { id, duplicate: false };
  } catch (error) {
    // A deterministic primary key is the cross-replica idempotency fence. Only
    // an actually-existing job is a duplicate; database failures still bubble.
    const existing = await prisma.backgroundJob.findUnique({ where: { id }, select: { id: true } });
    if (existing) return { id, duplicate: true };
    throw error;
  }
}

function parseIntent(payload: unknown): PersistedChatOpsIntent {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new Error('Invalid ChatOps job payload');
  }
  const value = payload as Record<string, unknown>;
  if (
    value.task !== CHATOPS_COMMAND_TASK ||
    (value.kind !== 'SLASH_COMMAND' && value.kind !== 'INTERACTIVE_ACTION') ||
    typeof value.requestHash !== 'string' ||
    typeof value.workspaceId !== 'string' ||
    typeof value.encryptedPayload !== 'string'
  ) {
    throw new Error('Invalid ChatOps job payload');
  }
  return value as PersistedChatOpsIntent;
}

async function postDeferredSlackResponse(responseUrl: unknown, body: unknown): Promise<void> {
  const url = typeof responseUrl === 'string' ? toSlackResponseUrl(responseUrl) : null;
  if (!url) return;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Slack deferred response failed with HTTP ${response.status}`);
}

/** Process one leased BackgroundJob. Throwing delegates retry/backoff/dead-letter to the queue. */
export async function processChatOpsIntent(rawJobPayload: unknown): Promise<void> {
  const intent = parseIntent(rawJobPayload);
  const decrypted = await decrypt(intent.encryptedPayload);
  const payload = JSON.parse(decrypted) as Record<string, unknown>;

  if (intent.kind === 'SLASH_COMMAND') {
    const { handleSlashCommand } = await import('@/lib/chatops/slash-commands');
    const slashPayload = payload as Parameters<typeof handleSlashCommand>[0];
    const result = await handleSlashCommand(slashPayload);
    await postDeferredSlackResponse(payload.response_url, result);
    return;
  }

  const { handleSlackActionRequest } = await import('@/app/api/slack/actions/route');
  const actionPayload = payload as Parameters<typeof handleSlackActionRequest>[0];
  const result = await handleSlackActionRequest(actionPayload);
  const resultBody = await result.json();
  await postDeferredSlackResponse(payload.response_url, resultBody);

  logger.info('chatops.intent_completed', {
    kind: intent.kind,
    workspaceId: intent.workspaceId,
    requestHash: intent.requestHash,
  });
}