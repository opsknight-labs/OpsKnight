import 'server-only';

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { decrypt, encrypt } from '@/lib/encryption';
import { logAudit } from '@/lib/audit';

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA =
  'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';
export const SCIM_RESOURCE_TYPE_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ResourceType';
export const SCIM_SCHEMA_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Schema';
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

export function scimError(status: number, detail: string, scimType?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/scim+json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  if (status === 401) {
    headers['WWW-Authenticate'] = 'Bearer error="invalid_token"';
  }
  return Response.json(
    {
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(status),
      ...(scimType ? { scimType } : {}),
      detail,
    },
    { status, headers }
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
  const cleaned = filter
    .trim()
    .replace(/^\((.*)\)$/, '$1')
    .trim();
  const match = /^(externalId|userName)\s+eq\s+["']?([^"'\r\n]{1,320})["']?$/i.exec(cleaned);
  if (!match) throw new Error('Unsupported SCIM filter. Use externalId eq or userName eq.');
  return match[1].toLowerCase() === 'externalid'
    ? { scimExternalId: match[2].trim() }
    : { email: match[2].trim().toLowerCase() };
}

export type ScimGroupMember = {
  user: {
    id: string;
    name: string;
    email: string;
  };
};

export type ScimGroupShape = {
  id: string;
  name: string;
  scimExternalId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  members?: ScimGroupMember[];
};

export function serializeScimGroup(group: ScimGroupShape, baseUrl = '') {
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: group.id,
    externalId: group.scimExternalId ?? undefined,
    displayName: group.name,
    members: (group.members ?? []).map(m => ({
      value: m.user.id,
      $ref: baseUrl ? `${baseUrl}/api/scim/v2/Users/${m.user.id}` : undefined,
      display: m.user.name || m.user.email,
    })),
    meta: {
      resourceType: 'Group',
      created: group.createdAt.toISOString(),
      lastModified: group.updatedAt.toISOString(),
      location: baseUrl ? `${baseUrl}/api/scim/v2/Groups/${group.id}` : undefined,
    },
  };
}

export function parseScimGroupFilter(
  filter: string | null
): { name?: string; scimExternalId?: string; id?: string } | null {
  if (!filter) return null;
  const cleaned = filter
    .trim()
    .replace(/^\((.*)\)$/, '$1')
    .trim();
  const match = /^(displayName|externalId|id)\s+eq\s+["']?([^"'\r\n]{1,320})["']?$/i.exec(cleaned);
  if (!match) {
    throw new Error('Unsupported SCIM group filter. Use displayName eq, externalId eq, or id eq.');
  }
  const field = match[1].toLowerCase();
  if (field === 'displayname') {
    return { name: match[2].trim() };
  }
  if (field === 'externalid') {
    return { scimExternalId: match[2].trim() };
  }
  return { id: match[2].trim() };
}

export function getServiceProviderConfig(baseUrl = '') {
  return {
    schemas: [SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA],
    documentationUri: 'https://opsknight.com/docs/integrations/scim',
    patch: {
      supported: true,
    },
    bulk: {
      supported: false,
      maxOperations: 0,
      maxPayloadSize: 0,
    },
    filter: {
      supported: true,
      maxResults: 100,
    },
    changePassword: {
      supported: false,
    },
    sort: {
      supported: false,
    },
    etag: {
      supported: false,
    },
    authenticationSchemes: [
      {
        name: 'OAuth Bearer Token',
        description: 'Authentication scheme using the Authorization header with a Bearer token',
        specUri: 'https://datatracker.ietf.org/doc/html/rfc6750',
        documentationUri: 'https://opsknight.com/docs/integrations/scim',
        type: 'oauthbearertoken',
        primary: true,
      },
    ],
    meta: {
      resourceType: 'ServiceProviderConfig',
      created: '2026-01-01T00:00:00.000Z',
      lastModified: '2026-10-01T00:00:00.000Z',
      location: baseUrl ? `${baseUrl}/api/scim/v2/ServiceProviderConfig` : undefined,
    },
  };
}

