import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const mocks = vi.hoisted(() => ({
  assertResponderOrAbove: vi.fn(),
  getCurrentAuthorizationActor: vi.fn(),
  incidentFindUnique: vi.fn(),
  incidentCount: vi.fn(),
  getPostmortemAssistForActor: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    incident: { findUnique: mocks.incidentFindUnique, count: mocks.incidentCount },
    postmortem: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/rbac', () => ({
  assertResponderOrAbove: mocks.assertResponderOrAbove,
  getCurrentAuthorizationActor: mocks.getCurrentAuthorizationActor,
  getCurrentUser: vi.fn(),
  getUserPermissions: vi.fn(),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/intelligence/postmortems/evidence-draft', () => ({ applyEvidenceToDraft: vi.fn() }));
vi.mock('@/lib/intelligence/postmortems/loaders', () => ({
  evidenceForStoredDraft: vi.fn(),
  getPostmortemAssistForActor: mocks.getPostmortemAssistForActor,
}));

import { generatePostmortemDraft } from '@/app/(app)/postmortems/actions';

// Scoped actor: reads only incidents owned by team-1 (or assigned to / watched by them).
const responder: AuthorizationActor = {
  id: 'responder-1',
  role: 'USER',
  status: 'ACTIVE',
  teamIds: ['team-1'],
};

describe('generatePostmortemDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertResponderOrAbove.mockResolvedValue({ id: responder.id, role: 'RESPONDER' });
    mocks.getCurrentAuthorizationActor.mockResolvedValue(responder);
    mocks.getPostmortemAssistForActor.mockResolvedValue(null);
    mocks.incidentFindUnique.mockResolvedValue({
      id: 'inc-1',
      createdAt: new Date('2026-11-01T10:00:00.000Z'),
      resolvedAt: new Date('2026-11-01T11:00:00.000Z'),
      urgency: 'HIGH',
      service: { name: 'Payments' },
      events: [{ id: 'e1', message: 'Secret internal event', createdAt: new Date('2026-11-01T10:05:00.000Z') }],
      notes: [],
    });
  });

  it('refuses an incident the caller cannot read, without loading its events or notes', async () => {
    mocks.incidentCount.mockResolvedValue(0);

    await expect(generatePostmortemDraft('inc-1', 'UTC')).rejects.toThrow('Incident not found');

    // The read scope is applied to this incident id, not just any incident.
    expect(mocks.incidentCount.mock.calls[0]![0].where.AND[0]).toEqual({ id: 'inc-1' });
    expect(mocks.incidentCount.mock.calls[0]![0].where.AND[1]).toHaveProperty('OR');
    expect(mocks.incidentFindUnique).not.toHaveBeenCalled();
    expect(mocks.getPostmortemAssistForActor).not.toHaveBeenCalled();
  });

  it('drafts from the timeline when the caller can read the incident', async () => {
    mocks.incidentCount.mockResolvedValue(1);

    const draft = await generatePostmortemDraft('inc-1', 'UTC');

    expect(draft.summary).toContain('Payments');
    expect(draft.timeline.map(entry => entry.description)).toContain('Secret internal event');
  });

  it('still requires responder access before looking at the incident', async () => {
    mocks.assertResponderOrAbove.mockRejectedValue(new Error('Unauthorized'));

    await expect(generatePostmortemDraft('inc-1', 'UTC')).rejects.toThrow('Unauthorized');
    expect(mocks.incidentCount).not.toHaveBeenCalled();
  });
});
