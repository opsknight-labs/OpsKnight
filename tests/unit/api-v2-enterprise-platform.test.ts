import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod/v3';
import {
  authorize,
  AUTHORIZATION_ACTIONS,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { enforceV2ResourceAuthorization } from '@/lib/api-v2/rbac';
import { requireIfMatch } from '@/lib/api-v2/concurrency';
import { readV2JsonBody, V2_MAX_BODY_BYTES } from '@/lib/api-v2/request-body';
import { runbookReadWhere, runbookExecutionReadWhere } from '@/lib/authorization-filters';

const actor: AuthorizationActor = {
  id: 'user-a',
  role: 'ADMIN',
  status: 'ACTIVE',
  teamIds: [],
  apiKey: { id: 'key', scopes: ['admin:manage'] },
};

describe('explicit infrastructure privileges', () => {
  it.each([
    [AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE, 'runbooks:write'],
    [AUTHORIZATION_ACTIONS.RUNBOOK_PUBLISH, 'runbooks:publish'],
    [AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE, 'runbooks:execute'],
  ] as const)('requires the exact scope for %s', (action, scope) => {
    expect(authorize({ actor, action })).toMatchObject({
      allowed: false,
      reason: 'MISSING_SCOPE',
      requiredScope: scope,
    });
    expect(
      authorize({ actor: { ...actor, apiKey: { id: 'key', scopes: [scope] } }, action }).allowed
    ).toBe(true);
    expect(
      authorize({
        actor: { ...actor, role: 'USER', apiKey: { id: 'key', scopes: [scope] } },
        action,
      }).allowed
    ).toBe(false);
  });
});

describe('runbook credential migration role compatibility', () => {
  it.each(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER'] as const)(
    'scopes retain the role boundary for %s',
    role => {
      for (const [action, scope] of [
        [AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE, 'runbooks:write'],
        [AUTHORIZATION_ACTIONS.RUNBOOK_PUBLISH, 'runbooks:publish'],
        [AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE, 'runbooks:execute'],
      ] as const) {
        const upgraded = {
          ...actor,
          role,
          apiKey: { id: 'replacement', scopes: ['admin:manage', scope] },
        };
        expect(authorize({ actor: upgraded, action }).allowed).toBe(
          role === 'ADMIN' ||
            (role === 'RESPONDER' && action === AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE)
        );
        expect(
          authorize({
            actor: { ...upgraded, apiKey: { id: 'old', scopes: ['admin:manage'] } },
            action,
          }).allowed
        ).toBe(false);
      }
    }
  );
  it('retains the ordinary administrator scope behavior', () => {
    expect(authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE }).allowed).toBe(true);
    expect(authorize({ actor, action: AUTHORIZATION_ACTIONS.SERVICE_READ }).allowed).toBe(true);
  });
});

describe('resource authorization fails closed', () => {
  const scoped: AuthorizationActor = {
    ...actor,
    role: 'USER',
    teamIds: ['team-a'],
    apiKey: { id: 'key', scopes: ['services:read', 'runbooks:read'] },
  };
  it('rejects a collection-level decision as object authorization', () => {
    expect(() =>
      enforceV2ResourceAuthorization(scoped, AUTHORIZATION_ACTIONS.SERVICE_READ)
    ).toThrow();
    expect(() =>
      enforceV2ResourceAuthorization(scoped, AUTHORIZATION_ACTIONS.SERVICE_READ, {
        type: 'service',
        teamId: 'team-b',
      })
    ).toThrow();
    expect(() =>
      enforceV2ResourceAuthorization(scoped, AUTHORIZATION_ACTIONS.SERVICE_READ, {
        type: 'service',
        teamId: 'team-a',
      })
    ).not.toThrow();
  });
  it('preserves existing library permissions and denies USER-role credentials', () => {
    expect(() => runbookReadWhere(scoped)).toThrow();
    expect(() => runbookExecutionReadWhere(scoped)).toThrow();
    expect(runbookReadWhere({ ...scoped, role: 'ADMIN' })).toEqual({});
    expect(runbookExecutionReadWhere({ ...scoped, role: 'ADMIN' })).toEqual({});
  });
});

describe('required HTTP preconditions', () => {
  const request = (value?: string) =>
    new Request('http://localhost', { headers: value === undefined ? {} : { 'If-Match': value } });
  it('returns 428 for missing or blank If-Match', () => {
    for (const value of [undefined, '', ' ']) {
      expect(() => requireIfMatch(request(value))).toThrow(
        expect.objectContaining({ code: 'PRECONDITION_REQUIRED', status: 428 })
      );
    }
  });
  it('preserves strong matching and existence semantics', () => {
    expect(requireIfMatch(request('"7"'))).toBe(7);
    expect(requireIfMatch(request('*'))).toBeNull();
    expect(() => requireIfMatch(request('W/"7"'))).toThrow(
      expect.objectContaining({ status: 412 })
    );
    expect(() => requireIfMatch(request('7'))).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('bounded JSON bodies', () => {
  it('accepts valid JSON and rejects malformed UTF-8 and JSON', async () => {
    await expect(
      readV2JsonBody(new Request('http://localhost', { method: 'POST', body: '{"ok":true}' }))
    ).resolves.toEqual({ ok: true });
    for (const body of ['{', new Uint8Array([0xff])]) {
      await expect(
        readV2JsonBody(new Request('http://localhost', { method: 'POST', body }))
      ).rejects.toMatchObject({ code: 'INVALID_JSON' });
    }
  });
  it('rejects oversized bodies with or without Content-Length', async () => {
    for (const headers of [
      new Headers(),
      new Headers({ 'Content-Length': '1' }),
      new Headers({ 'Content-Length': String(V2_MAX_BODY_BYTES + 1) }),
    ]) {
      await expect(
        readV2JsonBody(
          new Request('http://localhost', {
            method: 'POST',
            headers,
            body: ' '.repeat(V2_MAX_BODY_BYTES + 1),
          })
        )
      ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
    }
  });
  it('rejects excessive nesting before recursive schema validation', async () => {
    await expect(
      readV2JsonBody(
        new Request('http://localhost', {
          method: 'POST',
          body: '['.repeat(34) + '0' + ']'.repeat(34),
        })
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

vi.mock('@/lib/api-v2/auth', () => ({
  authenticateV2Request: vi.fn(async () => ({ actor, apiKey: actor.apiKey })),
}));
vi.mock('@/lib/api-v2/rate-limit', () => ({ enforceV2RateLimit: vi.fn(async () => ({})) }));

describe('factory authorization order and validation', () => {
  it('checks privileges before resource lookups and parsing sensitive payloads', async () => {
    const { defineV2Route } = await import('@/lib/api-v2/endpoint');
    const resourceExtractor = vi.fn();
    const handler = vi.fn();
    const route = defineV2Route({
      action: AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE,
      bodySchema: z.object({}).strict(),
      resourceExtractor,
      handler,
    });
    const result = await route(
      new NextRequest('http://localhost/api/v2/runbooks/r/execute', { method: 'POST', body: '{' })
    );
    expect(result.status).toBe(403);
    expect(resourceExtractor).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
  it('rejects duplicate query values without entering the handler', async () => {
    const { defineV2Route } = await import('@/lib/api-v2/endpoint');
    const handler = vi.fn();
    const route = defineV2Route({ action: AUTHORIZATION_ACTIONS.SERVICE_READ, handler });
    expect(
      (await route(new NextRequest('http://localhost/api/v2/services?limit=1&limit=2'))).status
    ).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
});
