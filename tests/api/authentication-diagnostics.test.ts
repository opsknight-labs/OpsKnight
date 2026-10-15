// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/auth/control/diagnostics/route';
import { getControlActor } from '@/lib/auth-control/actor';
import { consumeAuthRateLimit } from '@/lib/auth-abuse';
import { authenticationDiagnosticPage } from '@/lib/auth-control/diagnostic-queries';
vi.mock('@/lib/auth-control/actor', () => ({ getControlActor: vi.fn() }));
vi.mock('@/lib/auth-abuse', () => ({ consumeAuthRateLimit: vi.fn() }));
vi.mock('@/lib/auth-control/diagnostic-queries', () => ({ authenticationDiagnosticPage: vi.fn() }));
const request = (query = '') =>
  new NextRequest(`https://instance.example.test/api/auth/control/diagnostics${query}`);
beforeEach(() => {
  vi.mocked(getControlActor).mockResolvedValue({
    kind: 'admin',
    id: 'admin',
    tokenVersion: 0,
    authenticatedAt: Date.now(),
  });
  vi.mocked(consumeAuthRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 119,
    resetAt: Date.now() + 60000,
    count: 1,
  });
  vi.mocked(authenticationDiagnosticPage).mockResolvedValue({
    items: [],
    hasMore: false,
    nextCursor: null,
    pageSize: 25,
    snapshotAt: new Date().toISOString(),
  });
});
describe('authentication diagnostic read boundary', () => {
  it('requires authorized administration or restricted recovery', async () => {
    vi.mocked(getControlActor).mockRejectedValue(new Error('No authority'));
    expect((await GET(request())).status).toBe(403);
    expect(authenticationDiagnosticPage).not.toHaveBeenCalled();
  });
  it('returns non-cacheable paginated results and normalized filters', async () => {
    const response = await GET(request('?view=sessions&method=oidc&pageSize=50'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(authenticationDiagnosticPage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin' }),
      expect.objectContaining({ method: 'oidc', pageSize: 50 })
    );
  });
  it.each([
    '?pageSize=100000',
    '?range=custom',
    '?token=secret',
    '?view=unknown',
    '?view=audit&state=ACTIVE',
    '?view=deliveries&method=oidc',
  ])('rejects malformed filters %s', async query =>
    expect((await GET(request(query))).status).toBe(400)
  );
  it('limits reads across replicas', async () => {
    vi.mocked(consumeAuthRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60000,
      count: 121,
    });
    expect((await GET(request())).status).toBe(429);
  });
  it('returns a recoverable message without leaking database details', async () => {
    vi.mocked(authenticationDiagnosticPage).mockRejectedValue(
      new Error('Postgres internal secret')
    );
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('Postgres internal');
  });
});
