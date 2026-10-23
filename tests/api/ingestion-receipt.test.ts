import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/events/receipts/[id]/route';
import { authenticateApiKey } from '@/lib/api-auth';
import { resolveApiKeyActor } from '@/lib/authorization-actors';
import { authorize } from '@/lib/authorization-policy';

const db = vi.hoisted(() => ({
  ingestionReceipt: { findUnique: vi.fn() },
  service: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ default: db }));
vi.mock('@/lib/api-auth', () => ({ authenticateApiKey: vi.fn() }));
vi.mock('@/lib/authorization-actors', () => ({ resolveApiKeyActor: vi.fn() }));
vi.mock('@/lib/authorization-policy', () => ({
  AUTHORIZATION_ACTIONS: { EVENT_CREATE: 'event.create' },
  authorize: vi.fn(),
}));
const id = '4c0dd9de-e55d-4753-b514-95fedbbfd64f';
const request = () => new NextRequest(`http://localhost/api/events/receipts/${id}`);
const context = () => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authenticateApiKey).mockResolvedValue(null);
  vi.mocked(resolveApiKeyActor).mockResolvedValue({
    id: 'actor',
    role: 'RESPONDER',
    status: 'ACTIVE',
    teamIds: ['own-team'],
  });
  vi.mocked(authorize).mockReturnValue({ allowed: true, scope: 'resource' });
  db.ingestionReceipt.findUnique.mockResolvedValue({ id, serviceId: 'service', status: 'PENDING' });
  db.service.findUnique.mockResolvedValue({ teamId: 'own-team' });
});

describe('receipt service isolation', () => {
  it('requires a live API credential before reading receipts', async () => {
    expect((await GET(request(), context())).status).toBe(401);
    expect(db.ingestionReceipt.findUnique).not.toHaveBeenCalled();
  });
  it('hides receipts outside the actor service scope', async () => {
    vi.mocked(authenticateApiKey).mockResolvedValue({
      id: 'key',
      userId: 'actor',
      scopes: ['events:write'],
    } as Awaited<ReturnType<typeof authenticateApiKey>>);
    vi.mocked(authorize)
      .mockReturnValueOnce({ allowed: true, scope: 'resource' })
      .mockReturnValueOnce({
        allowed: false,
        reason: 'RESOURCE_OUT_OF_SCOPE',
        requiredCapability: 'incident.create.all',
      });
    expect((await GET(request(), context())).status).toBe(404);
  });
  it('returns a no-store status response and selects no raw envelope or lease credentials', async () => {
    vi.mocked(authenticateApiKey).mockResolvedValue({
      id: 'key',
      userId: 'actor',
      scopes: ['events:write'],
    } as Awaited<ReturnType<typeof authenticateApiKey>>);
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const selection = db.ingestionReceipt.findUnique.mock.calls[0][0].select;
    expect(selection.envelope).toBeUndefined();
    expect(selection.leaseToken).toBeUndefined();
  });
});
