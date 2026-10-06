import { vi } from 'vitest';
import type { AppRole, Capability } from '@/lib/authorization';
import type { Role } from '@prisma/client';

export type MockUser = {
  id: string;
  role: AppRole | Role | string;
  email: string;
  name: string;
  timeZone: string;
  status: string;
  tokenVersion: number;
  invitationGeneration: number;
};

export const DEFAULT_MOCK_USER: MockUser = {
  id: 'usr_mock_operator_01',
  role: 'ADMIN',
  email: 'operator@opsknight.local',
  name: 'OpsKnight Operator',
  timeZone: 'UTC',
  status: 'ACTIVE',
  tokenVersion: 1,
  invitationGeneration: 1,
};

export function createRbacMocks(overrides?: {
  currentUser?: Partial<MockUser> | null;
  capabilities?: readonly Capability[];
  canViewIncident?: boolean;
}) {
  const user =
    overrides?.currentUser === null
      ? null
      : { ...DEFAULT_MOCK_USER, ...overrides?.currentUser };

  const getCurrentUser = vi.fn().mockImplementation(async () => {
    if (!user) throw new Error('Unauthorized');
    return user;
  });

  const getUserPermissions = vi.fn().mockImplementation(async () => {
    if (!user) {
      return {
        id: '',
        role: 'VIEWER' as const,
        capabilities: [] as readonly Capability[],
        authenticated: false,
        isAdmin: false,
        isAuditor: false,
        isAdminOrResponder: false,
        isResponderOrAbove: false,
      };
    }

    const capabilities =
      overrides?.capabilities ??
      ([
        'incident.read.all',
        'incident.read.scoped',
        'runbook.read.all',
        'runbook.read.scoped',
        'runbook.execute',
        'runbook.author',
      ] as const);

    return {
      id: user.id,
      role: user.role as Role,
      capabilities,
      authenticated: true,
      isAdmin: user.role === 'ADMIN',
      isAuditor: user.role === 'AUDITOR',
      isAdminOrResponder: user.role === 'ADMIN' || user.role === 'RESPONDER',
      isResponderOrAbove: user.role === 'ADMIN' || user.role === 'RESPONDER',
    };
  });

  const assertCanViewIncident = vi.fn().mockImplementation(async (_incidentId: string) => {
    if (overrides?.canViewIncident === false) {
      throw new Error('Forbidden incident');
    }
    return user;
  });

  const assertCapability = vi.fn().mockImplementation(async () => {
    return user;
  });

  return {
    getCurrentUser,
    getUserPermissions,
    assertCanViewIncident,
    assertCapability,
  };
}
