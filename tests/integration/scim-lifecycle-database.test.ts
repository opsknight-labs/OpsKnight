// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import prisma from '@/lib/prisma';
import { getControlActor } from '@/lib/auth-control/actor';
import { resolveOidcIdentityForSignIn } from '@/lib/oidc-identity-resolution';
import {
  createScimCredentialAction,
  bindExistingScimUserAction,
  scimDriftAction,
  detachScimBindingAction,
  restoreScimIdentityAction,
  previewScimBindingAction,
  approveScimBindingAction,
  revokeScimCredentialAction,
} from '@/app/(app)/settings/system/scim-actions';
import { hashToken, authenticate } from '@/lib/scim/security/credentials';
import { handle } from '@/lib/scim/protocol/http';
import { users } from '@/lib/scim/lifecycle/users';
import { groups } from '@/lib/scim/lifecycle/groups';
import { preserveScimOwnedOidcFields } from '@/lib/scim/lifecycle/oidc-profile';
import { reconcileTeam } from '@/lib/scim/lifecycle/membership';
import { updateUserSecurityState } from '@/lib/users/admin-invariants';

const suite =
  process.env.SCIM_CERTIFICATION === '1' && process.env.VITEST_USE_REAL_DB === '1'
    ? describe
    : describe.skip;
