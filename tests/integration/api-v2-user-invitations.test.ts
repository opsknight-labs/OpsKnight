import type { Prisma } from '@prisma/client';
import { beforeEach, expect, it, vi } from 'vitest';
const identity = vi.hoisted(() => ({
  id: '',
  tokenVersion: 0,
  kind: 'admin' as 'admin' | 'emergency',
}));
const transport = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, messageId: 'owned-invitation-mail' }))
);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/auth-control/origin', () => ({
  authenticationOrigin: async () => 'https://invitations.example.invalid',
}));
vi.mock('@/lib/auth-control/actor', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/auth-control/actor')>()),
  getControlActor: async () => ({
    ...identity,
    authenticatedAt: Date.now(),
    issuedUnderPolicyVersion: 1,
    method: 'credentials',
  }),
}));
vi.mock('@/lib/rbac', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/rbac')>()),
  assertAdmin: async () => ({ id: identity.id, role: 'ADMIN' }),
}));
vi.mock('@/lib/email', () => ({ sendEmail: transport }));
import { GET as getPolicy } from '@/app/api/v2/users/invitation-policy/route';
import { POST as createInvitation } from '@/app/api/v2/users/invitations/route';
import {
  GET as getInvitation,
  POST as renewInvitation,
} from '@/app/api/v2/users/[id]/invitation/route';
import { addUser, generateInvite } from '@/app/(app)/users/actions';
import { setPassword } from '@/app/set-password/actions';
import { issueUserInvitation } from '@/lib/users/invitations';
import { invitationDeliveryRevoked, readUserInvitation } from '@/lib/users/invitation-policy';
import { deliverCentralNotification } from '@/lib/notification-control-plane';
import { encrypt, decrypt } from '@/lib/encryption';
import { encryptProviderConfig } from '@/lib/encrypted-provider-config';
import { createHash } from 'node:crypto';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  transport.mockClear();
  identity.kind = 'admin';
  await db.authenticationPolicy.create({ data: { mode: 'PASSWORD_ONLY', legacySnapshot: {} } });
});
const review = {
  authenticationMode: 'PASSWORD',
  delivery: 'MANUAL',
  expectedPolicyVersion: 1,
  expectedOidcConfigVersion: null,
} as const;
const body = (email = 'invited@example.invalid', extra: Record<string, unknown> = {}) => ({
  name: 'Invited user',
  email,
  role: 'RESPONDER' as const,
  ...review,
  ...extra,
});
const create = (token: string, key: string, input: unknown = body()) =>
  invokeV2(createInvitation, token, 'POST', '/users/invitations', {}, input, {
    'Idempotency-Key': key,
  });
