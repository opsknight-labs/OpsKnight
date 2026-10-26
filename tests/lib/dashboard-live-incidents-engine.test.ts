import { describe, expect, it } from 'vitest';
import {
  computeSlaSignal,
  deriveAttention,
  deriveLiveProjection,
  deriveShared,
  deriveTrend,
  deriveUnshared,
  isActorNeutralQuery,
  personalizeDerivation,
  type LiveSetRow,
  type LiveTrendRow,
} from '@/lib/dashboard/live-incidents-engine';
import { DEFAULT_LIVE_QUERY, type LiveIncidentQuery } from '@/lib/dashboard/live-incidents-shared';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const ctx = { actorId: 'me', teamIds: ['team-a'], now: NOW };

function row(id: string, overrides: Partial<LiveSetRow> = {}): LiveSetRow {
  return {
    id,
    escalationLevel: null,
    alertCount: 0,
    responderCount: 0,
    title: `Incident ${id}`,
    status: 'OPEN',
    urgency: 'LOW',
    priority: 'P3',
    escalationStatus: null,
    createdAt: '2026-10-24T11:00:00.000Z',
    updatedAt: '2026-10-24T11:00:00.000Z',
    acknowledgedAt: null,
    slaFirstAcknowledgedAt: null,
    slaAckTargetMs: null,
    slaResolveTargetMs: null,
    slaTargetSource: null,
    slaTargetCapturedAt: null,
    slaPausedMs: 0,
    slaPauseStartedAt: null,
    slaAckElapsedMs: null,
    slaResolveElapsedMs: null,
    service: { id: 'svc-a', name: 'API', teamId: 'team-a' },
    team: { id: 'team-a', name: 'Alpha' },
    assignee: null,
    ...overrides,
  };
}

const withSla = (createdAt: string, ackTargetMs: number): Partial<LiveSetRow> => ({
  createdAt,
  slaAckTargetMs: ackTargetMs,
  slaResolveTargetMs: ackTargetMs * 8,
  slaTargetSource: 'SERVICE_DEFAULT',
  slaTargetCapturedAt: createdAt,
});

const set: LiveSetRow[] = [
  row('critical-mine', {
    urgency: 'HIGH',
    priority: 'P1',
    createdAt: '2026-10-24T11:50:00.000Z',
    assignee: { id: 'me', name: 'Me' },
  }),
  row('acked-other-team', {
    status: 'ACKNOWLEDGED',
    urgency: 'MEDIUM',
    priority: 'P2',
    createdAt: '2026-10-24T11:40:00.000Z',
    service: { id: 'svc-b', name: 'Billing', teamId: 'team-b' },
    team: { id: 'team-b', name: 'Bravo' },
    assignee: { id: 'peer', name: 'Peer' },
  }),
  row('breached', withSla('2026-10-24T11:00:00.000Z', 15 * 60_000)),
  row('payment-search', {
    title: 'Payment processor errors',
    createdAt: '2026-10-24T10:00:00.000Z',
  }),
];

const derive = (query: Partial<LiveIncidentQuery> = {}, limit = 50) =>
  deriveLiveProjection(set, { ...DEFAULT_LIVE_QUERY, ...query }, ctx, limit);

