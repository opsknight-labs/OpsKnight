import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { decrypt, encrypt } from '@/lib/encryption';
import prisma from '@/lib/prisma';
import { toSlackResponseUrl } from '@/lib/slack-signature';
import type { ChatProvider } from '@/lib/chatops/provider';

const LEASE_MS = 5 * 60 * 1000;

export type ChatOpsIntentInput = {
  provider?: ChatProvider;
  kind: 'SLASH_COMMAND' | 'INTERACTIVE_ACTION';
  signature: string;
  workspaceId: string;
  channelId?: string;
  slackUserId?: string;
  /** Alias for Teams AAD object id — stored in slackUserId for back-compat */
  providerUserId?: string;
  payload: Record<string, unknown>;
  responseMode?: 'INLINE' | 'DEFERRED';
  payloadDigest?: string;
  providerTenantId?: string;
  providerConversationId?: string;
  providerChannelId?: string;
  providerActivityId?: string;
  providerObjectId?: string;
};

function deliveryHash(provider: ChatProvider, kind: ChatOpsIntentInput['kind'], signature: string): string {
  return crypto.createHash('sha256').update(`${provider}:${kind}:${signature}`).digest('hex');
}

function legacyDeliveryHash(kind: string, signature: string): string {
  return crypto.createHash('sha256').update(`${kind}:${signature}`).digest('hex');
}

export function payloadDigestFromPayload(payload: Record<string, unknown>): string {
  // Exclude dynamic execution deadlines (e.g. snoozedUntil) from duplicate-payload
  // comparison so that provider delivery retries do not trigger a false conflict.
  const { snoozedUntil: _, ...digestible } = payload;
  return crypto.createHash('sha256').update(JSON.stringify(digestible)).digest('hex');
}

function resolveProvider(input: ChatOpsIntentInput): ChatProvider {
  return input.provider ?? 'SLACK';
}

function resolveResponseMode(input: ChatOpsIntentInput, provider: ChatProvider): 'INLINE' | 'DEFERRED' {
  if (input.responseMode) return input.responseMode;
  return provider === 'MICROSOFT_TEAMS' ? 'INLINE' : 'DEFERRED';
}

function resolveProviderUserId(input: ChatOpsIntentInput): string | null {
  if (input.providerUserId) return input.providerUserId;
  if (input.slackUserId) return input.slackUserId;
  return null;
}

type ExistingIntent = { id: string; payloadDigest: string | null };

async function returnDuplicateIntent(
  existing: ExistingIntent,
  payloadDigest: string,
  responseMode: 'INLINE' | 'DEFERRED',
): Promise<{ id: string; duplicate: true }> {
  if (existing.payloadDigest && existing.payloadDigest !== payloadDigest) {
    throw new Error('ChatOps delivery identity was reused with a different payload');
  }
  // A prior crash or an old partially-deployed release could leave an intent
  // without a runnable executor. Repair that invariant without duplicating a
  // leased executor.
  if (responseMode === 'DEFERRED') await prisma.$transaction(async tx => {
    const runnable = await tx.backgroundJob.findFirst({
      where: { type: 'CHATOPS_INTENT', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['intentId'], equals: existing.id } },
      select: { id: true },
    });
    const intent = await tx.chatOpsIntent.findUnique({ where: { id: existing.id }, select: { status: true } });
    if (!runnable && intent && ['PENDING', 'FAILED', 'EFFECT_COMPLETED', 'RESPONSE_PENDING'].includes(intent.status)) {
      await tx.backgroundJob.create({
        data: { type: 'CHATOPS_INTENT', status: 'PENDING', scheduledAt: new Date(), payload: { intentId: existing.id }, maxAttempts: 8 },
      });
    }
  });
  return { id: existing.id, duplicate: true };
}

async function findLegacySlackIntent(kind: ChatOpsIntentInput['kind'], signature: string): Promise<ExistingIntent | null> {
  const legacyHash = legacyDeliveryHash(kind, signature);
  let existing = await prisma.chatOpsIntent.findUnique({
    where: { provider_kind_deliveryHash: { provider: 'SLACK', kind, deliveryHash: legacyHash } } as unknown as Prisma.ChatOpsIntentWhereUniqueInput,
    select: { id: true, payloadDigest: true },
  }) as ExistingIntent | null;
  if (!existing) {
    try {
      existing = await (prisma.chatOpsIntent.findUnique as unknown as (args: unknown) => Promise<ExistingIntent | null>)({
        where: { kind_deliveryHash: { kind, deliveryHash: legacyHash } }, select: { id: true, payloadDigest: true },
      });
    } catch {
      // A migrated client no longer exposes the legacy compound key.
    }
  }
  return existing;
}