async function fixture() {
  const admin = await createV2Credential(['users:read', 'users:write']);
  identity.id = admin.user.id;
  identity.tokenVersion = admin.user.tokenVersion;
  return admin;
}
async function emailProvider() {
  await db.notificationProvider.create({
    data: {
      provider: 'smtp',
      enabled: true,
      config: (await encryptProviderConfig('smtp', {
        host: 'mail.example.invalid',
        user: 'fixture',
        password: 'owned-test-only-password',
        port: 2525,
        fromEmail: 'ops@example.invalid',
      })) as Prisma.InputJsonObject,
    },
  });
}
function tokenFrom(url: string) {
  return new URLSearchParams(new URL(url).hash.slice(1)).get('token')!;
}
async function renew(
  token: string,
  userId: string,
  revision: number,
  key: string,
  extra: Record<string, unknown> = {}
) {
  return invokeV2(
    renewInvitation,
    token,
    'POST',
    `/users/${userId}/invitation`,
    { id: userId },
    { ...review, expectedLinkingApprovalRevision: null, ...extra },
    { 'Idempotency-Key': key, 'If-Match': `"${revision}"` }
  );
}
it('discloses a manual capability once, commits one generation/audit, and never persists the bearer URL in replay metadata', async () => {
  const admin = await fixture();
  const initial = await create(admin.token, 'manual-once');
  expect(initial.status).toBe(201);
  const result = (await initial.json()).data;
  const token = tokenFrom(result.inviteUrl);
  expect(initial.headers.get('cache-control')).toBe('no-store');
  const record = await db.userToken.findFirstOrThrow({ where: { userId: result.userId } });
  expect(record).toMatchObject({
    tokenHash: createHash('sha256').update(token).digest('hex'),
    generation: 1,
  });
  const receipts = JSON.stringify(await db.backgroundJob.findMany());
  expect(receipts).not.toContain(token);
  expect(receipts).not.toContain('#token=');
  const replay = await create(admin.token, 'manual-once');
  expect(replay.status).toBe(201);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await replay.json()).data).toMatchObject({
    userId: result.userId,
    inviteUrl: null,
    disclosure: 'ALREADY_DISCLOSED',
  });
  expect(await db.userToken.count()).toBe(1);
  expect(await db.auditLog.count({ where: { action: 'user.invited' } })).toBe(1);
});
it('concurrent same-key requests issue one capability and return safe replays', async () => {
  const admin = await fixture();
  const results = await Promise.all([1, 2, 3].map(() => create(admin.token, 'concurrent')));
  expect(results.map(r => r.status)).toEqual([201, 201, 201]);
  const data = await Promise.all(results.map(r => r.json()));
  expect(data.filter(r => r.data.inviteUrl)).toHaveLength(1);
  expect(await db.userToken.count()).toBe(1);
});
it('queues encrypted email atomically without disclosing its URL and dispatches through the actual notification worker', async () => {
  const admin = await fixture();
  await emailProvider();
  const response = await create(admin.token, 'email', body(undefined, { delivery: 'EMAIL' }));
  expect(response.status).toBe(201);
  const data = (await response.json()).data;
  expect(data).toMatchObject({
    inviteUrl: null,
    deliveryStatus: 'QUEUED',
    disclosure: 'NOT_REQUESTED',
  });
  const row = await db.notification.findUniqueOrThrow({ where: { id: data.notificationId } });
  const payload = JSON.parse(await decrypt(row.payloadEncrypted!));
  expect(payload.invitationPolicy).toMatchObject({
    userId: data.userId,
    invitationGeneration: 1,
    authenticationMode: 'PASSWORD',
  });
  expect(row.payloadEncrypted).not.toContain('token=');
  expect(await db.userNotificationEndpoint.count({ where: { userId: data.userId } })).toBe(1);
  expect((await deliverCentralNotification(row.id)).success).toBe(true);
  expect(transport).toHaveBeenCalledTimes(1);
});
it('fails an unconfigured email invitation without creating a user and rejects stale policy versions', async () => {
  const admin = await fixture();
  expect(
    (await create(admin.token, 'missing-provider', body(undefined, { delivery: 'EMAIL' }))).status
  ).toBe(503);
  expect(await db.user.count({ where: { email: 'invited@example.invalid' } })).toBe(0);
  expect(
    (await create(admin.token, 'stale-policy', body(undefined, { expectedPolicyVersion: 2 })))
      .status
  ).toBe(412);
  expect(await db.userToken.count()).toBe(0);
});
it('requires explicit users:write, current administrator authority, strict input and a retry key', async () => {
  await fixture();
  for (const role of ['USER', 'RESPONDER', 'AUDITOR'] as const) {
    const actor = await createV2Credential(['users:read', 'users:write'], role);
    expect((await create(actor.token, 'denied-' + role)).status).toBe(403);
    expect(
      (await invokeV2(getPolicy, actor.token, 'GET', '/users/invitation-policy', {})).status
    ).toBe(403);
  }
  const broad = await createV2Credential(['admin:manage']);
  expect((await create(broad.token, 'broad')).status).toBe(403);
  const admin = await fixture();
  expect(
    (await create(admin.token, 'strict', body(undefined, { bypassPolicy: true }))).status
  ).toBe(400);
  expect(
    (await invokeV2(createInvitation, admin.token, 'POST', '/users/invitations', {}, body())).status
  ).toBe(400);
});
it('renewal invalidates the old generation and the real password onboarding accepts only the new capability', async () => {
  const admin = await fixture();
  const first = (await (await create(admin.token, 'initial')).json()).data;
  const next = await renew(admin.token, first.userId, first.revision, 'renew');
  expect(next.status).toBe(200);
  const renewed = (await next.json()).data;
  const password = 'Invitation-river-harbor-482!';
  const form = (token: string) => {
    const f = new FormData();
    f.set('token', token);
    f.set('password', password);
    f.set('confirmPassword', password);
    return f;
  };
  expect((await setPassword({}, form(tokenFrom(first.inviteUrl)))).error).toBeTruthy();
  expect(await setPassword({}, form(tokenFrom(renewed.inviteUrl)))).toMatchObject({
    success: true,
  });
  expect((await db.user.findUniqueOrThrow({ where: { id: first.userId } })).status).toBe('ACTIVE');
  expect((await renew(admin.token, first.userId, renewed.revision, 'active-takeover')).status).toBe(
    412
  );
});
it('does not take over existing active or disabled identities, and does not replay after the actor loses authority', async () => {
  const admin = await fixture();
  const existing = await createTestUser();
  expect((await create(admin.token, 'existing', body(existing.email))).status).toBe(409);
  const created = (await (await create(admin.token, 'revocable')).json()).data;
  await db.user.update({ where: { id: admin.user.id }, data: { role: 'USER' } });
  expect((await create(admin.token, 'revocable')).status).toBe(403);
  expect((await db.user.findUniqueOrThrow({ where: { id: created.userId } })).status).toBe(
    'INVITED'
  );
});
it('rolls back the user, token and canonical audit if the caller transaction cannot commit', async () => {
  const admin = await fixture();
  await expect(
    db.$transaction(async tx => {
      await issueUserInvitation(body(), admin.user, {
        client: tx,
        prepared: { appUrl: 'https://invitations.example.invalid', emailProviders: [] },
      });
      throw new Error('Receipt failed');
    })
  ).rejects.toThrow('Receipt failed');
  expect(await db.user.count({ where: { email: 'invited@example.invalid' } })).toBe(0);
  expect(await db.userToken.count()).toBe(0);
  expect(await db.auditLog.count({ where: { action: 'user.invited' } })).toBe(0);
});
it('SSO Required creates a bound approval with no password token and canonical API attribution', async () => {
  const admin = await fixture();
  await db.oidcConfig.create({
    data: {
      updatedBy: admin.user.id,
      issuer: 'https://idp.example.invalid',
      clientId: 'owned-client',
      clientSecret: await encrypt('owned-client-secret'),
      enabled: true,
    },
  });
  await db.authenticationPolicy.update({
    where: { id: 'default' },
    data: { mode: 'SSO_REQUIRED', oidcConfigVersion: 1 },
  });
  expect(
    (
      await create(
        admin.token,
        'password-bypass',
        body(undefined, { expectedOidcConfigVersion: 1 })
      )
    ).status
  ).toBe(403);
  const response = await create(
    admin.token,
    'sso',
    body(undefined, { authenticationMode: 'SSO', expectedOidcConfigVersion: 1 })
  );
  expect(response.status).toBe(201);
  const data = (await response.json()).data;
  expect(data.inviteUrl).toBe('https://invitations.example.invalid/login');
  expect(await db.userToken.count({ where: { userId: data.userId } })).toBe(0);
  const approval = await db.oidcLinkingApproval.findUniqueOrThrow({
    where: { userId: data.userId },
  });
  expect(approval).toMatchObject({
    configVersion: 1,
    expectedEmail: 'invited@example.invalid',
    approvedById: admin.user.id,
  });
  const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'auth.user.sso.invited' } });
  expect(audit).toMatchObject({
    actorId: admin.user.id,
    details: expect.objectContaining({
      source: 'API',
      metadata: expect.objectContaining({ apiClientId: admin.key.id }),
    }),
  });
  const state = await db.$transaction(tx => readUserInvitation(tx, data.userId, admin.user));
  await db.oidcLinkingApproval.update({
    where: { userId: data.userId },
    data: { revokedAt: new Date() },
  });
  expect(
    (
      await renew(admin.token, data.userId, data.revision, 'stale-approval', {
        authenticationMode: 'SSO',
        expectedOidcConfigVersion: 1,
        expectedLinkingApprovalRevision: state.linkingApprovalRevision,
      })
    ).status
  ).toBe(412);
});
it('queued mail is suppressed after renewal, revocation or acceptance and after SSO trust changes', async () => {
  const admin = await fixture();
  await emailProvider();
  const created = (
    await (await create(admin.token, 'queued', body(undefined, { delivery: 'EMAIL' }))).json()
  ).data;
  await renew(admin.token, created.userId, created.revision, 'supersede');
  const result = await deliverCentralNotification(created.notificationId);
  expect(result.success).toBe(true);
  expect(transport).not.toHaveBeenCalled();
  expect(
    (await db.notification.findUniqueOrThrow({ where: { id: created.notificationId } })).status
  ).toBe('SKIPPED');
  const policy = {
    userId: created.userId,
    email: 'invited@example.invalid',
    invitationGeneration: 2,
    authenticationMode: 'PASSWORD' as const,
  };
  expect(await invitationDeliveryRevoked(policy, policy.email)).toBeNull();
  await db.user.update({ where: { id: created.userId }, data: { status: 'DISABLED' } });
  expect(await invitationDeliveryRevoked(policy, policy.email)).toBeTruthy();
});
it('actual UI creation and renewal share the command, while recovery principals cannot create invitations', async () => {
  await fixture();
  const form = new FormData();
  form.set('name', 'UI invited');
  form.set('email', 'ui-invited@example.invalid');
  form.set('role', 'USER');
  const created = await addUser({}, form);
  expect(created).toMatchObject({ success: true, emailSent: false });
  expect(created.inviteUrl).toContain('#token=');
  const user = await db.user.findUniqueOrThrow({ where: { email: 'ui-invited@example.invalid' } });
  expect(await generateInvite(user.id, {}, new FormData())).toMatchObject({ success: true });
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).invitationGeneration).toBe(
    2
  );
  expect(await db.auditLog.count({ where: { entityId: user.id } })).toBe(2);
  identity.kind = 'emergency';
  form.set('email', 'recovery-invite@example.invalid');
  expect((await addUser({}, form)).error).toContain('Ordinary administrator');
  expect(await db.user.count({ where: { email: 'recovery-invite@example.invalid' } })).toBe(0);
});
it('safe invitation reads expose validators and delivery state without bearer capabilities', async () => {
  const admin = await fixture();
  const created = (await (await create(admin.token, 'read')).json()).data;
  const response = await invokeV2(
    getInvitation,
    admin.token,
    'GET',
    `/users/${created.userId}/invitation`,
    { id: created.userId }
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toContain('tokenHash');
  expect(text).not.toContain('#token=');
  expect(response.headers.get('etag')).toBe(`"${created.revision}"`);
});
it('stops queued SSO mail when its reviewed provider trust changes', async () => {
  const admin = await fixture();
  await emailProvider();
  await db.oidcConfig.create({
    data: {
      issuer: 'https://idp.example.invalid',
      clientId: 'owned-client',
      clientSecret: await encrypt('owned-client-secret'),
      enabled: true,
      updatedBy: admin.user.id,
    },
  });
  await db.authenticationPolicy.update({
    where: { id: 'default' },
    data: { mode: 'SSO_OPTIONAL', oidcConfigVersion: 1 },
  });
  const response = await create(
    admin.token,
    'sso-email',
    body(undefined, { authenticationMode: 'SSO', expectedOidcConfigVersion: 1, delivery: 'EMAIL' })
  );
  expect(response.status).toBe(201);
  const created = (await response.json()).data;
  const row = await db.notification.findUniqueOrThrow({ where: { id: created.notificationId } });
  const payload = JSON.parse(await decrypt(row.payloadEncrypted!));
  expect(await invitationDeliveryRevoked(payload.invitationPolicy, payload.to)).toBeNull();
  await db.oidcConfig.update({ where: { id: 'default' }, data: { configVersion: 2 } });
  expect((await deliverCentralNotification(row.id)).success).toBe(true);
  expect((await db.notification.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
    'SKIPPED'
  );
  expect(transport).not.toHaveBeenCalled();
});
it('suppresses queued mail after actual password acceptance through the shared UI invitation', async () => {
  await fixture();
  await emailProvider();
  const form = new FormData();
  form.set('name', 'Accepted invite');
  form.set('email', 'accepted@example.invalid');
  form.set('role', 'USER');
  const invitation = await addUser({}, form);
  expect(invitation).toMatchObject({ success: true, emailQueued: true, emailSent: false });
  const user = await db.user.findUniqueOrThrow({ where: { email: 'accepted@example.invalid' } });
  const password = new FormData();
  password.set('token', tokenFrom(invitation.inviteUrl!));
  password.set('password', 'Acceptance-river-harbor-472!');
  password.set('confirmPassword', 'Acceptance-river-harbor-472!');
  expect(await setPassword({}, password)).toMatchObject({ success: true });
  const row = await db.notification.findFirstOrThrow({
    where: { sourceType: 'USER_INVITATION', sourceId: user.id },
  });
  await deliverCentralNotification(row.id);
  expect((await db.notification.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
    'SKIPPED'
  );
  expect(transport).not.toHaveBeenCalled();
});
it('bounds invitation queue admission before creating another user and ignores expired history', async () => {
  const admin = await fixture();
  await emailProvider();
  await db.notification.createMany({
    data: Array.from({ length: 100 }, () => ({
      userId: admin.user.id,
      channel: 'EMAIL' as const,
      sourceType: 'USER_INVITATION',
      status: 'PENDING' as const,
      expiresAt: new Date(Date.now() - 60000),
    })),
  });
  const first = await create(
    admin.token,
    'expired-history',
    body('first@example.invalid', { delivery: 'EMAIL' })
  );
  expect(first.status).toBe(201);
  await db.notification.createMany({
    data: Array.from({ length: 63 }, () => ({
      userId: admin.user.id,
      channel: 'EMAIL' as const,
      sourceType: 'USER_INVITATION',
      status: 'PENDING' as const,
      expiresAt: new Date(Date.now() + 60000),
    })),
  });
  const full = await create(admin.token, 'at-capacity', body(undefined, { delivery: 'EMAIL' }));
  expect(full.status).toBe(429);
  expect(full.headers.get('retry-after')).toBe('30');
  expect(await db.user.count({ where: { email: 'invited@example.invalid' } })).toBe(0);
});
