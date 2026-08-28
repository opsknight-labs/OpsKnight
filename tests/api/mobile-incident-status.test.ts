import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getServerSession = vi.hoisted(() => vi.fn());
const updateIncidentStatus = vi.hoisted(() => vi.fn());

vi.mock('next-auth', () => ({ getServerSession }));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/incidents/operator-lifecycle', () => ({ updateIncidentStatus }));

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
    getServerSession.mockResolvedValue({ user: { email: 'Responder@Example.com' } });
    updateIncidentStatus.mockResolvedValue({ replayed: false });
  });

  it('passes the request key into the transaction-bound lifecycle command', async () => {
    const response = await PATCH(request(), props);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(updateIncidentStatus).toHaveBeenCalledWith(
      'inc-1',
      'ACKNOWLEDGED',
      'OPEN',
      'MOBILE',
      { key: 'offline-action-1', principalId: 'responder@example.com' }
    );
  });

  it('returns the persisted result as a duplicate without inventing a second mutation path', async () => {
    updateIncidentStatus.mockResolvedValue({ replayed: true });

    const response = await PATCH(request(), props);

    expect(response.status).toBe(200);
    expect(response.headers.get('Idempotency-Replayed')).toBe('true');
    expect(await response.json()).toEqual({ success: true, duplicate: true });
    expect(updateIncidentStatus).toHaveBeenCalledOnce();
  });

  it('does not require an idempotency key for online calls', async () => {
    const req = new NextRequest('https://ops.example.com/api/mobile/incidents/inc-1/status', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'ACKNOWLEDGED' }),
      headers: { 'content-type': 'application/json' },
    });

    const response = await PATCH(req, props);

    expect(response.status).toBe(200);
    expect(updateIncidentStatus).toHaveBeenCalledWith(
      'inc-1',
      'ACKNOWLEDGED',
      undefined,
      'MOBILE',
      undefined
    );
  });
});
