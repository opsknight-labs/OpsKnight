import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ actor: vi.fn(), page: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: mocks.actor }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/dashboard/live-incidents', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/dashboard/live-incidents')>();
  return { ...actual, getLiveIncidentPage: mocks.page };
});

import { GET } from '@/app/api/dashboard/live/page/route';
import { AppError } from '@/lib/errors';
import { encodeLiveCursor } from '@/lib/dashboard/live-incidents';

const url = (query = '') => new Request(`http://localhost/api/dashboard/live/page${query}`);

describe('GET /api/dashboard/live/page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue({ id: 'user-1', role: 'USER', teamIds: ['t'] });
    mocks.page.mockResolvedValue({ incidents: [], nextCursor: null });
  });

  it('derives authorization from the session and passes only a position as the cursor', async () => {
    const cursor = encodeLiveCursor({ createdAt: '2026-10-24T10:00:00.000Z', id: 'inc-9' });
    const response = await GET(url(`?view=critical&scope=teams&q=api&limit=10&cursor=${cursor}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.page).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1' }),
      expect.objectContaining({ view: 'critical', scope: 'teams', search: 'api' }),
      { cursor, limit: 10 }
    );
  });

  it('rejects unauthenticated, forged, unpageable and malformed requests without querying', async () => {
    mocks.actor.mockRejectedValueOnce(new AppError({ code: 'AUTHENTICATION_REQUIRED' }));
    await expect(GET(url())).resolves.toMatchObject({ status: 401 });
    for (const query of [
      '?view=breaching',
      '?cursor=not-a-cursor',
      '?userId=admin',
      '?limit=500',
      '?view=critical&view=active',
      '?service=a%3Bb',
    ]) {
      await expect(GET(url(query))).resolves.toMatchObject({ status: 400 });
    }
    expect(mocks.page).not.toHaveBeenCalled();
  });

  it('fails closed without leaking internals', async () => {
    mocks.page.mockRejectedValueOnce(new Error('db exploded: secret-host'));
    const response = await GET(url());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret-host');
  });
});