// Ordinary HTTP authorization and PostgreSQL mutations remain real; UI actor checks are tested separately.
vi.mock('@/lib/auth-control/actor', () => ({
  getControlActor: vi.fn(),
  lockControlActor: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({ assertAdmin: vi.fn() }));
const token = 'scim-certification-only-token-000000000000001';
const tokenB = 'scim-certification-only-token-000000000000002';
const ids: string[] = [];
let userId: string;
let groupId: string;
let teamId: string;
const principal = {
  connectorId: 'cert-a',
  credentialId: 'cert-key-a',
  scopes: ['users:read', 'users:write', 'groups:read', 'groups:write'],
};
function call(
  resource: 'users' | 'groups',
  method: string,
  body?: unknown,
  id?: string,
  query = '',
  credential = token
) {
  const request = new NextRequest(
    `https://ops.example.test/api/scim/v2/${resource === 'users' ? 'Users' : 'Groups'}${id ? `/${id}` : ''}${query}`,
    {
      method,
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/scim+json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  );
  return handle(() => (resource === 'users' ? users(request, id) : groups(request, id)));
}
const patch = (...Operations: unknown[]) => ({
  schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
  Operations,
});
suite('SCIM PostgreSQL lifecycle certification', () => {
  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL!).pathname.endsWith('/enterprise_scim_test'))
      throw new Error('Use only the isolated enterprise_scim_test database.');
    for (const [id, secret] of [
      ['cert-a', token],
      ['cert-b', tokenB],
    ]) {
      await prisma.scimConnector.upsert({
        where: { id },
        create: { id, name: id },
        update: { enabled: true, credentialAuthority: 'REGISTRY' },
      });
      await prisma.scimCredential.upsert({
        where: { tokenHash: hashToken(secret) },
        create: {
          id: `cert-key-${id.slice(-1)}`,
          connectorId: id,
          name: 'Local certification',
          tokenHash: hashToken(secret),
          tokenHint: secret.slice(-4),
          scopes: principal.scopes,
          createdBy: 'certifier',
          expiresAt: new Date(Date.now() + 86400000),
        },
        update: { revokedAt: null, expiresAt: new Date(Date.now() + 86400000) },
      });
    }
    const owner = await prisma.user.create({
      data: {
        email: `scim-owner-${Date.now()}@example.test`,
        name: 'Protected owner',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    ids.push(owner.id);
    const team = await prisma.team.create({
      data: {
        name: `SCIM cert operational ${Date.now()}`,
        members: { create: { userId: owner.id, role: 'OWNER' } },
      },
    });
    teamId = team.id;
    await prisma.service.create({ data: { name: `scim-cert-service-${Date.now()}`, teamId } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  it('serializes SCIM creation against an uncommitted ordinary invitation with a case variant', async () => {
    const email = `race-${Date.now()}@example.test`;
    let ready!: () => void;
    const inserted = new Promise<void>(resolve => {
      ready = resolve;
    });
    const ordinary = prisma.$transaction(async tx => {
      const user = await tx.user.create({
        data: { email: email.toUpperCase(), name: 'Ordinary invitation', status: 'INVITED' },
      });
      ids.push(user.id);
      ready();
      await tx.$executeRaw`SELECT pg_sleep(0.5)`;
      return user;
    });
    await inserted;
    const [invited, response] = await Promise.all([
      ordinary,
      call('users', 'POST', { userName: email, externalId: email, active: true }),
    ]);
    expect(response.status).toBe(409);
    expect(
      await prisma.user.count({ where: { email: { equals: email, mode: 'insensitive' } } })
    ).toBe(1);
    expect(await prisma.scimIdentity.count({ where: { userId: invited.id } })).toBe(0);
  });

  it('shares canonical reservations with real OIDC JIT and releases them after rename and deletion', async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const email = `jit-race-${Date.now()}-${attempt}@example.test`;
      const [jit, scim] = await Promise.all([
        resolveOidcIdentityForSignIn({
          issuer: 'https://jit.example.test',
          subject: email,
          email: email.toUpperCase(),
          displayName: 'JIT user',
          providerType: 'GENERIC',
          emailVerifiedClaim: true,
          requireEmailVerifiedClaim: true,
          autoProvision: true,
          allowedDomains: [],
        }),
        call('users', 'POST', { userName: email, externalId: email }),
      ]);
      expect(jit.ok || scim.status === 201).toBe(true);
      expect([201, 409]).toContain(scim.status);
      expect(
        await prisma.user.count({ where: { email: { equals: email, mode: 'insensitive' } } })
      ).toBe(1);
    }
    const oldEmail = `reservation-${Date.now()}@example.test`;
    const newEmail = `renamed-${oldEmail}`;
    const owner = await prisma.user.create({
      data: { email: oldEmail, name: 'Reservation owner' },
    });
    await prisma.user.update({ where: { id: owner.id }, data: { email: newEmail } });
    const reused = await prisma.user.create({
      data: { email: oldEmail.toUpperCase(), name: 'Reused old address' },
    });
    await expect(
      prisma.user.update({ where: { id: reused.id }, data: { email: newEmail.toUpperCase() } })
    ).rejects.toMatchObject({ code: 'P2002' });
    await prisma.user.delete({ where: { id: owner.id } });
    const replacement = await prisma.user.create({
      data: { email: newEmail.toUpperCase(), name: 'Reused deleted address' },
    });
    await prisma.user.deleteMany({ where: { id: { in: [reused.id, replacement.id] } } });
  });

  it('preserves custom local photos on name-only PATCH while refreshing default initials', async () => {
    const response = await call('users', 'POST', {
      userName: `avatar-${Date.now()}@example.test`,
      externalId: `avatar-${Date.now()}`,
      displayName: 'Before Name',
      active: true,
    });
    const created = await response.json();
    ids.push(created.id);
    const custom = `/api/users/${created.id}/avatar`;
    await prisma.user.update({ where: { id: created.id }, data: { avatarUrl: custom } });
    const updated = await call(
      'users',
      'PATCH',
      patch({ op: 'replace', path: 'displayName', value: 'After Name' }),
      created.id
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ id: created.id, displayName: 'After Name' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).avatarUrl).toBe(
      custom
    );
    await prisma.user.update({
      where: { id: created.id },
      data: { avatarUrl: '/api/avatar?style=initials&seed=AN&radius=50' },
    });
    expect(
      (
        await call(
          'users',
          'PATCH',
          patch({ op: 'replace', path: 'displayName', value: 'Fresh Person' }),
          created.id
        )
      ).status
    ).toBe(200);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).avatarUrl
    ).toContain('seed=FP');
    const photo = 'https://example.test/explicit-avatar.png';
    expect(
      (
        await call(
          'users',
          'PATCH',
          patch({ op: 'replace', path: 'photos', value: [{ value: photo }] }),
          created.id
        )
      ).status
    ).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).avatarUrl).toBe(
      photo
    );
  });

  it('creates and serializes a directory identity without exposing local accounts', async () => {
    const response = await call('users', 'POST', {
      userName: `cert-${Date.now()}@example.test`,
      externalId: `cert-directory-${Date.now()}`,
      name: { givenName: 'Alice', familyName: 'Ng' },
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toContain('application/scim+json');
    const data = await response.json();
    userId = data.id;
    ids.push(userId);
    expect(data.name).toMatchObject({ givenName: 'Alice', familyName: 'Ng' });
    expect(response.headers.get('location')).toBe(data.meta.location);
    expect(await prisma.scimIdentity.count({ where: { userId } })).toBe(1);
    expect((await call('users', 'GET', undefined, ids[0])).status).toBe(404);
  });
  it('links a mixed-case local account, finds it case-insensitively and prevents duplicate creates and renames', async () => {
    const email = `MixedCase-${Date.now()}@Example.test`;
    const local = await prisma.user.create({
      data: { email, name: 'Local name', role: 'RESPONDER', roleSource: 'OIDC' },
    });
    vi.mocked(getControlActor).mockResolvedValue({ kind: 'admin', id: ids[0] } as Awaited<
      ReturnType<typeof getControlActor>
    >);
    expect(
      await bindExistingScimUserAction({
        connectorId: 'cert-a',
        externalId: `mixed-${local.id}`,
        userId: local.id,
      })
    ).toBeUndefined();
    const found = await call(
      'users',
      'GET',
      undefined,
      undefined,
      `?filter=${encodeURIComponent(`userName eq "${email.toLowerCase()}"`)}`
    );
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ totalResults: 1, Resources: [{ id: local.id }] });
    const countOnly = await call(
      'users',
      'GET',
      undefined,
      undefined,
      `?count=0&filter=${encodeURIComponent(`userName eq "${email.toUpperCase()}"`)}`
    );
    expect(await countOnly.json()).toMatchObject({ totalResults: 1, itemsPerPage: 0 });
    expect(
      (
        await call('users', 'POST', {
          userName: email.toLowerCase(),
          externalId: `duplicate-${local.id}`,
        })
      ).status
    ).toBe(409);
    expect(
      (
        await call(
          'users',
          'PATCH',
          patch({ op: 'replace', path: 'userName', value: email }),
          userId
        )
      ).status
    ).toBe(409);
    expect(
      await prisma.user.count({ where: { email: { equals: email, mode: 'insensitive' } } })
    ).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: local.id } })).toMatchObject({
      email,
      role: 'RESPONDER',
      roleSource: 'OIDC',
    });
    // Historical duplicates are exercised by the pre-migration upgrade fixture.
    // Once migrated, even non-SCIM writers cannot introduce another case variant.
    await expect(
      prisma.user.create({ data: { email: email.toLowerCase(), name: 'New duplicate' } })
    ).rejects.toMatchObject({ code: 'P2002' });
  });
  it('accepts User member types and removes displayName with structured-name fallback while retaining security authority', async () => {
    const created = await call('users', 'POST', {
      userName: `optional-${Date.now()}@example.test`,
      externalId: `optional-${Date.now()}`,
      displayName: 'Display override',
      name: { givenName: 'Alice', familyName: 'Ng' },
    });
    const user = await created.json();
    expect(created.status).toBe(201);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const removed = await call(
      'users',
      'PATCH',
      patch({ op: 'remove', path: 'displayName' }),
      user.id
    );
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ displayName: 'Alice Ng', active: true });
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toMatchObject({
      role: before.role,
      roleSource: before.roleSource,
      tokenVersion: before.tokenVersion,
    });
    const group = await call('groups', 'POST', {
      displayName: `Typed members ${Date.now()}`,
      members: [{ value: user.id, type: 'User' }],
    });
    expect(group.status).toBe(201);
    const directory = await group.json();
    expect(
      (
        await call(
          'groups',
          'PATCH',
          patch({ op: 'replace', path: 'members', value: [{ value: user.id, type: 'User' }] }),
          directory.id
        )
      ).status
    ).toBe(200);
    expect(
      await prisma.scimGroupMembership.count({ where: { groupId: directory.id, userId: user.id } })
    ).toBe(1);
  });
  it('isolates connectors even when an internal user ID is known', async () => {
    expect((await call('users', 'GET', undefined, userId, '', tokenB)).status).toBe(404);
    expect(
      (
        await call(
          'users',
          'PATCH',
          patch({ op: 'replace', path: 'active', value: false }),
          userId,
          '',
          tokenB
        )
      ).status
    ).toBe(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).status).toBe('ACTIVE');
  });
  it('preserves OIDC role authority and cosmetic session versions', async () => {
    await updateUserSecurityState(userId, { role: 'ADMIN', roleSource: 'OIDC' });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(
      (
        await call(
          'users',
          'PATCH',
          patch({ op: 'replace', path: 'displayName', value: 'Updated profile' }),
          userId
        )
      ).status
    ).toBe(200);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after).toMatchObject({
      role: 'ADMIN',
      roleSource: 'OIDC',
      tokenVersion: before.tokenVersion,
    });
    // The next OIDC revocation still owns the role transition.
    await updateUserSecurityState(userId, { role: 'USER' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).role).toBe('USER');
  });
  it('rejects invalid multi-operation PATCH without partial state or activity', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const count = await prisma.scimEvent.count({ where: { resourceId: userId } });
    expect(
      (
        await call(
          'users',
          'PATCH',
          patch(
            { op: 'replace', path: 'displayName', value: 'Must roll back' },
            { op: 'replace', path: 'roles', value: ['ADMIN'] }
          ),
          userId
        )
      ).status
    ).toBe(400);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toEqual(before);
    expect(await prisma.scimEvent.count({ where: { resourceId: userId } })).toBe(count);
  });
  it('handles work-email PATCH and PUT profile updates without cosmetic revocation', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const response = await call(
      'users',
      'PATCH',
      patch({
        op: 'replace',
        path: 'emails[type eq "work"].value',
        value: `changed-${Date.now()}@example.test`,
      }),
      userId
    );
    expect(response.status).toBe(200);
    const changed = await response.json();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).tokenVersion).toBe(
      before.tokenVersion + 1
    );
    expect(
      (
        await call(
          'users',
          'PUT',
          {
            userName: changed.userName,
            externalId: changed.externalId,
            displayName: 'New title',
            title: 'Engineer',
            active: true,
          },
          userId
        )
      ).status
    ).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).tokenVersion).toBe(
      before.tokenVersion + 1
    );
  });
  it('rejects access and mutations of unmanaged operational teams', async () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE'])
      expect(
        (
          await call(
            'groups',
            method,
            method === 'PUT'
              ? { displayName: 'Hijacked' }
              : method === 'PATCH'
                ? patch({ op: 'replace', path: 'displayName', value: 'Hijacked' })
                : undefined,
            teamId
          )
        ).status
      ).toBe(404);
    expect(await prisma.team.count({ where: { id: teamId } })).toBe(1);
    expect(await prisma.service.count({ where: { teamId } })).toBe(1);
  });
  it('creates a standalone directory group without adopting a matching team name', async () => {
    const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    const response = await call('groups', 'POST', {
      displayName: team.name,
      externalId: `cert-group-${Date.now()}`,
      members: [{ value: userId }],
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    groupId = body.id;
    expect(groupId).not.toBe(teamId);
    expect(await prisma.scimGroupTeamBinding.count({ where: { groupId } })).toBe(0);
    expect((await call('groups', 'GET', undefined, groupId, '', tokenB)).status).toBe(404);
  });
  it('supports members exclusion and count-zero searches', async () => {
    const response = await call('groups', 'GET', undefined, groupId, '?excludedAttributes=members');
    expect(await response.json()).not.toHaveProperty('members');
    expect(
      await (await call('groups', 'GET', undefined, undefined, '?count=0')).json()
    ).toMatchObject({ Resources: [], itemsPerPage: 0 });
    expect((await call('users', 'GET', undefined, undefined, '?count=1.5')).status).toBe(400);
  });
  it('preserves owner memberships and service associations during replacement', async () => {
    await prisma.$transaction(async tx => {
      await tx.scimGroupTeamBinding.create({ data: { groupId, teamId, approvedBy: ids[0] } });
      await reconcileTeam(tx, teamId);
    });
    expect(await prisma.teamMember.count({ where: { teamId } })).toBe(2);
    expect(
      (await call('groups', 'PATCH', patch({ op: 'replace', path: 'members', value: [] }), groupId))
        .status
    ).toBe(200);
    expect(
      await prisma.teamMember.findMany({ where: { teamId }, select: { userId: true, role: true } })
    ).toEqual([{ userId: ids[0], role: 'OWNER' }]);
    expect(await prisma.service.count({ where: { teamId } })).toBe(1);
  });
  it('rejects unknown members atomically', async () => {
    expect(
      (
        await call(
          'groups',
          'PATCH',
          patch(
            { op: 'replace', path: 'displayName', value: 'Partial' },
            { op: 'add', path: 'members', value: [{ value: 'missing-user' }] }
          ),
          groupId
        )
      ).status
    ).toBe(400);
    expect((await prisma.scimGroup.findUniqueOrThrow({ where: { id: groupId } })).name).not.toBe(
      'Partial'
    );
  });
  it('keeps request order and membership row IDs on no-op synchronization', async () => {
    expect(
      (
        await call(
          'groups',
          'PATCH',
          patch(
            { op: 'add', path: 'members', value: [{ value: userId }] },
            { op: 'remove', path: `members[value eq "${userId}"]` }
          ),
          groupId
        )
      ).status
    ).toBe(200);
    expect(await prisma.scimGroupMembership.count({ where: { groupId } })).toBe(0);
    await call(
      'groups',
      'PATCH',
      patch({ op: 'add', path: 'members', value: [{ value: userId }] }),
      groupId
    );
    const before = await prisma.teamMember.findUniqueOrThrow({
      where: { userId_teamId: { userId, teamId } },
    });
    await call(
      'groups',
      'PATCH',
      patch({ op: 'replace', path: 'members', value: [{ value: userId }] }),
      groupId
    );
    expect(
      await prisma.teamMember.findUniqueOrThrow({ where: { userId_teamId: { userId, teamId } } })
    ).toEqual(before);
  });
  it('preserves an explicit local promotion during subsequent directory replacement', async () => {
    const member = await prisma.teamMember.findUniqueOrThrow({
      where: { userId_teamId: { userId, teamId } },
    });
    await prisma.teamMember.update({
      where: { id: member.id },
      data: { role: 'ADMIN', receiveTeamNotifications: false },
    });
    expect(await prisma.scimTeamGrant.count({ where: { teamMemberId: member.id } })).toBe(0);
    expect(
      (await call('groups', 'PATCH', patch({ op: 'replace', path: 'members', value: [] }), groupId))
        .status
    ).toBe(200);
    expect(await prisma.teamMember.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({
      role: 'ADMIN',
      receiveTeamNotifications: false,
    });
  });
  it('deletes a directory group while preserving independent manual grants and associations', async () => {
    const before = await prisma.teamMember.findMany({ where: { teamId } });
    expect((await call('groups', 'DELETE', undefined, groupId)).status).toBe(204);
    expect(await prisma.teamMember.findMany({ where: { teamId } })).toEqual(before);
    expect(await prisma.service.count({ where: { teamId } })).toBe(1);
  });
  it('deactivates immediately without changing unrelated sessions or recovery accounts', async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: ids[0] } });
    const emergency = await prisma.emergencyAccount.create({
      data: {
        displayName: 'Independent SCIM certification recovery',
        authenticationMethod: 'PASSWORD',
        passwordHash: await hash('Disposable independent recovery fixture!', 6),
        status: 'ACTIVE',
        independenceConfirmedAt: new Date(),
      },
    });
    const emergencySession = await prisma.emergencySession.create({
      data: {
        emergencyAccountId: emergency.id,
        credentialVersion: emergency.credentialVersion,
        tokenHash: hashToken(`disposable-recovery-${emergency.id}`),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const schedule = await prisma.onCallSchedule.create({
      data: { name: `SCIM coverage ${Date.now()}` },
    });
    const shift = await prisma.onCallShift.create({
      data: {
        scheduleId: schedule.id,
        userId,
        start: new Date(),
        end: new Date(Date.now() + 3600000),
      },
    });
    const policy = await prisma.escalationPolicy.create({
      data: {
        name: `SCIM coverage policy ${Date.now()}`,
        steps: { create: { stepOrder: 0, targetUserId: userId, notificationChannels: ['EMAIL'] } },
      },
      include: { steps: true },
    });
    const recovery = await prisma.emergencyAccount.findMany();
    expect((await call('users', 'DELETE', undefined, emergency.id)).status).toBe(404);
    expect(
      (await call('users', 'PATCH', patch({ op: 'replace', path: 'active', value: false }), userId))
        .status
    ).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({
      status: 'DISABLED',
      tokenVersion: before.tokenVersion + 1,
    });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: ids[0] } })).toEqual(owner);
    expect(await prisma.emergencyAccount.findMany()).toEqual(recovery);
    expect(
      await prisma.emergencySession.findUnique({ where: { id: emergencySession.id } })
    ).toEqual(emergencySession);
    expect(await prisma.onCallShift.findUnique({ where: { id: shift.id } })).toEqual(shift);
    expect(
      await prisma.escalationPolicy.findUnique({
        where: { id: policy.id },
        include: { steps: true },
      })
    ).toEqual(policy);
    const warning = await prisma.scimEvent.findFirstOrThrow({
      where: { connectorId: principal.connectorId, resourceId: userId, action: 'user.disabled' },
      orderBy: { createdAt: 'desc' },
    });
    expect(warning.details).toMatchObject({
      operationalImpact: {
        futureShifts: 1,
        directEscalationRules: 1,
        coverageReviewRequired: true,
      },
    });
    const again = await call(
      'users',
      'PATCH',
      patch({ op: 'replace', path: 'active', value: false }),
      userId
    );
    expect(again.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).tokenVersion).toBe(
      before.tokenVersion + 1
    );
  });
  it('retains tombstones on DELETE and rejects automatic rehire adoption', async () => {
    const identity = await prisma.scimIdentity.findUniqueOrThrow({ where: { userId } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect((await call('users', 'DELETE', undefined, userId)).status).toBe(204);
    expect((await call('users', 'GET', undefined, userId)).status).toBe(404);
    expect(
      (await prisma.scimIdentity.findUniqueOrThrow({ where: { userId } })).deletedAt
    ).not.toBeNull();
    expect(
      (await call('users', 'POST', { userName: user.email, externalId: identity.externalId }))
        .status
    ).toBe(409);
  });
  it('requires explicit active true after disable and removes old grants permanently on DELETE and rehire', async () => {
    const created = await (
      await call('users', 'POST', {
        userName: `rehire-${Date.now()}@example.test`,
        externalId: `rehire-${Date.now()}`,
      })
    ).json();
    const directory = await prisma.scimGroup.create({
      data: {
        connectorId: 'cert-a',
        name: 'Rehire team',
        memberships: { create: { userId: created.id } },
        bindings: { create: { teamId, approvedBy: ids[0] } },
      },
    });
    await prisma.$transaction(tx => reconcileTeam(tx, teamId));
    expect(
      (
        await call(
          'users',
          'PATCH',
          patch({ op: 'replace', path: 'active', value: false }),
          created.id
        )
      ).status
    ).toBe(200);
    for (const active of [undefined, false]) {
      const response = await call(
        'users',
        'PUT',
        {
          userName: created.userName,
          displayName: 'Profile only',
          ...(active === undefined ? {} : { active }),
        },
        created.id
      );
      expect(response.status).toBe(200);
      expect((await response.json()).active).toBe(false);
    }
    expect(
      (await call('users', 'PUT', { userName: created.userName, active: true }, created.id)).status
    ).toBe(200);
    expect((await call('users', 'DELETE', undefined, created.id)).status).toBe(204);
    expect(await prisma.scimGroupMembership.count({ where: { userId: created.id } })).toBe(0);
    expect(await prisma.teamMember.count({ where: { teamId, userId: created.id } })).toBe(0);
    vi.mocked(getControlActor).mockResolvedValue({ kind: 'admin', id: ids[0] } as Awaited<
      ReturnType<typeof getControlActor>
    >);
    expect(await restoreScimIdentityAction({ id: created.id })).toBeUndefined();
    expect((await call('users', 'PUT', { userName: created.userName }, created.id)).status).toBe(
      200
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).status).toBe(
      'DISABLED'
    );
    expect(
      (
        await call(
          'users',
          'PATCH',
          patch({ op: 'replace', path: 'active', value: true }),
          created.id
        )
      ).status
    ).toBe(200);
    expect(await prisma.teamMember.count({ where: { teamId, userId: created.id } })).toBe(0);
    expect(
      (
        await call(
          'groups',
          'PATCH',
          patch({ op: 'replace', path: 'displayName', value: 'No stale references' }),
          directory.id
        )
      ).status
    ).toBe(200);
    expect(
      (
        await call(
          'groups',
          'PATCH',
          patch({ op: 'add', path: 'members', value: [{ value: created.id }] }),
          directory.id
        )
      ).status
    ).toBe(200);
    expect(await prisma.teamMember.count({ where: { teamId, userId: created.id } })).toBe(1);
  });
  it('requires explicit selection to adopt matching legacy membership provenance without replacing rows', async () => {
    const directoryUsers: Array<{ id: string }> = [];
    for (const label of ['adopted', 'manual'])
      directoryUsers.push(
        await prisma.user.create({
          data: { name: label, email: `${label}-legacy-${Date.now()}@example.test` },
        })
      );
    const team = await prisma.team.create({
      data: {
        name: `Legacy adoption ${Date.now()}`,
        scimExternalId: `legacy-adopt-${Date.now()}`,
        members: {
          create: [
            { userId: ids[0], role: 'OWNER' },
            ...directoryUsers.map(user => ({ userId: user.id, role: 'MEMBER' as const })),
          ],
        },
      },
      include: { members: true },
    });
    await prisma.scimConnector.upsert({
      where: { id: 'legacy' },
      create: { id: 'legacy', name: 'Legacy' },
      update: {},
    });
    const directory = await prisma.scimGroup.create({
      data: {
        id: team.id,
        connectorId: 'legacy',
        name: team.name,
        scimExternalId: team.scimExternalId,
        memberships: { create: directoryUsers.map(user => ({ userId: user.id })) },
      },
    });
    vi.mocked(getControlActor).mockResolvedValue({ kind: 'admin', id: ids[0] } as Awaited<
      ReturnType<typeof getControlActor>
    >);
    const selected = team.members.find(member => member.userId === directoryUsers[0].id)!;
    const preview = await previewScimBindingAction({
      groupId: directory.id,
      teamId: team.id,
      adoptMemberIds: [selected.id],
    });
    if ('scimError' in preview) throw new Error(preview.scimError);
    expect(preview.adoptedMemberships).toBe(1);
    expect(
      await approveScimBindingAction({
        groupId: directory.id,
        teamId: team.id,
        adoptMemberIds: [],
        revision: preview.revision,
      })
    ).toMatchObject({ scimError: expect.stringContaining('changed') });
    expect(await prisma.scimGroupTeamBinding.count({ where: { groupId: directory.id } })).toBe(0);

    expect(
      await approveScimBindingAction({
        groupId: directory.id,
        teamId: team.id,
        adoptMemberIds: [selected.id],
        revision: preview.revision,
      })
    ).toBeUndefined();
    expect(await prisma.teamMember.findUnique({ where: { id: selected.id } })).toEqual(selected);
    expect(await prisma.scimTeamGrant.count({ where: { teamMemberId: selected.id } })).toBe(1);
    await prisma.$transaction(async tx => {
      await tx.scimGroupMembership.deleteMany({ where: { groupId: directory.id } });
      await reconcileTeam(tx, team.id);
    });
    expect(
      await prisma.teamMember.count({ where: { teamId: team.id, userId: directoryUsers[0].id } })
    ).toBe(0);
    expect(
      await prisma.teamMember.count({ where: { teamId: team.id, userId: directoryUsers[1].id } })
    ).toBe(1);
    expect(await prisma.teamMember.count({ where: { teamId: team.id, role: 'OWNER' } })).toBe(1);
  });
  it('aggregates drift against every bound source without classifying manual members as directory grants', async () => {
    const connector = await prisma.scimConnector.create({
      data: { name: 'Aggregate drift semantics' },
    });
    const members = await Promise.all(
      ['manual', 'unexpected', 'other-source', 'missing'].map(label =>
        prisma.user.create({
          data: { email: `${label}-${connector.id}@example.test`, name: label },
        })
      )
    );
    const team = await prisma.team.create({
      data: {
        name: `Aggregate drift ${connector.id}`,
        members: {
          create: [
            { userId: ids[0], role: 'OWNER' },
            ...members.slice(0, 3).map(user => ({ userId: user.id, role: 'MEMBER' as const })),
          ],
        },
      },
      include: { members: true },
    });
    const group = await prisma.scimGroup.create({
      data: {
        connectorId: connector.id,
        name: 'Primary source',
        memberships: { create: [members[0], members[3]].map(user => ({ userId: user.id })) },
      },
    });
    const other = await prisma.scimGroup.create({
      data: {
        connectorId: 'cert-b',
        name: 'Other source',
        memberships: { create: { userId: members[2].id } },
      },
    });
    const binding = await prisma.scimGroupTeamBinding.create({
      data: { groupId: group.id, teamId: team.id, approvedBy: ids[0] },
    });
    await prisma.scimGroupTeamBinding.create({
      data: { groupId: other.id, teamId: team.id, approvedBy: ids[0] },
    });
    await prisma.scimTeamGrant.createMany({
      data: [members[1], members[2]].map(user => ({
        bindingId: binding.id,
        userId: user.id,
        teamMemberId: team.members.find(member => member.userId === user.id)!.id,
      })),
    });
    expect(await scimDriftAction({ connectorId: connector.id, page: 1 })).toMatchObject([
      {
        groupId: group.id,
        missingMembers: 1,
        unexpectedDirectoryGrants: 1,
        independentManualMembers: 2,
      },
    ]);
    await prisma.scimGroupMembership.deleteMany({ where: { groupId: other.id } });
    expect(await scimDriftAction({ connectorId: connector.id, page: 1 })).toMatchObject([
      { unexpectedDirectoryGrants: 2 },
    ]);
    expect(await scimDriftAction({ connectorId: connector.id, page: 2 })).toEqual([]);
  });
  it('preserves a disabled connector while issuing a fresh credential', async () => {
    const connector = await prisma.scimConnector.create({
      data: { name: 'Disabled rotation', enabled: false },
    });
    vi.mocked(getControlActor).mockResolvedValue({ kind: 'admin', id: ids[0] } as Awaited<
      ReturnType<typeof getControlActor>
    >);
    const credential = await createScimCredentialAction({
      connectorId: connector.id,
      name: 'Does not enable',
      scopes: ['users:read'],
      lifetimeDays: 1,
      overlapMinutes: 0,
    });
    if ('scimError' in credential) throw new Error(credential.scimError);
    expect(
      (await prisma.scimConnector.findUniqueOrThrow({ where: { id: connector.id } })).enabled
    ).toBe(false);
    expect(await authenticate(`Bearer ${credential.token}`)).toBeNull();
  });
  it('fences a write already admitted before connector disablement', async () => {
    const credential = await prisma.scimCredential.findUniqueOrThrow({
      where: { id: 'cert-key-a' },
    });
    const admitted = {
      connectorId: 'cert-a',
      credentialId: credential.id,
      scopes: credential.scopes,
    };
    await prisma.scimConnector.update({ where: { id: 'cert-a' }, data: { enabled: false } });
    try {
      const { recheck } = await import('@/lib/scim/security/credentials');
      await expect(prisma.$transaction(tx => recheck(tx, admitted))).rejects.toMatchObject({
        status: 401,
      });
    } finally {
      await prisma.scimConnector.update({ where: { id: 'cert-a' }, data: { enabled: true } });
    }
  });
  it('rolls back user tombstone and directory grant cleanup when deletion audit fails', async () => {
    const created = await (
      await call('users', 'POST', {
        userName: `delete-atomic-${Date.now()}@example.test`,
        externalId: `delete-atomic-${Date.now()}`,
      })
    ).json();
    const directory = await prisma.scimGroup.create({
      data: {
        connectorId: 'cert-a',
        name: 'Atomic user delete',
        memberships: { create: { userId: created.id } },
        bindings: { create: { teamId, approvedBy: ids[0] } },
      },
    });
    await prisma.$transaction(tx => reconcileTeam(tx, teamId));
    const before = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION scim_cert_fail_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'user.deleted' THEN RAISE EXCEPTION 'isolated user deletion certification'; END IF; RETURN NEW; END $$`
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER scim_cert_fail_user_delete BEFORE INSERT ON "ScimEvent" FOR EACH ROW EXECUTE FUNCTION scim_cert_fail_user_delete()'
    );
    try {
      expect((await call('users', 'DELETE', undefined, created.id)).status).toBe(503);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).toEqual(before);
      expect(
        (await prisma.scimIdentity.findUniqueOrThrow({ where: { userId: created.id } })).deletedAt
      ).toBeNull();
      expect(
        await prisma.scimGroupMembership.count({
          where: { groupId: directory.id, userId: created.id },
        })
      ).toBe(1);
      expect(await prisma.teamMember.count({ where: { teamId, userId: created.id } })).toBe(1);
      expect(await prisma.scimTeamGrant.count({ where: { userId: created.id } })).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER scim_cert_fail_user_delete ON "ScimEvent"');
      await prisma.$executeRawUnsafe('DROP FUNCTION scim_cert_fail_user_delete()');
    }
  });
  it('preserves invited account status during profile-only PUT and PATCH', async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Invited directory account',
        email: `invited-scim-${Date.now()}@example.test`,
        status: 'INVITED',
        scimIdentities: { create: { connectorId: 'cert-a', externalId: `invited-${Date.now()}` } },
      },
    });
    expect(
      (
        await call(
          'users',
          'PUT',
          { userName: user.email, displayName: 'Updated invited' },
          user.id
        )
      ).status
    ).toBe(200);
    expect(
      (
        await call(
          'users',
          'PATCH',
          patch({ op: 'replace', path: 'title', value: 'Profile only' }),
          user.id
        )
      ).status
    ).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      status: 'INVITED',
      tokenVersion: user.tokenVersion,
    });
    expect((await (await call('users', 'GET', undefined, user.id)).json()).active).toBe(false);
  });
  it('prevents duplicate identities across concurrent requests/connections', async () => {
    const externalId = `concurrent-${Date.now()}`;
    const payload = { userName: `${externalId}@example.test`, externalId };
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => call('users', 'POST', payload))
    );
    expect(responses.filter(r => r.status === 201)).toHaveLength(1);
    expect(responses.filter(r => r.status === 409)).toHaveLength(5);
    expect(await prisma.scimIdentity.count({ where: { connectorId: 'cert-a', externalId } })).toBe(
      1
    );
  });
  it('enforces expiry/revocation using a separate database client', async () => {
    const replica = new PrismaClient();
    try {
      await replica.scimCredential.update({
        where: { id: 'cert-key-b' },
        data: { expiresAt: new Date(0) },
      });
      expect(await authenticate(`Bearer ${tokenB}`)).toBeNull();
      await replica.scimCredential.update({
        where: { id: 'cert-key-b' },
        data: { expiresAt: new Date(Date.now() + 86400000), revokedAt: new Date() },
      });
      expect(await authenticate(`Bearer ${tokenB}`)).toBeNull();
    } finally {
      await replica.$disconnect();
    }
  });
  it('keeps last-administrator invariants under the SCIM security boundary', async () => {
    const snapshot = await prisma.user.findUniqueOrThrow({ where: { id: ids[0] } });
    await expect(
      prisma.$transaction(
        async tx => {
          await tx.user.updateMany({
            where: { role: 'ADMIN', id: { not: ids[0] } },
            data: { status: 'DISABLED' },
          });
          await updateUserSecurityState(
            ids[0],
            { status: 'DISABLED' },
            {},
            undefined,
            undefined,
            undefined,
            tx
          );
        },
        { isolationLevel: 'Serializable' }
      )
    ).rejects.toThrow(/no active administrators/i);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: ids[0] } })).toEqual(snapshot);
  });
  it('rotates with bounded overlap and immediately revokes a verified replacement', async () => {
    vi.mocked(getControlActor).mockResolvedValue({
      kind: 'admin',
      id: ids[0],
      tokenVersion: 0,
      authenticatedAt: Date.now(),
    });
    const replacement = await createScimCredentialAction({
      connectorId: 'cert-a',
      name: 'Replacement certification',
      scopes: ['users:read'],
      lifetimeDays: 30,
      overlapMinutes: 60,
    });
    if ('scimError' in replacement) throw new Error(replacement.scimError);
    expect(getControlActor).toHaveBeenCalledWith(true);
    expect(await authenticate(`Bearer ${replacement.token}`)).toMatchObject({
      connectorId: 'cert-a',
      scopes: ['users:read'],
    });
    expect(await authenticate(`Bearer ${token}`)).not.toBeNull();
    const old = await prisma.scimCredential.findUniqueOrThrow({ where: { id: 'cert-key-a' } });
    expect(old.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3600000);
    expect(
      (
        await call(
          'users',
          'POST',
          { userName: 'denied@example.test', externalId: 'denied' },
          undefined,
          '',
          replacement.token
        )
      ).status
    ).toBe(403);
    await revokeScimCredentialAction(replacement.id);
    expect(await authenticate(`Bearer ${replacement.token}`)).toBeNull();
  });
  it('rejects credential mutations when fresh authentication is unavailable', async () => {
    vi.mocked(getControlActor).mockRejectedValueOnce(
      new Error('Sign in again before this operation.')
    );
    const count = await prisma.scimCredential.count({ where: { connectorId: 'cert-a' } });
    await expect(
      createScimCredentialAction({
        connectorId: 'cert-a',
        name: 'Denied',
        scopes: ['users:read'],
        lifetimeDays: 30,
        overlapMinutes: 60,
      })
    ).resolves.toMatchObject({ scimError: expect.stringMatching(/sign in again/i) });
    expect(await prisma.scimCredential.count({ where: { connectorId: 'cert-a' } })).toBe(count);
  });
  it('rolls back a user mutation if its mandatory audit event cannot commit', async () => {
    const response = await call('users', 'POST', {
      userName: `audit-rollback-${Date.now()}@example.test`,
      externalId: `audit-rollback-${Date.now()}`,
    });
    const created = await response.json();
    const before = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    await prisma.$executeRawUnsafe(
      `CREATE OR REPLACE FUNCTION scim_cert_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'user.updated' THEN RAISE EXCEPTION 'isolated certification injected failure'; END IF; RETURN NEW; END $$`
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER scim_cert_fail_audit BEFORE INSERT ON "ScimEvent" FOR EACH ROW EXECUTE FUNCTION scim_cert_fail_audit()`
    );
    try {
      expect(
        (
          await call(
            'users',
            'PATCH',
            patch({ op: 'replace', path: 'displayName', value: 'Must not commit' }),
            created.id
          )
        ).status
      ).toBe(503);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).toEqual(before);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER scim_cert_fail_audit ON "ScimEvent"');
      await prisma.$executeRawUnsafe('DROP FUNCTION scim_cert_fail_audit()');
    }
  });

  it('allows separately authorized privacy erasure without dangling directory memberships', async () => {
    const response = await call('users', 'POST', {
      userName: `privacy-${Date.now()}@example.test`,
      externalId: `privacy-${Date.now()}`,
    });
    const created = await response.json();
    const group = await prisma.scimGroup.create({
      data: {
        connectorId: 'cert-a',
        name: 'Privacy fixture',
        memberships: { create: { userId: created.id } },
      },
    });
    await prisma.user.delete({ where: { id: created.id } });
    expect(await prisma.scimIdentity.count({ where: { userId: created.id } })).toBe(0);
    expect(await prisma.scimGroupMembership.count({ where: { groupId: group.id } })).toBe(0);
    expect(await prisma.scimGroup.count({ where: { id: group.id } })).toBe(1);
  });
  it('enforces configurable profile authority without rejecting lifecycle-only changes', async () => {
    const response = await call('users', 'POST', {
      userName: `authority-${Date.now()}@example.test`,
      externalId: `authority-${Date.now()}`,
      title: 'Manual title',
    });
    const created = await response.json();
    await prisma.scimConnector.update({
      where: { id: 'cert-a' },
      data: { profileFields: ['name', 'email', 'photos'] },
    });
    try {
      expect(
        (
          await call(
            'users',
            'PATCH',
            patch({ op: 'replace', path: 'title', value: 'Directory takeover' }),
            created.id
          )
        ).status
      ).toBe(400);
      expect(
        (
          await call(
            'users',
            'PATCH',
            patch({ op: 'replace', path: 'active', value: false }),
            created.id
          )
        ).status
      ).toBe(200);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
        jobTitle: 'Manual title',
        status: 'DISABLED',
      });
    } finally {
      await prisma.scimConnector.update({
        where: { id: 'cert-a' },
        data: { profileFields: ['name', 'email', 'title', 'department', 'photos'] },
      });
    }
  });
  it('reconciles the union of independently approved directory groups', async () => {
    const response = await call('users', 'POST', {
      userName: `union-${Date.now()}@example.test`,
      externalId: `union-${Date.now()}`,
    });
    const created = await response.json();
    const directoryGroups = await Promise.all(
      ['A', 'B'].map(label =>
        prisma.scimGroup.create({
          data: {
            connectorId: 'cert-a',
            name: `Union ${label}`,
            memberships: { create: { userId: created.id } },
            bindings: { create: { teamId, approvedBy: ids[0] } },
          },
        })
      )
    );
    await prisma.$transaction(tx => reconcileTeam(tx, teamId));
    expect(
      (
        await call(
          'groups',
          'PATCH',
          patch({ op: 'replace', path: 'members', value: [] }),
          directoryGroups[0].id
        )
      ).status
    ).toBe(200);
    expect(await prisma.teamMember.count({ where: { teamId, userId: created.id } })).toBe(1);
    expect(
      (
        await call(
          'groups',
          'PATCH',
          patch({ op: 'replace', path: 'members', value: [] }),
          directoryGroups[1].id
        )
      ).status
    ).toBe(200);
    expect(await prisma.teamMember.count({ where: { teamId, userId: created.id } })).toBe(0);
  });

  it('revokes solely owned grants on group DELETE, including notification-edited members', async () => {
    const created = await (
      await call('users', 'POST', {
        userName: `delete-grant-${Date.now()}@example.test`,
        externalId: `delete-grant-${Date.now()}`,
      })
    ).json();
    const directory = await prisma.scimGroup.create({
      data: {
        connectorId: 'cert-a',
        name: 'Delete revocation',
        memberships: { create: { userId: created.id } },
        bindings: { create: { teamId, approvedBy: ids[0] } },
      },
    });
    await prisma.$transaction(tx => reconcileTeam(tx, teamId));
    const member = await prisma.teamMember.findUniqueOrThrow({
      where: { userId_teamId: { userId: created.id, teamId } },
    });
    await prisma.teamMember.update({
      where: { id: member.id },
      data: { receiveTeamNotifications: false },
    });
    expect(await prisma.scimTeamGrant.count({ where: { teamMemberId: member.id } })).toBe(1);
    await prisma.team.update({ where: { id: teamId }, data: { teamLeadId: created.id } });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect((await call('groups', 'DELETE', undefined, directory.id)).status).toBe(204);
    expect(await prisma.teamMember.count({ where: { teamId, userId: created.id } })).toBe(0);
    expect(await prisma.scimTeamGrant.count({ where: { teamMemberId: member.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).tokenVersion).toBe(
      before.tokenVersion + 1
    );
    expect((await prisma.team.findUniqueOrThrow({ where: { id: teamId } })).teamLeadId).toBeNull();
    expect(await prisma.service.count({ where: { teamId } })).toBe(1);
    const audit = await prisma.scimEvent.findFirstOrThrow({
      where: { resourceId: directory.id, action: 'group.deleted' },
    });
    expect(audit.details).toMatchObject({
      policy: 'REVOKE_DIRECTORY_GRANTS',
      teams: [{ teamId, revokedMemberships: 1, coverageReviewRequired: true }],
    });
  });
  it('transfers another group grant on DELETE and revokes on the final administrative detach', async () => {
    const created = await (
      await call('users', 'POST', {
        userName: `detach-grant-${Date.now()}@example.test`,
        externalId: `detach-grant-${Date.now()}`,
      })
    ).json();
    const directoryGroups = [];
    for (const label of ['A', 'B'])
      directoryGroups.push(
        await prisma.scimGroup.create({
          data: {
            connectorId: 'cert-a',
            name: `Detach union ${label}`,
            memberships: { create: { userId: created.id } },
            bindings: { create: { teamId, approvedBy: ids[0] } },
          },
          include: { bindings: true },
        })
      );
    await prisma.$transaction(tx => reconcileTeam(tx, teamId));
    const grant = await prisma.scimTeamGrant.findFirstOrThrow({ where: { userId: created.id } });
    const owningGroup = directoryGroups.find(group => group.bindings[0].id === grant.bindingId)!;
    const survivingGroup = directoryGroups.find(group => group.id !== owningGroup.id)!;
    const before = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect((await call('groups', 'DELETE', undefined, owningGroup.id)).status).toBe(204);
    expect(await prisma.teamMember.count({ where: { teamId, userId: created.id } })).toBe(1);
    expect(
      (await prisma.scimTeamGrant.findFirstOrThrow({ where: { userId: created.id } })).bindingId
    ).toBe(survivingGroup.bindings[0].id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).tokenVersion).toBe(
      before.tokenVersion
    );
    vi.mocked(getControlActor).mockResolvedValue({ kind: 'admin', id: ids[0] } as Awaited<
      ReturnType<typeof getControlActor>
    >);
    expect(await detachScimBindingAction({ groupId: survivingGroup.id, teamId })).toBeUndefined();
    expect(await prisma.teamMember.count({ where: { teamId, userId: created.id } })).toBe(0);
    expect(await prisma.scimGroup.count({ where: { id: survivingGroup.id } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).tokenVersion).toBe(
      before.tokenVersion + 1
    );
  });
  it('preserves pre-existing manual members and actual role promotions when deleting their directory group', async () => {
    const users = [];
    for (const label of ['manual', 'promoted'])
      users.push(
        await (
          await call('users', 'POST', {
            userName: `${label}-preservation-${Date.now()}@example.test`,
            externalId: `${label}-preservation-${Date.now()}`,
          })
        ).json()
      );
    const manual = await prisma.teamMember.create({
      data: { teamId, userId: users[0].id, role: 'MEMBER' },
    });
    const directory = await prisma.scimGroup.create({
      data: {
        connectorId: 'cert-a',
        name: 'Manual grant preservation',
        memberships: { create: users.map(user => ({ userId: user.id })) },
        bindings: { create: { teamId, approvedBy: ids[0] } },
      },
    });
    await prisma.$transaction(tx => reconcileTeam(tx, teamId));
    const promoted = await prisma.teamMember.update({
      where: { userId_teamId: { teamId, userId: users[1].id } },
      data: { role: 'ADMIN' },
    });
    const before = await prisma.user.findMany({
      where: { id: { in: users.map(user => user.id) } },
      orderBy: { id: 'asc' },
    });
    expect((await call('groups', 'DELETE', undefined, directory.id)).status).toBe(204);
    expect(await prisma.teamMember.findUnique({ where: { id: manual.id } })).toEqual(manual);
    expect(await prisma.teamMember.findUnique({ where: { id: promoted.id } })).toEqual(promoted);
    expect(
      await prisma.user.findMany({
        where: { id: { in: users.map(user => user.id) } },
        orderBy: { id: 'asc' },
      })
    ).toEqual(before);
    expect(await prisma.teamMember.count({ where: { teamId, role: 'OWNER' } })).toBe(1);
  });
  it('rolls back group deletion and access revocation when its audit fails', async () => {
    const created = await (
      await call('users', 'POST', {
        userName: `delete-rollback-${Date.now()}@example.test`,
        externalId: `delete-rollback-${Date.now()}`,
      })
    ).json();
    const directory = await prisma.scimGroup.create({
      data: {
        connectorId: 'cert-a',
        name: 'Delete rollback',
        memberships: { create: { userId: created.id } },
        bindings: { create: { teamId, approvedBy: ids[0] } },
      },
    });
    await prisma.$transaction(tx => reconcileTeam(tx, teamId));
    const before = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION scim_cert_fail_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'group.deleted' THEN RAISE EXCEPTION 'isolated delete certification failure'; END IF; RETURN NEW; END $$`
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER scim_cert_fail_delete BEFORE INSERT ON "ScimEvent" FOR EACH ROW EXECUTE FUNCTION scim_cert_fail_delete()'
    );
    try {
      expect((await call('groups', 'DELETE', undefined, directory.id)).status).toBe(503);
      expect(await prisma.teamMember.count({ where: { teamId, userId: created.id } })).toBe(1);
      expect(await prisma.scimGroup.count({ where: { id: directory.id } })).toBe(1);
      expect(await prisma.scimTeamGrant.count({ where: { userId: created.id } })).toBe(1);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).toEqual(before);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER scim_cert_fail_delete ON "ScimEvent"');
      await prisma.$executeRawUnsafe('DROP FUNCTION scim_cert_fail_delete()');
    }
  });

  it('keeps OIDC profile synchronization from overwriting directory-owned fields or preserving a withdrawn role', async () => {
    const response = await call('users', 'POST', {
      userName: `oidc-authority-${Date.now()}@example.test`,
      externalId: `oidc-authority-${Date.now()}`,
      title: 'Directory title',
      'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
        department: 'Directory department',
      },
    });
    const created = await response.json();
    await updateUserSecurityState(created.id, { role: 'ADMIN', roleSource: 'OIDC' });
    await prisma.$transaction(
      async tx => {
        const update: Record<string, unknown> = {
          department: 'OIDC overwrite',
          jobTitle: 'OIDC overwrite',
          lastOidcSync: new Date(),
        };
        await preserveScimOwnedOidcFields(tx, created.id, update);
        expect(update).toEqual({});
        await updateUserSecurityState(
          created.id,
          { role: 'USER', tokenVersion: { increment: 1 } },
          update,
          undefined,
          undefined,
          undefined,
          tx
        );
      },
      { isolationLevel: 'Serializable' }
    );
    expect(await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      role: 'USER',
      roleSource: 'OIDC',
      jobTitle: 'Directory title',
      department: 'Directory department',
    });
  });
  it('fences legacy database and environment authentication when moving to registry credentials', async () => {
    const legacySecret = 'legacy-database-certification-secret-0000000000001';
    await prisma.scimConnector.update({
      where: { id: 'legacy' },
      data: { enabled: true, credentialAuthority: 'LEGACY' },
    });
    await prisma.systemConfig.upsert({
      where: { key: 'scim_configuration' },
      create: {
        key: 'scim_configuration',
        value: { enabled: true, secretTokenHash: hashToken(legacySecret) },
      },
      update: { value: { enabled: true, secretTokenHash: hashToken(legacySecret) } },
    });
    expect(await authenticate(`Bearer ${legacySecret}`)).toMatchObject({ connectorId: 'legacy' });
    const priorCredentials = await prisma.scimCredential.count({
      where: { connectorId: 'legacy' },
    });
    expect(
      await createScimCredentialAction({
        connectorId: 'legacy',
        name: 'Unacknowledged cutover',
        scopes: ['users:read'],
        lifetimeDays: 30,
        overlapMinutes: 60,
      })
    ).toMatchObject({ scimError: expect.stringContaining('acknowledgement') });
    expect(await prisma.scimCredential.count({ where: { connectorId: 'legacy' } })).toBe(
      priorCredentials
    );
    expect(await authenticate(`Bearer ${legacySecret}`)).not.toBeNull();
    const replacement = await createScimCredentialAction({
      connectorId: 'legacy',
      acknowledgeLegacyCutover: true,
      name: 'Legacy migration',
      scopes: ['users:read'],
      lifetimeDays: 30,
      overlapMinutes: 60,
    });
    if ('scimError' in replacement) throw new Error(replacement.scimError);
    expect(await authenticate(`Bearer ${legacySecret}`)).toBeNull();
    expect(await authenticate(`Bearer ${replacement.token}`)).toMatchObject({
      connectorId: 'legacy',
    });
    expect(
      (await prisma.systemConfig.findUniqueOrThrow({ where: { key: 'scim_configuration' } })).value
    ).toEqual({ enabled: false, migratedToRegistry: true });
  });
});
