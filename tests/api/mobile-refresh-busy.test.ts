import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const m = vi.hoisted(() => ({ dashboard: vi.fn(), status: vi.fn() }));

vi.mock('@/lib/request-actor-context', () => ({
  getRequestActorContext: async () => ({ actor: { id: 'user-1' }, user: { id: 'user-1' } }),
}));
vi.mock('@/lib/dashboard/responder-dashboard-snapshot', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/dashboard/responder-dashboard-snapshot')>()),
  getResponderDashboardSnapshot: m.dashboard,
}));
vi.mock('@/lib/status/internal-operational-status-snapshot', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/status/internal-operational-status-snapshot')>()),
  getInternalOperationalStatusSnapshot: m.status,
}));
vi.mock('@/lib/realtime-change-control-plane', () => ({
  getRealtimeChangeGeneration: async () => 7,
}));

import { POST } from '@/app/api/mobile/refresh/route';
import { ResponderDashboardUnavailableError } from '@/lib/dashboard/responder-dashboard-snapshot';
import { InternalOperationalStatusBusyError } from '@/lib/status/internal-operational-status-snapshot';

const refresh = (pathname: string) =>
  POST(
    new NextRequest('http://localhost/api/mobile/refresh', {
      method: 'POST',
      body: JSON.stringify({ pathname }),
    })
  );

describe('POST /api/mobile/refresh when recalculation slots are taken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('answers 503 with Retry-After for the dashboard instead of a 500', async () => {
    m.dashboard.mockRejectedValue(new ResponderDashboardUnavailableError());

    const response = await refresh('/m');

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('2');
    expect(await response.json()).toEqual({ error: 'REFRESH_BUSY' });
  });

  it('does the same for the operational status page', async () => {
    m.status.mockRejectedValue(new InternalOperationalStatusBusyError());

    const response = await refresh('/m/status');

    expect(response.status).toBe(503);
  });

  it('still lets unexpected failures surface', async () => {
    m.dashboard.mockRejectedValue(new Error('database down'));

    await expect(refresh('/m')).rejects.toThrow('database down');
  });

  it('answers ok after a successful fresh read', async () => {
    m.dashboard.mockResolvedValue({});

    const response = await refresh('/m');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, generation: 7 });
  });
});
