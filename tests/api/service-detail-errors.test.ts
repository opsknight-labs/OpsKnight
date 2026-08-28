import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest, parseResponse } from '../helpers/api-test';

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  checkRateLimit: vi.fn(),
  resolveApiKeyActor: vi.fn(),
  authorize: vi.fn(),
  serviceReadWhere: vi.fn(),
  serviceFindFirst: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ authenticateApiKey: mocks.authenticateApiKey }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock('@/lib/authorization-actors', () => ({ resolveApiKeyActor: mocks.resolveApiKeyActor }));
vi.mock('@/lib/authorization-policy', () => ({
  AUTHORIZATION_ACTIONS: { SERVICE_READ: 'service.read' },
  authorize: mocks.authorize,
}));
vi.mock('@/lib/authorization-filters', () => ({ serviceReadWhere: mocks.serviceReadWhere }));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    service: { findFirst: mocks.serviceFindFirst },
  },
}));

import { GET } from '@/app/api/services/[id]/route';

const context = { params: Promise.resolve({ id: 'svc-1' }) };

function actor() {
  return {
    id: 'user-1',
    role: 'RESPONDER',
    status: 'ACTIVE',
    teamIds: [],
    apiKey: { id: 'key-1', scopes: ['services:read'] },
  };
}

describe('GET /api/services/:id typed errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateApiKey.mockResolvedValue({
      id: 'key-1',
      userId: 'user-1',
      scopes: ['services:read'],
    });
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 59,
      resetAt: Date.now() + 60_000,
      count: 1,
    });
    mocks.resolveApiKeyActor.mockResolvedValue(actor());
    mocks.authorize.mockReturnValue({ allowed: true, scope: 'global' });
    mocks.serviceReadWhere.mockReturnValue({});
    mocks.serviceFindFirst.mockResolvedValue({ id: 'svc-1', name: 'Database' });
  });

  it('returns API_KEY_INVALID for a missing or invalid key', async () => {
    mocks.authenticateApiKey.mockResolvedValue(null);
    const req = await createMockRequest('GET', '/api/services/svc-1');

    const { status, data } = await parseResponse(await GET(req, context));

    expect(status).toBe(401);
    expect(data.code).toBe('API_KEY_INVALID');
  });

  it('returns API_KEY_USER_INVALID when the key owner cannot be resolved', async () => {
    mocks.resolveApiKeyActor.mockResolvedValue(null);
    const req = await createMockRequest('GET', '/api/services/svc-1');

    const { status, data } = await parseResponse(await GET(req, context));

    expect(status).toBe(401);
    expect(data.code).toBe('API_KEY_USER_INVALID');
  });

  it('returns SERVICE_NOT_FOUND for an inaccessible or missing service', async () => {
    mocks.serviceFindFirst.mockResolvedValue(null);
    const req = await createMockRequest('GET', '/api/services/svc-1');

    const { status, data } = await parseResponse(await GET(req, context));

    expect(status).toBe(404);
    expect(data.code).toBe('SERVICE_NOT_FOUND');
  });

  it('returns RATE_LIMIT_EXCEEDED with Retry-After', async () => {
    mocks.checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
      count: 61,
    });
    const req = await createMockRequest('GET', '/api/services/svc-1');

    const response = await GET(req, context);
    const { status, data } = await parseResponse(response);

    expect(status).toBe(429);
    expect(data.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(Number(response.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});