/**
 * Persist a signed provider request before acknowledging it. The signature
 * is deterministic for a provider retry, while the payload itself remains
 * encrypted at rest because it can contain response URLs and user content.
 * Generic for Slack (DEFERRED response_url) and Teams (INLINE invoke response).
 */
export async function enqueueChatOpsIntent(input: ChatOpsIntentInput): Promise<{ id: string; duplicate: boolean }> {
  const provider = resolveProvider(input);
  const responseMode = resolveResponseMode(input, provider);
  const payloadDigest = input.payloadDigest ?? payloadDigestFromPayload(input.payload);
  const hash = deliveryHash(provider, input.kind, input.signature);
  const providerUserId = resolveProviderUserId(input);
  // Migration changes the unique hash format but intentionally leaves historical
  // encrypted payload rows intact. Check Slack's old hash *before* attempting
  // the new insert; otherwise no P2002 is raised and a retry can mutate twice.
  if (provider === 'SLACK') {
    const legacy = await findLegacySlackIntent(input.kind, input.signature);
    if (legacy) return returnDuplicateIntent(legacy, payloadDigest, responseMode);
  }
  try {
    const encryptedPayload = await encrypt(JSON.stringify(input.payload));
    const intent = await prisma.$transaction(async tx => {
      const created = await tx.chatOpsIntent.create({
        // Prisma client types lag schema during local dev (shared node_modules) — cast via any for rolling migration
        data: {
          provider,
          kind: input.kind,
          deliveryHash: hash,
          workspaceId: input.workspaceId,
          channelId: input.channelId || null,
          slackUserId: providerUserId,
          encryptedPayload,
          responseMode,
          payloadDigest,
          providerTenantId: input.providerTenantId ?? null,
          providerConversationId: input.providerConversationId ?? null,
          providerChannelId: input.providerChannelId ?? input.channelId ?? null,
          providerActivityId: input.providerActivityId ?? null,
          providerUserId,
          providerObjectId: input.providerObjectId ?? null,
        } as unknown as Prisma.ChatOpsIntentCreateInput,
      });
      if (responseMode === 'DEFERRED') {
        await tx.backgroundJob.create({
          data: {
            type: 'CHATOPS_INTENT', status: 'PENDING', scheduledAt: new Date(),
            payload: { intentId: created.id }, maxAttempts: 8,
          },
        });
      }
      return created;
    });
    return { id: intent.id, duplicate: false };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    // Provider-scoped lookup (new constraint)
    let existing = await prisma.chatOpsIntent.findUnique({
      where: { provider_kind_deliveryHash: { provider, kind: input.kind, deliveryHash: hash } } as unknown as Prisma.ChatOpsIntentWhereUniqueInput,
      select: { id: true, payloadDigest: true },
    }) as ExistingIntent | null;
    // Rolling-deploy compat: pre-generic Slack rows have deliveryHash = sha256(kind:signature) without provider prefix.
    // A retry arriving with new code would otherwise miss the dedup row and duplicate the mutation.
    if (!existing && provider === 'SLACK') {
      existing = await findLegacySlackIntent(input.kind, input.signature);
    }
    if (!existing) throw error;
    return returnDuplicateIntent(existing, payloadDigest, responseMode);
  }
}

