/* eslint-disable @typescript-eslint/no-explicit-any -- route handlers and Prisma doubles are exercised through untyped mocks */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 119,
    resetAt: Date.now() + 60_000,
    count: 1,
  }),
  incrementSharedCounter: vi.fn().mockResolvedValue({ count: 1, resetAt: Date.now() + 60_000 }),
}));

const admin = {
  id: 'usr_admin',
  role: 'ADMIN',
  status: 'ACTIVE',
  teamIds: [],
  apiKey: { id: 'key_admin', scopes: ['admin:manage'] },
};

vi.mock('@/lib/api-v2/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/api-v2/auth')>();
  return {
    ...actual,
    authenticateV2Request: vi.fn(async () => ({
      apiKey: { id: 'key_admin', scopes: ['admin:manage'] },
      actor: admin,
    })),
  };
});

const v1Actor = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/rbac', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/rbac')>();
  return { ...actual, getCurrentAuthorizationActor: v1Actor.get };
});

import { apiV2Error } from '@/lib/api-v2/response';
import { AppError } from '@/lib/errors';
import {
  PostmortemCreateV2Schema,
  PostmortemUpdateV2Schema,
  StatusPageCreateV2Schema,
  StatusPageUpdateV2Schema,
} from '@/lib/api-v2/validation';
import { GET as listUsers } from '@/app/api/v2/users/route';
import { GET as listNotifications } from '@/app/api/v2/notifications/route';
import { GET as listNotes } from '@/app/api/v2/incidents/[id]/notes/route';
import { GET as getRunbook } from '@/app/api/v2/runbooks/[id]/route';
import { GET as listObjectiveVersions } from '@/app/api/v1/service-objectives/[id]/versions/route';
import { authenticateApiKey, authenticateApiKeyDetailed } from '@/lib/api-auth';
import { legacyHashCandidatesWithAdmission } from '@/lib/legacy-token-admission';
import { LEGACY_AUTH_ADMISSION_LIMIT } from '@/lib/api-v2/rate-limit';
import { rateLimitMemoryCache } from '@/lib/api-v2/cache';

