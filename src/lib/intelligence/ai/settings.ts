import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { decrypt, encrypt } from '@/lib/encryption';
import { assertSafeOutboundUrl } from '@/lib/network-security';
import { parseOrThrow, type IntelligenceActor } from '../settings/service';
import {
  AI_SETTINGS_DEFAULTS,
  aiProviderInputSchema,
  aiSettingsInputSchema,
  type AiProviderInput,
} from './contract';
import type { AiDataClass } from './port';

type Client = Prisma.TransactionClient | typeof prisma;

export const MAX_AI_PROVIDERS = 20;

export interface AiSettingsView {
  enabled: boolean;
  squireEnabled: boolean;
  squireName: string;
  allowExternalFallback: boolean;
  requestsPerMinutePerUser: number;
  dailyTokenBudget: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  /** 0 means no row has been saved yet and defaults apply. */
  revision: number;
}

const SETTINGS_SELECT = {
  enabled: true,
  squireEnabled: true,
  squireName: true,
  allowExternalFallback: true,
  requestsPerMinutePerUser: true,
  dailyTokenBudget: true,
  maxOutputTokens: true,
  requestTimeoutMs: true,
  revision: true,
} as const;

/** Reads never write: with no saved row, AI is off and everything uses the safe defaults. */
export async function getAiSettings(client: Client = prisma): Promise<AiSettingsView> {
  const row = await client.aiSettings.findUnique({ where: { id: 'default' }, select: SETTINGS_SELECT });
  return row ?? { ...AI_SETTINGS_DEFAULTS, revision: 0 };
}

const auditSource = (actor: IntelligenceActor) => ({
  source: actor.source,
  details: actor.source === 'API' ? { apiClientId: actor.apiClientId } : undefined,
});

