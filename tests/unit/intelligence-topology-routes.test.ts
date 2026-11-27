import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  rate: vi.fn(),
  parse: vi.fn(),
  apply: vi.fn(),
  graph: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: mocks.actor }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.rate }));
vi.mock('@/lib/prisma', () => ({ default: { $transaction: mocks.transaction } }));
vi.mock('@/lib/intelligence/dependencies/import', async () => {
  const actual = await vi.importActual<typeof import('@/lib/intelligence/dependencies/import')>(
    '@/lib/intelligence/dependencies/import'
  );
  return { ...actual, parseCatalog: mocks.parse, applyCatalogImport: mocks.apply };
});
vi.mock('@/lib/intelligence/dependencies/graph-view', () => ({
  getServiceGraphForActor: mocks.graph,
}));

import { GET as getGraph } from '@/app/api/intelligence/topology/graph/route';
import { POST as postImport } from '@/app/api/intelligence/topology/import/route';
import { AppError } from '@/lib/errors';
import { MAX_IMPORT_BYTES } from '@/lib/intelligence/dependencies/import';

const admin = { id: 'admin-1', role: 'ADMIN', status: 'ACTIVE', apiKey: null };

beforeEach(() => {
  mocks.actor.mockReset().mockResolvedValue(admin);
  mocks.rate.mockReset().mockResolvedValue({ allowed: true });
  mocks.parse.mockReset().mockReturnValue([{ name: 'checkout' }]);
  mocks.apply.mockReset().mockResolvedValue({ edgesCreated: 1 });
  mocks.transaction
    .mockReset()
    .mockImplementation(async (run: (tx: unknown) => unknown) => run({}));
  mocks.graph.mockReset().mockResolvedValue({ nodes: [], edges: [] });
});

const importRequest = (body: BodyInit, headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/intelligence/topology/import', {
    method: 'POST',
    headers,
    body,
    ...{ duplex: 'half' as const },
  });
const graphRequest = (headers: Record<string, string> = {}) =>
  new NextRequest('http://localhost/api/intelligence/topology/graph', { headers });

describe('POST /api/intelligence/topology/import', () => {
  it('imports a catalog for an administrator and never caches the answer', async () => {
    const response = await postImport(importRequest('kind: Component'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.apply).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a cross-site request', { 'sec-fetch-site': 'cross-site' }, 403],
    ['a same-site (other origin) request', { 'sec-fetch-site': 'same-site' }, 403],
  ])('refuses %s before reading anything', async (_label, headers, status) => {
    expect((await postImport(importRequest('x', headers))).status).toBe(status);
    expect(mocks.actor).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('answers 401 when nobody is signed in', async () => {
    mocks.actor.mockRejectedValue(new Error('no session'));
    expect((await postImport(importRequest('x'))).status).toBe(401);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it.each([
    ['an API key', { ...admin, apiKey: { id: 'key-1' } }],
    ['a suspended account', { ...admin, status: 'SUSPENDED' }],
    ['a plain user', { ...admin, role: 'USER' }],
    ['a responder', { ...admin, role: 'RESPONDER' }],
  ])('refuses %s and changes nothing', async (_label, actor) => {
    mocks.actor.mockResolvedValue(actor);
    expect((await postImport(importRequest('x'))).status).toBe(403);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('rate limits per person', async () => {
    mocks.rate.mockResolvedValue({ allowed: false });
    expect((await postImport(importRequest('x'))).status).toBe(429);
    expect(mocks.rate).toHaveBeenCalledWith('intelligence:topology-import:admin-1', 10, 60_000);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('rejects a declared oversized body before reading it', async () => {
    const response = await postImport(
      importRequest('x', { 'content-length': String(MAX_IMPORT_BYTES + 1) })
    );
    expect(response.status).toBe(413);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('cancels a chunked body at the byte ceiling even without Content-Length', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_IMPORT_BYTES + 1));
      },
      cancel,
    });
    const response = await postImport(importRequest(body));
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('maps a validation problem to 400 and a conflict to 409', async () => {
    mocks.parse.mockImplementation(() => {
      throw new AppError({
        code: 'VALIDATION_FAILED',
        fields: [{ field: 'body', message: 'Bad YAML' }],
      });
    });
    expect((await postImport(importRequest('x'))).status).toBe(400);
    mocks.parse.mockImplementation(() => {
      throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: 'Would create a cycle' });
    });
    expect((await postImport(importRequest('x'))).status).toBe(409);
  });

  it('answers 503 for an unexpected failure without leaking its message', async () => {
    mocks.apply.mockRejectedValue(new Error('connection string postgres://secret'));
    const response = await postImport(importRequest('x'));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('secret');
  });
});

describe('GET /api/intelligence/topology/graph', () => {
  it('returns the graph the caller may see', async () => {
    const response = await getGraph(graphRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.graph).toHaveBeenCalledWith(admin);
  });

  it('refuses cross-site requests, anonymous callers and inactive accounts', async () => {
    expect((await getGraph(graphRequest({ 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    mocks.actor.mockRejectedValue(new Error('no session'));
    expect((await getGraph(graphRequest())).status).toBe(401);
    mocks.actor.mockResolvedValue({ ...admin, status: 'SUSPENDED' });
    expect((await getGraph(graphRequest())).status).toBe(403);
    expect(mocks.graph).not.toHaveBeenCalled();
  });

  it('rate limits, and denies when the caller may see no graph', async () => {
    mocks.rate.mockResolvedValue({ allowed: false });
    expect((await getGraph(graphRequest())).status).toBe(429);
    mocks.rate.mockResolvedValue({ allowed: true });
    mocks.graph.mockResolvedValue(null);
    expect((await getGraph(graphRequest())).status).toBe(403);
  });

  it('answers 503 when the graph cannot be built', async () => {
    mocks.graph.mockRejectedValue(new Error('db down'));
    expect((await getGraph(graphRequest())).status).toBe(503);
  });
});
