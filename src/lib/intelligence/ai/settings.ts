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
  SQUIRE_AVATARS,
  type SquireAvatar,
  type SquireLauncherStyle,
  aiProviderInputSchema,
  aiSettingsInputSchema,
  type AiProviderInput,
} from './contract';
import type { AiDataClass } from './port';
import { assertNotMetadataEndpoint } from './egress';

type Client = Prisma.TransactionClient | typeof prisma;

export const MAX_AI_PROVIDERS = 20;

export interface AiSettingsView {
  enabled: boolean;
  squireEnabled: boolean;
  squireName: string;
  squireAvatar: SquireAvatar;
  squireLauncher: SquireLauncherStyle;
  squireAnimations: boolean;
  allowedDataRegions: string[];
  embeddingsEnabled: boolean;
  squireHistoryEnabled: boolean;
  squireHistoryRetentionDays: number;
  allowExternalFallback: boolean;
  requestsPerMinutePerUser: number;
  dailyTokenBudget: number;
  userDailyTokenBudget: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  /** 0 means no row has been saved yet and defaults apply. */
  revision: number;
}

const SETTINGS_SELECT = {
  enabled: true,
  squireEnabled: true,
  squireName: true,
  squireAvatar: true,
  squireLauncher: true,
  squireAnimations: true,
  allowedDataRegions: true,
  embeddingsEnabled: true,
  squireHistoryEnabled: true,
  squireHistoryRetentionDays: true,
  allowExternalFallback: true,
  requestsPerMinutePerUser: true,
  dailyTokenBudget: true,
  userDailyTokenBudget: true,
  maxOutputTokens: true,
  requestTimeoutMs: true,
  revision: true,
} as const;

type SettingsRow = Prisma.AiSettingsGetPayload<{ select: typeof SETTINGS_SELECT }>;

/** The columns are CHECK-constrained; anything unexpected still renders as the safe default. */
function toSettingsView(row: SettingsRow): AiSettingsView {
  return {
    ...row,
    squireAvatar: (SQUIRE_AVATARS as readonly string[]).includes(row.squireAvatar)
      ? (row.squireAvatar as SquireAvatar)
      : 'ICON',
    squireLauncher: row.squireLauncher === 'SEARCH_ONLY' ? 'SEARCH_ONLY' : 'FLOATING',
  };
}

/** Reads never write: with no saved row, AI is off and everything uses the safe defaults. */
export async function getAiSettings(client: Client = prisma): Promise<AiSettingsView> {
  const row = await client.aiSettings.findUnique({
    where: { id: 'default' },
    select: SETTINGS_SELECT,
  });
  return row
    ? toSettingsView(row)
    : { ...AI_SETTINGS_DEFAULTS, allowedDataRegions: [], revision: 0 };
}

const auditSource = (actor: IntelligenceActor) => ({
  source: actor.source,
  details: actor.source === 'API' ? { apiClientId: actor.apiClientId } : undefined,
});

