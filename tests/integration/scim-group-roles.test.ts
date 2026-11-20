// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { hashToken } from '@/lib/scim/security/credentials';
import { handle } from '@/lib/scim/protocol/http';
import { users } from '@/lib/scim/lifecycle/users';
import { groups } from '@/lib/scim/lifecycle/groups';
import { getControlActor } from '@/lib/auth-control/actor';
import {
  getScimRoleMappingAction,
  previewScimRoleMappingAction,
  saveScimRoleMappingAction,
} from '@/app/(app)/settings/system/scim-role-actions';
import { evaluateOidcRoleClaims, resolveSignInRole } from '@/lib/oidc/role-mapping';

vi.mock('@/lib/auth-control/actor', () => ({
  getControlActor: vi.fn(),
  lockControlActor: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({ assertAdmin: vi.fn() }));
const suite =
  process.env.SCIM_CERTIFICATION === '1' && process.env.VITEST_USE_REAL_DB === '1'
    ? describe
    : describe.skip;
const token = `scim-role-test-${crypto.randomUUID()}`;
let connectorId: string;
let otherConnectorId: string;
let adminId: string;
let sequence = 0;
function call(resource: 'Users' | 'Groups', method: string, body?: unknown, id?: string) {
  const request = new NextRequest(`https://ops.test/api/scim/v2/${resource}${id ? `/${id}` : ''}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/scim+json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return handle(() => (resource === 'Users' ? users(request, id) : groups(request, id)));
}
async function person() {
  const response = await call('Users', 'POST', {
    userName: `scim-role-${token}-${sequence++}@example.test`,
    externalId: `u-${sequence}`,
  });
  expect(response.status).toBe(201);
  return (await response.json()).id as string;
}
async function group(userIds: string[] = []) {
  const response = await call('Groups', 'POST', {
    displayName: `Role group ${sequence++}`,
    externalId: `g-${sequence}`,
    members: userIds.map(value => ({ value })),
  });
  expect(response.status).toBe(201);
  return (await response.json()).id as string;
}
async function map(groupId: string, role: 'ADMIN' | 'RESPONDER' | 'AUDITOR' | 'USER' | null) {
  const input = { connectorId, groupId, role };
  const preview = await previewScimRoleMappingAction(input);
  if ('scimError' in preview) throw new Error(preview.scimError);
  const result = await saveScimRoleMappingAction({ ...input, revision: preview.revision });
  return result;
}
const account = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });
const members = (id: string, userIds: string[]) =>
  call(
    'Groups',
    'PATCH',
    {
      Operations: [{ op: 'replace', path: 'members', value: userIds.map(value => ({ value })) }],
    },
    id
  );

suite('SCIM group system roles through real provisioning and PostgreSQL', () => {
  beforeAll(async () => {
    if (new URL(process.env.DATABASE_URL!).pathname !== '/enterprise_scim_test')
      throw new Error('Use only the isolated enterprise_scim_test database.');
    connectorId = (await prisma.scimConnector.create({ data: { name: token, provider: 'ENTRA' } }))
      .id;
    otherConnectorId = (await prisma.scimConnector.create({ data: { name: `${token}-other` } })).id;
    adminId = (
      await prisma.user.create({
        data: {
          email: `${token}-admin@example.test`,
          name: 'Role mapping administrator',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      })
    ).id;
    vi.mocked(getControlActor).mockResolvedValue({
      kind: 'admin',
      id: adminId,
      tokenVersion: 0,
      authenticatedAt: Date.now(),
    });
    await prisma.scimCredential.create({
      data: {
        connectorId,
        name: 'Test',
        tokenHash: hashToken(token),
        tokenHint: token.slice(-4),
        createdBy: adminId,
        scopes: ['users:read', 'users:write', 'groups:read', 'groups:write'],
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('preserves upgraded legacy SCIM roles through routine unmapped PATCH, PUT and deletion', async () => {
    for (const role of ['ADMIN', 'RESPONDER', 'AUDITOR'] as const) {
      const id = await person();
      await prisma.user.update({ where: { id }, data: { role, roleSource: 'SCIM' } });
      const before = await account(id);
      expect(before.scimRoleMappingAdopted).toBe(false);
      const directory = await group([id]);
      expect((await members(directory, [id])).status).toBe(200);
      expect(
        (
          await call(
            'Groups',
            'PUT',
            { displayName: 'Unmapped legacy group', members: [{ value: id }] },
            directory
          )
        ).status
      ).toBe(200);
      expect((await call('Groups', 'DELETE', undefined, directory)).status).toBe(204);
      expect(await account(id)).toMatchObject({
        role,
        roleSource: 'SCIM',
        scimRoleMappingAdopted: false,
        tokenVersion: before.tokenVersion,
        mcpRevocationVersion: before.mcpRevocationVersion,
      });
      expect(
        await prisma.scimEvent.count({ where: { resourceId: id, action: 'user.role.synced' } })
      ).toBe(0);
      // Historical SSO takeover is preserved until an administrator-approved mapping adopts it.
      expect(
        resolveSignInRole(
          evaluateOidcRoleClaims({ groups: ['responders'] }, [
            { claim: 'groups', value: 'responders', role: 'RESPONDER' },
          ]),
          await account(id)
        )
      ).toMatchObject({ role: 'RESPONDER', roleSource: 'OIDC', changed: true });
    }
  });

  it('explicitly adopts a same-role legacy account and subsequently revokes only its mapped grant', async () => {
    const id = await person();
    await prisma.user.update({ where: { id }, data: { role: 'RESPONDER', roleSource: 'SCIM' } });
    const directory = await group([id]);
    const before = await account(id);
    expect(
      await previewScimRoleMappingAction({ connectorId, groupId: directory, role: 'RESPONDER' })
    ).toMatchObject({ changedUsers: 1, adoptedUsers: 1 });
    expect(await map(directory, 'RESPONDER')).toEqual({ changedUsers: 1 });
    expect(await account(id)).toMatchObject({
      role: 'RESPONDER',
      roleSource: 'SCIM',
      scimRoleMappingAdopted: true,
      tokenVersion: before.tokenVersion + 1,
      mcpRevocationVersion: before.mcpRevocationVersion,
    });
    expect((await members(directory, [])).status).toBe(200);
    expect(await account(id)).toMatchObject({
      role: 'USER',
      roleSource: 'SCIM',
      scimRoleMappingAdopted: true,
    });
  });

  it('requires explicit opt-in, previews authority takeover, and applies roles without sign-in', async () => {
    const id = await person();
    const groupId = await group([id]);
    expect(await account(id)).toMatchObject({
      role: 'USER',
      roleSource: 'MANUAL',
      tokenVersion: 0,
    });
    const preview = await previewScimRoleMappingAction({ connectorId, groupId, role: 'RESPONDER' });
    expect(preview).toMatchObject({ members: 1, changedUsers: 1, adoptedUsers: 1 });
    expect(await map(groupId, 'RESPONDER')).toEqual({ changedUsers: 1 });
    const user = await account(id);
    expect(user).toMatchObject({ role: 'RESPONDER', roleSource: 'SCIM', tokenVersion: 1 });
    // OIDC cannot promote a provisioned role even on the first SSO link.
    expect(
      resolveSignInRole(
        evaluateOidcRoleClaims({ groups: ['admins'] }, [
          { claim: 'groups', value: 'admins', role: 'ADMIN' },
        ]),
        user,
        { firstLink: true }
      )
    ).toMatchObject({ role: 'RESPONDER', roleSource: 'SCIM', changed: false });
    expect(
      await prisma.scimEvent.findFirst({
        where: { connectorId, action: 'user.role.synced', resourceId: id },
      })
    ).toMatchObject({
      details: {
        fromRole: 'USER',
        fromSource: 'MANUAL',
        role: 'RESPONDER',
        roleSource: 'SCIM',
        actorId: adminId,
      },
    });
    expect((await members(groupId, [id])).status).toBe(200);
    expect(await account(id)).toMatchObject({ tokenVersion: 1 });
  });

  it('syncs future additions, overlapping groups, rename, PUT, removal and deletion deterministically', async () => {
    const id = await person();
    const responders = await group();
    const auditors = await group([id]);
    expect(await map(responders, 'RESPONDER')).toEqual({ changedUsers: 0 });
    await map(auditors, 'AUDITOR');
    expect((await members(responders, [id])).status).toBe(200);
    expect(await account(id)).toMatchObject({ role: 'RESPONDER' });
    expect(
      (
        await call(
          'Groups',
          'PATCH',
          { Operations: [{ op: 'replace', path: 'displayName', value: 'Renamed by Entra' }] },
          responders
        )
      ).status
    ).toBe(200);
    expect(await account(id)).toMatchObject({ role: 'RESPONDER' });
    expect(
      (await call('Groups', 'PUT', { displayName: 'Renamed by Entra', members: [] }, responders))
        .status
    ).toBe(200);
    expect(await account(id)).toMatchObject({ role: 'AUDITOR' });
    expect((await call('Groups', 'DELETE', undefined, auditors)).status).toBe(204);
    expect(await account(id)).toMatchObject({ role: 'USER', roleSource: 'SCIM' });
  });

  it('protects connection boundaries and rejects provider-supplied privileges', async () => {
    const id = await person();
    const groupId = await group([id]);
    expect(
      await getScimRoleMappingAction({ connectorId: otherConnectorId, groupId })
    ).toHaveProperty('scimError');
    expect(
      await previewScimRoleMappingAction({ connectorId: otherConnectorId, groupId, role: 'ADMIN' })
    ).toHaveProperty('scimError');
    expect(
      (
        await call(
          'Groups',
          'PATCH',
          { Operations: [{ op: 'replace', path: 'systemRole', value: 'ADMIN' }] },
          groupId
        )
      ).status
    ).toBe(400);
    expect(
      (
        await call(
          'Users',
          'PATCH',
          { Operations: [{ op: 'replace', path: 'roles', value: [{ value: 'ADMIN' }] }] },
          id
        )
      ).status
    ).toBe(400);
    expect(
      (
        await call(
          'Users',
          'PATCH',
          { Operations: [{ op: 'replace', path: 'scimRoleMappingAdopted', value: true }] },
          id
        )
      ).status
    ).toBe(400);
    const existing = await account(id);
    expect(
      (await call('Users', 'PUT', { userName: existing.email, scimRoleMappingAdopted: true }, id))
        .status
    ).toBe(200);
    expect(await account(id)).toMatchObject({
      role: 'USER',
      roleSource: 'MANUAL',
      scimRoleMappingAdopted: false,
    });
  });

  it('rejects stale previews after membership, user authority or competing mapping changes', async () => {
    const id = await person();
    const groupId = await group([id]);
    const competing = await group([id]);
    const input = { connectorId, groupId, role: 'RESPONDER' as const };
    const preview = await previewScimRoleMappingAction(input);
    if ('scimError' in preview) throw new Error(preview.scimError);
    await map(competing, 'AUDITOR');
    expect(await saveScimRoleMappingAction({ ...input, revision: preview.revision })).toMatchObject(
      { scimError: expect.stringContaining('Preview') }
    );
    expect(
      (await prisma.scimGroup.findUniqueOrThrow({ where: { id: groupId } })).systemRole
    ).toBeNull();
    const refreshed = await previewScimRoleMappingAction(input);
    if ('scimError' in refreshed) throw new Error(refreshed.scimError);
    await members(groupId, []);
    expect(
      await saveScimRoleMappingAction({ ...input, revision: refreshed.revision })
    ).toHaveProperty('scimError');
  });

  it('revokes admin MCP grants, reasserts mapped roles, and clears deleted users for rehire', async () => {
    const id = await person();
    const groupId = await group([id]);
    await map(groupId, 'ADMIN');
    const before = await account(id);
    expect(await map(groupId, 'RESPONDER')).toEqual({ changedUsers: 1 });
    expect(await account(id)).toMatchObject({
      mcpRevocationVersion: before.mcpRevocationVersion + 1,
    });
    await prisma.user.update({ where: { id }, data: { role: 'AUDITOR', roleSource: 'MANUAL' } });
    await members(groupId, [id]);
    expect(await account(id)).toMatchObject({ role: 'RESPONDER', roleSource: 'SCIM' });
    expect((await call('Users', 'DELETE', undefined, id)).status).toBe(204);
    expect(await account(id)).toMatchObject({
      role: 'USER',
      roleSource: 'SCIM',
      status: 'DISABLED',
    });
  });

  it('removes a mapping immediately, keeps unrelated manual roles, and is idempotent', async () => {
    const id = await person();
    const groupId = await group([id]);
    await map(groupId, 'RESPONDER');
    expect(await map(groupId, null)).toEqual({ changedUsers: 1 });
    expect(await account(id)).toMatchObject({ role: 'USER', roleSource: 'SCIM' });
    const before = await account(id);
    expect(await map(groupId, null)).toEqual({ changedUsers: 0 });
    expect(await account(id)).toMatchObject({ tokenVersion: before.tokenVersion });
    await prisma.user.update({ where: { id }, data: { role: 'ADMIN', roleSource: 'MANUAL' } });
    await members(groupId, []);
    expect(await account(id)).toMatchObject({ role: 'ADMIN', roleSource: 'MANUAL' });
  });

  it.skipIf(process.env.SCIM_LOAD_TEST !== '1')(
    'maps 10,000 members with bounded batch writes and idempotent replay',
    async () => {
      const prefix = `rolecap-${crypto.randomUUID().slice(0, 12)}-`;
      await prisma.$executeRaw`INSERT INTO "User" (id,email,name,role,status,"updatedAt")
      SELECT ${prefix} || i, ${prefix} || i || '@example.test', 'Role capacity', 'USER'::"Role", 'ACTIVE'::"UserStatus", CURRENT_TIMESTAMP
      FROM generate_series(1,10000) i`;
      await prisma.$executeRaw`INSERT INTO "ScimIdentity" (id,"connectorId","userId","externalId")
      SELECT ${prefix} || i, ${connectorId}, ${prefix} || i, ${prefix} || i FROM generate_series(1,10000) i`;
      const directory = await prisma.scimGroup.create({
        data: { name: '10K role mapping', connectorId },
      });
      await prisma.$executeRaw`INSERT INTO "ScimGroupMembership" ("groupId","userId")
      SELECT ${directory.id}, ${prefix} || i FROM generate_series(1,10000) i`;
      expect(await map(directory.id, 'RESPONDER')).toEqual({ changedUsers: 10000 });
      const prefixGroups = `${prefix}groups-`;
      await prisma.$executeRaw`INSERT INTO "ScimGroup" (id, "connectorId", name, "systemRole", "updatedAt")
        SELECT ${prefixGroups} || g, ${connectorId}, 'Overlapping mapped auditors', 'AUDITOR'::"Role", CURRENT_TIMESTAMP
        FROM generate_series(1,10) g`;
      // Bound fixture insertion work per statement; keep production statement timeouts.
      for (let first = 1; first <= 10; first += 10) {
        await prisma.$executeRaw`INSERT INTO "ScimGroupMembership" ("groupId", "userId")
          SELECT ${prefixGroups} || g, ${prefix} || u
          FROM generate_series(${first}::integer, ${first + 9}::integer) g CROSS JOIN generate_series(1,10000) u`;
      }
      const { planScimRoles } = await import('@/lib/scim/lifecycle/roles');
      const aggregated = await prisma.$transaction(
        tx =>
          planScimRoles(
            tx,
            connectorId,
            Array.from({ length: 10000 }, (_, index) => `${prefix}${index + 1}`)
          ),
        { isolationLevel: 'RepeatableRead', timeout: 30000 }
      );
      expect(aggregated.changes).toEqual([]);
      expect(
        await prisma.user.count({
          where: {
            id: { startsWith: prefix },
            role: 'RESPONDER',
            roleSource: 'SCIM',
            tokenVersion: 1,
          },
        })
      ).toBe(10000);
      expect(await map(directory.id, 'RESPONDER')).toEqual({ changedUsers: 0 });
      expect(
        await prisma.scimEvent.count({
          where: { connectorId, resourceId: { startsWith: prefix }, action: 'user.role.synced' },
        })
      ).toBe(10000);
    },
    120000
  );

  it('rolls back membership, mapping, role and events when the last active admin would be removed', async () => {
    const id = await person();
    const groupId = await group([id]);
    await map(groupId, 'ADMIN');
    // This database is disposable. Temporarily disable other admins to exercise the shared invariant.
    const otherAdmins = await prisma.user.findMany({
      where: { role: 'ADMIN', status: 'ACTIVE', id: { not: id } },
      select: { id: true },
    });
    await prisma.user.updateMany({
      where: { id: { in: otherAdmins.map(a => a.id) } },
      data: { status: 'DISABLED' },
    });
    try {
      // Rehearse an upgraded last administrator with no new role authority. Ordinary
      // directory updates must succeed rather than demote it or fail the entire sync.
      const legacyId = await person();
      await prisma.user.update({
        where: { id: legacyId },
        data: { role: 'ADMIN', roleSource: 'SCIM' },
      });
      await prisma.user.update({ where: { id }, data: { status: 'DISABLED' } });
      try {
        const legacyGroup = await group([legacyId]);
        expect((await members(legacyGroup, [legacyId])).status).toBe(200);
        expect((await call('Groups', 'DELETE', undefined, legacyGroup)).status).toBe(204);
        expect(await account(legacyId)).toMatchObject({
          role: 'ADMIN',
          roleSource: 'SCIM',
          scimRoleMappingAdopted: false,
          tokenVersion: 0,
        });
      } finally {
        await prisma.user.update({ where: { id }, data: { status: 'ACTIVE' } });
        await prisma.user.update({ where: { id: legacyId }, data: { role: 'USER' } });
      }
      const before = await account(id);
      const events = await prisma.scimEvent.count({ where: { connectorId } });
      const response = await members(groupId, []);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        detail: expect.stringContaining('no active administrators'),
      });
      expect(await prisma.scimGroupMembership.count({ where: { groupId, userId: id } })).toBe(1);
      expect(await account(id)).toMatchObject({ role: 'ADMIN', tokenVersion: before.tokenVersion });
      expect(await map(groupId, 'USER')).toMatchObject({
        scimError: expect.stringContaining('no active administrators'),
      });
      expect(
        (await prisma.scimGroup.findUniqueOrThrow({ where: { id: groupId } })).systemRole
      ).toBe('ADMIN');
      expect(await prisma.scimEvent.count({ where: { connectorId } })).toBe(events);
    } finally {
      await prisma.user.updateMany({
        where: { id: { in: otherAdmins.map(a => a.id) } },
        data: { status: 'ACTIVE' },
      });
    }
  });
});
