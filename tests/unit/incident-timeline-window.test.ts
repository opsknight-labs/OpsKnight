import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eventFindMany: vi.fn(),
  noteFindMany: vi.fn(),
  notificationFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    incidentEvent: { findMany: mocks.eventFindMany },
    incidentNote: { findMany: mocks.noteFindMany },
    notification: { findMany: mocks.notificationFindMany },
    incidentAutomationDecision: { findUnique: vi.fn().mockResolvedValue(null) },
    automationTrace: { findMany: vi.fn().mockResolvedValue([]) },
    incident: { findUnique: vi.fn().mockResolvedValue({ automationSourceRestricted: false }) },
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  assertCanViewIncident: vi.fn().mockResolvedValue(undefined),
  getCurrentAuthorizationActor: vi.fn(),
  getCurrentUser: vi.fn(),
  getUserPermissions: vi.fn().mockResolvedValue({ capabilities: [] }),
}));
vi.mock('@/lib/authorization-policy', () => ({ AUTHORIZATION_ACTIONS: {}, authorize: vi.fn() }));
vi.mock('@/lib/incidents/role-access', () => ({ assertCanChangeIncidentRole: vi.fn() }));
vi.mock('@/lib/incidents/roles-command', () => ({ assignIncidentRoleCommand: vi.fn() }));
vi.mock('@/app/(app)/incidents/actions', () => ({
  addNote: vi.fn(),
  addWatcher: vi.fn(),
  removeWatcher: vi.fn(),
  updateIncidentDescription: vi.fn(),
  updateIncidentStatus: vi.fn(),
}));

import { loadOlderIncidentTimelineActivity } from '@/components/incident/detail/actions';
import { keepSince, timelineCompleteSince } from '@/lib/incidents/timeline-window';

const at = (hoursAgo: number) => new Date(Date.UTC(2026, 0, 10) - hoursAgo * 3_600_000);
const rows = (prefix: string, hoursAgo: number[]) =>
  hoursAgo.map((h, i) => ({ id: `${prefix}${i}`, createdAt: at(h) }));

describe('timelineCompleteSince', () => {
  it('is null while no table filled its page', () => {
    expect(timelineCompleteSince([{ rows: rows('e', [1, 2]), take: 3 }])).toBeNull();
  });

  it('is the newest of the oldest rows of the tables that filled their page', () => {
    const since = timelineCompleteSince([
      { rows: rows('e', [1, 40, 47]), take: 3 },
      { rows: rows('n', [1, 2, 3]), take: 3 },
      { rows: rows('x', [5]), take: 3 },
    ]);
    expect(since).toEqual(at(3));
    expect(keepSince(rows('e', [1, 40, 47]), since).map(r => r.id)).toEqual(['e0']);
  });
});

describe('loadOlderIncidentTimelineActivity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns rows only down to the newest table that hit its page size', async () => {
    // events reach 47h back, notifications only 3h back and may hold more.
    mocks.eventFindMany.mockResolvedValue(
      rows('e', [1, 20, 47]).map(r => ({ ...r, message: 'm', type: 'EVENT' }))
    );
    mocks.noteFindMany.mockResolvedValue([]);
    mocks.notificationFindMany.mockResolvedValue(
      rows('n', [1, 2, 3]).map(r => ({
        ...r,
        channel: 'EMAIL',
        status: 'SENT',
        recipientDisplay: null,
        errorMsg: null,
        sentAt: null,
        deliveredAt: null,
        failedAt: null,
        user: null,
      }))
    );

    const page = await loadOlderIncidentTimelineActivity(
      'inc-1',
      { eventCursor: { createdAt: at(0).toISOString(), id: 'z' } },
      3
    );

    expect(page.notifications.map(n => n.id)).toEqual(['n0', 'n1', 'n2']);
    // The 20h and 47h events wait for the next page, after the missing notifications are fetched.
    expect(page.events.map(e => e.id)).toEqual(['e0']);
  });
});
