import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const txMock = {
  team: {
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  teamMember: {
    create: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
};

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      if (typeof arg === 'function') {
        return (arg as (tx: typeof txMock) => unknown)(txMock);
      }
      return arg;
    }),
    team: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    teamMember: {
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { GET as listGroups, POST as createGroup } from '@/app/api/scim/v2/Groups/route';
import {
  DELETE as deleteGroup,
  GET as getGroup,
  PATCH as patchGroup,
  PUT as replaceGroup,
} from '@/app/api/scim/v2/Groups/[id]/route';

const token = 'scim-test-token-that-is-longer-than-thirty-two-characters';
const originalToken = process.env.SCIM_BEARER_TOKEN;

function request(
  url: string,
  init: { method?: string; body?: BodyInit; headers?: HeadersInit } = {}
) {
  return new NextRequest(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
  });
}

function context(id = 'team-1') {
  return { params: Promise.resolve({ id }) };
}

const mockTeam = {
  id: 'team-1',
  name: 'Platform Engineering',
  scimExternalId: 'ext-group-1',
  description: 'Provisioned via SCIM 2.0',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  members: [
    {
      user: {
        id: 'user-1',
        name: 'Alice Smith',
        email: 'alice@example.com',
      },
    },
  ],
};

describe('SCIM Groups HTTP lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SCIM_BEARER_TOKEN = token;
    txMock.team.findUniqueOrThrow.mockResolvedValue(mockTeam);
  });

  afterAll(() => {
    if (originalToken === undefined) delete process.env.SCIM_BEARER_TOKEN;
    else process.env.SCIM_BEARER_TOKEN = originalToken;
  });

  describe('Authentication & Authorization', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const unauthReq = new NextRequest('https://ops.example.com/api/scim/v2/Groups');
      const res = await listGroups(unauthReq);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
    });

    it('rejects requests with invalid bearer token with 401', async () => {
      const invalidReq = new NextRequest('https://ops.example.com/api/scim/v2/Groups', {
        headers: { authorization: 'Bearer invalid-token' },
      });
      const res = await listGroups(invalidReq);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/scim/v2/Groups (List & Search)', () => {
    it('returns a paginated list of SCIM groups', async () => {
      vi.mocked(prisma.team.findMany).mockResolvedValue([mockTeam] as never);
      vi.mocked(prisma.team.count).mockResolvedValue(1 as never);

      const res = await listGroups(
        request('https://ops.example.com/api/scim/v2/Groups?startIndex=1&count=50')
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/scim+json');

      const body = await res.json();
      expect(body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(body.totalResults).toBe(1);
      expect(body.itemsPerPage).toBe(1);
      expect(body.startIndex).toBe(1);
      expect(body.Resources).toHaveLength(1);
      expect(body.Resources[0].displayName).toBe('Platform Engineering');
      expect(body.Resources[0].members[0].value).toBe('user-1');
    });

    it('filters groups by displayName eq', async () => {
      vi.mocked(prisma.team.findMany).mockResolvedValue([mockTeam] as never);
      vi.mocked(prisma.team.count).mockResolvedValue(1 as never);

      const res = await listGroups(
        request(
          'https://ops.example.com/api/scim/v2/Groups?filter=displayName%20eq%20%22Platform%20Engineering%22'
        )
      );
      expect(res.status).toBe(200);
      expect(prisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: 'Platform Engineering' },
        })
      );
    });

    it('returns 400 for unsupported filter operators', async () => {
      const res = await listGroups(
        request('https://ops.example.com/api/scim/v2/Groups?filter=displayName%20sw%20%22Plat%22')
      );
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/scim/v2/Groups (Create)', () => {
    it('returns 400 if displayName is missing or empty', async () => {
      const res = await createGroup(
        request('https://ops.example.com/api/scim/v2/Groups', {
          method: 'POST',
          body: JSON.stringify({ displayName: '   ' }),
        })
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 if displayName exceeds 100 characters', async () => {
      const res = await createGroup(
        request('https://ops.example.com/api/scim/v2/Groups', {
          method: 'POST',
          body: JSON.stringify({ displayName: 'a'.repeat(101) }),
        })
      );
      expect(res.status).toBe(400);
    });

    it('returns 409 if a group with same displayName already exists', async () => {
      vi.mocked(prisma.team.findFirst).mockResolvedValue({ id: 'existing-id' } as never);

      const res = await createGroup(
        request('https://ops.example.com/api/scim/v2/Groups', {
          method: 'POST',
          body: JSON.stringify({ displayName: 'Platform Engineering' }),
        })
      );
      expect(res.status).toBe(409);
    });

    it('creates a new group and associates members successfully', async () => {
      vi.mocked(prisma.team.findFirst).mockResolvedValue(null as never);
      txMock.team.create.mockResolvedValue({ id: 'team-1' });
      txMock.user.findUnique.mockResolvedValue({ id: 'user-1' });
      txMock.teamMember.create.mockResolvedValue({ id: 'tm-1' });

      const res = await createGroup(
        request('https://ops.example.com/api/scim/v2/Groups', {
          method: 'POST',
          body: JSON.stringify({
            displayName: 'Platform Engineering',
            externalId: 'ext-group-1',
            members: [{ value: 'user-1' }],
          }),
        })
      );

      expect(res.status).toBe(201);
      expect(txMock.team.create).toHaveBeenCalledWith({
        data: {
          name: 'Platform Engineering',
          scimExternalId: 'ext-group-1',
          description: 'Provisioned via SCIM 2.0',
        },
      });
      expect(txMock.teamMember.create).toHaveBeenCalledWith({
        data: {
          teamId: 'team-1',
          userId: 'user-1',
          role: 'MEMBER',
        },
      });
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'scim.group.created',
          entityType: 'TEAM',
          entityId: 'team-1',
        })
      );

      const body = await res.json();
      expect(body.id).toBe('team-1');
      expect(body.displayName).toBe('Platform Engineering');
      expect(body.members[0].value).toBe('user-1');
    });
  });

  describe('GET /api/scim/v2/Groups/[id] (Get)', () => {
    it('returns 404 when group is not found', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValue(null as never);

      const res = await getGroup(
        request('https://ops.example.com/api/scim/v2/Groups/non-existent'),
        context('non-existent')
      );
      expect(res.status).toBe(404);
    });

    it('returns serialized group when found', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValue(mockTeam as never);

      const res = await getGroup(
        request('https://ops.example.com/api/scim/v2/Groups/team-1'),
        context('team-1')
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.id).toBe('team-1');
      expect(body.displayName).toBe('Platform Engineering');
      expect(body.members).toHaveLength(1);
    });
  });

  describe('PUT /api/scim/v2/Groups/[id] (Replace)', () => {
    it('returns 404 when group does not exist', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValue(null as never);

      const res = await replaceGroup(
        request('https://ops.example.com/api/scim/v2/Groups/team-1', {
          method: 'PUT',
          body: JSON.stringify({ displayName: 'New Name' }),
        }),
        context('team-1')
      );
      expect(res.status).toBe(404);
    });

    it('returns 400 when displayName is missing', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValue({ id: 'team-1', name: 'Old' } as never);

      const res = await replaceGroup(
        request('https://ops.example.com/api/scim/v2/Groups/team-1', {
          method: 'PUT',
          body: JSON.stringify({}),
        }),
        context('team-1')
      );
      expect(res.status).toBe(400);
    });

    it('returns 409 if renaming to an existing group name', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValue({ id: 'team-1', name: 'Old' } as never);
      vi.mocked(prisma.team.findFirst).mockResolvedValue({ id: 'team-2' } as never);

      const res = await replaceGroup(
        request('https://ops.example.com/api/scim/v2/Groups/team-1', {
          method: 'PUT',
          body: JSON.stringify({ displayName: 'Existing Other Name' }),
        }),
        context('team-1')
      );
      expect(res.status).toBe(409);
    });

    it('replaces group and synchronizes members', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValue({ id: 'team-1', name: 'Old' } as never);
      vi.mocked(prisma.team.findFirst).mockResolvedValue(null as never);
      txMock.user.findUnique.mockResolvedValue({ id: 'user-2' });

      const updatedTeam = {
        ...mockTeam,
        name: 'New Name',
        members: [{ user: { id: 'user-2', name: 'Bob', email: 'bob@example.com' } }],
      };
      txMock.team.findUniqueOrThrow.mockResolvedValue(updatedTeam);

      const res = await replaceGroup(
        request('https://ops.example.com/api/scim/v2/Groups/team-1', {
          method: 'PUT',
          body: JSON.stringify({
            displayName: 'New Name',
            externalId: 'ext-group-1',
            members: [{ value: 'user-2' }],
          }),
        }),
        context('team-1')
      );

      expect(res.status).toBe(200);
      expect(txMock.team.update).toHaveBeenCalledWith({
        where: { id: 'team-1' },
        data: { name: 'New Name', scimExternalId: 'ext-group-1' },
      });
      expect(txMock.teamMember.deleteMany).toHaveBeenCalledWith({ where: { teamId: 'team-1' } });
      expect(txMock.teamMember.create).toHaveBeenCalledWith({
        data: { teamId: 'team-1', userId: 'user-2', role: 'MEMBER' },
      });
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'scim.group.updated' })
      );
    });
  });

  describe('PATCH /api/scim/v2/Groups/[id] (Patch Operations)', () => {
    it('returns 400 for invalid Operations body', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValue(mockTeam as never);

      const res = await patchGroup(
        request('https://ops.example.com/api/scim/v2/Groups/team-1', {
          method: 'PATCH',
          body: JSON.stringify({ Operations: 'not-an-array' }),
        }),
        context('team-1')
      );
      expect(res.status).toBe(400);
    });

    it('patches displayName attribute', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValue(mockTeam as never);
      vi.mocked(prisma.team.findFirst).mockResolvedValue(null as never);
      const updatedTeam = { ...mockTeam, name: 'Renamed Engineering' };
      txMock.team.findUniqueOrThrow.mockResolvedValue(updatedTeam);

      const res = await patchGroup(
        request('https://ops.example.com/api/scim/v2/Groups/team-1', {
          method: 'PATCH',
          body: JSON.stringify({
            Operations: [{ op: 'replace', path: 'displayName', value: 'Renamed Engineering' }],
          }),
        }),
        context('team-1')
      );

      expect(res.status).toBe(200);
      expect(txMock.team.update).toHaveBeenCalledWith({
        where: { id: 'team-1' },
        data: { name: 'Renamed Engineering' },
      });
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'scim.group.patched',
          details: expect.objectContaining({ displayName: 'Renamed Engineering' }),
        })
      );
    });

    it('adds a member to the group', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValue(mockTeam as never);
      txMock.user.findUnique.mockResolvedValue({ id: 'user-2' });

      const res = await patchGroup(
        request('https://ops.example.com/api/scim/v2/Groups/team-1', {
          method: 'PATCH',
          body: JSON.stringify({
            Operations: [{ op: 'add', path: 'members', value: [{ value: 'user-2' }] }],
          }),
        }),
        context('team-1')
      );

      expect(res.status).toBe(200);
      expect(txMock.teamMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_teamId: { userId: 'user-2', teamId: 'team-1' } },
        })
      );
    });

    it('removes a member using RFC 7644 filter path members[value eq "user-1"]', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValue(mockTeam as never);

      const res = await patchGroup(
        request('https://ops.example.com/api/scim/v2/Groups/team-1', {
          method: 'PATCH',
          body: JSON.stringify({
            Operations: [{ op: 'remove', path: 'members[value eq "user-1"]' }],
          }),
        }),
        context('team-1')
      );

      expect(res.status).toBe(200);
      expect(txMock.teamMember.deleteMany).toHaveBeenCalledWith({
        where: { teamId: 'team-1', userId: { in: ['user-1'] } },
      });
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'scim.group.patched',
          details: expect.objectContaining({ membersRemoved: ['user-1'] }),
        })
      );
    });

    it('replaces all members with a new set', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValue(mockTeam as never);
      txMock.user.findUnique.mockResolvedValue({ id: 'user-99' });

      const res = await patchGroup(
        request('https://ops.example.com/api/scim/v2/Groups/team-1', {
          method: 'PATCH',
          body: JSON.stringify({
            Operations: [{ op: 'replace', path: 'members', value: [{ value: 'user-99' }] }],
          }),
        }),
        context('team-1')
      );

      expect(res.status).toBe(200);
      expect(txMock.teamMember.deleteMany).toHaveBeenCalledWith({ where: { teamId: 'team-1' } });
      expect(txMock.teamMember.create).toHaveBeenCalledWith({
        data: { teamId: 'team-1', userId: 'user-99', role: 'MEMBER' },
      });
    });
  });

  describe('DELETE /api/scim/v2/Groups/[id] (Delete)', () => {
    it('returns 404 when deleting a non-existent group', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValue(null as never);

      const res = await deleteGroup(
        request('https://ops.example.com/api/scim/v2/Groups/non-existent'),
        context('non-existent')
      );
      expect(res.status).toBe(404);
    });

    it('deletes team and members and logs audit with 204 No Content', async () => {
      vi.mocked(prisma.team.findUnique).mockResolvedValue({
        id: 'team-1',
        name: 'Platform Engineering',
      } as never);

      const res = await deleteGroup(
        request('https://ops.example.com/api/scim/v2/Groups/team-1', { method: 'DELETE' }),
        context('team-1')
      );

      expect(res.status).toBe(204);
      expect(txMock.teamMember.deleteMany).toHaveBeenCalledWith({ where: { teamId: 'team-1' } });
      expect(txMock.team.delete).toHaveBeenCalledWith({ where: { id: 'team-1' } });
      expect(logAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'scim.group.deleted',
          entityType: 'TEAM',
          entityId: 'team-1',
        })
      );
    });
  });
});
