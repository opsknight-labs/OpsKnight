import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const mocks = vi.hoisted(() => ({
  assertResponderOrAbove: vi.fn(),
  getCurrentAuthorizationActor: vi.fn(),
  getCurrentUser: vi.fn(),
  incidentFindUnique: vi.fn(),
  incidentCount: vi.fn(),
  postmortemFindUnique: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    incident: { findUnique: mocks.incidentFindUnique, count: mocks.incidentCount },
    postmortem: { findUnique: mocks.postmortemFindUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/rbac', () => ({
  assertResponderOrAbove: mocks.assertResponderOrAbove,
  getCurrentAuthorizationActor: mocks.getCurrentAuthorizationActor,
  getCurrentUser: mocks.getCurrentUser,
  getUserPermissions: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/intelligence/postmortems/evidence-draft', () => ({ applyEvidenceToDraft: vi.fn() }));
vi.mock('@/lib/intelligence/postmortems/loaders', () => ({
  evidenceForStoredDraft: vi.fn(),
  getPostmortemAssistForActor: vi.fn(),
}));

import { upsertPostmortem } from '@/app/(app)/postmortems/actions';

// Scoped actor: reads only incidents owned by team-1 (or assigned to / watched by them).
const responder: AuthorizationActor = {
  id: 'responder-1',
  role: 'USER',
  status: 'ACTIVE',
  teamIds: ['team-1'],
};

describe('upsertPostmortem creating a postmortem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertResponderOrAbove.mockResolvedValue({ id: responder.id, role: 'RESPONDER' });
    mocks.getCurrentAuthorizationActor.mockResolvedValue(responder);
    mocks.getCurrentUser.mockResolvedValue({
      id: responder.id,
      role: 'RESPONDER',
      capabilities: [],
    });
    mocks.incidentFindUnique.mockResolvedValue({
      id: 'inc-1',
      status: 'RESOLVED',
      assigneeId: null,
      service: { team: { members: [] } },
    });
    mocks.postmortemFindUnique.mockResolvedValue(null);
  });

  it('refuses an incident the caller cannot read, so they never become its author', async () => {
    mocks.incidentCount.mockResolvedValue(0);

    await expect(upsertPostmortem('inc-1', { title: 'Outage' })).rejects.toThrow(
      'Incident not found'
    );

    // The read scope is applied to this incident id, not just any incident.
    expect(mocks.incidentCount.mock.calls[0]![0].where.AND[0]).toEqual({ id: 'inc-1' });
    expect(mocks.incidentCount.mock.calls[0]![0].where.AND[1]).toHaveProperty('OR');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('creates the postmortem when the caller can read the incident', async () => {
    mocks.incidentCount.mockResolvedValue(1);
    mocks.transaction.mockResolvedValue({ id: 'pm-1' });

    const result = await upsertPostmortem('inc-1', { title: 'Outage' });

    expect(result).toMatchObject({ success: true });
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it('refuses more action items than the API can read back', async () => {
    const item = {
      id: 'a',
      title: 't',
      description: '',
      status: 'OPEN' as const,
      priority: 'LOW' as const,
    };
    await expect(
      upsertPostmortem('inc-1', {
        title: 'Outage',
        actionItems: Array.from({ length: 101 }, (_, i) => ({ ...item, id: `a${i}` })),
      })
    ).rejects.toThrow('at most 100 action items');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('still edits an existing postmortem after its incident was reopened', async () => {
    mocks.incidentFindUnique.mockResolvedValue({
      id: 'inc-1',
      status: 'OPEN',
      assigneeId: null,
      service: { team: { members: [] } },
    });
    mocks.postmortemFindUnique.mockResolvedValue({ createdById: responder.id });
    mocks.transaction.mockResolvedValue({ id: 'pm-1' });

    await expect(
      upsertPostmortem('inc-1', { title: 'Outage', expectedRevision: 3 })
    ).resolves.toMatchObject({ success: true });
  });

  it('still refuses to create a postmortem for an incident that is not resolved', async () => {
    mocks.incidentFindUnique.mockResolvedValue({
      id: 'inc-1',
      status: 'OPEN',
      assigneeId: null,
      service: { team: { members: [] } },
    });

    await expect(upsertPostmortem('inc-1', { title: 'Outage' })).rejects.toThrow(
      'only be created for resolved incidents'
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