/** Execute and durably replay an INLINE provider request (Teams invoke). */
export async function processInlineChatOpsIntent(
  intentId: string,
  execute: (input: { intentId: string; payload: Record<string, unknown> }) => Promise<Prisma.InputJsonValue>,
): Promise<Prisma.JsonValue> {
  const completed = await prisma.chatOpsIntent.findUnique({
    where: { id: intentId },
    select: { status: true, responsePayload: true, responseMode: true },
  });
  if (completed?.status === 'COMPLETED' && completed.responsePayload !== null) return completed.responsePayload;
  if (completed?.responseMode !== 'INLINE') throw new Error('ChatOps intent is not inline');

  const claim = await claimEffect(intentId);
  if (!claim) {
    const replay = await prisma.chatOpsIntent.findUnique({ where: { id: intentId }, select: { responsePayload: true } });
    if (replay?.responsePayload !== null && replay?.responsePayload !== undefined) {
      // A process can crash after committing the mutation response but before
      // advancing RESPONSE_PENDING to COMPLETED. The persisted response is the
      // replay boundary: never execute the domain mutation again. Opportunistically
      // finish the response state machine while returning the exact same payload.
      const replayClaim = await claimResponse(intentId);
      if (replayClaim) await completeResponse(replayClaim);
      return replay.responsePayload;
    }
    throw new Error('ChatOps action is already processing');
  }
  try {
    const payload = JSON.parse(await decrypt(claim.encryptedPayload)) as Record<string, unknown>;
    const response = await execute({ intentId, payload });
    await recordEffect(claim, response);
    const responseClaim = await claimResponse(intentId);
    if (!responseClaim) throw new Error('ChatOps inline response could not be claimed');
    await completeResponse(responseClaim);
    return response as Prisma.JsonValue;
  } catch (error) {
    await failEffect(claim, error);
    throw error;
  }
}

type ClaimedIntent = {
  id: string;
  leaseToken: string;
  encryptedPayload: string;
  responsePayload: Prisma.JsonValue | null;
  provider: ChatProvider;
  responseMode: 'INLINE' | 'DEFERRED';
};

