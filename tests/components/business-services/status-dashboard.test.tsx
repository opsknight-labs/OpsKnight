import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createFakeBusinessServiceEngine } from '@/lib/business-services/__fixtures__/health';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const now = Date.now();
const fake = createFakeBusinessServiceEngine({
  services: [
    { id: 'search', name: 'Search', criticality: 'TIER_2', ownerTeam: null, memberCount: 2 },
    {
      id: 'checkout',
      name: 'Checkout',
      criticality: 'TIER_0',
      ownerTeam: null,
      memberCount: 5,
      status: 'PARTIAL_OUTAGE',
      health: { impactedMemberCount: 2, openIncidentCount: 1, since: new Date(now - 600_000) },
    },
    {
      id: 'payments',
      name: 'Payments',
      criticality: 'TIER_1',
      ownerTeam: null,
      memberCount: 3,
      status: 'MAJOR_OUTAGE',
      health: { impactedMemberCount: 3, openIncidentCount: 2 },
    },
    {
      id: 'login',
      name: 'Login',
      criticality: 'TIER_0',
      ownerTeam: null,
      memberCount: 1,
      status: 'MAINTENANCE',
    },
  ],
});

// The page code imports the real contract; the stub engine is swapped for the fixture engine.
// A getter, because vi.mock is hoisted above `fake`; the contract reads `engine` at call time.
vi.mock('@/lib/business-services/health-impl', () => ({
  get engine() {
    return fake.engine;
  },
}));

const prisma = vi.hoisted(() => ({
  businessService: { findMany: vi.fn() },
  statusDashboardBusinessService: { findMany: vi.fn() },
  statusPageAnnouncement: { findMany: vi.fn() },
  maintenanceWindow: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ default: prisma }));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn() }));
vi.mock('@/contexts/TimezoneContext', () => ({ useTimezone: () => ({ userTimeZone: 'UTC' }) }));

import {
  createStatusDashboard,
  isEngineNotReady,
  loadStatusBoard,
  StatusDashboardInputSchema,
} from '@/lib/business-services/dashboards';
import StatusBoard, { sortTiles } from '@/components/business-service/StatusBoard';

const stakeholder: AuthorizationActor = {
  id: 'u1',
  role: 'STAKEHOLDER',
  status: 'ACTIVE',
  teamIds: ['t1'],
};
const tiles = ['search', 'checkout', 'payments', 'login'].map(id => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  criticality: null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  prisma.businessService.findMany.mockResolvedValue(tiles);
  prisma.statusPageAnnouncement.findMany.mockResolvedValue([
    {
      id: 'a1',
      title: 'Card payments slower than usual',
      message: 'We are investigating.',
      startDate: new Date(now - 60_000),
      endDate: null,
      maintenanceWindowId: null,
    },
    {
      id: 'a2',
      title: 'Login maintenance (announcement copy)',
      message: null,
      startDate: new Date(now - 60_000),
      endDate: null,
      maintenanceWindowId: 'mw1',
    },
  ]);
  prisma.maintenanceWindow.findMany.mockResolvedValue([
    {
      id: 'mw1',
      title: 'Login database upgrade',
      description: 'Sign-in may be slow.',
      startsAt: new Date(now - 60_000),
      endsAt: new Date(now + 3_600_000),
      businessServices: [{ businessService: { name: 'Login' } }],
    },
  ]);
});

