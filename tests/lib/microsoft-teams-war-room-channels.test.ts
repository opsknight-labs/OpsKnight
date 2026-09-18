import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChannel,
  findWarRoomChannel,
  warRoomChannelName,
  warRoomMarker,
} from '@/lib/microsoft-teams/graph/channels';

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
    expect(warRoomMarker('incident-abcdefgh', 10)).not.toContain(
      warRoomMarker('incident-abcdefgh', 1)
    );
  });

  it('rejects duplicate markers even when Graph places them on different pages', async () => {
    const marker = warRoomMarker('incident-abcdefgh', 1);
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [{ id: 'channel-a', displayName: 'first', description: marker }],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next-page',
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [{ id: 'channel-b', displayName: 'second', description: marker }],
          }),
          { status: 200 }
        )
      ) as typeof fetch;

    await expect(
      findWarRoomChannel({ tenantId: 'tenant-1', teamId: 'team-1', marker })
    ).resolves.toMatchObject({ ok: false, code: 'DUPLICATE_WAR_ROOMS' });
  });

  it('refreshes a rejected Graph credential exactly once on 401', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [] }), { status: 200 })
      ) as typeof fetch;

    await expect(
      findWarRoomChannel({ tenantId: 'tenant-1', teamId: 'team-1', marker: 'marker' })
    ).resolves.toEqual({ ok: true, value: null });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('creates a private channel with the verified owner in the initial request', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'channel-1', displayName: 'incident-room' }), {
        status: 201,
      })
    ) as typeof fetch;
    await expect(
      createChannel({
        tenantId: 'tenant-1',
        teamId: 'team-1',
        displayName: 'incident-room',
        description: 'marker',
        membershipType: 'PRIVATE',
        ownerObjectId: "owner'o",
      })
    ).resolves.toMatchObject({ ok: true, value: { id: 'channel-1' } });
    const request = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(String(request?.[1]?.body));
    expect(body.membershipType).toBe('private');
    expect(body.members).toEqual([
      expect.objectContaining({
        roles: ['owner'],
        'user@odata.bind': "https://graph.microsoft.com/v1.0/users('owner''o')",
      }),
    ]);
  });

  it('rejects a private create without a verified owner before calling Graph', async () => {
    global.fetch = vi.fn() as typeof fetch;
    await expect(
      createChannel({
        tenantId: 'tenant-1',
        teamId: 'team-1',
        displayName: 'incident-room',
        description: 'marker',
        membershipType: 'PRIVATE',
      })
    ).resolves.toMatchObject({ ok: false, code: 'MEMBER_NOT_IN_TEAM' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('findUserByUpn Entra directory resolution', () => {
  it('resolves user object ID on 200 OK', async () => {
    const { findUserByUpn } = await import('@/lib/microsoft-teams/graph/members');
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'user-guid-123' }), { status: 200 })
      ) as typeof fetch;

    const result = await findUserByUpn({ tenantId: 'tenant-1', upn: 'admin@contoso.com' });
    expect(result).toEqual({ ok: true, value: { id: 'user-guid-123' } });
  });

  it('classifies 429 as retryable RATE_LIMITED with retryAfterMs', async () => {
    const { findUserByUpn } = await import('@/lib/microsoft-teams/graph/members');
    global.fetch = vi.fn().mockResolvedValue(
      new Response('rate limited', {
        status: 429,
        headers: { 'Retry-After': '5' },
      })
    ) as typeof fetch;

    const result = await findUserByUpn({ tenantId: 'tenant-1', upn: 'admin@contoso.com' });
    expect(result).toMatchObject({
      ok: false,
      code: 'RATE_LIMITED',
      retryAfterMs: 5000,
    });
  });

  it('classifies 5xx as retryable TRANSIENT_READ', async () => {
    const { findUserByUpn } = await import('@/lib/microsoft-teams/graph/members');
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response('internal error', { status: 503 })) as typeof fetch;

    const result = await findUserByUpn({ tenantId: 'tenant-1', upn: 'admin@contoso.com' });
    expect(result).toMatchObject({
      ok: false,
      code: 'TRANSIENT_READ',
    });
  });

  it('classifies network fetch throw as retryable TRANSIENT_READ', async () => {
    const { findUserByUpn } = await import('@/lib/microsoft-teams/graph/members');
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNRESET')) as typeof fetch;

    const result = await findUserByUpn({ tenantId: 'tenant-1', upn: 'admin@contoso.com' });
    expect(result).toMatchObject({
      ok: false,
      code: 'TRANSIENT_READ',
    });
  });

  it('classifies 404 user not found as terminal ok: true, value: null', async () => {
    const { findUserByUpn } = await import('@/lib/microsoft-teams/graph/members');
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 'Request_ResourceNotFound', message: 'User not found' } }),
        {
          status: 404,
        }
      )
    ) as typeof fetch;

    const result = await findUserByUpn({ tenantId: 'tenant-1', upn: 'nonexistent@contoso.com' });
    expect(result).toEqual({ ok: true, value: null });
  });
});

describe('findTeamMember & listTeamMembers Graph queries', () => {
  it('queries /teams/{teamId}/members without $select to avoid conversationMember OData failure', async () => {
    const { findTeamMember } = await import('@/lib/microsoft-teams/graph/members');
    let requestedUrl = '';
    global.fetch = vi.fn().mockImplementation((url: string) => {
      requestedUrl = url;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            value: [
              {
                '@odata.type': '#microsoft.graph.aadUserConversationMember',
                id: 'member-1',
                userId: 'user-guid-456',
                roles: ['owner'],
              },
            ],
          }),
          { status: 200 }
        )
      );
    }) as typeof fetch;

    const result = await findTeamMember({
      tenantId: 'tenant-1',
      teamId: 'team-abc',
      userObjectId: 'user-guid-456',
    });

    expect(requestedUrl).toBe('https://graph.microsoft.com/v1.0/teams/team-abc/members?$top=100');
    expect(requestedUrl).not.toContain('$select');
    expect(result).toEqual({
      ok: true,
      value: {
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        id: 'member-1',
        userId: 'user-guid-456',
        roles: ['owner'],
      },
    });
  });

  it('listTeamMembers queries without $select and indexes by userId', async () => {
    const { listTeamMembers } = await import('@/lib/microsoft-teams/graph/members');
    let requestedUrl = '';
    global.fetch = vi.fn().mockImplementation((url: string) => {
      requestedUrl = url;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            value: [
              {
                '@odata.type': '#microsoft.graph.aadUserConversationMember',
                id: 'member-1',
                userId: 'user-guid-456',
                roles: ['owner'],
              },
            ],
          }),
          { status: 200 }
        )
      );
    }) as typeof fetch;

    const result = await listTeamMembers({
      tenantId: 'tenant-1',
      teamId: 'team-abc',
    });

    expect(requestedUrl).toBe('https://graph.microsoft.com/v1.0/teams/team-abc/members?$top=100');
    expect(requestedUrl).not.toContain('$select');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.get('user-guid-456')).toMatchObject({
        id: 'member-1',
        userId: 'user-guid-456',
      });
    }
  });
});
