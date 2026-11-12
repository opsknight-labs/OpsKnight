import 'server-only';
import { createHash } from 'node:crypto';
import prisma from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { utcDay } from './budget';
import { callSiteRefusal } from './call-site';
import { attributeTeam, priceForModel } from './cost';
import { costMicrosFor } from './pricing';
import { recordResultCacheHit } from './scoped-budget';
import { getAiSettings } from './settings';
import type {
  AiGenerateRequest,
  AiGenerateResult,
  AiStructuredRequest,
  AiStructuredResult,
  LanguageModelPort,
} from './port';

/**
 * Result cache: the same question about the same facts is answered once. An entry is keyed by capability,
 * prompt id and version, the routed model, a scope (data class, attributed team and an optional caller
 * scope) and a hash of the exact model input, so nothing is ever served across scopes and a new prompt
 * version never matches an old answer. Answers are encrypted at rest, expire, and are swept by the
 * retention job. Only a complete, valid answer is stored: errors, refusals, truncated output and tool
 * conversations never are. The cache is opt-in (AI settings) and can only skip a model call: any cache
 * failure falls back to the live call.
 */

export const RESULT_CACHE_TTL_MS = 24 * 3_600_000;
/** Served-provider marker on a cached answer; never a real provider id. */
export const RESULT_CACHE_PROVIDER = 'result-cache';

export interface ResultCacheOptions {
  /** Defaults to the registered prompt on the request. Inline prompts pass an id and bump the version. */
  prompt?: { id: string; version: number };
  /** Extra isolation beyond data class and team, for example `user:<id>` for personal content. */
  scope?: string;
  ttlMs?: number;
}

type CacheKey = {
  capability: string;
  promptId: string;
  promptVersion: number;
  model: string;
  scopeKey: string;
  inputHash: string;
};

interface Slot {
  key: CacheKey;
  teamId: string | null;
}

/** Hash of exactly what the model would receive; `extra` carries the structured-output schema name. */
export function resultCacheInputHash(request: AiGenerateRequest, extra = ''): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        request.messages.map(message => [message.role, message.content]),
        request.maxOutputTokens ?? null,
        extra,
      ])
    )
    .digest('hex');
}

async function slotFor(
  port: LanguageModelPort,
  request: AiGenerateRequest,
  options: ResultCacheOptions,
  extra: string
): Promise<Slot | null> {
  const prompt = options.prompt ?? request.context.prompt;
  // Tool conversations depend on live reads, and a refused call site must reach the gateway's own check.
  if (!prompt || request.tools?.length || callSiteRefusal(request.context)) return null;
  if (!(await getAiSettings()).resultCacheEnabled) return null;
  const teamId = await attributeTeam(request.context.actorId, request.context.incidentId);
  return {
    teamId,
    key: {
      capability: request.context.capability,
      promptId: prompt.id.slice(0, 120),
      promptVersion: prompt.version,
      model: (port.model ?? 'default').slice(0, 200),
      scopeKey: `${request.context.dataClass}|team:${teamId ?? ''}|${options.scope ?? ''}`.slice(
        0,
        300
      ),
      inputHash: resultCacheInputHash(request, extra),
    },
  };
}

type CachedRow = {
  id: string;
  outputEncrypted: string;
  providerKind: string;
  servedModel: string;
  inputTokens: number;
  outputTokens: number;
  costMicros: bigint | null;
};

async function readSlot(slot: Slot): Promise<{ row: CachedRow; payload: unknown } | null> {
  const row = await prisma.aiResultCache.findFirst({
    where: { ...slot.key, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      outputEncrypted: true,
      providerKind: true,
      servedModel: true,
      inputTokens: true,
      outputTokens: true,
      costMicros: true,
    },
  });
  if (!row) return null;
  return { row, payload: JSON.parse(await decrypt(row.outputEncrypted)) as unknown };
}

/** Counts the hit and what it saved; a hit adds no request, tokens or dollars to the day's usage. */
async function recordHit(slot: Slot, row: CachedRow): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.aiResultCache.updateMany({ where: { id: row.id }, data: { hits: { increment: 1 } } });
    await recordResultCacheHit(
      tx,
      utcDay(),
      { tokens: row.inputTokens + row.outputTokens, costMicros: row.costMicros },
      {
        teamId: slot.teamId,
        capability: slot.key.capability,
        providerKind: row.providerKind,
        model: row.servedModel,
      }
    );
  });
}

