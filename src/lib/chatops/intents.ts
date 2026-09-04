import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { decrypt, encrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { toSlackResponseUrl } from '@/lib/slack-signature';

const LEASE_MS = 5 * 60 * 1000;

export type ChatOpsIntentInput = {
  kind: 'SLASH_COMMAND' | 'INTERACTIVE_ACTION';
  signature: string;
  workspaceId: string;
  channelId?: string;
  slackUserId?: string;
  payload: Record<string, unknown>;
};

function deliveryHash(kind: ChatOpsIntentInput['kind'], signature: string): string {
  return crypto.createHash('sha256').update(`${kind}:${signature}`).digest('hex');
}

/**
 * Persist a signed Slack request before acknowledging it. The Slack signature
 * is deterministic for a provider retry, while the payload itself remains
 * encrypted at rest because it can contain response URLs and user content.
 */
export async function enqueueChatOpsIntent(input: ChatOpsIntentInput): Promise<{ id: string; duplicate: boolean }> {
  const hash = deliveryHash(input.kind, input.signature);
  try {
    const encryptedPayload = await encrypt(JSON.stringify(input.payload));
    const intent = await prisma.$transaction(async tx => {
      const created = await tx.chatOpsIntent.create({
        data: {
          kind: input.kind,
          deliveryHash: hash,
          workspaceId: input.workspaceId,
          channelId: input.channelId || null,
          slackUserId: input.slackUserId || null,
          encryptedPayload,
        },
      });
      await tx.backgroundJob.create({
        data: {
          type: 'CHATOPS_INTENT',
          status: 'PENDING',
          scheduledAt: new Date(),
          payload: { intentId: created.id },
          maxAttempts: 8,
        },
      });
      return created;
    });
    return { id: intent.id, duplicate: false };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    const existing = await prisma.chatOpsIntent.findUnique({
      where: { kind_deliveryHash: { kind: input.kind, deliveryHash: hash } },
      select: { id: true },
    });
    if (!existing) throw error;
    // A prior crash or an old partially-deployed release could leave an
    // intent without a runnable executor. Repair that invariant transactionally
    // on the duplicate path without creating a second job when one is leased.
    await prisma.$transaction(async tx => {
      const runnable = await tx.backgroundJob.findFirst({
        where: {
          type: 'CHATOPS_INTENT',
          status: { in: ['PENDING', 'PROCESSING'] },
          payload: { path: ['intentId'], equals: existing.id },
        },
        select: { id: true },
      });
      const intent = await tx.chatOpsIntent.findUnique({
        where: { id: existing.id },
        select: { status: true },
      });
      if (!runnable && intent && ['PENDING', 'FAILED', 'EFFECT_COMPLETED'].includes(intent.status)) {
        await tx.backgroundJob.create({
          data: {
            type: 'CHATOPS_INTENT', status: 'PENDING', scheduledAt: new Date(),
            payload: { intentId: existing.id }, maxAttempts: 8,
          },
        });
      }
    });
    return { id: existing.id, duplicate: true };
  }
}

type ClaimedIntent = { id: string; leaseToken: string; encryptedPayload: string; status: 'PROCESSING' | 'EFFECT_COMPLETED'; responsePayload: Prisma.JsonValue | null };

async function claimChatOpsIntent(id: string): Promise<ClaimedIntent | null> {
  const now = new Date();
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  const claimed = await prisma.chatOpsIntent.updateMany({
    where: {
      id,
      OR: [
        { status: { in: ['PENDING', 'FAILED', 'EFFECT_COMPLETED'] } },
        { status: 'PROCESSING', leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      status: 'PROCESSING',
      leaseToken,
      leaseExpiresAt,
      attempt: { increment: 1 },
      lastError: null,
    },
  });
  if (claimed.count !== 1) return null;
  const intent = await prisma.chatOpsIntent.findUnique({
    where: { id },
    select: { id: true, encryptedPayload: true, responsePayload: true, effectCompletedAt: true },
  });
  if (!intent) return null;
  return {
    id: intent.id,
    leaseToken,
    encryptedPayload: intent.encryptedPayload,
    status: intent.effectCompletedAt ? 'EFFECT_COMPLETED' : 'PROCESSING',
    responsePayload: intent.responsePayload,
  };
}

async function recordEffect(claim: ClaimedIntent, responsePayload: Prisma.InputJsonValue): Promise<void> {
  const result = await prisma.chatOpsIntent.updateMany({
    where: { id: claim.id, status: 'PROCESSING', leaseToken: claim.leaseToken },
    data: {
      status: 'EFFECT_COMPLETED',
      effectCompletedAt: new Date(),
      responsePayload,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  if (result.count !== 1) throw new Error('ChatOps intent lease was lost before effect completion');
}

async function completeIntent(id: string): Promise<void> {
  await prisma.chatOpsIntent.update({
    where: { id },
    data: { status: 'COMPLETED', responseCompletedAt: new Date(), leaseToken: null, leaseExpiresAt: null },
  });
}

async function failIntent(claim: ClaimedIntent, error: unknown): Promise<void> {
  await prisma.chatOpsIntent.updateMany({
    where: { id: claim.id, status: 'PROCESSING', leaseToken: claim.leaseToken },
    data: {
      status: 'FAILED',
      lastError: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
}

async function sendSlackResponse(payload: Record<string, unknown>, response: Prisma.JsonValue | null): Promise<void> {
  const responseUrl = toSlackResponseUrl(payload.response_url);
  if (!responseUrl || response === null) return;
  const request = await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response),
    signal: AbortSignal.timeout(5_000),
  });
  if (!request.ok) throw new Error(`Slack response delivery failed (${request.status})`);
}

/** Called exclusively from the durable background queue. */
export async function processChatOpsIntent(intentId: string): Promise<void> {
  const claim = await claimChatOpsIntent(intentId);
  if (!claim) return;
  try {
    const payload: Record<string, unknown> = {
      ...(JSON.parse(await decrypt(claim.encryptedPayload)) as Record<string, unknown>),
      __opsknightIntentId: claim.id,
    };
    let response = claim.responsePayload;
    if (claim.status === 'PROCESSING') {
      if (payload.__kind === 'SLASH_COMMAND') {
        const { handleSlashCommand } = await import('@/lib/chatops/slash-commands');
        response = (await handleSlashCommand(
          payload as unknown as Parameters<typeof handleSlashCommand>[0]
        )) as unknown as Prisma.JsonValue;
      } else {
        const { handleSlackActionRequest } = await import('@/app/api/slack/actions/route');
        const result = await handleSlackActionRequest(payload);
        response = await result.json();
      }
      await recordEffect(claim, response as Prisma.InputJsonValue);
    }
    await sendSlackResponse(payload, response);
    await completeIntent(claim.id);
  } catch (error) {
    await failIntent(claim, error);
    throw error;
  }
}