export function getScimSchemas(baseUrl = '') {
  return [
    {
      schemas: [SCIM_SCHEMA_SCHEMA],
      id: SCIM_USER_SCHEMA,
      name: 'User',
      description: 'OpsKnight User Account Schema',
      attributes: [
        {
          name: 'userName',
          type: 'string',
          multiValued: false,
          description: 'Unique identifier for the User, typically user email address.',
          required: true,
          caseExact: false,
          mutability: 'readWrite',
          returned: 'default',
          uniqueness: 'server',
        },
        {
          name: 'displayName',
          type: 'string',
          multiValued: false,
          description: 'The name of the User, suitable for display to end-users.',
          required: false,
          caseExact: false,
          mutability: 'readWrite',
          returned: 'default',
          uniqueness: 'none',
        },
        {
          name: 'emails',
          type: 'complex',
          multiValued: true,
          description: 'Email addresses for the user.',
          required: false,
          subAttributes: [
            { name: 'value', type: 'string', multiValued: false, required: false },
            { name: 'type', type: 'string', multiValued: false, required: false },
            { name: 'primary', type: 'boolean', multiValued: false, required: false },
          ],
        },
        {
          name: 'photos',
          type: 'complex',
          multiValued: true,
          description: 'URLs of photos of the User.',
          required: false,
          subAttributes: [
            { name: 'value', type: 'reference', multiValued: false, required: false },
            { name: 'type', type: 'string', multiValued: false, required: false },
            { name: 'primary', type: 'boolean', multiValued: false, required: false },
          ],
        },
        {
          name: 'active',
          type: 'boolean',
          multiValued: false,
          description: 'A Boolean value indicating the User administrative status.',
          required: false,
          mutability: 'readWrite',
        },
        {
          name: 'externalId',
          type: 'string',
          multiValued: false,
          description:
            'A unique identifier for the resource as defined by the provisioning client.',
          required: false,
          mutability: 'readWrite',
        },
      ],
      meta: {
        resourceType: 'Schema',
        location: baseUrl
          ? `${baseUrl}/api/scim/v2/Schemas/${encodeURIComponent(SCIM_USER_SCHEMA)}`
          : undefined,
      },
    },
    {
      schemas: [SCIM_SCHEMA_SCHEMA],
      id: SCIM_GROUP_SCHEMA,
      name: 'Group',
      description: 'OpsKnight Group Schema',
      attributes: [
        {
          name: 'displayName',
          type: 'string',
          multiValued: false,
          description: 'A human-readable name for the Group.',
          required: true,
          caseExact: false,
          mutability: 'readWrite',
          returned: 'default',
          uniqueness: 'server',
        },
        {
          name: 'externalId',
          type: 'string',
          multiValued: false,
          description:
            'A unique identifier for the resource as defined by the provisioning client.',
          required: false,
          mutability: 'readWrite',
        },
        {
          name: 'members',
          type: 'complex',
          multiValued: true,
          description: 'A list of members of the Group.',
          required: false,
          mutability: 'readWrite',
          subAttributes: [
            {
              name: 'value',
              type: 'string',
              multiValued: false,
              description: 'Identifier of the member of this Group.',
              required: true,
              mutability: 'immutable',
            },
            {
              name: '$ref',
              type: 'reference',
              referenceTypes: ['User'],
              multiValued: false,
              description: 'The URI that corresponds to the member resource of this Group.',
              required: false,
              mutability: 'immutable',
            },
            {
              name: 'display',
              type: 'string',
              multiValued: false,
              description: 'A human-readable name for the member.',
              required: false,
              mutability: 'readOnly',
            },
          ],
        },
      ],
      meta: {
        resourceType: 'Schema',
        location: baseUrl
          ? `${baseUrl}/api/scim/v2/Schemas/${encodeURIComponent(SCIM_GROUP_SCHEMA)}`
          : undefined,
      },
    },
  ];
}
