import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const mocks = vi.hoisted(() => ({
  assertResponderOrAbove: vi.fn(),
  getCurrentAuthorizationActor: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  findMany: vi.fn(),
  logAudit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    postmortem: {
      findFirst: mocks.findFirst,
      update: mocks.update,
      count: mocks.count,
      findMany: mocks.findMany,
    },
  },
}));
vi.mock('@/lib/rbac', () => ({
  assertResponderOrAbove: mocks.assertResponderOrAbove,
  getCurrentAuthorizationActor: mocks.getCurrentAuthorizationActor,
  getCurrentUser: vi.fn(),
  getUserPermissions: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/intelligence/postmortems/evidence-draft', () => ({ applyEvidenceToDraft: vi.fn() }));
vi.mock('@/lib/intelligence/postmortems/loaders', () => ({
  evidenceForStoredDraft: vi.fn(),
  getPostmortemAssistForActor: vi.fn(),
}));

import { getAllPostmortems, togglePostmortemPublicStatus } from '@/app/(app)/postmortems/actions';

const responder: AuthorizationActor = {
  id: 'responder-1',
  role: 'RESPONDER',
  status: 'ACTIVE',
  teamIds: [],
};

describe('togglePostmortemPublicStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertResponderOrAbove.mockResolvedValue({ id: responder.id, role: 'RESPONDER' });
    mocks.getCurrentAuthorizationActor.mockResolvedValue(responder);
  });

  it('refuses a responder who is not author, assignee, team member or admin', async () => {
    mocks.findFirst.mockResolvedValue(null);

    const result = await togglePostmortemPublicStatus('pm-1', true);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission/i);
    expect(JSON.stringify(mocks.findFirst.mock.calls[0][0].where)).toContain('createdById');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it('records who changed the status-page visibility and the old and new value', async () => {
    mocks.findFirst.mockResolvedValue({ isPublic: false });
    mocks.update.mockResolvedValue({ id: 'pm-1', incidentId: 'inc-1', isPublic: true });

    const result = await togglePostmortemPublicStatus('pm-1', true);

    expect(result).toEqual({ success: true, isPublic: true });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'postmortem.visibility.changed',
        entityId: 'inc-1',
        actorId: responder.id,
        oldValue: { isPublic: false },
        newValue: { isPublic: true },
      })
    );
  });
});

describe('getAllPostmortems status filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.count.mockResolvedValue(0);
    mocks.findMany.mockResolvedValue([]);
  });

  it('never widens a USER asking for drafts to published rows', async () => {
    mocks.getCurrentAuthorizationActor.mockResolvedValue({ ...responder, role: 'USER' });

    await getAllPostmortems({ status: 'DRAFT' });

    const clauses = mocks.findMany.mock.calls[0][0].where.AND;
    // Published-only read scope AND status DRAFT: an empty list, not the published postmortems.
    expect(clauses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'PUBLISHED' }),
        expect.objectContaining({ status: 'DRAFT' }),
      ])
    );
  });

  it('lets a responder filter by any status', async () => {
    mocks.getCurrentAuthorizationActor.mockResolvedValue(responder);

    await getAllPostmortems({ status: 'DRAFT' });

    const clauses = mocks.findMany.mock.calls[0][0].where.AND;
    expect(JSON.stringify(clauses)).not.toContain('PUBLISHED');
    expect(clauses).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'DRAFT' })]));
  });
});
