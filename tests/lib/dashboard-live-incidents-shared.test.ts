import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVE_QUERY,
  LIVE_API_PARAMS,
  LIVE_STALE_AFTER_MS,
  LIVE_URL_PARAMS,
  coerceLiveQuery,
  countActiveFacets,
  countLiveFeedChanges,
  diffLiveIncidents,
  formatCountdown,
  formatIncidentAge,
  isActiveStatus,
  liveQueryFromParams,
  liveQueryKey,
  liveQueryToParams,
  resolveConnectionHealth,
  sortLiveIncidents,
  type LiveIncident,
} from '@/lib/dashboard/live-incidents-shared';

function liveIncident(id: string, overrides: Partial<LiveIncident> = {}): LiveIncident {
  return {
    id,
    escalationLevel: null,
    alertCount: 0,
    responderCount: 0,
    title: `Incident ${id}`,
    status: 'OPEN',
    urgency: 'HIGH',
    priority: 'P1',
    escalationStatus: null,
    createdAt: '2026-10-24T10:00:00.000Z',
    updatedAt: '2026-10-24T10:00:00.000Z',
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
    service: { id: 'svc', name: 'Service', teamId: null },
    team: null,
    assignee: null,
    sla: { warning: 'NONE', phase: null, deadline: null },
    ...overrides,
  };
}

describe('live incident query contract', () => {
  it('coerces untrusted input to safe defaults', () => {
    expect(coerceLiveQuery({})).toEqual(DEFAULT_LIVE_QUERY);
    expect(
      coerceLiveQuery({
        scope: 'everyone',
        sort: 'random',
        view: 'ACTIVE',
        serviceId: 'svc;drop',
        teamId: 'team-1',
        status: 'RESOLVED',
        urgency: 'HIGH',
        assignment: 'nobody',
        search: `  ${'x'.repeat(500)}  `,
      })
    ).toEqual({
      scope: 'all',
      sort: 'newest',
      view: 'active',
      serviceId: null,
      teamId: 'team-1',
      status: 'all',
      urgency: 'HIGH',
      assignment: 'all',
      search: 'x'.repeat(120),
    });
  });

  it('round-trips through namespaced URL params and canonical API params', () => {
    const query = coerceLiveQuery({
      view: 'critical',
      serviceId: 'svc-1',
      status: 'OPEN',
      assignment: 'unassigned',
      search: 'gateway',
    });
    const url = liveQueryToParams(query, LIVE_URL_PARAMS);
    expect(url.get('lview')).toBe('critical');
    expect(url.get('lservice')).toBe('svc-1');
    expect(liveQueryFromParams(url)).toEqual(query);
    const api = liveQueryToParams(query, LIVE_API_PARAMS);
    expect(api.toString()).toBe(
      'view=critical&service=svc-1&status=OPEN&assignment=unassigned&q=gateway'
    );
    expect(liveQueryToParams(DEFAULT_LIVE_QUERY).toString()).toBe('');
    expect(liveQueryKey(query)).toBe(api.toString());
    expect(countActiveFacets(query)).toBe(4);
  });

  it('round-trips scope and sort without counting them as filters', () => {
    const query = coerceLiveQuery({ scope: 'teams', sort: 'attention' });
    const url = liveQueryToParams(query, LIVE_URL_PARAMS);
    expect(url.get('lscope')).toBe('teams');
    expect(url.get('lsort')).toBe('attention');
    expect(liveQueryFromParams(url)).toEqual(query);
    expect(liveQueryToParams(query, LIVE_API_PARAMS).toString()).toBe('scope=teams&sort=attention');
    expect(countActiveFacets(query)).toBe(0);
  });

  it('treats ACTIVE as OPEN plus ACKNOWLEDGED only', () => {
    expect(isActiveStatus('OPEN')).toBe(true);
    expect(isActiveStatus('ACKNOWLEDGED')).toBe(true);
    expect(isActiveStatus('ACTIVE')).toBe(false);
    expect(isActiveStatus('RESOLVED')).toBe(false);
  });

  it('sorts newest first with a stable id tie-break', () => {
    const sorted = sortLiveIncidents([
      liveIncident('a', { createdAt: '2026-10-24T10:00:00.000Z' }),
      liveIncident('c', { createdAt: '2026-10-24T12:00:00.000Z' }),
      liveIncident('b', { createdAt: '2026-10-24T12:00:00.000Z' }),
    ]);
    expect(sorted.map(item => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('diffs added, updated (ack/reassign) and removed (resolved) incidents', () => {
    const previous = ['keep', 'ack', 'reassign', 'resolved'].map(id => liveIncident(id));
    const next = [
      liveIncident('new'),
      liveIncident('keep'),
      liveIncident('ack', { status: 'ACKNOWLEDGED', updatedAt: '2026-10-24T10:05:00.000Z' }),
      liveIncident('reassign', { assignee: { id: 'u2', name: 'Riley' } }),
    ];
    const diff = diffLiveIncidents(previous, next);
    expect(diff).toEqual({ added: ['new'], updated: ['ack', 'reassign'], removed: ['resolved'] });
    expect(countLiveFeedChanges(diff)).toBe(4);
    expect(countLiveFeedChanges(diffLiveIncidents(next, next))).toBe(0);
  });

  it('formats compact ages and SLA countdowns', () => {
    const now = Date.parse('2026-10-24T10:00:00.000Z');
    expect(formatIncidentAge('2026-10-24T09:59:30.000Z', now)).toBe('Now');
    expect(formatIncidentAge('2026-10-24T09:57:00.000Z', now)).toBe('3m');
    expect(formatIncidentAge('2026-10-24T07:00:00.000Z', now)).toBe('3h');
    expect(formatIncidentAge('2026-10-22T10:00:00.000Z', now)).toBe('2d');
    expect(formatCountdown('2026-10-24T10:00:45.000Z', now)).toBe('45s left');
    expect(formatCountdown('2026-10-24T10:12:00.000Z', now)).toBe('12m left');
    expect(formatCountdown('2026-10-24T08:55:00.000Z', now)).toBe('1h05m over');
    expect(formatCountdown('2026-10-21T10:00:00.000Z', now)).toBe('3d over');
  });

  it('resolves connection health including stale and offline states', () => {
    const base = {
      isConnected: true,
      revoked: false,
      online: true,
      lastMessageAt: 1_000,
      now: 2_000,
      everConnected: true,
    };
    expect(resolveConnectionHealth(base)).toBe('live');
    expect(resolveConnectionHealth({ ...base, now: 1_000 + LIVE_STALE_AFTER_MS + 1 })).toBe(
      'stale'
    );
    expect(resolveConnectionHealth({ ...base, isConnected: false })).toBe('offline');
    expect(resolveConnectionHealth({ ...base, isConnected: false, everConnected: false })).toBe(
      'connecting'
    );
    expect(resolveConnectionHealth({ ...base, online: false })).toBe('offline');
    expect(resolveConnectionHealth({ ...base, revoked: true })).toBe('revoked');
  });
});
