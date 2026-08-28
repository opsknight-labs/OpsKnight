import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest, parseResponse } from '../helpers/api-test';

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  checkRateLimit: vi.fn(),
  resolveApiKeyActor: vi.fn(),
  authorize: vi.fn(),
  incidentFindUnique: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ authenticateApiKey: mocks.authenticateApiKey }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock('@/lib/authorization-actors', () => ({ resolveApiKeyActor: mocks.resolveApiKeyActor }));
vi.mock('@/lib/authorization-policy', () => ({
  AUTHORIZATION_ACTIONS: {
    INCIDENT_READ: 'incident.read',
    INCIDENT_MANAGE: 'incident.manage',
  },
  authorize: mocks.authorize,
}));
vi.mock('@/lib/incidents/rest-patch', () => ({ applyRestIncidentPatch: vi.fn() }));
vi.mock('@/lib/jobs/queue', () => ({ scheduleStatusPageNotification: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: { findUnique: mocks.incidentFindUnique },
  },
}));

import { GET } from '@/app/api/incidents/[id]/route';

const context = { params: Promise.resolve({ id: 'inc-1' }) };

function actor() {
  return {
    id: 'user-1',
    role: 'RESPONDER',
    status: 'ACTIVE',
    teamIds: [],
    apiKey: { id: 'key-1', scopes: ['incidents:read'] },
  };
}

function incident() {
  return {
    id: 'inc-1',
    title: 'Database latency',
    assigneeId: null,
    teamId: null,
    visibility: 'PUBLIC',
    watchers: [],
    service: { id: 'svc-1', name: 'Database', teamId: null },
    assignee: null,
  };
}

describe('GET /api/incidents/:id typed errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateApiKey.mockResolvedValue({
      id: 'key-1',
      userId: 'user-1',
      scopes: ['incidents:read'],
    });
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 59,
      resetAt: Date.now() + 60_000,
      count: 1,
    });
    mocks.resolveApiKeyActor.mockResolvedValue(actor());
    mocks.authorize.mockReturnValue({ allowed: true, scope: 'global' });
    mocks.incidentFindUnique.mockResolvedValue(incident());
  });

  it('returns API_KEY_INVALID for a missing or invalid key', async () => {
    mocks.authenticateApiKey.mockResolvedValue(null);
    const req = await createMockRequest('GET', '/api/incidents/inc-1');

    const { status, data } = await parseResponse(await GET(req, context));

    expect(status).toBe(401);
    expect(data.code).toBe('API_KEY_INVALID');
  });

  it('returns RATE_LIMIT_EXCEEDED with Retry-After metadata', async () => {
    mocks.checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      count: 61,
    });
    const req = await createMockRequest('GET', '/api/incidents/inc-1');

    const response = await GET(req, context);
    const { status, data } = await parseResponse(response);

    expect(status).toBe(429);
    expect(data.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('returns INCIDENT_NOT_FOUND when the incident is absent', async () => {
    mocks.incidentFindUnique.mockResolvedValue(null);
    const req = await createMockRequest('GET', '/api/incidents/inc-1');

    const { status, data } = await parseResponse(await GET(req, context));

    expect(status).toBe(404);
    expect(data.code).toBe('INCIDENT_NOT_FOUND');
  });

  it('returns INCIDENT_ACCESS_DENIED for a resource-level denial', async () => {
    mocks.authorize
      .mockReturnValueOnce({ allowed: true, scope: 'scoped' })
      .mockReturnValueOnce({
        allowed: false,
        reason: 'MISSING_CAPABILITY',
        requiredCapability: 'incident.read.scoped',
      });
    const req = await createMockRequest('GET', '/api/incidents/inc-1');

    const { status, data } = await parseResponse(await GET(req, context));

    expect(status).toBe(403);
    expect(data.code).toBe('INCIDENT_ACCESS_DENIED');
  });
});
