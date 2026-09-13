import { afterEach, describe, expect, it, vi } from 'vitest';
import { findWarRoomChannel, warRoomChannelName, warRoomMarker } from '@/lib/microsoft-teams/graph/channels';

vi.mock('@/lib/microsoft-teams/client', () => ({
  getMicrosoftTeamsGraphAccessToken: vi.fn().mockResolvedValue('graph-token'),
  clearMicrosoftTeamsGraphAccessToken: vi.fn(),
}));

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
});

describe('Teams war-room channel identity', () => {
  it('uses a deterministic, bounded, generation-aware name', () => {
    const one = warRoomChannelName('incident-abcdefgh', 1, 'Payments API outage');
    const two = warRoomChannelName('incident-abcdefgh', 2, 'Payments API outage');
    expect(one).toBe('inc-abcdefgh-g1-payments-api-outage');
    expect(two).toBe('inc-abcdefgh-g2-payments-api-outage');
    expect(one).not.toBe(two);
    expect(warRoomChannelName('incident-abcdefgh', 12, 'x'.repeat(200))).toHaveLength(50);
  });

  it('uses the incident and generation marker rather than a mutable title', () => {
    expect(warRoomMarker('incident-abcdefgh', 2)).toBe('[OKWR:incident-abcdefgh:g2]');
    expect(warRoomMarker('incident-abcdefgh', 10)).not.toContain(warRoomMarker('incident-abcdefgh', 1));
  });

  it('rejects duplicate markers even when Graph places them on different pages', async () => {
    const marker = warRoomMarker('incident-abcdefgh', 1);
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        value: [{ id: 'channel-a', displayName: 'first', description: marker }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next-page',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        value: [{ id: 'channel-b', displayName: 'second', description: marker }],
      }), { status: 200 })) as typeof fetch;

    await expect(findWarRoomChannel({ tenantId: 'tenant-1', teamId: 'team-1', marker }))
      .resolves.toMatchObject({ ok: false, code: 'DUPLICATE_WAR_ROOMS' });
  });

  it('refreshes a rejected Graph credential exactly once on 401', async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [] }), { status: 200 })) as typeof fetch;

    await expect(findWarRoomChannel({ tenantId: 'tenant-1', teamId: 'team-1', marker: 'marker' }))
      .resolves.toEqual({ ok: true, value: null });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
