// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import prisma from '@/lib/prisma';
import { getControlActor } from '@/lib/auth-control/actor';
import {
  createScimCredentialAction,
  revokeScimCredentialAction,
} from '@/app/(app)/settings/system/scim-actions';
import { hashToken, authenticate } from '@/lib/scim/security/credentials';
import { handle } from '@/lib/scim/protocol/http';
import { users } from '@/lib/scim/lifecycle/users';
import { groups } from '@/lib/scim/lifecycle/groups';
import { preserveScimOwnedOidcFields } from '@/lib/scim/lifecycle/oidc-profile';
import { reconcileTeam } from '@/lib/scim/lifecycle/membership';
import { updateUserSecurityState } from '@/lib/users/admin-invariants';

const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
// Ordinary HTTP authorization and PostgreSQL mutations remain real; UI actor checks are tested separately.
vi.mock('@/lib/auth-control/actor', () => ({
  getControlActor: vi.fn(),
  lockControlActor: vi.fn(),
}));
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
  it('deletes directory group and retains all operational associations and members', async () => {
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
    const replacement = await createScimCredentialAction({
      connectorId: 'legacy',
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
