import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ actor: vi.fn(), rate: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: mocks.actor }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rate }));
vi.mock('@/lib/intelligence/squire/actions/execute', () => ({
  executeSquireAction: mocks.execute,
}));
import { POST } from '@/app/api/intelligence/squire/actions/route';
beforeEach(() => {
  mocks.actor.mockReset().mockResolvedValue({ id: 'user-1' });
  mocks.rate.mockReset().mockResolvedValue({ allowed: true });
  mocks.execute.mockReset().mockResolvedValue({ ok: true, message: 'Done.' });
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