describe('status dashboard', () => {
  it('loads tiles scoped to the viewer and live notices, each window once', async () => {
    const board = await loadStatusBoard(stakeholder);
    const where = prisma.businessService.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      OR: [
        { ownerTeamId: { in: ['t1'] } },
        { members: { some: { service: { teamId: { in: ['t1'] } } } } },
      ],
    });
    expect(board.tiles.map(tile => tile.health.status)).toEqual([
      'OPERATIONAL',
      'PARTIAL_OUTAGE',
      'MAJOR_OUTAGE',
      'MAINTENANCE',
    ]);
    expect(board.notices.map(notice => notice.title)).toEqual([
      'Login database upgrade',
      'Card payments slower than usual',
    ]);
  });

  it('reads a custom dashboard in its own order', async () => {
    prisma.statusDashboardBusinessService.findMany.mockResolvedValue([
      { businessService: tiles[1] },
    ]);
    const board = await loadStatusBoard(stakeholder, { dashboardId: 'd1' });
    expect(prisma.statusDashboardBusinessService.findMany.mock.calls[0][0].where.dashboardId).toBe(
      'd1'
    );
    expect(board.tiles.map(tile => tile.id)).toEqual(['checkout']);
  });

  it('sorts worst first, then by tier, and stays free of incident details', async () => {
    const board = await loadStatusBoard(stakeholder);
    const withTiers = board.tiles.map(tile => ({
      ...tile,
      criticality: tile.id === 'search' ? ('TIER_0' as const) : null,
    }));
    expect(sortTiles(withTiers).map(tile => tile.id)).toEqual([
      'payments',
      'checkout',
      'login',
      'search',
    ]);
    render(<StatusBoard tiles={board.tiles} notices={board.notices} now={board.computedAt} />);
    expect(screen.getByRole('region', { name: 'Overall status' })).toHaveTextContent(
      '2 of 4 business services impacted'
    );
    const list = screen.getAllByRole('list')[1];
    const links = within(list).getAllByRole('link');
    expect(links.map(link => link.getAttribute('aria-label'))).toEqual([
      'Payments: Major outage',
      'Checkout: Partial outage',
      'Login: Maintenance',
      'Search: Operational',
    ]);
    expect(links[1]).toHaveAttribute('href', '/services/business/checkout');
    expect(links[1]).toHaveTextContent('2 of 5 services impacted · 1 open incident');
    expect(screen.getByText('Login database upgrade')).toBeInTheDocument();
    expect(screen.queryByText(/announcement copy/)).toBeNull();
  });

  it('says all clear when nothing is impacted', () => {
    render(
      <StatusBoard
        tiles={[
          {
            id: 'search',
            name: 'Search',
            criticality: null,
            health: { ...fakeOperational('search') },
          },
        ]}
        notices={[]}
        now={new Date()}
      />
    );
    expect(screen.getByRole('region', { name: 'Overall status' })).toHaveTextContent(
      'All business services are operational'
    );
  });

  it('recognises the placeholder engine so pages can show a calm state', async () => {
    const stub = await vi.importActual<typeof import('@/lib/business-services/health-impl')>(
      '@/lib/business-services/health-impl'
    );
    const error = await stub.engine.getBusinessServiceHealth([], stakeholder).catch(e => e);
    expect(isEngineNotReady(error)).toBe(true);
    expect(isEngineNotReady(new Error('connection refused'))).toBe(false);
  });

  it('only lets managers create dashboards and validates the URL', async () => {
    await expect(
      createStatusDashboard({ name: 'Leadership', slug: 'leadership' }, { actor: stakeholder })
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(StatusDashboardInputSchema.safeParse({ name: 'x', slug: 'Payments Team' }).success).toBe(
      false
    );
    expect(StatusDashboardInputSchema.safeParse({ name: 'x', slug: '-payments' }).success).toBe(
      false
    );
    expect(StatusDashboardInputSchema.safeParse({ name: 'x', slug: 'pay--ments' }).success).toBe(
      false
    );
    expect(StatusDashboardInputSchema.parse({ name: ' x ', slug: 'payments-eu' })).toEqual({
      name: 'x',
      slug: 'payments-eu',
      businessServiceIds: [],
    });
  });
});

function fakeOperational(id: string) {
  return {
    businessServiceId: id,
    status: 'OPERATIONAL' as const,
    since: null,
    reasons: [],
    openIncidentCount: 0,
    memberCount: 1,
    impactedMemberCount: 0,
    computedAt: new Date(0),
  };
}
