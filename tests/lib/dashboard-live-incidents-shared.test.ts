import { describe, expect, it } from 'vitest';
import {
  LIVE_STALE_AFTER_MS,
  countLiveFeedChanges,
  diffLiveIncidents,
  formatIncidentAge,
  isActiveStatus,
  parseLiveIncidentFilter,
  resolveConnectionHealth,
  sortLiveIncidents,
  type LiveIncident,
} from '@/lib/dashboard/live-incidents-shared';

function incident(id: string, overrides: Partial<LiveIncident> = {}): LiveIncident {
  return {
    id,
    title: `Incident ${id}`,
    status: 'OPEN',
    urgency: 'HIGH',
    priority: 'P1',
    createdAt: '2026-10-24T10:00:00.000Z',
    updatedAt: '2026-10-24T10:00:00.000Z',
    service: { id: 'svc', name: 'Service' },
    team: null,
    assignee: null,
    ...overrides,
  };
}

describe('live incident feed contract', () => {
  it('defaults to all active and rejects unknown filters', () => {
    expect(parseLiveIncidentFilter(undefined)).toBe('active');
    expect(parseLiveIncidentFilter('my_teams')).toBe('my_teams');
    expect(parseLiveIncidentFilter('ACTIVE')).toBeNull();
    expect(parseLiveIncidentFilter('resolved')).toBeNull();
  });

  it('treats ACTIVE as OPEN plus ACKNOWLEDGED only', () => {
    expect(isActiveStatus('OPEN')).toBe(true);
    expect(isActiveStatus('ACKNOWLEDGED')).toBe(true);
    expect(isActiveStatus('ACTIVE')).toBe(false);
    expect(isActiveStatus('RESOLVED')).toBe(false);
    expect(isActiveStatus('SNOOZED')).toBe(false);
  });

  it('sorts newest first with a stable id tie-break', () => {
    const sorted = sortLiveIncidents([
      incident('a', { createdAt: '2026-10-24T10:00:00.000Z' }),
      incident('c', { createdAt: '2026-10-24T12:00:00.000Z' }),
      incident('b', { createdAt: '2026-10-24T12:00:00.000Z' }),
    ]);
    expect(sorted.map(item => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('diffs added, updated (ack/reassign) and removed (resolved) incidents', () => {
    const previous = [
      incident('keep'),
      incident('ack'),
      incident('reassign'),
      incident('resolved'),
    ];
    const next = [
      incident('new'),
      incident('keep'),
      incident('ack', { status: 'ACKNOWLEDGED', updatedAt: '2026-10-24T10:05:00.000Z' }),
      incident('reassign', { assignee: { id: 'u2', name: 'Riley' } }),
    ];
    const diff = diffLiveIncidents(previous, next);
    expect(diff).toEqual({ added: ['new'], updated: ['ack', 'reassign'], removed: ['resolved'] });
    expect(countLiveFeedChanges(diff)).toBe(4);
    expect(countLiveFeedChanges(diffLiveIncidents(next, next))).toBe(0);
  });

  it('formats compact ages', () => {
    const now = Date.parse('2026-10-24T10:00:00.000Z');
    expect(formatIncidentAge('2026-10-24T09:59:30.000Z', now)).toBe('Now');
    expect(formatIncidentAge('2026-10-24T09:57:00.000Z', now)).toBe('3m');
    expect(formatIncidentAge('2026-10-24T07:00:00.000Z', now)).toBe('3h');
    expect(formatIncidentAge('2026-10-22T10:00:00.000Z', now)).toBe('2d');
    expect(formatIncidentAge('2026-10-24T10:00:05.000Z', now)).toBe('Now');
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