describe('live projection engine', () => {
  it('returns every active incident newest first by default', () => {
    const result = derive();
    expect(result.incidents.map(item => item.id)).toEqual([
      'critical-mine',
      'acked-other-team',
      'breached',
      'payment-search',
    ]);
    expect(result.total).toBe(4);
  });

  it('applies views', () => {
    expect(derive({ view: 'critical' }).incidents.map(item => item.id)).toEqual(['critical-mine']);
    expect(derive({ view: 'mine' }).incidents.map(item => item.id)).toEqual(['critical-mine']);
    expect(derive({ view: 'my_teams' }).total).toBe(3);
    expect(derive({ view: 'unassigned' }).total).toBe(2);
    expect(derive({ view: 'breaching' }).incidents.map(item => item.id)).toEqual(['breached']);
  });

  it('applies facets and search, bounded by the limit', () => {
    expect(derive({ serviceId: 'svc-b' }).incidents.map(item => item.id)).toEqual([
      'acked-other-team',
    ]);
    expect(derive({ teamId: 'team-b' }).total).toBe(1);
    expect(derive({ status: 'ACKNOWLEDGED' }).total).toBe(1);
    expect(derive({ urgency: 'HIGH' }).total).toBe(1);
    expect(derive({ assignment: 'assigned' }).total).toBe(2);
    expect(derive({ search: 'PAYMENT' }).incidents.map(item => item.id)).toEqual([
      'payment-search',
    ]);
    expect(derive({ search: 'billing' }).total).toBe(1);
    const limited = derive({}, 2);
    expect(limited.incidents).toHaveLength(2);
    expect(limited.total).toBe(4);
  });

  it('computes facet counts excluding the facet being counted', () => {
    const { facets } = derive({ status: 'OPEN', serviceId: 'svc-a' });
    // Status counts ignore the status facet but respect the service facet.
    expect(facets.status).toEqual({ OPEN: 3, ACKNOWLEDGED: 0 });
    // Service counts ignore the service facet but respect the status facet.
    expect(facets.services.map(option => [option.id, option.count])).toEqual([['svc-a', 3]]);
    // View counts respect all facets.
    expect(facets.views.active).toBe(3);
    expect(facets.views.critical).toBe(1);
    expect(facets.assignment).toEqual({ assigned: 1, unassigned: 2 });
  });

  it('summarizes the whole scoped set regardless of the current view', () => {
    const { summary } = derive({ view: 'mine', search: 'nothing-matches' });
    expect(summary).toEqual({
      visibleActive: 4,
      active: 4,
      triggered: 3,
      acknowledged: 1,
      critical: 1,
      unassigned: 2,
      unassignedCritical: 0,
      slaBreached: 1,
      slaAtRisk: 1,
      slaDueSoon: 0,
      slaRecentlyBreached: 1,
      mine: 1,
    });
  });

  it('derives rail projections', () => {
    const result = derive({ view: 'critical' });
    expect(result.myQueue.map(item => item.id)).toEqual(['critical-mine']);
    expect(result.slaRisk.map(item => item.id)).toEqual(['breached']);
    expect(result.servicesAtRisk[0]).toMatchObject({ id: 'svc-a', count: 3, critical: 1 });
  });

  it('signals SLA approach and breach on the acknowledge phase', () => {
    const breached = computeSlaSignal(
      row('x', withSla('2026-10-24T11:00:00.000Z', 15 * 60_000)),
      NOW
    );
    expect(breached).toMatchObject({ warning: 'BREACHED', phase: 'ack' });
    expect(Date.parse(breached.deadline!)).toBeLessThan(NOW);
    const fine = computeSlaSignal(row('y', withSla('2026-10-24T11:59:00.000Z', 60 * 60_000)), NOW);
    expect(fine.warning).toBe('NONE');
    expect(computeSlaSignal(row('z'), NOW)).toEqual({
      warning: 'NONE',
      phase: null,
      deadline: null,
    });
  });

  it('applies scope before views and keeps "mine" counted across the full set', () => {
    const teams = derive({ scope: 'teams' });
    expect(teams.incidents.map(item => item.id)).toEqual([
      'critical-mine',
      'breached',
      'payment-search',
    ]);
    expect(teams.summary.active).toBe(3);
    const mine = derive({ scope: 'mine' });
    expect(mine.incidents.map(item => item.id)).toEqual(['critical-mine']);
    expect(mine.summary).toMatchObject({ active: 1, mine: 1 });
    // A peer's incident outside my teams is never in the teams scope.
    expect(teams.incidents.some(item => item.id === 'acked-other-team')).toBe(false);
  });

  it('sorts by attention: critical first, then SLA risk, then unowned, then newest', () => {
    const ids = derive({ sort: 'attention' }).incidents.map(item => item.id);
    expect(ids).toEqual(['critical-mine', 'breached', 'payment-search', 'acked-other-team']);
  });

  it('returns pinned incidents in pin order, independent of view and filters', () => {
    const result = deriveLiveProjection(
      set,
      { ...DEFAULT_LIVE_QUERY, view: 'critical', search: 'nothing' },
      ctx,
      50,
      { pinIds: ['payment-search', 'missing', 'acked-other-team'] }
    );
    expect(result.incidents).toHaveLength(0);
    expect(result.pinned.map(item => item.id)).toEqual(['payment-search', 'acked-other-team']);
  });

  it('separates "due within 10 minutes" from "breached in the last hour"', () => {
    const dueSoon = row('due-soon', withSla('2026-10-24T11:55:00.000Z', 10 * 60_000));
    const overdueLong = row('overdue-long', withSla('2026-10-24T09:00:00.000Z', 15 * 60_000));
    const { summary } = deriveLiveProjection(
      [...set, dueSoon, overdueLong],
      DEFAULT_LIVE_QUERY,
      ctx,
      50
    );
    expect(summary.slaDueSoon).toBe(1);
    expect(summary.slaRecentlyBreached).toBe(1);
    expect(summary.slaBreached).toBe(2);
    expect(summary.slaAtRisk).toBe(2);
  });

  it('derives a bounded needs-attention list with actionable labels', () => {
    const { incidents } = deriveLiveProjection(
      [
        ...set,
        row('unowned-p1', { urgency: 'HIGH', priority: 'P1' }),
        row('escalated', {
          escalationLevel: 3,
          assignee: { id: 'peer', name: 'Peer' },
        }),
      ],
      DEFAULT_LIVE_QUERY,
      ctx,
      50
    );
    const items = deriveAttention(incidents, NOW);
    expect(items.map(item => [item.incident.id, item.reason])).toEqual([
      ['breached', 'sla'],
      ['unowned-p1', 'unowned'],
      ['escalated', 'escalated'],
    ]);
    expect(items[0]?.label).toBe('Ack 45m late');
    expect(items[1]?.label).toBe('No owner · P1');
    expect(items[2]?.label).toBe('Escalated L3');
  });

  it('builds 24 hourly trend buckets, last-hour deltas and MTTA/MTTR within scope', () => {
    const trendRow = (overrides: Partial<LiveTrendRow>): LiveTrendRow => ({
      createdAt: '2026-10-24T11:30:00.000Z',
      acknowledgedAt: null,
      resolvedAt: null,
      critical: false,
      assigneeId: null,
      teamId: 'team-a',
      serviceTeamId: 'team-a',
      ...overrides,
    });
    const rows = [
      trendRow({ critical: true, acknowledgedAt: '2026-10-24T11:40:00.000Z' }),
      trendRow({
        createdAt: '2026-10-24T08:00:00.000Z',
        acknowledgedAt: '2026-10-24T08:20:00.000Z',
        resolvedAt: '2026-10-24T09:00:00.000Z',
      }),
      trendRow({ teamId: 'team-b', serviceTeamId: 'team-b' }),
      trendRow({ createdAt: '2026-10-22T08:00:00.000Z' }),
    ];
    const all = deriveTrend(rows, 'all', ctx);
    expect(all.created).toHaveLength(24);
    expect(all.created.reduce((sum, value) => sum + value, 0)).toBe(3);
    expect(all.created.at(-1)).toBe(2);
    expect(all.createdLastHour).toBe(2);
    expect(all.createdCriticalLastHour).toBe(1);
    expect(all.acknowledgedLastHour).toBe(1);
    expect(all.resolved24h).toBe(1);
    expect(all.mtta24h).toBe(15);
    expect(all.mttr24h).toBe(60);

    const teams = deriveTrend(rows, 'teams', ctx);
    expect(teams.createdLastHour).toBe(1);
    expect(deriveTrend(rows, 'mine', ctx).createdLastHour).toBe(0);
  });

  it('shares the actor-independent derivation and personalizes it identically to a full derivation', () => {
    const big: LiveSetRow[] = Array.from({ length: 240 }, (_, index) =>
      row(`bulk-${index}`, {
        urgency: index % 7 === 0 ? 'HIGH' : index % 3 === 0 ? 'MEDIUM' : 'LOW',
        priority: index % 7 === 0 ? 'P1' : 'P3',
        status: index % 4 === 0 ? 'ACKNOWLEDGED' : 'OPEN',
        createdAt: new Date(NOW - (index + 1) * 90_000).toISOString(),
        service: {
          id: `svc-${index % 5}`,
          name: `Service ${index % 5}`,
          teamId: `team-${index % 3}`,
        },
        team: index % 2 ? { id: `team-${index % 3}`, name: `Team ${index % 3}` } : null,
        assignee:
          index % 5 === 0
            ? { id: 'me', name: 'Me' }
            : index % 4 === 0
              ? { id: 'peer', name: 'Peer' }
              : null,
        ...(index % 6 === 0 ? withSla(new Date(NOW - 20 * 60_000).toISOString(), 15 * 60_000) : {}),
      })
    );
    const actors = [
      { actorId: 'me', teamIds: ['team-1'], now: NOW },
      { actorId: 'peer', teamIds: ['team-0', 'team-2'], now: NOW },
      { actorId: 'nobody', teamIds: [], now: NOW },
    ];
    const queries: Array<Partial<LiveIncidentQuery>> = [
      {},
      { view: 'critical' },
      { view: 'unassigned' },
      { view: 'breaching' },
      { serviceId: 'svc-2' },
      { teamId: 'team-1', status: 'OPEN' },
      { urgency: 'HIGH', assignment: 'unassigned' },
      { search: 'bulk-1' },
      { sort: 'attention' },
    ];
    for (const partial of queries) {
      const query = { ...DEFAULT_LIVE_QUERY, ...partial };
      expect(isActorNeutralQuery(query)).toBe(true);
      const shared = deriveShared(big, query, NOW);
      for (const ctxForActor of actors) {
        const pins = ['bulk-3', 'missing', 'bulk-9'];
        const viaShared = personalizeDerivation(shared, query, ctxForActor, 20, pins);
        const reference = deriveUnshared(big, query, ctxForActor, 20, { pinIds: pins });
        expect(viaShared).toEqual(reference);
      }
    }
    // Queries that depend on the viewer are never shared.
    for (const view of ['mine', 'my_teams'] as const) {
      expect(isActorNeutralQuery({ ...DEFAULT_LIVE_QUERY, view })).toBe(false);
    }
    expect(isActorNeutralQuery({ ...DEFAULT_LIVE_QUERY, scope: 'teams' })).toBe(false);
  });

  it('keeps the visible active count and critical alerts independent of scope and filters', () => {
    const narrowed = derive({ scope: 'mine', view: 'unassigned', search: 'zzz' });
    expect(narrowed.summary.active).toBeLessThan(4);
    expect(narrowed.summary.visibleActive).toBe(4);
    expect(narrowed.alerts.map(item => item.id)).toEqual(['critical-mine']);
    // Same through the shared (actor-neutral) path and the full per-viewer path.
    const full = derive({ view: 'critical' });
    expect(full.summary.visibleActive).toBe(4);
    expect(full.alerts.map(item => item.id)).toEqual(['critical-mine']);
  });
});
