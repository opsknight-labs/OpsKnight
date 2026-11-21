import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  rate: vi.fn(),
  execute: vi.fn(),
  outcome: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: mocks.actor }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rate }));
vi.mock('@/lib/intelligence/squire/actions/execute', () => ({
  executeSquireAction: mocks.execute,
}));
vi.mock('@/lib/intelligence/squire/actions/outcomes', () => ({
  readSquireActionOutcome: mocks.outcome,
}));
import { GET } from '@/app/api/intelligence/squire/actions/[id]/route';
import { POST } from '@/app/api/intelligence/squire/actions/route';
beforeEach(() => {
  mocks.actor.mockReset().mockResolvedValue({ id: 'user-1' });
  mocks.rate.mockReset().mockResolvedValue({ allowed: true });
  mocks.execute.mockReset().mockResolvedValue({ ok: true, message: 'Done.' });
  mocks.outcome.mockReset().mockResolvedValue({ status: 'SUCCEEDED', message: 'Note added.' });
});
const request = (body: BodyInit, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/intelligence/squire/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
    ...{ duplex: 'half' as const },
  });
describe('confirmed Squire action body limits', () => {
  it('executes a valid sealed token under the current actor', async () => {
    expect((await POST(request(JSON.stringify({ token: 'sealed' })))).status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith({ id: 'user-1' }, 'sealed');
  });
  it('rejects oversized declared bodies before reading them', async () => {
    expect((await POST(request('{}', { 'content-length': '20000' }))).status).toBe(413);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('cancels a chunked body at the byte ceiling even without Content-Length', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(16_385)));
      },
      cancel,
    });
    const response = await POST(request(body));
    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON without executing an action', async () => {
    expect((await POST(request('{'))).status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

const receiptId = 'd03ed6f0-155c-4c06-a95b-433feea3284e';
const getRequest = (headers: Record<string, string> = {}) =>
  new Request(`http://localhost/api/intelligence/squire/actions/${receiptId}`, { headers });
const context = (id = receiptId) => ({ params: Promise.resolve({ id }) });
describe('read-only Squire action recovery', () => {
  it('returns an owner-scoped outcome without executing another action', async () => {
    const response = await GET(getRequest(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.outcome).toHaveBeenCalledWith({ id: 'user-1' }, receiptId);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('rejects cross-site and malformed identifiers before reading an outcome', async () => {
    expect((await GET(getRequest({ 'sec-fetch-site': 'cross-site' }), context())).status).toBe(403);
    expect((await GET(getRequest(), context('bad-id'))).status).toBe(404);
    expect(mocks.outcome).not.toHaveBeenCalled();
  });
  it('does not expose results or execute actions through API keys', async () => {
    mocks.actor.mockResolvedValue({ id: 'user-1', apiKey: { id: 'key', scopes: [] } });
    expect((await GET(getRequest(), context())).status).toBe(403);
    expect((await POST(request(JSON.stringify({ token: 'sealed' })))).status).toBe(403);
    expect(mocks.outcome).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('requires a signed-in browser and rate-limits lookups', async () => {
    mocks.actor.mockRejectedValueOnce(new Error('No session'));
    expect((await GET(getRequest(), context())).status).toBe(401);
    mocks.rate.mockResolvedValueOnce({ allowed: false });
    expect((await GET(getRequest(), context())).status).toBe(429);
    expect(mocks.outcome).not.toHaveBeenCalled();
  });
  it('keeps missing, unowned and no-longer-readable results indistinguishable', async () => {
    mocks.outcome.mockResolvedValue(null);
    expect((await GET(getRequest(), context())).status).toBe(404);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
