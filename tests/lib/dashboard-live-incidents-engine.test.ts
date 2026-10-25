import { describe, expect, it } from 'vitest';
import {
  computeSlaSignal,
  deriveLiveProjection,
  type LiveSetRow,
} from '@/lib/dashboard/live-incidents-engine';
import { DEFAULT_LIVE_QUERY, type LiveIncidentQuery } from '@/lib/dashboard/live-incidents-shared';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const ctx = { actorId: 'me', teamIds: ['team-a'], now: NOW };

function row(id: string, overrides: Partial<LiveSetRow> = {}): LiveSetRow {
  return {
    id,
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
      active: 4,
      triggered: 3,
      acknowledged: 1,
      critical: 1,
      unassigned: 2,
      slaBreached: 1,
      slaAtRisk: 1,
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
});
