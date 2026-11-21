import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), request: vi.fn(), rate: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: mock.actor }));
vi.mock('@/lib/intelligence/analysis/view', () => ({ readIncidentAnalysisState: mock.read }));
vi.mock('@/lib/intelligence/analysis/request', () => ({ requestIncidentAnalysis: mock.request }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mock.rate }));
import { GET, POST } from '@/app/api/intelligence/incidents/[id]/analysis/route';
const url = 'http://localhost:3000/api/intelligence/incidents/incident-1/analysis';
const context = { params: Promise.resolve({ id: 'incident-1' }) };
const post = (body = '{}', headers: Record<string, string> = {}) =>
  new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
beforeEach(() => {
  mock.actor
    .mockReset()
    .mockResolvedValue({ id: 'user-1', role: 'ADMIN', status: 'ACTIVE', teamIds: [] });
  mock.read
    .mockReset()
    .mockResolvedValue({ status: 'CURRENT', message: 'Checked', canRefresh: true });
  mock.request.mockReset().mockResolvedValue('requested');
  mock.rate.mockReset().mockResolvedValue({ allowed: true });
});
it('returns scoped state without cache and hides missing or unreadable incidents uniformly', async () => {
  const result = await GET(new NextRequest(url), context);
  expect(result.headers.get('cache-control')).toContain('no-store');
  expect((await result.json()).data.analysis.status).toBe('CURRENT');
  mock.read.mockResolvedValue(null);
  expect((await GET(new NextRequest(url), context)).status).toBe(404);
});
it('refuses API keys, inactive sessions and cross-site requests before any state read', async () => {
  expect(
    (await GET(new NextRequest(url, { headers: { 'sec-fetch-site': 'same-site' } }), context))
      .status
  ).toBe(403);
  mock.actor.mockResolvedValue({ id: 'u', role: 'ADMIN', status: 'ACTIVE', apiKey: { id: 'key' } });
  expect((await GET(new NextRequest(url), context)).status).toBe(403);
  mock.actor.mockResolvedValue({ id: 'u', role: 'ADMIN', status: 'DISABLED' });
  expect((await POST(post(), context)).status).toBe(403);
  expect(mock.read).not.toHaveBeenCalled();
  expect(mock.request).not.toHaveBeenCalled();
});
it('requires operator permission and rejects arbitrary job input and oversized bodies', async () => {
  mock.actor.mockResolvedValueOnce({ id: 'u', role: 'USER', status: 'ACTIVE' });
  expect((await POST(post(), context)).status).toBe(403);
  expect((await POST(post('{"kind":"SEND_DIGEST"}'), context)).status).toBe(400);
  expect((await POST(post(JSON.stringify({ data: 'x'.repeat(300) })), context)).status).toBe(413);
  expect(mock.request).not.toHaveBeenCalled();
  expect((await POST(post(), context)).status).toBe(202);
  expect(mock.request).toHaveBeenCalledTimes(1);
});
it('does not bypass failed-work review or the OFF policy and enforces request limits', async () => {
  mock.request.mockResolvedValueOnce('review_required').mockResolvedValueOnce('off');
  expect((await POST(post(), context)).status).toBe(409);
  expect((await POST(post(), context)).status).toBe(409);
  mock.rate.mockResolvedValue({ allowed: false });
  expect((await POST(post(), context)).status).toBe(429);
  expect(mock.request).toHaveBeenCalledTimes(2);
});
it('reports an outage without exposing failure payloads', async () => {
  mock.read.mockRejectedValue(new Error('provider-secret-canary'));
  const result = await GET(new NextRequest(url), context);
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain('provider-secret-canary');
});
