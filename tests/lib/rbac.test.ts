import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCurrentUser,
  assertAdmin,
  assertAdminOrResponder,
  assertAuditorOrAdmin,
  assertAdminOrTeamOwner,
  assertNotSelf,
  getUserPermissions,
  assertCanModifyIncident,
  assertCanAcknowledgeIncident,
  assertCanAddIncidentNote,
  assertCanModifyService,
  assertCanCreateIncidentForService,
} from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock next-auth
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

// Mock auth options
// Mock auth options
vi.mock('@/lib/auth', () => ({
  getAuthOptions: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: vi.fn(),
    },
    incident: {
      findUnique: vi.fn(),
    },
    service: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    teamMember: {
      findFirst: vi.fn(),
    },
  },
}));

describe('RBAC Functions', () => {
  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    role: 'USER',
    name: 'Test User',
    status: 'ACTIVE',
    teamMemberships: [{ teamId: 'team-1' }],
  };

  const mockAdmin = {
    id: 'admin-1',
    email: 'admin@example.com',
    role: 'ADMIN',
    name: 'Admin User',
    status: 'ACTIVE',
    teamMemberships: [],
  };

  const mockResponder = {
    id: 'resp-1',
    email: 'resp@example.com',
    role: 'RESPONDER',
    name: 'Responder User',
    status: 'ACTIVE',
    teamMemberships: [],
  };

  const mockAuditor = {
    id: 'audit-1',
    email: 'auditor@example.com',
    role: 'AUDITOR',
    name: 'Audit User',
    status: 'ACTIVE',
    teamMemberships: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCurrentUser', () => {
    it('should return user when session is valid', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockUser.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const result = await getCurrentUser();
      expect(result).toEqual(mockUser);
    });

    it('should throw Error when session is missing', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      await expect(getCurrentUser()).rejects.toThrow('Unauthorized');
    });

    it('should throw Error when user is not found in DB', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: 'wrong@example.com' } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      await expect(getCurrentUser()).rejects.toThrow('User not found');
    });
  });

  describe('assertAdmin', () => {
    it('should return user if role is ADMIN', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockAdmin.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAdmin as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      const result = await assertAdmin();
      expect(result).toEqual(mockAdmin);
    });

    it('should throw Error if role is not ADMIN', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockUser.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      await expect(assertAdmin()).rejects.toThrow('Unauthorized. Admin access required.');
    });
  });

  describe('assertAdminOrResponder', () => {
    it('should return user if role is ADMIN', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockAdmin.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAdmin as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(await assertAdminOrResponder()).toEqual(mockAdmin);
    });

    it('should return user if role is RESPONDER', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockResponder.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockResponder as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(await assertAdminOrResponder()).toEqual(mockResponder);
    });

    it('should throw Error if role is USER', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockUser.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      await expect(assertAdminOrResponder()).rejects.toThrow(
        'Unauthorized. Admin or Responder access required.'
      );
    });
  });

  describe('assertAuditorOrAdmin', () => {
    it('allows Auditor to read audit evidence', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockAuditor.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuditor as never);

      expect(await assertAuditorOrAdmin()).toEqual(mockAuditor);
    });

    it('does not grant audit evidence to Responder', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockResponder.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockResponder as never);

      await expect(assertAuditorOrAdmin()).rejects.toThrow(
        'Unauthorized. Auditor or Admin access required.'
      );
    });
  });

  describe('assertAdminOrTeamOwner', () => {
    const teamId = 'team-1';

    it('should allow ADMIN even without membership', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockAdmin.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAdmin as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(await assertAdminOrTeamOwner(teamId)).toEqual(mockAdmin);
    });

    it('should allow TEAM OWNER', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockUser.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.teamMember.findFirst).mockResolvedValue({ id: 'membership-1' } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(await assertAdminOrTeamOwner(teamId)).toEqual(mockUser);
    });

    it('should throw Error for regular user not in team', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockUser.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.teamMember.findFirst).mockResolvedValue(null);

      await expect(assertAdminOrTeamOwner(teamId)).rejects.toThrow(
        'Unauthorized. Admin or Team Owner access required.'
      );
    });
  });

  describe('assertNotSelf', () => {
    it('should pass if IDs are different', async () => {
      await expect(assertNotSelf('u1', 'u2', 'delete')).resolves.not.toThrow();
    });

    it('should throw if IDs are the same', async () => {
      await expect(assertNotSelf('u1', 'u1', 'delete')).rejects.toThrow(
        'You cannot delete your own account.'
      );
    });
  });

  describe('getUserPermissions', () => {
    it('should return permissions for logged in user', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockAdmin.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAdmin as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const perms = await getUserPermissions();
      expect(perms.isAdmin).toBe(true);
      expect(perms.isAdminOrResponder).toBe(true);
    });

    it('should return default permissions if not logged in', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);
      const perms = await getUserPermissions();
      expect(perms.isAdmin).toBe(false);
      expect(perms.id).toBe('');
    });
  });

  describe('Incident/Service access', () => {
    const incidentId = 'inc-1';
    const serviceId = 'svc-1';

    it('should allow ADMIN to modify incident', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockAdmin.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAdmin as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(await assertCanModifyIncident(incidentId)).toEqual(mockAdmin);
    });

    it('should allow assignee to modify incident', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockUser.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: incidentId,
        assigneeId: mockUser.id,
        service: { team: { members: [] } },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(await assertCanModifyIncident(incidentId)).toEqual(mockUser);
    });

    it('should allow team member to modify incident', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockUser.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: incidentId,
        assigneeId: 'someone-else',
        service: { team: { members: [{ userId: mockUser.id }] } },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(await assertCanModifyIncident(incidentId)).toEqual(mockUser);
    });

    it('should throw if user has no access to incident', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockUser.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: incidentId,
        assigneeId: 'someone-else',
        service: { team: { members: [] } },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      await expect(assertCanModifyIncident(incidentId)).rejects.toThrow('Unauthorized');
    });

    it('should allow team member to modify service', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockUser.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: serviceId,
        team: { members: [{ userId: mockUser.id }] },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(await assertCanModifyService(serviceId)).toEqual(mockUser);
    });

    it('should allow ADMIN to create incident for any service', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockAdmin.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAdmin as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: serviceId,
        teamId: null,
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(await assertCanCreateIncidentForService(serviceId)).toEqual(mockAdmin);
    });

    it('should allow RESPONDER to create incident for any service', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockResponder.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockResponder as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: serviceId,
        teamId: null,
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(await assertCanCreateIncidentForService(serviceId)).toEqual(mockResponder);
    });

    it('should allow USER to create incident for their team service', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockUser.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: serviceId,
        teamId: 'team-1',
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(await assertCanCreateIncidentForService(serviceId)).toEqual(mockUser);
    });

    it('should reject USER from creating incident for non-team service', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockUser.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: serviceId,
        teamId: 'team-2',
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      await expect(assertCanCreateIncidentForService(serviceId)).rejects.toThrow(
        'Unauthorized. You can only create incidents for your team services.'
      );
    });

    it('should reject AUDITOR from creating incidents', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockAuditor.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuditor as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: serviceId,
        teamId: null,
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      await expect(assertCanCreateIncidentForService(serviceId)).rejects.toThrow(
        'Unauthorized. Incident creation access required.'
      );
    });

    it('should allow USER to acknowledge a visible team incident', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockUser.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: incidentId,
        assigneeId: null,
        teamId: null,
        visibility: 'PUBLIC',
        watchers: [],
        service: { teamId: 'team-1' },
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      expect(await assertCanAcknowledgeIncident(incidentId)).toEqual(mockUser);
    });

    it('should reject AUDITOR from adding notes', async () => {
      vi.mocked(getServerSession).mockResolvedValue({ user: { email: mockAuditor.email } });
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockAuditor as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      await expect(assertCanAddIncidentNote(incidentId)).rejects.toThrow(
        'Unauthorized. Incident note access required.'
      );
    });
  });
});
