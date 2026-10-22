import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/prisma', () => ({
  default: {
    scimCredential: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    scimConnector: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 'legacy', enabled: true, credentialAuthority: 'LEGACY' }),
    },
    systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock('@/lib/auth-control/actor', () => ({
  getControlActor: vi.fn(),
  lockControlActor: vi.fn(),
}));
import prisma from '@/lib/prisma';
import {
  getScimSchemas,
  getServiceProviderConfig,
  isScimRequestAuthorized,
  parseScimFilter,
  parseScimGroupFilter,
  serializeScimGroup,
  serializeScimUser,
} from '@/lib/scim';

beforeEach(() => {
  vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);
});

const originalToken = process.env.SCIM_BEARER_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.SCIM_BEARER_TOKEN;
  else process.env.SCIM_BEARER_TOKEN = originalToken;
});

describe('SCIM protocol helpers', () => {
  it('fails closed without a strong configured bearer token', async () => {
    delete process.env.SCIM_BEARER_TOKEN;
    expect(await isScimRequestAuthorized('Bearer anything')).toBe(false);
    process.env.SCIM_BEARER_TOKEN = 'short';
    expect(await isScimRequestAuthorized('Bearer short')).toBe(false);
  });

  it('bounds repeated unknown token misses before querying PostgreSQL again', async () => {
    const { authenticate } = await import('@/lib/scim/security/credentials');
    vi.mocked(prisma.scimConnector.findUnique).mockResolvedValueOnce(null);
    const before = vi.mocked(prisma.scimCredential.findUnique).mock.calls.length;
    const token = `Bearer repeated-unknown-token-${Date.now()}-certification`;
    expect(await authenticate(token)).toBeNull();
    expect(await authenticate(token)).toBeNull();
    expect(vi.mocked(prisma.scimCredential.findUnique).mock.calls.length - before).toBe(1);
  });
  it('revalidates active credentials while coalescing last-used writes', async () => {
    const { authenticate, hashToken } = await import('@/lib/scim/security/credentials');
    const token = 'active-credential-last-used-certification-only';
    vi.mocked(prisma.scimCredential.findUnique).mockResolvedValueOnce({
      id: 'key',
      connectorId: 'source',
      tokenHash: hashToken(token),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      lastUsedAt: new Date(),
      scopes: ['users:read'],
      connector: { enabled: true, credentialAuthority: 'REGISTRY' },
    } as never);
    const before = vi.mocked(prisma.scimCredential.updateMany).mock.calls.length;
    expect(await authenticate(`Bearer ${token}`)).toMatchObject({ connectorId: 'source' });
    expect(vi.mocked(prisma.scimCredential.updateMany).mock.calls.length).toBe(before);
  });
  it('compares a configured bearer token exactly', async () => {
    process.env.SCIM_BEARER_TOKEN = 'a-secure-scim-token-with-at-least-32-characters';
    expect(await isScimRequestAuthorized(`Bearer ${process.env.SCIM_BEARER_TOKEN}`)).toBe(true);
    expect(await isScimRequestAuthorized('Bearer wrong-token')).toBe(false);
  });

  it('never rescues an invalid database credential with an environment token', async () => {
    process.env.SCIM_BEARER_TOKEN = 'a-secure-scim-token-with-at-least-32-characters';
    vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue({
      value: { enabled: true, secretTokenHash: '0'.repeat(64) },
    } as never);
    expect(await isScimRequestAuthorized(`Bearer ${process.env.SCIM_BEARER_TOKEN}`)).toBe(false);
    vi.mocked(prisma.systemConfig.findUnique).mockRejectedValueOnce(
      new Error('database unavailable')
    );
    expect(await isScimRequestAuthorized(`Bearer ${process.env.SCIM_BEARER_TOKEN}`)).toBe(false);
  });

  it('accepts only bounded externalId and userName equality filters', () => {
    expect(parseScimFilter('externalId eq "directory-123"')).toEqual({
      scimExternalId: 'directory-123',
    });
    expect(parseScimFilter('userName eq "USER@Example.com"')).toEqual({
      email: 'user@example.com',
    });
    expect(() => parseScimFilter('userName co "example"')).toThrow(/unsupported/i);
  });

  it('serializes an OpsKnight user as a SCIM user resource with avatar photos', () => {
    const timestamp = new Date('2026-09-11T00:00:00.000Z');
    expect(
      serializeScimUser({
        id: 'u1',
        scimExternalId: 'directory-1',
        email: 'user@example.com',
        name: 'User',
        avatarUrl: 'https://example.com/avatar.png',
        status: 'DISABLED',
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    ).toMatchObject({
      id: 'u1',
      externalId: 'directory-1',
      userName: 'user@example.com',
      photos: [{ value: 'https://example.com/avatar.png', type: 'photo', primary: true }],
      active: false,
    });
  });

  it('accepts bounded SCIM group filters and rejects unsupported formats', () => {
    expect(parseScimGroupFilter('displayName eq "Platform Engineers"')).toEqual({
      name: 'Platform Engineers',
    });
    expect(parseScimGroupFilter("displayName eq 'Platform Engineers'")).toEqual({
      name: 'Platform Engineers',
    });
    expect(parseScimGroupFilter('(displayName eq "Platform Engineers")')).toEqual({
      name: 'Platform Engineers',
    });
    expect(parseScimGroupFilter('externalId eq "ext-grp-42"')).toEqual({
      scimExternalId: 'ext-grp-42',
    });
    expect(parseScimGroupFilter('id eq "team-99"')).toEqual({
      id: 'team-99',
    });
    expect(parseScimGroupFilter(null)).toBeNull();
    expect(parseScimGroupFilter('')).toBeNull();
    expect(() => parseScimGroupFilter('displayName sw "Plat"')).toThrow(/unsupported/i);
    expect(() => parseScimGroupFilter('invalidField eq "test"')).toThrow(/unsupported/i);
  });

  it('serializes an OpsKnight team as a SCIM group resource', () => {
    const timestamp = new Date('2026-10-01T00:00:00.000Z');
    const group = serializeScimGroup(
      {
        id: 'team-1',
        name: 'SRE Team',
        scimExternalId: 'scim-team-1',
        createdAt: timestamp,
        updatedAt: timestamp,
        members: [
          {
            user: {
              id: 'user-1',
              name: 'Alice',
              email: 'alice@example.com',
            },
          },
        ],
      },
      'https://ops.example.com'
    );

    expect(group).toMatchObject({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      id: 'team-1',
      externalId: 'scim-team-1',
      displayName: 'SRE Team',
      members: [
        {
          value: 'user-1',
          display: 'Alice',
          $ref: 'https://ops.example.com/api/scim/v2/Users/user-1',
        },
      ],
      meta: {
        resourceType: 'Group',
        location: 'https://ops.example.com/api/scim/v2/Groups/team-1',
      },
    });
  });

  it('generates a compliant SCIM ServiceProviderConfig', () => {
    const config = getServiceProviderConfig('https://ops.example.com');
    expect(config.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig');
    expect(config.patch.supported).toBe(true);
    expect(config.filter.supported).toBe(true);
    expect(config.authenticationSchemes[0].type).toBe('oauthbearertoken');
    expect(config.meta.location).toBe('https://ops.example.com/api/scim/v2/ServiceProviderConfig');
  });

  it('generates RFC 7643 schema descriptors with attribute definitions', () => {
    const schemas = getScimSchemas('https://ops.example.com');
    expect(schemas).toHaveLength(3);
    const groupSchema = schemas.find(s => s.name === 'Group');
    expect(groupSchema).toBeDefined();
    expect(groupSchema?.attributes.some(a => a.name === 'displayName' && a.required)).toBe(true);
    expect(groupSchema?.attributes.some(a => a.name === 'members' && a.multiValued)).toBe(true);
  });
});