async function claimEffect(id: string): Promise<ClaimedIntent | null> {
  const now = new Date();
  const leaseToken = crypto.randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  const claimed = await prisma.chatOpsIntent.updateMany({
    where: {
      id,
      OR: [
        { status: { in: ['PENDING', 'FAILED'] } },
        { status: 'EFFECT_PROCESSING', leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      status: 'EFFECT_PROCESSING',
      leaseToken,
      leaseExpiresAt,
      attempt: { increment: 1 },
      lastError: null,
    },
  });
  if (claimed.count !== 1) return null;
  const intent = await (prisma as unknown as {
    chatOpsIntent: { findUnique: (a: unknown) => Promise<{ id: string; encryptedPayload: string; responsePayload: Prisma.JsonValue | null; provider?: ChatProvider; responseMode?: string } | null> };
  }).chatOpsIntent.findUnique({
    where: { id },
    select: { id: true, encryptedPayload: true, responsePayload: true, provider: true, responseMode: true },
  });
  if (!intent) return null;
  return {
    id: intent.id,
    leaseToken,
    encryptedPayload: intent.encryptedPayload,
    responsePayload: intent.responsePayload,
    provider: (intent.provider as ChatProvider) ?? 'SLACK',
    responseMode: ((intent.responseMode as string) as 'INLINE' | 'DEFERRED') ?? 'DEFERRED',
  };
}

async function recordEffect(claim: ClaimedIntent, responsePayload: Prisma.InputJsonValue): Promise<void> {
  const result = await prisma.chatOpsIntent.updateMany({
    where: { id: claim.id, status: 'EFFECT_PROCESSING', leaseToken: claim.leaseToken },
    data: {
      status: 'RESPONSE_PENDING',
      effectCompletedAt: new Date(),
      responsePayload,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  if (result.count !== 1) throw new Error('ChatOps intent lease was lost before effect completion');
}

async function claimResponse(id: string): Promise<ClaimedIntent | null> {
  const now = new Date();
  const leaseToken = crypto.randomUUID();
  const claimed = await prisma.chatOpsIntent.updateMany({
    where: {
      id,
      OR: [
        { status: { in: ['EFFECT_COMPLETED', 'RESPONSE_PENDING'] } },
        { status: 'RESPONSE_PROCESSING', leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      status: 'RESPONSE_PROCESSING',
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
    },
  });
  if (claimed.count !== 1) return null;
  const intent = await (prisma as unknown as {
    chatOpsIntent: { findUnique: (a: unknown) => Promise<{ id: string; encryptedPayload: string; responsePayload: Prisma.JsonValue | null; provider?: ChatProvider; responseMode?: string } | null> };
  }).chatOpsIntent.findUnique({
    where: { id },
    select: { id: true, encryptedPayload: true, responsePayload: true, provider: true, responseMode: true },
  });
  return intent ? {
    id: intent.id,
    leaseToken,
    encryptedPayload: intent.encryptedPayload,
    responsePayload: intent.responsePayload,
    provider: (intent.provider as ChatProvider) ?? 'SLACK',
    responseMode: ((intent.responseMode as string) as 'INLINE' | 'DEFERRED') ?? 'DEFERRED',
  } : null;
}

async function completeResponse(claim: ClaimedIntent): Promise<void> {
  const completed = await prisma.chatOpsIntent.updateMany({
    where: { id: claim.id, status: 'RESPONSE_PROCESSING', leaseToken: claim.leaseToken },
    data: {
      status: 'COMPLETED',
      responseCompletedAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  if (completed.count !== 1) throw new Error('ChatOps response lease was lost');
}

async function failEffect(claim: ClaimedIntent, error: unknown): Promise<void> {
  await prisma.chatOpsIntent.updateMany({
    where: { id: claim.id, status: 'EFFECT_PROCESSING', leaseToken: claim.leaseToken },
    data: {
      status: 'FAILED',
      lastError: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
}

async function deferResponse(claim: ClaimedIntent, error: unknown): Promise<void> {
  await prisma.chatOpsIntent.updateMany({
    where: { id: claim.id, status: 'RESPONSE_PROCESSING', leaseToken: claim.leaseToken },
    data: {
      status: 'RESPONSE_PENDING',
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

async function deliverResponse(claim: ClaimedIntent, payload: Record<string, unknown>, response: Prisma.JsonValue | null): Promise<void> {
  // INLINE (Teams) is answered synchronously by the Bot Framework invoke handler; the background worker must not
  // attempt a Slack-style response_url POST. Persisting RESPONSE_PENDING→COMPLETED is still the durability signal,
  // but no transport delivery is required here.
  if (claim.responseMode === 'INLINE') return;
  if (claim.provider === 'MICROSOFT_TEAMS') return;
  await sendSlackResponse(payload, response);
}

/** Called exclusively from the durable background queue. */
export async function processChatOpsIntent(intentId: string): Promise<void> {
  let responseClaim: ClaimedIntent | null = null;
  const effectClaim = await claimEffect(intentId);
  if (effectClaim) {
    try {
      const payload: Record<string, unknown> = {
        ...(JSON.parse(await decrypt(effectClaim.encryptedPayload)) as Record<string, unknown>),
        __opsknightIntentId: effectClaim.id,
      };
      let response: Prisma.JsonValue;
      if (payload.__kind === 'SLASH_COMMAND') {
        const { handleSlashCommand } = await import('@/lib/chatops/slash-commands');
        response = (await handleSlashCommand(
          payload as unknown as Parameters<typeof handleSlashCommand>[0]
        )) as unknown as Prisma.JsonValue;
      } else {
        // Provider-aware dispatch: Slack actions remain the default; Teams interactive will be added in Commit 4
        // and will set provider=MICROSOFT_TEAMS. Until then, fall back to Slack handler for compat.
        if (effectClaim.provider === 'MICROSOFT_TEAMS') {
          const { handleSlackActionRequest } = await import('@/app/api/slack/actions/route');
          const result = await handleSlackActionRequest(payload);
          response = await result.json();
        } else {
          const { handleSlackActionRequest } = await import('@/app/api/slack/actions/route');
          const result = await handleSlackActionRequest(payload);
          response = await result.json();
        }
      }
      await recordEffect(effectClaim, response as Prisma.InputJsonValue);
    } catch (error) {
      await failEffect(effectClaim, error);
      throw error;
    }
  }

  responseClaim = await claimResponse(intentId);
  if (!responseClaim) return;
  try {
    const payload: Record<string, unknown> = {
      ...(JSON.parse(await decrypt(responseClaim.encryptedPayload)) as Record<string, unknown>),
      __opsknightIntentId: responseClaim.id,
    };
    await deliverResponse(responseClaim, payload, responseClaim.responsePayload);
    await completeResponse(responseClaim);
  } catch (error) {
    await deferResponse(responseClaim, error);
    throw error;
  }
}
