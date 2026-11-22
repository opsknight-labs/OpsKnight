import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import {
  alertSearchWhere,
  countAlertsForActor,
  listAlertsForActor,
} from '@/lib/intelligence/lists/alerts';
import { changeSearchWhere, countChangesForActor } from '@/lib/intelligence/lists/changes';
import { parseAlertListFilters, parseChangeListFilters } from '@/lib/intelligence/lists/contract';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const admin: AuthorizationActor = { id: 'u1', role: 'ADMIN', status: 'ACTIVE', teamIds: [] };
const scoped: AuthorizationActor = {
  id: 'u2',
  role: 'USER',
  status: 'ACTIVE',
  teamIds: ['team-a'],
};
const NOW = new Date('2026-11-20T12:00:00Z');

/** A client whose budgeted transaction hands the work a fake tx and records every read. */
function fakeClient(tx: Record<string, unknown>) {
  return {
    $transaction: (work: (tx: unknown) => unknown) =>
      work({ $queryRaw: async () => [{ pid: 1 }], ...tx }),
  } as never;
}

const json = (value: unknown) => JSON.stringify(value);

describe('alerts list search', () => {
  it('matches the summary, title, dedup key, resource and service name', () => {
    const where = alertSearchWhere('disk');
    expect(json(where)).toContain('"path":["summary"]');
    expect(json(where)).toContain('"path":["title"]');
    for (const field of ['dedupKey', 'resourceKey']) {
      expect(where.OR).toContainEqual({ [field]: { contains: 'disk', mode: 'insensitive' } });
    }
    expect(where.OR).toContainEqual({
      service: { name: { contains: 'disk', mode: 'insensitive' } },
    });
  });

  it('applies the search to the page walk alongside the actor scope', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await listAlertsForActor(scoped, parseAlertListFilters({ q: 'disk' }), {
      now: NOW,
      client: fakeClient({
        alert: { findMany },
        service: { findMany: vi.fn().mockResolvedValue([]) },
      }),
    });
    const where = json(findMany.mock.calls[0][0].where);
    expect(where).toContain('"team-a"');
    expect(where).toContain('"contains":"disk"');
  });

  it('counts the filtered alerts in the window, scoped like the list', async () => {
    const count = vi.fn().mockResolvedValue(42);
    const total = await countAlertsForActor(
      scoped,
      parseAlertListFilters({ q: 'disk', severity: 'critical', cursor: 'ignored' }),
      { now: NOW, client: fakeClient({ alert: { count } }) }
    );
    expect(total).toBe(42);
    const where = json(count.mock.calls[0][0].where);
    expect(where).toContain('"team-a"');
    expect(where).toContain('"severity":"critical"');
    expect(where).toContain('"contains":"disk"');
    expect(where).toContain('"createdAt"');
  });

  it('does not guess a count under a decision filter', async () => {
    const count = vi.fn();
    const total = await countAlertsForActor(admin, parseAlertListFilters({ decision: 'grouped' }), {
      client: fakeClient({ alert: { count } }),
    });
    expect(total).toBeNull();
    expect(count).not.toHaveBeenCalled();
  });
});

describe('changes list search', () => {
  it('matches the summary, source, version and component case-insensitively', () => {
    const where = changeSearchWhere('v43');
    for (const field of ['summary', 'source', 'version', 'component']) {
      expect(where.OR).toContainEqual({ [field]: { contains: 'v43', mode: 'insensitive' } });
    }
  });

  it('counts the filtered changes in the window, scoped like the list', async () => {
    const count = vi.fn().mockResolvedValue(3);
    const total = await countChangesForActor(
      scoped,
      parseChangeListFilters({ q: 'v43', risk: 'high' }),
      { now: NOW, client: fakeClient({ changeEvent: { count } }) }
    );
    expect(total).toBe(3);
    const where = json(count.mock.calls[0][0].where);
    expect(where).toContain('"team-a"');
    expect(where).toContain('"contains":"v43"');
    expect(where).toContain('"riskScore"');
  });
});
