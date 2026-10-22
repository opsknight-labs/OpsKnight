import 'server-only';
import { equalityFilter } from '@/lib/scim/protocol/filters';

import { authenticate, createCredential, scopes } from '@/lib/scim/security/credentials';
import { getControlActor, lockControlActor } from '@/lib/auth-control/actor';
import { runSerializableTransaction } from '@/lib/db-utils';

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA =
  'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';
export const SCIM_RESOURCE_TYPE_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:ResourceType';
export const SCIM_SCHEMA_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Schema';
export const SCIM_LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_CONFIG_KEY = 'scim_configuration';

export type ScimConfigRecord = {
  enabled: boolean;
  secretTokenHash?: string;
  encryptedSecretToken?: string;
  tokenHint?: string;
  createdAt?: string;
  updatedAt?: string;
};
export async function isScimRequestAuthorized(authorization: string | null): Promise<boolean> {
  try {
    return Boolean(await authenticate(authorization));
  } catch {
    return false;
  }
}
export async function getScimConfig() {
  const { default: prisma } = await import('@/lib/prisma');
  const connector = await prisma.scimConnector.findUnique({ where: { id: 'legacy' } });
  const credential = await prisma.scimCredential.findFirst({
    where: {
      connector: { enabled: true, credentialAuthority: 'REGISTRY' },
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (credential || connector?.credentialAuthority === 'REGISTRY')
    return {
      enabled: Boolean(credential),
      hasSecretToken: Boolean(credential),
      tokenHint: credential?.tokenHint ?? null,
      source: 'DATABASE' as const,
      createdAt: credential?.createdAt.toISOString() ?? null,
      updatedAt: credential?.createdAt.toISOString() ?? null,
    };
  const record = await prisma.systemConfig.findUnique({ where: { key: SCIM_CONFIG_KEY } });
  const config = record?.value as ScimConfigRecord | null;
  const env = !record && (process.env.SCIM_BEARER_TOKEN?.trim().length ?? 0) >= 32;
  return {
    enabled: connector?.enabled === true && (config?.enabled === true || Boolean(env)),
    hasSecretToken: Boolean(config?.secretTokenHash || env),
    tokenHint: config?.tokenHint ?? null,
    source: record ? ('DATABASE' as const) : env ? ('ENV' as const) : ('NONE' as const),
    createdAt: config?.createdAt ?? null,
    updatedAt: config?.updatedAt ?? null,
  };
}
export async function generateAndSaveScimToken(_actorId?: string) {
  return createCredential({
    connectorId: 'legacy',
    name: 'SCIM provisioning',
    scopes: [...scopes],
    lifetimeDays: 90,
    overlapMinutes: 60,
  });
}
export async function revokeScimToken(_actorId?: string) {
  const actor = await getControlActor(true);
  if (actor.kind !== 'admin') throw new Error('Administrator sign-in required.');
  await runSerializableTransaction(async tx => {
    await lockControlActor(tx, actor);
    await tx.scimConnector.update({
      where: { id: 'legacy' },
      data: { enabled: false, credentialAuthority: 'REGISTRY' },
    });
    await tx.systemConfig.upsert({
      where: { key: SCIM_CONFIG_KEY },
      create: {
        key: SCIM_CONFIG_KEY,
        value: { enabled: false, migratedToRegistry: true },
        updatedBy: actor.id,
      },
      update: { value: { enabled: false, migratedToRegistry: true }, updatedBy: actor.id },
    });
    await tx.scimCredential.updateMany({
      where: { connectorId: 'legacy', revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.scimEvent.create({
      data: {
        connectorId: 'legacy',
        action: 'connector.revoked',
        requestId: crypto.randomUUID(),
        details: { actorId: actor.id },
      },
    });
  });
}
export async function revealScimToken(): Promise<string | null> {
  // New credentials are one-time secrets. Legacy secrets must be rotated to migrate.
  await getControlActor(true);
  return null;
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
  department?: string | null;
  scimGivenName?: string | null;
  scimFamilyName?: string | null;
  jobTitle?: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeScimUser(user: ScimUserShape, baseUrl = '') {
  return {
    schemas: [SCIM_USER_SCHEMA, 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'],
    title: user.jobTitle ?? undefined,
    'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
      department: user.department ?? undefined,
    },
    id: user.id,
    externalId: user.scimExternalId ?? undefined,
    userName: user.email,
    displayName: user.name,
    name: {
      formatted: user.name,
      givenName: user.scimGivenName ?? undefined,
      familyName: user.scimFamilyName ?? undefined,
    },
    emails: [{ value: user.email, primary: true, type: 'work' }],
    ...(user.avatarUrl && /^https?:\/\//i.test(user.avatarUrl)
      ? { photos: [{ value: user.avatarUrl, primary: true, type: 'photo' }] }
      : {}),
    active: user.status !== 'DISABLED',
    meta: {
      resourceType: 'User',
      location: baseUrl ? `${baseUrl}/api/scim/v2/Users/${user.id}` : undefined,
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
    },
  };
}

export function parseScimFilter(
  filter: string | null
): { scimExternalId: string } | { email: string } | null {
  const parsed = equalityFilter(filter, ['externalid', 'username']);
  if (!parsed) return null;
  return parsed.attribute === 'externalid'
    ? { scimExternalId: parsed.value }
    : { email: parsed.value.toLowerCase() };
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
  const parsed = equalityFilter(filter, ['displayname', 'externalid', 'id']);
  if (!parsed) return null;
  if (parsed.attribute === 'displayname') return { name: parsed.value };
  if (parsed.attribute === 'externalid') return { scimExternalId: parsed.value };
  return { id: parsed.value };
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
  const string = (name: string, required = false) => ({
    name,
    type: 'string',
    multiValued: false,
    required,
    mutability: 'readWrite',
    returned: 'default',
    caseExact: false,
    uniqueness: 'none',
  });
  const complex = (
    name: string,
    multiValued: boolean,
    subAttributes: Array<ReturnType<typeof string> & { referenceTypes?: string[] }>
  ) => ({
    name,
    type: 'complex',
    multiValued,
    required: false,
    mutability: 'readWrite',
    returned: 'default',
    subAttributes,
  });
  const descriptors = [
    {
      id: SCIM_USER_SCHEMA,
      name: 'User',
      description:
        'OpsKnight directory-managed account. Configure an immutable externalId when creating users.',
      attributes: [
        { ...string('userName', true), uniqueness: 'server' },
        { ...string('externalId'), mutability: 'immutable', caseExact: true },
        string('displayName'),
        complex('name', false, [string('formatted'), string('givenName'), string('familyName')]),
        {
          name: 'active',
          type: 'boolean',
          multiValued: false,
          required: false,
          mutability: 'readWrite',
          returned: 'default',
        },
        complex('emails', true, [
          string('value', true),
          string('type'),
          { ...string('primary'), type: 'boolean' },
        ]),
        complex('photos', true, [
          string('value', true),
          string('type'),
          { ...string('primary'), type: 'boolean' },
        ]),
        string('title'),
      ],
    },
    {
      id: SCIM_GROUP_SCHEMA,
      name: 'Group',
      description:
        'Directory group. Operational team binding requires separate administrator approval.',
      attributes: [
        string('displayName', true),
        { ...string('externalId'), mutability: 'immutable', caseExact: true },
        complex('members', true, [
          { ...string('value', true), mutability: 'immutable' },
          {
            ...string('$ref'),
            type: 'reference',
            mutability: 'readOnly',
            referenceTypes: ['User'],
          },
          { ...string('display'), mutability: 'readOnly' },
        ]),
      ],
    },
    {
      id: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
      name: 'EnterpriseUser',
      description: 'Supported enterprise profile attributes',
      attributes: [string('department')],
    },
  ];
  return descriptors.map(schema => ({
    schemas: [SCIM_SCHEMA_SCHEMA],
    ...schema,
    meta: {
      resourceType: 'Schema',
      location: baseUrl
        ? `${baseUrl}/api/scim/v2/Schemas/${encodeURIComponent(schema.id)}`
        : undefined,
    },
  }));
}
