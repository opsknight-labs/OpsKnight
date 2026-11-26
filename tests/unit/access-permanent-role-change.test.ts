import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  requesterRole: 'USER',
  tx: {
    user: { findUnique: vi.fn() },
    accessRequest: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/access/settings', () => ({
  getAccessControlSettings: async () => ({ requestsEnabled: true, selfApprovalAllowed: false }),
}));
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: async (callback: (tx: unknown) => unknown) => callback(db.tx),
}));

import { permanentRoleKeepsAccess } from '@/lib/authorization';
import { createAccessRequest } from '@/lib/access/requests';

describe('permanent role changes keep the requester working', () => {
  it('allows a step up the operations ladder or a strict superset, not a lateral move', () => {
    expect(permanentRoleKeepsAccess('USER', 'RESPONDER')).toBe(true);
    expect(permanentRoleKeepsAccess('USER', 'ADMIN')).toBe(true);
    expect(permanentRoleKeepsAccess('RESPONDER', 'ADMIN')).toBe(true);
    expect(permanentRoleKeepsAccess('AUDITOR', 'ADMIN')).toBe(true);
    expect(permanentRoleKeepsAccess('STAKEHOLDER', 'USER')).toBe(true);

    expect(permanentRoleKeepsAccess('USER', 'AUDITOR')).toBe(false);
    expect(permanentRoleKeepsAccess('RESPONDER', 'AUDITOR')).toBe(false);
    expect(permanentRoleKeepsAccess('AUDITOR', 'RESPONDER')).toBe(false);
    expect(permanentRoleKeepsAccess('ADMIN', 'RESPONDER')).toBe(false);
  });
});

describe('createAccessRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.tx.user.findUnique.mockResolvedValue({
      id: 'u1',
      name: 'Una',
      email: 'u@example.com',
      role: 'USER',
      roleSource: 'MANUAL',
      status: 'ACTIVE',
    });
  });

  it('refuses a permanent lateral role that would demote the requester', async () => {
    await expect(
      createAccessRequest('u1', {
        kind: 'ORG_ROLE',
        requestedRole: 'AUDITOR',
        reason: 'I need to read the audit log for a review',
        durationMinutes: null,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(db.tx.accessRequest.create).not.toHaveBeenCalled();
  });
});
