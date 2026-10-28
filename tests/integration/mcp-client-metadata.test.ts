import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import { createMcpOAuthModel } from '@/lib/mcp/auth/oauth-model';
import { resolveCimdClient } from '@/lib/mcp/auth/cimd';
import { resolveMcpGrant } from '@/lib/mcp/auth/principal';
import { mcpResource } from '@/lib/mcp/auth/config';
import { GET as metadata } from '@/app/.well-known/oauth-authorization-server/oauth/mcp/route';

const id = 'https://client.example.com/oauth/metadata.json';
const redirect = 'https://client.example.com/callback';
const document = (extra: Record<string, unknown> = {}) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    client_id: id,
    client_name: 'Example\u0000 client',
    redirect_uris: [redirect],
    token_endpoint_auth_method: 'none',
    ...extra,
  }),
});
const policy = (data: Record<string, unknown> = {}) =>
  db.mcpPolicy.upsert({
    where: { id: 'default' },
    create: {
      enabled: true,
      cimdEnabled: true,
      cimdAllowedHosts: ['client.example.com'],
      cimdScopes: ['incidents:read'],
      ...data,
    },
    update: {
      enabled: true,
      cimdEnabled: true,
      cimdAllowedHosts: ['client.example.com'],
      cimdScopes: ['incidents:read'],
      ...data,
    },
  });
const resolve = async (fetched = document(), requested = redirect, clientId = id) =>
  resolveCimdClient(
    db,
    await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } }),
    clientId,
    requested,
    async () => fetched
  );

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_TOKEN_HASH_SECRET = randomBytes(32).toString('hex');
  await resetDatabase();
}, 60000);
beforeEach(async () => {
  await db.mcpClient.deleteMany({ where: { metadataUrl: { not: null } } });
  await policy();
});

