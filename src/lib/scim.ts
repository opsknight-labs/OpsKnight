import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { decrypt, encrypt } from '@/lib/encryption';
import { logAudit } from '@/lib/audit';

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_CONFIG_KEY = 'scim_configuration';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export type ScimConfigRecord = {
  enabled: boolean;
  secretTokenHash?: string;
  encryptedSecretToken?: string;
  tokenHint?: string;
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
};

export async function isScimRequestAuthorized(authorization: string | null): Promise<boolean> {
  if (!authorization?.startsWith('Bearer ')) return false;
  const supplied = authorization.slice('Bearer '.length).trim();
  if (supplied.length === 0) return false;

  const suppliedDigest = digest(supplied);

  // 1. Check UI/Database configuration first
  try {
    const { default: prisma } = await import('@/lib/prisma');
    const record = await prisma.systemConfig.findUnique({
      where: { key: SCIM_CONFIG_KEY },
    });
    if (record?.value && typeof record.value === 'object') {
      const config = record.value as ScimConfigRecord;
      if (config.enabled === false) return false;
      if (config.secretTokenHash) {
        const storedDigest = Buffer.from(config.secretTokenHash, 'hex');
        if (
          storedDigest.length === suppliedDigest.length &&
          timingSafeEqual(suppliedDigest, storedDigest)
        ) {
          return true;
        }
      }
    }
  } catch {
    // If DB is temporarily unavailable (e.g. during isolated unit tests), fall back to env var
  }

  // 2. Fallback to process.env.SCIM_BEARER_TOKEN (legacy / EC2 .env)
  const configured = process.env.SCIM_BEARER_TOKEN?.trim() ?? '';
  if (configured.length < 32) return false;
  return timingSafeEqual(suppliedDigest, digest(configured));
}

export async function getScimConfig(): Promise<{
  enabled: boolean;
  hasSecretToken: boolean;
  tokenHint: string | null;
  source: 'DATABASE' | 'ENV' | 'NONE';
  createdAt: string | null;
  updatedAt: string | null;
}> {
  try {
    const { default: prisma } = await import('@/lib/prisma');
    const record = await prisma.systemConfig.findUnique({
      where: { key: SCIM_CONFIG_KEY },
    });
    if (record?.value && typeof record.value === 'object') {
      const config = record.value as ScimConfigRecord;
      if (config.secretTokenHash) {
        return {
          enabled: config.enabled !== false,
          hasSecretToken: true,
          tokenHint: config.tokenHint ?? null,
          source: 'DATABASE',
          createdAt: config.createdAt ?? null,
          updatedAt: config.updatedAt ?? null,
        };
      }
    }
  } catch {
    // Fall back to env check
  }

  const envToken = process.env.SCIM_BEARER_TOKEN?.trim() ?? '';
  if (envToken.length >= 32) {
    return {
      enabled: true,
      hasSecretToken: true,
      tokenHint: envToken.slice(-4),
      source: 'ENV',
      createdAt: null,
      updatedAt: null,
    };
  }

  return {
    enabled: false,
    hasSecretToken: false,
    tokenHint: null,
    source: 'NONE',
    createdAt: null,
    updatedAt: null,
  };
}

export async function generateAndSaveScimToken(actorId?: string): Promise<{
  token: string;
  tokenHint: string;
}> {
  const token = randomBytes(32).toString('hex');
  const secretTokenHash = digest(token).toString('hex');
  const encryptedSecretToken = await encrypt(token);
  const tokenHint = token.slice(-4);
  const now = new Date().toISOString();

  const configValue: ScimConfigRecord = {
    enabled: true,
    secretTokenHash,
    encryptedSecretToken,
    tokenHint,
    createdAt: now,
    updatedAt: now,
  };

  const { default: prisma } = await import('@/lib/prisma');
  await prisma.systemConfig.upsert({
    where: { key: SCIM_CONFIG_KEY },
    create: {
      key: SCIM_CONFIG_KEY,
      value: configValue,
      updatedBy: actorId ?? null,
    },
    update: {
      value: configValue,
      updatedBy: actorId ?? null,
    },
  });

  await logAudit({
    action: 'scim.token.generated',
    entityType: 'SYSTEM_CONFIG',
    entityId: SCIM_CONFIG_KEY,
    actorId: actorId ?? null,
    source: 'UI',
    details: { tokenHint, source: 'UI' },
  });

  return { token, tokenHint };
}

export async function revokeScimToken(actorId?: string): Promise<void> {
  const { default: prisma } = await import('@/lib/prisma');
  const record = await prisma.systemConfig.findUnique({
    where: { key: SCIM_CONFIG_KEY },
  });
  if (record) {
    await prisma.systemConfig.update({
      where: { key: SCIM_CONFIG_KEY },
      data: {
        value: {
          enabled: false,
          updatedAt: new Date().toISOString(),
        },
        updatedBy: actorId ?? null,
      },
    });
  }

  await logAudit({
    action: 'scim.token.revoked',
    entityType: 'SYSTEM_CONFIG',
    entityId: SCIM_CONFIG_KEY,
    actorId: actorId ?? null,
    source: 'UI',
    details: { source: 'UI' },
  });
}

export async function revealScimToken(): Promise<string | null> {
  try {
    const { default: prisma } = await import('@/lib/prisma');
    const record = await prisma.systemConfig.findUnique({
      where: { key: SCIM_CONFIG_KEY },
    });
    if (record?.value && typeof record.value === 'object') {
      const config = record.value as ScimConfigRecord;
      if (config.encryptedSecretToken) {
        return await decrypt(config.encryptedSecretToken);
      }
    }
  } catch {
    // If not found in DB
  }

  const envToken = process.env.SCIM_BEARER_TOKEN?.trim() ?? '';
  return envToken.length >= 32 ? envToken : null;
}

export function scimError(status: number, detail: string) {
  return Response.json(
    { schemas: [SCIM_ERROR_SCHEMA], status: String(status), detail },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export type ScimUserShape = {
  id: string;
  scimExternalId: string | null;
  email: string;
  name: string;
  avatarUrl?: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeScimUser(user: ScimUserShape) {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: user.id,
    externalId: user.scimExternalId ?? undefined,
    userName: user.email,
    displayName: user.name,
    name: { formatted: user.name },
    emails: [{ value: user.email, primary: true, type: 'work' }],
    ...(user.avatarUrl
      ? { photos: [{ value: user.avatarUrl, primary: true, type: 'photo' }] }
      : {}),
    active: user.status !== 'DISABLED',
    meta: {
      resourceType: 'User',
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
    },
  };
}

export function parseScimFilter(
  filter: string | null
): { scimExternalId: string } | { email: string } | null {
  if (!filter) return null;
  const match = /^(externalId|userName)\s+eq\s+"([^"\r\n]{1,320})"$/i.exec(filter.trim());
  if (!match) throw new Error('Unsupported SCIM filter. Use externalId eq or userName eq.');
  return match[1].toLowerCase() === 'externalid'
    ? { scimExternalId: match[2] }
    : { email: match[2].trim().toLowerCase() };
}