async function writeSlot(
  slot: Slot,
  payload: unknown,
  result: Pick<AiGenerateResult, 'usage' | 'served'>,
  ttlMs: number
): Promise<void> {
  const provider = await prisma.aiProvider.findUnique({
    where: { id: result.served.providerId },
    select: { kind: true },
  });
  const providerKind = provider?.kind ?? 'UNKNOWN';
  const cost = costMicrosFor(result.usage, await priceForModel(providerKind, result.served.model));
  const data = {
    outputEncrypted: await encrypt(JSON.stringify(payload)),
    providerKind,
    servedModel: result.served.model.slice(0, 200),
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costMicros: cost === null ? null : BigInt(cost),
    hits: 0,
    expiresAt: new Date(Date.now() + ttlMs),
  };
  await prisma.aiResultCache.upsert({
    where: {
      capability_promptId_promptVersion_model_scopeKey_inputHash: slot.key,
    },
    create: { ...slot.key, ...data },
    update: { ...data, createdAt: new Date() },
  });
}

const warn = (stage: string, error: unknown) =>
  logger.warn(`[AI] Result cache ${stage} failed; using the live call`, {
    error: error instanceof Error ? error.name : 'error',
  });

/** A complete answer: the model stopped on its own (not cut off, not filtered or refused). */
const complete = (finishReason: string | undefined) =>
  finishReason === undefined || finishReason === 'stop';

const cachedServed = (row: CachedRow) => ({
  usage: { inputTokens: 0, outputTokens: 0 },
  served: { providerId: RESULT_CACHE_PROVIDER, model: row.servedModel, fallbackDepth: 0 },
  cached: true as const,
});

async function cached<R extends Pick<AiGenerateResult, 'usage' | 'served' | 'finishReason'>>(
  port: LanguageModelPort,
  request: AiGenerateRequest,
  options: ResultCacheOptions,
  extra: string,
  live: () => Promise<R>,
  /** The value to store, or undefined when this result must not be cached. */
  pack: (result: R) => unknown,
  /** Rebuilds a result from a stored value, or null when the value no longer passes validation. */
  unpack: (payload: unknown, row: CachedRow) => R | null
): Promise<R> {
  const slot = await slotFor(port, request, options, extra).catch(error => {
    warn('lookup', error);
    return null;
  });
  if (!slot) return live();
  try {
    const found = await readSlot(slot);
    const hit = found ? unpack(found.payload, found.row) : null;
    if (found && hit) {
      await recordHit(slot, found.row).catch(error => warn('accounting', error));
      return hit;
    }
  } catch (error) {
    warn('read', error);
  }
  const result = await live();
  const payload = complete(result.finishReason) ? pack(result) : undefined;
  if (payload !== undefined)
    await writeSlot(slot, payload, result, options.ttlMs ?? RESULT_CACHE_TTL_MS).catch(error =>
      warn('write', error)
    );
  return result;
}

/** `port.generate` through the result cache. A repeat with unchanged input costs zero tokens. */
export function cachedGenerate(
  port: LanguageModelPort,
  request: AiGenerateRequest,
  options: ResultCacheOptions = {}
): Promise<AiGenerateResult> {
  return cached<AiGenerateResult>(
    port,
    request,
    options,
    '',
    () => port.generate(request),
    result => (result.text.trim() && result.toolCalls.length === 0 ? result.text : undefined),
    (payload, row) =>
      typeof payload === 'string' && payload
        ? { text: payload, toolCalls: [], finishReason: 'stop', ...cachedServed(row) }
        : null
  );
}

/** `port.generateStructured` through the result cache; a stored object is validated again before use. */
export function cachedGenerateStructured<T>(
  port: LanguageModelPort,
  request: AiStructuredRequest<T>,
  options: ResultCacheOptions = {}
): Promise<AiStructuredResult<T>> {
  return cached<AiStructuredResult<T>>(
    port,
    request,
    options,
    `schema:${request.schemaName}`,
    () => port.generateStructured(request),
    result => result.object,
    (payload, row) => {
      const checked = request.schema.safeParse(payload);
      return checked.success
        ? { object: checked.data, finishReason: 'stop', ...cachedServed(row) }
        : null;
    }
  );
}

/** Retention: expired answers go in bounded batches. Returns the number removed. */
export async function purgeExpiredAiResults(
  tx: Pick<typeof prisma, '$executeRaw'>,
  options: { now?: Date; limit: number }
): Promise<number> {
  return tx.$executeRaw`
    DELETE FROM "AiResultCache" WHERE id IN (
      SELECT id FROM "AiResultCache" WHERE "expiresAt" < ${options.now ?? new Date()}
      ORDER BY "expiresAt" LIMIT ${options.limit})`;
}
