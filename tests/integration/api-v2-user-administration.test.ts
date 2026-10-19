import { beforeEach, expect, it, vi } from 'vitest';
const identity = vi.hoisted(() => ({ id: '' }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rbac', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/rbac')>()),
  assertAdmin: async () => ({ id: identity.id, role: 'ADMIN' }),
}));
import { GET, PATCH } from '@/app/api/v2/users/[id]/administration/route';
import { updateUserRole, deactivateUser, reactivateUser } from '@/app/(app)/users/actions';
import { administerUser } from '@/lib/users/administration';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
const headers = (revision: number, key: string) => ({
  'If-Match': `"${revision}"`,
  'Idempotency-Key': key,
});
const patch = (token: string, userId: string, revision: number, key: string, body: unknown) =>
  invokeV2(
    PATCH,
    token,
    'PATCH',
    `/users/${userId}/administration`,
    { id: userId },
    body,
    headers(revision, key)
  );
it('returns privileged safe metadata and an all-writer revision without credentials or session versions', async () => {
  const admin = await createV2Credential(['users:read']);
  const target = await createTestUser({ passwordHash: 'private-password-hash' });
  const response = await invokeV2(GET, admin.token, 'GET', `/users/${target.id}/administration`, {
    id: target.id,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('etag')).toBe(`"${target.revision}"`);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const text = await response.text();
  for (const field of ['passwordHash', 'tokenVersion', 'invitationGeneration', target.email])
    expect(text).not.toContain(field);
  await db.user.update({
    where: { id: target.id },
    data: { jobTitle: 'Concurrent legacy writer' },
  });
  expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).revision).toBe(
    target.revision + 1
  );
});
it('commits a canonical attributed role audit and concurrent same-key requests only once', async () => {
  const admin = await createV2Credential(['users:write']);
  const target = await createTestUser({ roleSource: 'OIDC' });
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      patch(admin.token, target.id, target.revision, 'role-once', {
        operation: 'set-role',
        role: 'RESPONDER',
      })
    )
  );
  expect(results.map(r => r.status)).toEqual([200, 200, 200]);
  expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
    role: 'RESPONDER',
    roleSource: 'MANUAL',
    tokenVersion: target.tokenVersion + 1,
  });
  const audits = await db.auditLog.findMany({ where: { entityId: target.id } });
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({
    action: 'user.role.updated',
    actorId: admin.user.id,
    details: expect.objectContaining({
      source: 'API',
      metadata: expect.objectContaining({ apiClientId: admin.key.id }),
    }),
  });
});
it('requires administrator authority and scopes for reads and writes', async () => {
  const target = await createTestUser();
  for (const role of ['USER', 'RESPONDER', 'AUDITOR'] as const) {
    const actor = await createV2Credential(['users:read', 'users:write'], role);
    expect(
      (
        await patch(actor.token, target.id, target.revision, `denied-${role}`, {
          operation: 'deactivate',
        })
      ).status
    ).toBe(403);
    expect(
      (
        await invokeV2(GET, actor.token, 'GET', `/users/${target.id}/administration`, {
          id: target.id,
        })
      ).status
    ).toBe(403);
  }
  const broad = await createV2Credential(['admin:manage']);
  expect(
    (
      await patch(broad.token, target.id, target.revision, 'broad-admin', {
        operation: 'deactivate',
      })
    ).status
  ).toBe(403);
  const admin = await createV2Credential(['users:read']);
  expect(
    (await patch(admin.token, target.id, target.revision, 'no-scope', { operation: 'deactivate' }))
      .status
  ).toBe(403);
});
it('rejects missing/wildcard/stale validators, missing keys, extra fields and self mutation', async () => {
  const admin = await createV2Credential(['users:write']);
  const target = await createTestUser();
  const path = `/users/${target.id}/administration`;
  for (const [extra, status] of [
    [{}, 428],
    [{ 'If-Match': '*' }, 400],
    [{ 'If-Match': `"${target.revision}"` }, 400],
  ] as const) {
    expect(
      (
        await invokeV2(
          PATCH,
          admin.token,
          'PATCH',
          path,
          { id: target.id },
          { operation: 'deactivate' },
          extra
        )
      ).status
    ).toBe(status);
  }
  expect(
    (
      await patch(admin.token, target.id, target.revision, 'strict', {
        operation: 'deactivate',
        status: 'ACTIVE',
      })
    ).status
  ).toBe(400);
  await db.user.update({ where: { id: target.id }, data: { roleSource: 'SCIM' } });
  expect(
    (await patch(admin.token, target.id, target.revision, 'stale', { operation: 'deactivate' }))
      .status
  ).toBe(412);
  for (const operation of [{ operation: 'deactivate' }, { operation: 'set-role', role: 'USER' }])
    expect(
      (
        await patch(
          admin.token,
          admin.user.id,
          admin.user.revision,
          'self-' + operation.operation,
          operation
        )
      ).status
    ).toBe(403);
});
it('deactivation revokes credentials and approvals atomically and reactivation restores none', async () => {
  const admin = await createV2Credential(['users:write']);
  const target = await createV2Credential(['users:read']);
  target.user = await db.user.update({
    where: { id: target.user.id },
    data: { passwordHash: null },
  });
  await db.userToken.create({
    data: {
      userId: target.user.id,
      identifier: target.user.email,
      tokenHash: 'test-unused-token',
      type: 'INVITE',
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  expect(
    (
      await patch(admin.token, target.user.id, target.user.revision, 'disable', {
        operation: 'deactivate',
      })
    ).status
  ).toBe(200);
  const disabled = await db.user.findUniqueOrThrow({ where: { id: target.user.id } });
  expect(disabled).toMatchObject({
    status: 'DISABLED',
    invitationGeneration: target.user.invitationGeneration + 1,
    tokenVersion: target.user.tokenVersion + 1,
  });
  expect(
    (await db.apiKey.findUniqueOrThrow({ where: { id: target.key.id } })).revokedAt
  ).not.toBeNull();
  expect(await db.userToken.count({ where: { userId: target.user.id, revokedAt: null } })).toBe(0);
  expect(
    (
      await patch(admin.token, target.user.id, disabled.revision, 'reactivate', {
        operation: 'reactivate',
      })
    ).status
  ).toBe(200);
  expect(await db.user.findUniqueOrThrow({ where: { id: target.user.id } })).toMatchObject({
    status: 'INVITED',
    deactivatedAt: null,
  });
  expect(
    (await db.apiKey.findUniqueOrThrow({ where: { id: target.key.id } })).revokedAt
  ).not.toBeNull();
});
it('no-op role/deactivation changes do not repeat audits or session revocations', async () => {
  const admin = await createV2Credential(['users:write']);
  const target = await createTestUser({ status: 'DISABLED' });
  for (const [i, body] of [
    { operation: 'set-role', role: 'USER' },
    { operation: 'deactivate' },
  ].entries())
    expect((await patch(admin.token, target.id, target.revision, `no-op-${i}`, body)).status).toBe(
      200
    );
  expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
    revision: target.revision,
    tokenVersion: target.tokenVersion,
  });
  expect(await db.auditLog.count({ where: { entityId: target.id } })).toBe(0);
});
it('actual UI lifecycle actions use the same canonical audit and session effects', async () => {
  const admin = await createV2Credential([]);
  identity.id = admin.user.id;
  const target = await createTestUser({ passwordHash: 'existing-password-hash' });
  const form = new FormData();
  form.set('role', 'RESPONDER');
  await updateUserRole(target.id, form);
  await deactivateUser(target.id);
  await reactivateUser(target.id);
  expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
    role: 'RESPONDER',
    status: 'ACTIVE',
    tokenVersion: target.tokenVersion + 3,
  });
  expect(
    (await db.auditLog.findMany({ where: { entityId: target.id } })).map(a => a.action).sort()
  ).toEqual(['user.deactivated', 'user.reactivated', 'user.role.updated']);
});
it('rechecks a stale UI administrator and rolls back all changes if the outer transaction fails', async () => {
  const admin = await createTestUser({ role: 'USER' });
  const target = await createTestUser();
  await expect(
    administerUser(target.id, { operation: 'set-role', role: 'ADMIN' }, admin)
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  const actual = await createTestUser({ role: 'ADMIN' });
  await expect(
    db.$transaction(
      async tx => {
        await administerUser(target.id, { operation: 'deactivate' }, actual, { client: tx });
        throw new Error('Forced receipt failure');
      },
      { isolationLevel: 'Serializable' }
    )
  ).rejects.toThrow('Forced receipt failure');
  expect(await db.user.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
    status: 'ACTIVE',
    tokenVersion: target.tokenVersion,
  });
  expect(await db.auditLog.count({ where: { entityId: target.id } })).toBe(0);
});
it('a successful request cannot replay after the administrator is demoted', async () => {
  const admin = await createV2Credential(['users:write']);
  const target = await createTestUser();
  expect(
    (
      await patch(admin.token, target.id, target.revision, 'revocable', {
        operation: 'revoke-sessions',
      })
    ).status
  ).toBe(200);
  await db.user.update({ where: { id: admin.user.id }, data: { role: 'USER' } });
  expect(
    (
      await patch(admin.token, target.id, target.revision, 'revocable', {
        operation: 'revoke-sessions',
      })
    ).status
  ).toBe(403);
  expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).tokenVersion).toBe(
    target.tokenVersion + 1
  );
});
it('preserves the last active admin even with concurrent cross-demotion commands', async () => {
  const a = await createTestUser({ role: 'ADMIN' }),
    b = await createTestUser({ role: 'ADMIN' });
  await Promise.allSettled([
    administerUser(a.id, { operation: 'set-role', role: 'USER' }, b),
    administerUser(b.id, { operation: 'set-role', role: 'USER' }, a),
  ]);
  expect(await db.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(1);
  expect(await db.auditLog.count({ where: { action: 'user.role.updated' } })).toBe(1);
});
it('session revocation retains API credentials and binds a retry key to its reviewed command', async () => {
  const admin = await createV2Credential(['users:write']);
  const target = await createV2Credential(['users:read']);
  await db.userDevice.create({
    data: {
      userId: target.user.id,
      deviceId: 'session:revocation-fixture',
      platform: 'session:STANDARD',
      token: 'test-session-digest',
    },
  });
  const first = await patch(admin.token, target.user.id, target.user.revision, 'sessions', {
    operation: 'revoke-sessions',
  });
  expect(first.status).toBe(200);
  expect(await db.userDevice.findFirstOrThrow({ where: { userId: target.user.id } })).toMatchObject(
    { platform: 'session:REVOKED:STANDARD' }
  );
  expect(
    (await db.apiKey.findUniqueOrThrow({ where: { id: target.key.id } })).revokedAt
  ).toBeNull();
  expect(
    (
      await patch(admin.token, target.user.id, target.user.revision, 'sessions', {
        operation: 'deactivate',
      })
    ).status
  ).toBe(409);
  expect((await db.user.findUniqueOrThrow({ where: { id: target.user.id } })).status).toBe(
    'ACTIVE'
  );
});
it('rejects disabled principals at the shared boundary and invalid reactivation without audit side effects', async () => {
  const admin = await createV2Credential(['users:write']);
  const target = await createTestUser();
  expect(
    (
      await patch(admin.token, target.id, target.revision, 'already-active', {
        operation: 'reactivate',
      })
    ).status
  ).toBe(400);
  await db.user.update({ where: { id: admin.user.id }, data: { status: 'DISABLED' } });
  await expect(
    administerUser(target.id, { operation: 'deactivate' }, admin.user)
  ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  expect(await db.auditLog.count({ where: { entityId: target.id } })).toBe(0);
});
