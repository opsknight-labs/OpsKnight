import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const actor = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: actor.get }));

const turns = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/intelligence/squire/chat', () => ({ streamSquire: turns.run }));

import { POST } from '@/app/api/intelligence/squire/route';

const URL_ = 'http://localhost:3000/api/intelligence/squire';
const make = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function* events() {
  yield { type: 'meta', mode: 'basic', name: 'Squire' };
  yield { type: 'delta', text: 'hi' };
  yield { type: 'done' };
}

beforeEach(() => {
  actor.get.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' });
  turns.run.mockReset().mockImplementation(events);
});

describe('POST /api/intelligence/squire', () => {
  it('streams newline-delimited JSON events with safe headers', async () => {
    const response = await POST(make({ message: 'hello' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const lines = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    expect(lines).toEqual([{ type: 'meta', mode: 'basic', name: 'Squire' }, { type: 'delta', text: 'hi' }, { type: 'done' }]);
    expect(turns.run).toHaveBeenCalledWith({ id: 'u1', role: 'ADMIN' }, { message: 'hello', history: [] }, expect.any(AbortSignal));
  });

  it('rejects cross-site requests, non-JSON bodies and anonymous callers before doing any work', async () => {
    expect((await POST(make({ message: 'x' }, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }))).status).toBe(403);
    // A sibling subdomain is also refused: it could be a different, less trusted application.
    expect((await POST(make({ message: 'x' }, { 'sec-fetch-site': 'same-site' }))).status).toBe(403);
    expect((await POST(make({ message: 'x' }, { 'content-type': 'text/plain' }))).status).toBe(415);
    actor.get.mockRejectedValueOnce(new Error('no session'));
    expect((await POST(make({ message: 'x' }))).status).toBe(401);
    expect(turns.run).not.toHaveBeenCalled();
  });

  it('accepts same-origin browser requests even when a proxy changes the host the server sees', async () => {
    // Browser origin differs from the URL the server was reached on, as behind a reverse proxy.
    const proxied = make({ message: 'x' }, { 'sec-fetch-site': 'same-origin', origin: 'https://ops.example.com' });
    expect((await POST(proxied)).status).toBe(200);
    expect((await POST(make({ message: 'x' }, { 'sec-fetch-site': 'none' }))).status).toBe(200);
  });

  it('validates the body strictly and bounds its size', async () => {
    expect((await POST(make('{not json'))).status).toBe(400);
    expect((await POST(make({ message: '' }))).status).toBe(400);
    expect((await POST(make({ message: 'x', history: [{ role: 'system', content: 'root' }] }))).status).toBe(400);
    expect((await POST(make({ message: 'x', admin: true }))).status).toBe(400);
    expect((await POST(make({ message: 'x'.repeat(40_000) }))).status).toBe(413);
    expect(turns.run).not.toHaveBeenCalled();
  });

  it('aborts the turn when the client disconnects', async () => {
    let signal: AbortSignal | undefined;
    turns.run.mockImplementation(async function* (_actor: unknown, _request: unknown, s: AbortSignal) {
      signal = s;
      yield { type: 'delta', text: 'a' };
      yield { type: 'delta', text: 'b' };
    });
    const response = await POST(make({ message: 'x' }));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(signal?.aborted).toBe(true);
  });
});