describe('Client ID Metadata Documents', () => {
  it('is off by default and advertised only when usable', async () => {
    await db.mcpPolicy.upsert({
      where: { id: 'default' },
      create: { enabled: true },
      update: { enabled: true, cimdEnabled: false, cimdAllowedHosts: [], cimdScopes: [] },
    });
    expect((await (await metadata()).json()).client_id_metadata_document_supported).toBe(false);
    await expect(
      resolveCimdClient(
        db,
        await db.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } }),
        id,
        redirect,
        async () => document()
      )
    ).rejects.toThrow('invalid_client');
    await policy();
    expect((await (await metadata()).json()).client_id_metadata_document_supported).toBe(true);
    await policy({ cimdScopes: [] });
    expect((await (await metadata()).json()).client_id_metadata_document_supported).toBe(false);
  });

  it('creates a client limited to the administrator scope ceiling, with sanitized display data', async () => {
    const client = await resolve(
      document({ scope: 'incidents:read admin:manage runbooks:execute' })
    );
    expect(client).toMatchObject({
      id,
      metadataUrl: id,
      redirectUris: [redirect],
      scopes: ['incidents:read'],
    });
    expect(client.name).toBe('Example  client');
    await policy({ cimdScopes: ['incidents:read', 'services:read'] });
    expect((await resolve()).scopes.sort()).toEqual(['incidents:read', 'services:read']);
  });

  it('rejects untrusted hosts, unlisted redirects and revoked or foreign identities', async () => {
    await expect(
      resolve(document(), redirect, 'https://other.example.org/metadata.json')
    ).rejects.toThrow('invalid_client');
    await expect(resolve(document(), 'https://client.example.com/other')).rejects.toThrow(
      'invalid_client'
    );
    await expect(
      resolve(document({ client_id: 'https://evil.example.net/m.json' }))
    ).rejects.toThrow('invalid_client');
    await resolve();
    await db.mcpClient.update({ where: { id }, data: { revokedAt: new Date() } });
    await expect(resolve()).rejects.toThrow('invalid_client');
    expect(await db.mcpClient.findUnique({ where: { id } })).toMatchObject({
      revokedAt: expect.any(Date),
    });
  });

  it('never adopts a registered client that merely has a URL-shaped id', async () => {
    const squatted = 'https://client.example.com/registered.json';
    await db.mcpClient.create({
      data: { id: squatted, name: 'Manual', scopes: ['incidents:read'], redirectUris: [redirect] },
    });
    await expect(
      resolve(
        { ...document(), body: JSON.stringify({ client_id: squatted, redirect_uris: [redirect] }) },
        redirect,
        squatted
      )
    ).rejects.toThrow('invalid_client');
    await db.mcpClient.delete({ where: { id: squatted } });
  });

  it('removes access immediately when the trust policy changes', async () => {
    const user = await createTestUser({ role: 'ADMIN' });
    const client = await resolve();
    const grant = await db.mcpGrant.create({
      data: {
        clientId: client.id,
        userId: user.id,
        userTokenVersion: user.tokenVersion,
        scopes: ['incidents:read'],
        resource: mcpResource(),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const model = createMcpOAuthModel(db, () => undefined);
    await expect(resolveMcpGrant(grant.id)).resolves.toMatchObject({ actor: { id: user.id } });
    expect(await model.getClient(id, '')).toBeTruthy();

    await policy({ cimdAllowedHosts: ['elsewhere.example.com'] });
    await expect(resolveMcpGrant(grant.id)).rejects.toThrow('MCP_INVALID_GRANT');
    expect(await model.getClient(id, '')).toBe(false);

    await policy({ cimdEnabled: false });
    await expect(resolveMcpGrant(grant.id)).rejects.toThrow('MCP_INVALID_GRANT');

    await policy();
    await expect(resolveMcpGrant(grant.id)).resolves.toBeTruthy();
    await policy({ cimdScopes: ['services:read'] });
    await resolve();
    await expect(resolveMcpGrant(grant.id)).resolves.toMatchObject({
      apiKey: { scopes: [] },
    });
  });

  it('applies a lowered scope ceiling immediately, without re-resolving the client document', async () => {
    const user = await createTestUser({ role: 'ADMIN' });
    await policy({ cimdScopes: ['incidents:read', 'services:read'] });
    const client = await resolve();
    expect(client.scopes.sort()).toEqual(['incidents:read', 'services:read']);
    const grant = await db.mcpGrant.create({
      data: {
        clientId: client.id,
        userId: user.id,
        userTokenVersion: user.tokenVersion,
        scopes: ['incidents:read', 'services:read'],
        resource: mcpResource(),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const model = createMcpOAuthModel(db, () => undefined);
    await expect(resolveMcpGrant(grant.id)).resolves.toMatchObject({
      apiKey: { scopes: expect.arrayContaining(['incidents:read', 'services:read']) },
    });

    // Only the policy changes; the stored client copy still lists both scopes.
    await policy({ cimdScopes: ['incidents:read'] });
    expect((await db.mcpClient.findUniqueOrThrow({ where: { id } })).scopes.sort()).toEqual([
      'incidents:read',
      'services:read',
    ]);
    expect((await resolveMcpGrant(grant.id)).apiKey.scopes).toEqual(['incidents:read']);
    expect((await model.getClient(id, '')) as unknown as { scopes: string[] }).toMatchObject({
      scopes: ['incidents:read'],
    });
    const principal = { grantId: grant.id };
    const oauthClient = (await model.getClient(id, '')) as never;
    expect(await model.validateScope!(principal as never, oauthClient, ['services:read'])).toBe(
      false
    );
    expect(await model.validateScope!(principal as never, oauthClient, ['incidents:read'])).toEqual(
      ['incidents:read']
    );

    // A refresh that still lists the removed scope is narrowed, never widened.
    const saved = await model.saveToken!(
      {
        accessToken: 'access-token-value',
        refreshToken: 'refresh-token-value',
        accessTokenExpiresAt: new Date(Date.now() + 3600000),
        refreshTokenExpiresAt: new Date(Date.now() + 7200000),
        scope: ['incidents:read', 'services:read'],
      },
      oauthClient,
      principal as never
    );
    expect((saved as unknown as { scope: string[] }).scope).toEqual(['incidents:read']);
    const stored = await db.mcpToken.findFirstOrThrow({ where: { grantId: grant.id } });
    expect(stored.scopes).toEqual(['incidents:read']);

    // Nothing left in the ceiling means no usable scopes at all.
    await policy({ cimdScopes: ['admin-none:read'] });
    expect((await resolveMcpGrant(grant.id)).apiKey.scopes).toEqual([]);
    await expect(
      model.saveToken!(
        {
          accessToken: 'access-token-two',
          refreshToken: 'refresh-token-two',
          accessTokenExpiresAt: new Date(Date.now() + 3600000),
          refreshTokenExpiresAt: new Date(Date.now() + 7200000),
          scope: ['incidents:read'],
        },
        oauthClient,
        principal as never
      )
    ).rejects.toThrow('invalid_scope');
  });
});
