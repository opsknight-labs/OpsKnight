import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const actor = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: actor.get }));

const view = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/intelligence/squire/briefing-view', () => ({
  getPinnedBriefingForActor: view.read,
}));

const limit = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: limit.check }));

import { GET } from '@/app/api/intelligence/squire/briefing/route';

const make = (query: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000/api/intelligence/squire/briefing${query}`, { headers });

const BRIEFING = { incidentId: 'inc_1', similar: [], changes: [], runbooks: [] };

beforeEach(() => {
  actor.get.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN', status: 'ACTIVE' });
  view.read.mockReset().mockResolvedValue(BRIEFING);
  limit.check.mockReset().mockResolvedValue({ allowed: true });
});

describe('GET /api/intelligence/squire/briefing', () => {
  it('returns the briefing for the session actor, uncached', async () => {
    const response = await GET(make('?incidentId=inc_1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).data).toEqual({ briefing: BRIEFING });
    expect(view.read).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), 'inc_1');
    expect(limit.check).toHaveBeenCalledWith('intelligence:squire-briefing:u1', 60, 60_000);
  });

  it('answers 200 with a null briefing when there is nothing to pin, so existence is not revealed', async () => {
    view.read.mockResolvedValue(null);
    const response = await GET(make('?incidentId=unknown'));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ briefing: null });
  });

  it('refuses cross-site requests before reading anything', async () => {
    const response = await GET(make('?incidentId=inc_1', { 'sec-fetch-site': 'cross-site' }));
    expect(response.status).toBe(403);
    expect(actor.get).not.toHaveBeenCalled();
  });

  it('requires a signed-in, active app session with the suggestions capability', async () => {
    actor.get.mockRejectedValueOnce(new Error('no session'));
    expect((await GET(make('?incidentId=inc_1'))).status).toBe(401);
    actor.get.mockResolvedValueOnce({ id: 'k', role: 'ADMIN', status: 'ACTIVE', apiKey: {} });
    expect((await GET(make('?incidentId=inc_1'))).status).toBe(403);
    actor.get.mockResolvedValueOnce({ id: 'u2', role: 'ADMIN', status: 'DISABLED' });
    expect((await GET(make('?incidentId=inc_1'))).status).toBe(403);
    actor.get.mockResolvedValueOnce({ id: 'u3', role: 'NOT_A_ROLE', status: 'ACTIVE' });
    expect((await GET(make('?incidentId=inc_1'))).status).toBe(403);
    expect(view.read).not.toHaveBeenCalled();
  });

  it.each(['', '?incidentId=', '?incidentId=../x', `?incidentId=${'a'.repeat(65)}`])(
    'rejects a malformed incident id (%s)',
    async query => {
      expect((await GET(make(query))).status).toBe(400);
      expect(view.read).not.toHaveBeenCalled();
    }
  );

  it('is rate limited per person and fails soft when the read throws', async () => {
    limit.check.mockResolvedValueOnce({ allowed: false });
    expect((await GET(make('?incidentId=inc_1'))).status).toBe(429);
    expect(view.read).not.toHaveBeenCalled();
    view.read.mockRejectedValueOnce(new Error('db down'));
    expect((await GET(make('?incidentId=inc_1'))).status).toBe(503);
  });
});
