import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 119,
    resetAt: Date.now() + 60000,
    count: 1,
  }),
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: vi.fn().mockImplementation(async fn => fn({})),
}));

vi.mock('@/lib/idempotency', () => ({
  executeIdempotentOperation: vi.fn().mockImplementation(async (_tx, opts) => ({
    value: await opts.execute(),
    replayed: false,
  })),
}));

vi.mock('@/lib/api-v2/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-v2/auth')>();
  return {
    ...actual,
    authenticateV2Request: vi.fn().mockImplementation(async (req: NextRequest) => {
      const auth = req.headers.get('authorization');
      if (auth === 'Bearer viewer-token') {
        return {
          apiKey: { id: 'key_view', scopes: ['incidents:read'] },
          actor: {
            id: 'usr_view',
            role: 'VIEWER',
            status: 'ACTIVE',
            teamIds: ['team_1'],
            apiKey: { id: 'key_view', scopes: ['incidents:read'] },
          },
        };
      }
      return {
        apiKey: { id: 'key_admin', scopes: ['admin:manage'] },
        actor: {
          id: 'usr_admin',
          role: 'ADMIN',
          status: 'ACTIVE',
          teamIds: ['team_1'],
          apiKey: { id: 'key_admin', scopes: ['admin:manage'] },
        },
      };
    }),
  };
});

import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { API_SCOPES } from '@/lib/authorization';

describe('defineV2Route Endpoint Factory', () => {

  it('handles standard GET request with pagination and envelopes', async () => {
    const route = defineV2Route({
      action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
      handler: async ({ pagination }) => {
        return {
          data: [{ id: 'inc_1', title: 'Outage' }],
          pagination: { limit: pagination.limit, hasMore: false, nextCursor: null },
        };
      },
    });

    const req = new NextRequest('http://localhost:3000/api/v2/incidents?limit=10', {
      headers: { authorization: 'Bearer admin-token' },
    });

    const res = await route(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('120');

    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.pagination.limit).toBe(10);
    expect(body.requestId).toBeTruthy();
  });

  it('validates request body schema and returns 201 Created on success', async () => {
    const route = defineV2Route({
      action: AUTHORIZATION_ACTIONS.INCIDENT_CREATE,
      bodySchema: z.object({ title: z.string().min(5) }),
      handler: async ({ body }) => {
        return {
          status: 201,
          data: { id: 'inc_created', title: body.title },
        };
      },
    });

    const req = new NextRequest('http://localhost:3000/api/v2/incidents', {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Severe Outage' }),
    });

    const res = await route(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe('inc_created');
  });

  it('rejects invalid request body with RFC 9457 Problem Details', async () => {
    const handlerSpy = vi.fn();
    const route = defineV2Route({
      action: AUTHORIZATION_ACTIONS.INCIDENT_CREATE,
      bodySchema: z.object({ title: z.string().min(5) }),
      handler: handlerSpy,
    });

    const req = new NextRequest('http://localhost:3000/api/v2/incidents', {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'No' }), // too short
    });

    const res = await route(req);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(handlerSpy).not.toHaveBeenCalled();

    const problem = await res.json();
    expect(problem.code).toBe('VALIDATION_FAILED');
    expect(problem.fields[0].field).toBe('title');
  });

  it('enforces RBAC action and returns 403 when scope is missing', async () => {
    const handlerSpy = vi.fn();
    const route = defineV2Route({
      action: AUTHORIZATION_ACTIONS.INCIDENT_CREATE,
      handler: handlerSpy,
    });

    const req = new NextRequest('http://localhost:3000/api/v2/incidents', {
      method: 'POST',
      headers: { authorization: 'Bearer viewer-token' }, // viewer does not have incidents:write
    });

    const res = await route(req);
    expect(res.status).toBe(403);
    expect(handlerSpy).not.toHaveBeenCalled();
    const problem = await res.json();
    expect(problem.code).toBe('API_SCOPE_REQUIRED');
  });

  it('formats 204 No Content response properly', async () => {
    const route = defineV2Route({
      action: AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE,
      handler: async () => {
        return { status: 204 };
      },
    });

    const req = new NextRequest('http://localhost:3000/api/v2/postmortems/pm_1', {
      method: 'DELETE',
      headers: { authorization: 'Bearer admin-token' },
    });

    const res = await route(req);
    expect(res.status).toBe(204);
  });

  it('rejects idempotent operation when idempotencyRequired is true and header is missing', async () => {
    const handlerSpy = vi.fn();
    const route = defineV2Route({
      action: AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE,
      idempotent: true,
      idempotencyRequired: true,
      handler: handlerSpy,
    });

    const req = new NextRequest('http://localhost:3000/api/v2/runbooks/rb_1/execute', {
      method: 'POST',
      headers: { authorization: 'Bearer admin-token' },
    });

    const res = await route(req);
    expect(res.status).toBe(400);
    expect(handlerSpy).not.toHaveBeenCalled();

    const problem = await res.json();
    expect(problem.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('accepts idempotent operation when idempotencyRequired is true and header is provided', async () => {
    const handlerSpy = vi.fn().mockResolvedValue({ status: 202, data: { executionId: 'exec_1' } });
    const route = defineV2Route({
      action: AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE,
      idempotent: true,
      idempotencyRequired: true,
      handler: handlerSpy,
    });

    const req = new NextRequest('http://localhost:3000/api/v2/runbooks/rb_1/execute', {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-token',
        'idempotency-key': 'idem-test-123',
      },
    });

    const res = await route(req);
    expect(res.status).toBe(202);
    expect(handlerSpy).toHaveBeenCalled();
  });
});