/** Caller must authorize INTELLIGENCE_MANAGE. Revision-locked; the audit entry commits atomically. */
export async function updateAiSettings(
  input: unknown,
  actor: IntelligenceActor
): Promise<AiSettingsView> {
  const { expectedRevision, ...values } = parseOrThrow(aiSettingsInputSchema, input);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('ai-settings', 0))`;
    const previous = await getAiSettings(tx);
    if (previous.revision !== expectedRevision) throw new AppError({ code: 'PRECONDITION_FAILED' });
    const next = toSettingsView(
      await tx.aiSettings.upsert({
        where: { id: 'default' },
        create: { ...values, revision: 1, updatedBy: actor.actorId },
        update: { ...values, revision: { increment: 1 }, updatedBy: actor.actorId },
        select: SETTINGS_SELECT,
      })
    );
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

export interface AiProviderOptions {
  azureResourceName?: string;
  azureApiVersion?: string;
  awsRegion?: string;
  gcpProject?: string;
  gcpLocation?: string;
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
  dataRegion: string | null;
  embeddingModel: string | null;
  options: AiProviderOptions;
  /** Whether a credential is stored. The credential itself never leaves the server. */
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
  dataRegion: true,
  embeddingModel: true,
  options: true,
  apiKeyEncrypted: true,
} as const;

const OPTION_KEYS: ReadonlySet<string> = new Set([
  'azureResourceName',
  'azureApiVersion',
  'awsRegion',
  'gcpProject',
  'gcpLocation',
]);

/** Only known string options survive, so a hand-edited row can never inject anything unexpected. */
export function readProviderOptions(value: unknown): AiProviderOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, raw]) =>
        OPTION_KEYS.has(key) && typeof raw === 'string' && raw.length > 0 && raw.length <= 128
    )
  ) as AiProviderOptions;
}

function toView(
  row: Prisma.AiProviderGetPayload<{ select: typeof PROVIDER_SELECT }>
): AiProviderView {
  const { apiKeyEncrypted, options, ...rest } = row;
  return { ...rest, options: readProviderOptions(options), hasApiKey: Boolean(apiKeyEncrypted) };
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
export async function validateProviderEndpoint(
  baseUrl: string,
  allowPrivateNetwork: boolean
): Promise<string> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw invalid('baseUrl', 'Enter a valid URL');
  }
  if (url.username || url.password)
    throw invalid('baseUrl', 'URLs containing credentials are not allowed');
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw invalid('baseUrl', 'Use an http(s) URL');
  try {
    await assertNotMetadataEndpoint(url);
  } catch {
    throw invalid('baseUrl', 'Link-local and cloud metadata addresses are never allowed');
  }
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

/** A Vertex AI service-account key, reduced to the three fields the client needs. */
export function parseServiceAccount(json: string): {
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw invalid(
      'serviceAccountJson',
      'Paste the service account key JSON downloaded from Google Cloud'
    );
  }
  const record = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const clientEmail = record.client_email;
  const privateKey = record.private_key;
  const privateKeyId = record.private_key_id;
  if (
    record.type !== 'service_account' ||
    typeof clientEmail !== 'string' ||
    !/^[^@\s]+@[a-z0-9.-]+\.iam\.gserviceaccount\.com$/i.test(clientEmail) ||
    typeof privateKey !== 'string' ||
    !privateKey.includes('PRIVATE KEY')
  ) {
    throw invalid('serviceAccountJson', 'This is not a Google Cloud service account key');
  }
  return { clientEmail, privateKey, ...(typeof privateKeyId === 'string' ? { privateKeyId } : {}) };
}

/**
 * The secret to store for a provider, or undefined to keep the existing one. API-key providers store the key;
 * Bedrock stores its access key pair and Vertex the essential fields of its service account, each as JSON.
 */
async function secretFor(parsed: AiProviderInput): Promise<string | undefined> {
  switch (parsed.kind) {
    case 'BEDROCK':
      if (parsed.awsAccessKeyId && parsed.awsSecretAccessKey) {
        return encrypt(
          JSON.stringify({
            accessKeyId: parsed.awsAccessKeyId,
            secretAccessKey: parsed.awsSecretAccessKey,
          })
        );
      }
      return parsed.apiKey ? encrypt(JSON.stringify({ apiKey: parsed.apiKey })) : undefined;
    case 'VERTEX':
      return parsed.serviceAccountJson
        ? encrypt(JSON.stringify(parseServiceAccount(parsed.serviceAccountJson)))
        : undefined;
    default:
      return parsed.apiKey ? encrypt(parsed.apiKey) : undefined;
  }
}

function optionsFor(parsed: AiProviderInput): AiProviderOptions {
  switch (parsed.kind) {
    case 'AZURE_OPENAI':
      return {
        ...(parsed.azureResourceName
          ? { azureResourceName: parsed.azureResourceName.toLowerCase() }
          : {}),
        ...(parsed.azureApiVersion ? { azureApiVersion: parsed.azureApiVersion } : {}),
      };
    case 'BEDROCK':
      return parsed.awsRegion ? { awsRegion: parsed.awsRegion } : {};
    case 'VERTEX':
      return {
        ...(parsed.gcpProject ? { gcpProject: parsed.gcpProject } : {}),
        ...(parsed.gcpLocation ? { gcpLocation: parsed.gcpLocation } : {}),
      };
    default:
      return {};
  }
}

/** Caller must authorize INTELLIGENCE_MANAGE. */
export async function saveAiProvider(
  id: string | null,
  input: unknown,
  actor: IntelligenceActor
): Promise<AiProviderView> {
  const parsed = parseOrThrow(aiProviderInputSchema, input);
  const baseUrl = parsed.baseUrl
    ? await validateProviderEndpoint(parsed.baseUrl, parsed.allowPrivateNetwork)
    : null;
  const apiKeyEncrypted = await secretFor(parsed);
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
    dataRegion: parsed.dataRegion ?? null,
    embeddingModel: parsed.embeddingModel ?? null,
    options: { ...optionsFor(parsed) },
  };
  // Providers that authenticate with more than a key must have their credentials when first created.
  if (id === null && !apiKeyEncrypted && (parsed.kind === 'BEDROCK' || parsed.kind === 'VERTEX')) {
    throw invalid(
      parsed.kind === 'BEDROCK' ? 'awsAccessKeyId' : 'serviceAccountJson',
      parsed.kind === 'BEDROCK'
        ? 'Enter AWS credentials or a Bedrock API key'
        : 'Paste a service account key'
    );
  }

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
      row = await tx.aiProvider.create({
        data: { ...data, apiKeyEncrypted: apiKeyEncrypted ?? null },
        select: PROVIDER_SELECT,
      });
    } else {
      const existing = await tx.aiProvider.findUnique({ where: { id }, select: { kind: true } });
      if (!existing) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
      // A stored credential has the shape of its kind, so changing kind requires a new one.
      if (existing.kind !== data.kind && !apiKeyEncrypted) {
        throw invalid('kind', 'Enter new credentials when changing the provider type');
      }
      row = await tx.aiProvider.update({
        where: { id },
        data: { ...data, ...(apiKeyEncrypted !== undefined ? { apiKeyEncrypted } : {}) },
        select: PROVIDER_SELECT,
      });
    }
    const view = toView(row);
    await logAudit(
      {
        action:
          id === null ? 'intelligence.ai.provider.created' : 'intelligence.ai.provider.updated',
        entityType: 'SYSTEM_CONFIG',
        entityId: row.id,
        actorId: actor.actorId,
        ...auditSource(actor),
        // Credentials are never audited; only whether they were replaced.
        newValue: {
          ...view,
          options: { ...view.options },
          keyReplaced: apiKeyEncrypted !== undefined,
        },
      },
      tx
    );
    return view;
  });
}

export async function deleteAiProvider(
  id: string,
  actor: IntelligenceActor
): Promise<'deleted' | 'not_found'> {
  return prisma.$transaction(async tx => {
    const row = await tx.aiProvider.findUnique({ where: { id }, select: PROVIDER_SELECT });
    if (!row) return 'not_found';
    await tx.aiProvider.delete({ where: { id } });
    const view = toView(row);
    await logAudit(
      {
        action: 'intelligence.ai.provider.deleted',
        entityType: 'SYSTEM_CONFIG',
        entityId: id,
        actorId: actor.actorId,
        ...auditSource(actor),
        oldValue: { ...view, options: { ...view.options } },
      },
      tx
    );
    return 'deleted';
  });
}

export type GatewayCredentials =
  | { type: 'none' }
  | { type: 'apiKey'; apiKey: string }
  | { type: 'aws'; accessKeyId: string; secretAccessKey: string }
  | { type: 'google'; clientEmail: string; privateKey: string; privateKeyId?: string };

function readCredentials(kind: AiProviderView['kind'], secret: string | null): GatewayCredentials {
  if (!secret) return { type: 'none' };
  if (kind !== 'BEDROCK' && kind !== 'VERTEX') return { type: 'apiKey', apiKey: secret };
  try {
    const value = JSON.parse(secret) as Record<string, unknown>;
    if (
      kind === 'BEDROCK' &&
      typeof value.accessKeyId === 'string' &&
      typeof value.secretAccessKey === 'string'
    ) {
      return {
        type: 'aws',
        accessKeyId: value.accessKeyId,
        secretAccessKey: value.secretAccessKey,
      };
    }
    if (kind === 'BEDROCK' && typeof value.apiKey === 'string')
      return { type: 'apiKey', apiKey: value.apiKey };
    if (
      kind === 'VERTEX' &&
      typeof value.clientEmail === 'string' &&
      typeof value.privateKey === 'string'
    ) {
      return {
        type: 'google',
        clientEmail: value.clientEmail,
        privateKey: value.privateKey,
        ...(typeof value.privateKeyId === 'string' ? { privateKeyId: value.privateKeyId } : {}),
      };
    }
  } catch {
    // An unreadable credential is treated as missing; the provider then fails closed.
  }
  return { type: 'none' };
}

/**
 * Server-only: loads providers with their decrypted credentials for the gateway. Only enabled ones by
 * default; `includeDisabled` lets an administrator test a provider before switching it on.
 */
export async function loadProvidersForGateway(
  client: Client = prisma,
  options: { includeDisabled?: boolean } = {}
) {
  const rows = await client.aiProvider.findMany({
    where: options.includeDisabled ? {} : { enabled: true },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    take: MAX_AI_PROVIDERS,
    select: PROVIDER_SELECT,
  });
  return Promise.all(
    rows.map(async row => {
      const secret = row.apiKeyEncrypted
        ? await decrypt(row.apiKeyEncrypted).catch(() => null)
        : null;
      const credentials = readCredentials(row.kind, secret);
      return {
        ...toView(row),
        credentials,
        apiKey: credentials.type === 'apiKey' ? credentials.apiKey : null,
      };
    })
  );
}

export type GatewayProvider = Awaited<ReturnType<typeof loadProvidersForGateway>>[number];

/** What the browser may know: whether the assistant exists and what it is called. */
export async function getAiPublicStatus(client: Client = prisma) {
  const settings = await getAiSettings(client);
  return {
    squireEnabled: settings.squireEnabled,
    squireName: settings.squireName,
    squireAvatar: settings.squireAvatar,
    squireLauncher: settings.squireLauncher,
    squireAnimations: settings.squireAnimations,
    aiEnabled: settings.enabled,
    historyEnabled: settings.enabled && settings.squireHistoryEnabled,
    historyRetentionDays: settings.squireHistoryRetentionDays,
  };
}