const get = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3000${url}`, { headers });

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMemoryCache.clear();
});

describe('internal error metadata', () => {
  it('never serializes details of an internal error', async () => {
    const res = apiV2Error(
      new AppError({
        code: 'INTERNAL_ERROR',
        details: { connectionString: 'postgresql://user:secret@db/opsknight', query: 'SELECT 1' },
      })
    );
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.meta).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('secret@db');
  });

  it('keeps details for public, client-actionable errors', async () => {
    const res = apiV2Error(
      new AppError({ code: 'RATE_LIMIT_EXCEEDED', details: { retryAfter: 7, limit: 60 } })
    );
    const body = await res.json();
    expect(body.meta).toMatchObject({ retryAfter: 7 });
    expect(res.headers.get('Retry-After')).toBe('7');
  });
});

describe('accepted fields are stored or rejected, never silently dropped', () => {
  it('rejects a status-page description, which has no storage', () => {
    expect(() =>
      StatusPageCreateV2Schema.parse({ name: 'Status', slug: 'status', description: 'x' })
    ).toThrow(/description is not supported/);
    expect(() => StatusPageUpdateV2Schema.parse({ description: 'x' })).toThrow(
      /description is not supported/
    );
    expect(StatusPageCreateV2Schema.parse({ name: 'Status', slug: 'status' })).toBeDefined();
  });

  it('rejects postmortem impact, which is structured data the REST string cannot represent', () => {
    expect(() =>
      PostmortemCreateV2Schema.parse({ incidentId: 'inc_1', summary: 'Long summary', impact: 'x' })
    ).toThrow(/impact is not supported/);
    expect(() => PostmortemUpdateV2Schema.parse({ impact: 'x' })).toThrow(
      /impact is not supported/
    );
  });
});

describe('enum query filters are validated before reaching Prisma', () => {
  it('answers an unknown user role with 400, not 500', async () => {
    const res = await listUsers(get('/api/v2/users?role=SUPERUSER'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_FAILED');
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('answers unknown notification channel or status with 400', async () => {
    for (const url of ['/api/v2/notifications?channel=FAX', '/api/v2/notifications?status=LOST']) {
      const res = await listNotifications(get(url));
      expect(res.status).toBe(400);
    }
    expect(prisma.notification.findMany).not.toHaveBeenCalled();
  });

  it('passes a valid enum through', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as any);
    const res = await listUsers(get('/api/v2/users?role=RESPONDER'));
    expect(res.status).toBe(200);
    expect(JSON.stringify(vi.mocked(prisma.user.findMany).mock.calls[0][0])).toContain(
      '"role":"RESPONDER"'
    );
  });
});

describe('growing collections are paginated', () => {
  it('bounds incident notes and returns a cursor', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValue({
      id: 'inc_1',
      assigneeId: null,
      teamId: null,
      visibility: 'PUBLIC',
      watchers: [],
      service: { id: 'svc', name: 'svc', teamId: null },
    } as any);
    const rows = Array.from({ length: 6 }, (_, i) => ({
      id: `note_${i}`,
      content: 'n',
      userId: 'u',
      createdAt: new Date(Date.now() - i * 1000),
      user: null,
    }));
    vi.mocked(prisma.incidentNote.findMany).mockResolvedValue(rows as any);

    const res = await listNotes(get('/api/v2/incidents/inc_1/notes?limit=5'), {
      params: Promise.resolve({ id: 'inc_1' }),
    });
    const body = await res.json();
    expect(vi.mocked(prisma.incidentNote.findMany).mock.calls[0][0]).toMatchObject({ take: 6 });
    expect(body.data).toHaveLength(5);
    expect(body.pagination.nextCursor).toBeTruthy();
  });
});

describe('runbook visibility matches the collection', () => {
  it('returns 404 for an unpublished runbook by id', async () => {
    (prisma as any).runbook = {
      findUnique: vi.fn().mockResolvedValue({
        id: 'rb_1',
        name: 'Draft only',
        archivedAt: null,
        publishedVersion: null,
      }),
      findFirst: vi.fn(),
    };
    const res = await getRunbook(get('/api/v2/runbooks/rb_1'), {
      params: Promise.resolve({ id: 'rb_1' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('legacy credential paths share the scrypt admission budget', () => {
  const legacyToken = (seed: string) => `ok_${seed.padEnd(43, 'a')}`;

  it('throttles 1.x-shaped lookups per address after the budget, without throttling modern tokens', async () => {
    const req = get('/api/incidents', { 'x-forwarded-for': '198.51.100.31' });
    for (let i = 0; i < LEGACY_AUTH_ADMISSION_LIMIT; i++) {
      expect((await legacyHashCandidatesWithAdmission(req, legacyToken(`t${i}`))).status).toBe(
        'ok'
      );
    }
    expect((await legacyHashCandidatesWithAdmission(req, legacyToken('over'))).status).toBe(
      'throttled'
    );
    // A modern-format token never needs scrypt and is never throttled here.
    expect(
      (await legacyHashCandidatesWithAdmission(req, `ok_live_${'m'.repeat(40)}`)).status
    ).toBe('ok');
  });

  it('rejects malformed API keys on the legacy path without a database lookup', async () => {
    for (const token of ['nope', 'ok_short', `ok_live_${'a'.repeat(300)}`]) {
      await expect(
        authenticateApiKey(get('/api/incidents', { authorization: `Bearer ${token}` }))
      ).resolves.toBeNull();
    }
    expect(prisma.apiKey.findFirst).not.toHaveBeenCalled();
  });

  it('reports a throttled legacy lookup distinctly so /api/v1 can answer 429', async () => {
    vi.mocked(prisma.apiKey.findFirst).mockResolvedValue(null);
    const headers = { 'x-forwarded-for': '198.51.100.32' };
    for (let i = 0; i < LEGACY_AUTH_ADMISSION_LIMIT; i++) {
      await authenticateApiKeyDetailed(
        get('/api/v1/response-policy/workspace', {
          ...headers,
          authorization: `Bearer ${legacyToken(`k${i}`)}`,
        })
      );
    }
    const result = await authenticateApiKeyDetailed(
      get('/api/v1/response-policy/workspace', {
        ...headers,
        authorization: `Bearer ${legacyToken('last')}`,
      })
    );
    expect(result.status).toBe('throttled');
  });
});

describe('/api/v1 error boundary', () => {
  it('turns an authentication failure into its status instead of a 500', async () => {
    v1Actor.get.mockRejectedValue(
      new AppError({ code: 'AUTHENTICATION_REQUIRED', userMessage: 'Sign in required.' })
    );
    const res = await listObjectiveVersions(get('/api/v1/service-objectives/lin_1/versions'), {
      params: Promise.resolve({ id: 'lin_1' }),
    });
    expect(res.status).toBe(401);
  });

  it('bounds the version list', async () => {
    v1Actor.get.mockResolvedValue({ ...admin, apiKey: undefined });
    (prisma as any).serviceObjective = {
      findMany: vi.fn().mockResolvedValue([{ id: 'v1', lineageId: 'lin_1', version: 1 }]),
    };
    await listObjectiveVersions(get('/api/v1/service-objectives/lin_1/versions?limit=10000'), {
      params: Promise.resolve({ id: 'lin_1' }),
    });
    expect((prisma as any).serviceObjective.findMany.mock.calls[0][0]).toMatchObject({ take: 500 });
  });
});