/** Caller must authorize INTELLIGENCE_MANAGE. Revision-locked; the audit entry commits atomically. */
export async function updateAiSettings(input: unknown, actor: IntelligenceActor): Promise<AiSettingsView> {
  const { expectedRevision, ...values } = parseOrThrow(aiSettingsInputSchema, input);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('ai-settings', 0))`;
    const previous = await getAiSettings(tx);
    if (previous.revision !== expectedRevision) throw new AppError({ code: 'PRECONDITION_FAILED' });
    const next = await tx.aiSettings.upsert({
      where: { id: 'default' },
      create: { ...values, revision: 1, updatedBy: actor.actorId },
      update: { ...values, revision: { increment: 1 }, updatedBy: actor.actorId },
      select: SETTINGS_SELECT,
    });
    await logAudit(
      {
        action: 'intelligence.ai.settings.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'ai',
        actorId: actor.actorId,
        ...auditSource(actor),
        oldValue: { ...previous },
        newValue: { ...next },
      },
      tx
    );
    return next;
  });
}

export interface AiProviderView {
  id: string;
  name: string;
  kind: AiProviderInput['kind'];
  model: string;
  baseUrl: string | null;
  enabled: boolean;
  isExternal: boolean;
  maxDataClass: AiDataClass;
  allowPrivateNetwork: boolean;
  priority: number;
  /** Whether a key is stored. The key itself never leaves the server. */
  hasApiKey: boolean;
}

const PROVIDER_SELECT = {
  id: true,
  name: true,
  kind: true,
  model: true,
  baseUrl: true,
  enabled: true,
  isExternal: true,
  maxDataClass: true,
  allowPrivateNetwork: true,
  priority: true,
  apiKeyEncrypted: true,
} as const;

function toView(row: Prisma.AiProviderGetPayload<{ select: typeof PROVIDER_SELECT }>): AiProviderView {
  const { apiKeyEncrypted, ...rest } = row;
  return { ...rest, hasApiKey: Boolean(apiKeyEncrypted) };
}

export async function listAiProviders(client: Client = prisma): Promise<AiProviderView[]> {
  const rows = await client.aiProvider.findMany({
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    take: MAX_AI_PROVIDERS,
    select: PROVIDER_SELECT,
  });
  return rows.map(toView);
}

function invalid(field: string, message: string): AppError {
  return new AppError({ code: 'VALIDATION_FAILED', fields: [{ field, code: 'custom', message }] });
}

/**
 * Validates an endpoint. Without explicit private-network consent it must be HTTPS and resolve only
 * to public addresses. With consent it may be a private address, but the exact origin is what the
 * administrator approved and what every later request is pinned to.
 */
export async function validateProviderEndpoint(baseUrl: string, allowPrivateNetwork: boolean): Promise<string> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw invalid('baseUrl', 'Enter a valid URL');
  }
  if (url.username || url.password) throw invalid('baseUrl', 'URLs containing credentials are not allowed');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid('baseUrl', 'Use an http(s) URL');
  if (!allowPrivateNetwork) {
    try {
      await assertSafeOutboundUrl(url.toString(), { requireHttps: true });
    } catch (error) {
      throw invalid(
        'baseUrl',
        error instanceof Error && error.message === 'HTTPS is required'
          ? 'HTTPS is required'
          : 'This address is not reachable from the public internet. Enable private-network access to allow it.'
      );
    }
  }
  return url.toString().replace(/\/$/, '');
}

/** Caller must authorize INTELLIGENCE_MANAGE. */
export async function saveAiProvider(
  id: string | null,
  input: unknown,
  actor: IntelligenceActor
): Promise<AiProviderView> {
  const parsed = parseOrThrow(aiProviderInputSchema, input);
  const baseUrl = parsed.baseUrl ? await validateProviderEndpoint(parsed.baseUrl, parsed.allowPrivateNetwork) : null;
  const apiKeyEncrypted = parsed.apiKey ? await encrypt(parsed.apiKey) : undefined;
  const data = {
    name: parsed.name,
    kind: parsed.kind,
    model: parsed.model,
    baseUrl,
    enabled: parsed.enabled,
    isExternal: parsed.isExternal,
    maxDataClass: parsed.maxDataClass,
    allowPrivateNetwork: parsed.allowPrivateNetwork,
    priority: parsed.priority,
  };

  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('ai-providers', 0))`;
    if (id === null && (await tx.aiProvider.count()) >= MAX_AI_PROVIDERS) {
      throw invalid('name', 'Provider limit reached');
    }
    const duplicate = await tx.aiProvider.findFirst({
      where: { name: data.name, ...(id ? { id: { not: id } } : {}) },
      select: { id: true },
    });
    if (duplicate) throw invalid('name', 'A provider with this name already exists');
    let row;
    if (id === null) {
      row = await tx.aiProvider.create({ data: { ...data, apiKeyEncrypted: apiKeyEncrypted ?? null }, select: PROVIDER_SELECT });
    } else {
      const existing = await tx.aiProvider.findUnique({ where: { id }, select: { id: true } });
      if (!existing) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
      row = await tx.aiProvider.update({
        where: { id },
        data: { ...data, ...(apiKeyEncrypted !== undefined ? { apiKeyEncrypted } : {}) },
        select: PROVIDER_SELECT,
      });
    }
    const view = toView(row);
    await logAudit(
      {
        action: id === null ? 'intelligence.ai.provider.created' : 'intelligence.ai.provider.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: row.id,
        actorId: actor.actorId,
        ...auditSource(actor),
        // The key is never audited; only whether one is stored.
        newValue: { ...view, keyReplaced: apiKeyEncrypted !== undefined },
      },
      tx
    );
    return view;
  });
}

export async function deleteAiProvider(id: string, actor: IntelligenceActor): Promise<'deleted' | 'not_found'> {
  return prisma.$transaction(async tx => {
    const row = await tx.aiProvider.findUnique({ where: { id }, select: PROVIDER_SELECT });
    if (!row) return 'not_found';
    await tx.aiProvider.delete({ where: { id } });
    await logAudit(
      {
        action: 'intelligence.ai.provider.deleted',
        entityType: 'SYSTEM_CONFIG',
        entityId: id,
        actorId: actor.actorId,
        ...auditSource(actor),
        oldValue: { ...toView(row) },
      },
      tx
    );
    return 'deleted';
  });
}

/** Server-only: loads enabled providers with their decrypted keys for the gateway. */
export async function loadProvidersForGateway(client: Client = prisma) {
  const rows = await client.aiProvider.findMany({
    where: { enabled: true },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    take: MAX_AI_PROVIDERS,
    select: PROVIDER_SELECT,
  });
  return Promise.all(
    rows.map(async row => ({
      ...toView(row),
      apiKey: row.apiKeyEncrypted ? await decrypt(row.apiKeyEncrypted).catch(() => null) : null,
    }))
  );
}

export type GatewayProvider = Awaited<ReturnType<typeof loadProvidersForGateway>>[number];

/** What the browser may know: whether the assistant exists and what it is called. */
export async function getAiPublicStatus(client: Client = prisma) {
  const settings = await getAiSettings(client);
  return { squireEnabled: settings.squireEnabled, squireName: settings.squireName, aiEnabled: settings.enabled };
}
