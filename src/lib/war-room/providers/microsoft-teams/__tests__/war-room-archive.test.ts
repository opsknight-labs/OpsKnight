import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockFindUnique = vi.fn();
const mockFetch = vi.fn();

vi.mock('@/lib/prisma', () => ({
  default: {
    incidentWarRoom: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

vi.mock('@/lib/microsoft-teams/client', () => ({
  clearMicrosoftTeamsGraphAccessToken: vi.fn(),
  getMicrosoftTeamsGraphAccessToken: vi.fn().mockResolvedValue('mock-token'),
}));

import { microsoftTeamsWarRoomAdapter } from '../adapter';
import { archiveChannel } from '@/lib/microsoft-teams/graph/channels';

describe('microsoftTeamsWarRoomAdapter — channel archive', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('declares archiveRoom capability as true', () => {
    expect(microsoftTeamsWarRoomAdapter.capabilities.archiveRoom).toBe(true);
    expect(typeof microsoftTeamsWarRoomAdapter.archive).toBe('function');
  });

  describe('archiveChannel graph helper', () => {
    it('sends POST /teams/{teamId}/channels/{channelId}/archive and succeeds on 202', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(null, { status: 202, statusText: 'Accepted' })
      );

      const result = await archiveChannel({
        tenantId: 'tenant-123',
        teamId: 'team-456',
        channelId: 'channel-789',
      });

      expect(result).toEqual({ ok: true, value: null });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/teams/team-456/channels/channel-789/archive',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token',
          }),
        })
      );
    });

    it('idempotently succeeds when Microsoft Graph reports channel already archived', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'BadRequest', message: 'Channel already archived.' } }),
          { status: 400, statusText: 'Bad Request' }
        )
      );

      const result = await archiveChannel({
        tenantId: 'tenant-123',
        teamId: 'team-456',
        channelId: 'channel-789',
      });

      expect(result).toEqual({ ok: true, value: null });
    });

    it('returns CHANNEL_NOT_FOUND when channel is not found', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Channel not found', { status: 404, statusText: 'Not Found' })
      );

      const result = await archiveChannel({
        tenantId: 'tenant-123',
        teamId: 'team-456',
        channelId: 'channel-789',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CHANNEL_NOT_FOUND');
        expect(result.message).toContain('channel was not found');
      }
    });
  });

  describe('adapter.archive', () => {
    it('returns NOT_FOUND if war room record does not exist', async () => {
      mockFindUnique.mockResolvedValueOnce(null);

      const result = await microsoftTeamsWarRoomAdapter.archive!('nonexistent-id');

      expect(result).toEqual({
        ok: false,
        code: 'NOT_FOUND',
        message: 'War room not found.',
      });
    });

    it('returns NOT_FOUND if channel identifiers are missing', async () => {
      mockFindUnique.mockResolvedValueOnce({
        provider: 'MICROSOFT_TEAMS',
        providerTenantId: 'tenant-123',
        providerContainerId: 'team-456',
        providerChannelId: null,
      });

      const result = await microsoftTeamsWarRoomAdapter.archive!('room-no-channel');

      expect(result).toEqual({
        ok: false,
        code: 'NOT_FOUND',
        message: 'Teams channel identifiers missing.',
      });
    });

    it('archives channel and returns success', async () => {
      mockFindUnique.mockResolvedValueOnce({
        provider: 'MICROSOFT_TEAMS',
        providerTenantId: 'tenant-123',
        providerContainerId: 'team-456',
        providerChannelId: '19:channel@thread.tacv2',
      });
      mockFetch.mockResolvedValueOnce(
        new Response(null, { status: 202, statusText: 'Accepted' })
      );

      const result = await microsoftTeamsWarRoomAdapter.archive!('room-123');

      expect(result).toEqual({
        ok: true,
        value: undefined,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://graph.microsoft.com/v1.0/teams/team-456/channels/19%3Achannel%40thread.tacv2/archive',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('maps channel/team not found to NOT_FOUND for graceful settlement', async () => {
      mockFindUnique.mockResolvedValueOnce({
        provider: 'MICROSOFT_TEAMS',
        providerTenantId: 'tenant-123',
        providerContainerId: 'team-456',
        providerChannelId: '19:deleted@thread.tacv2',
      });
      mockFetch.mockResolvedValueOnce(
        new Response('Channel not found', { status: 404, statusText: 'Not Found' })
      );

      const result = await microsoftTeamsWarRoomAdapter.archive!('room-deleted');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('NOT_FOUND');
      }
    });

    it('maps rate limits with retryAfterMs preserved', async () => {
      mockFindUnique.mockResolvedValueOnce({
        provider: 'MICROSOFT_TEAMS',
        providerTenantId: 'tenant-123',
        providerContainerId: 'team-456',
        providerChannelId: '19:channel@thread.tacv2',
      });
      const headers = new Headers();
      headers.set('Retry-After', '5');
      mockFetch.mockResolvedValueOnce(
        new Response('Rate limit', { status: 429, headers })
      );

      const result = await microsoftTeamsWarRoomAdapter.archive!('room-rate-limited');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('RATE_LIMITED');
        expect(result.retryAfterMs).toBe(5000);
      }
    });

    it('maps 403 to PERMISSION_DENIED', async () => {
      mockFindUnique.mockResolvedValueOnce({
        provider: 'MICROSOFT_TEAMS',
        providerTenantId: 'tenant-123',
        providerContainerId: 'team-456',
        providerChannelId: '19:channel@thread.tacv2',
      });
      mockFetch.mockResolvedValueOnce(
        new Response('Forbidden', { status: 403, statusText: 'Forbidden' })
      );

      const result = await microsoftTeamsWarRoomAdapter.archive!('room-forbidden');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PERMISSION_DENIED');
      }
    });
  });
});
