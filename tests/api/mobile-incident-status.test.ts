import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getServerSession = vi.hoisted(() => vi.fn());
const updateIncidentStatus = vi.hoisted(() => vi.fn());
const rateLimit = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));

vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/app/(app)/incidents/actions', () => ({ updateIncidentStatus }));
vi.mock('@/lib/prisma', () => ({ default: { rateLimit } }));

import { PATCH } from '@/app/api/mobile/incidents/[id]/status/route';

function request(key = 'offline-action-1') {
  return new NextRequest('https://ops.example.com/api/mobile/incidents/inc-1/status', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'ACKNOWLEDGED', expectedStatus: 'OPEN' }),
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
  });
}

const props = { params: Promise.resolve({ id: 'inc-1' }) };

describe('mobile incident status idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getServerSession.mockResolvedValue({ user: { email: 'responder@example.com' } });
    rateLimit.findUnique.mockResolvedValue(null);
    rateLimit.upsert.mockResolvedValue({});
    updateIncidentStatus.mockResolvedValue(undefined);
  });

  it('records the idempotency outcome only after a successful mutation', async () => {
    updateIncidentStatus.mockRejectedValueOnce(new Error('temporary database failure'));

    const failed = await PATCH(request(), props);
    expect(failed.status).toBe(500);
    expect(rateLimit.upsert).not.toHaveBeenCalled();

    const retried = await PATCH(request(), props);
    expect(retried.status).toBe(200);
    expect(updateIncidentStatus).toHaveBeenCalledTimes(2);
    expect(rateLimit.upsert).toHaveBeenCalledTimes(1);
  });

  it('returns the completed outcome without replaying the mutation', async () => {
    rateLimit.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000) });

    const response = await PATCH(request(), props);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, duplicate: true });
    expect(updateIncidentStatus).not.toHaveBeenCalled();
  });
});
