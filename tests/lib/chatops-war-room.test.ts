import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateBridgeUrl,
  createIncidentWarRoom,
  postWarRoomUpdate,
  archiveWarRoomChannel,
  inviteUserToWarRoom,
  slackApiCall,
} from '@/lib/chatops/war-room';
import prisma from '@/lib/prisma';
import * as retryModule from '@/lib/retry';

vi.mock('@/lib/prisma', () => ({
  default: {
    incident: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    chatOpsConfig: {
      findUnique: vi.fn(),
    },
    service: {
      findUnique: vi.fn(),
    },
    incidentEvent: {
      create: vi.fn(),
    },
    slackPinnedMessage: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    // Required by the responder auto-invite path. Without it, prisma.user is
    // undefined, the invite block throws immediately and is swallowed by its
    // catch — so the tests pass without ever exercising the invite logic.
    user: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    teamMember: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/escalation', () => ({
  resolveEscalationTarget: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/slack', () => ({
  getSlackBotToken: vi.fn().mockResolvedValue('xoxb-test-token'),
  sendSlackMessageToChannel: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/env-validation', () => ({
  getBaseUrl: () => 'https://app.opsknight.com',
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/lib/retry', () => ({
  retryFetch: vi.fn(),
}));

describe('ChatOps War-Room Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateBridgeUrl', () => {
    it('should generate Jitsi Meet URL', () => {
      const url = generateBridgeUrl('inc-12345678', 'JITSI');
      expect(url).toBe('https://meet.jit.si/opsknight-inc-12345678');
    });

    it('should return null for NONE provider', () => {
      const url = generateBridgeUrl('inc-12345678', 'NONE');
      expect(url).toBeNull();
    });

    it('should generate Zoom meeting URL with custom template or return null if unconfigured', () => {
      const customUrl = generateBridgeUrl('inc-9999', 'ZOOM', 'https://zoom.us/j/1234567890');
      expect(customUrl).toBe('https://zoom.us/j/1234567890');

      const unconfiguredUrl = generateBridgeUrl('inc-12345678', 'ZOOM');
      expect(unconfiguredUrl).toBeNull();
    });

    it('should generate Google Meet URL with custom template or fallback', () => {
      const customUrl = generateBridgeUrl(
        'inc-9999',
        'GOOGLE_MEET',
        'meet.google.com/abc-defg-hij'
      );
      expect(customUrl).toBe('https://meet.google.com/abc-defg-hij');

      const fallbackUrl = generateBridgeUrl('inc-12345678', 'GOOGLE_MEET');
      expect(fallbackUrl).toBe('https://meet.google.com/lookup/opsknight-inc-12345678');
    });

    it('should return null for unknown provider without custom template', () => {
      const url = generateBridgeUrl('inc-12345678', 'UNKNOWN');
      expect(url).toBeNull();
    });
  });

  describe('createIncidentWarRoom', () => {
    it('should return error if incident is not found', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(null as any);
      const result = await createIncidentWarRoom('inc-missing');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Incident not found');
    });

    it('should provision a fresh channel when the previous one was archived', async () => {
      // Reopening an incident must not be blocked by a dead channel.
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-abcdef123456',
        title: 'Recurring outage',
        urgency: 'HIGH',
        status: 'OPEN',
        slackChannelId: 'C-OLD-ARCHIVED',
        warRoomArchivedAt: new Date('2026-08-15T10:00:00Z'),
        serviceId: 'srv-1',
        service: {
          id: 'srv-1',
          name: 'Payments API',
          autoCreateWarRoom: true,
          slackIntegration: { workspaceId: 'workspace-1' },
        },
        assignee: null,
      } as any);
      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        enabled: true,
        channelPrefix: 'inc',
        autoCreateOnUrgency: ['HIGH'],
        autoCreateOnPriority: ['P1'],
        defaultVideoBridge: 'JITSI',
      } as any);
      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: 'srv-1',
        policy: { steps: [] },
      } as any);
      vi.mocked(prisma.incident.update).mockResolvedValue({} as any);
      vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as any);
      vi.mocked(retryModule.retryFetch).mockReset();
      vi.mocked(retryModule.retryFetch).mockImplementation((async (url: any) => {
        if (String(url).includes('conversations.create')) {
          return { json: async () => ({ ok: true, channel: { id: 'C-NEW', name: 'inc-new' } }) };
        }
        return { json: async () => ({ ok: true }) };
      }) as any);

      const result = await createIncidentWarRoom('inc-abcdef123456');

      expect(result.success).toBe(true);
      expect(result.channelId).toBe('C-NEW');
      expect(prisma.incident.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slackChannelId: 'C-NEW', warRoomArchivedAt: null }),
        })
      );
    });

    it('should return existing war-room if already created', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-104',
        slackChannelId: 'C123456',
        slackChannelName: 'inc-104-payments',
        service: { id: 'srv-1', name: 'Payments API' },
      } as any);

      const result = await createIncidentWarRoom('inc-104');
      expect(result.success).toBe(true);
      expect(result.channelId).toBe('C123456');
    });

    it('should return error if ChatOps is disabled globally', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-104',
        urgency: 'HIGH',
        slackChannelId: null,
        service: { id: 'srv-1', name: 'Payments API', autoCreateWarRoom: true },
      } as any);
      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        enabled: false,
      } as any);

      const result = await createIncidentWarRoom('inc-104');
      expect(result.success).toBe(false);
      expect(result.error).toBe('ChatOps is not enabled');
    });

    it('should return error if incident does not meet urgency threshold', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-104',
        urgency: 'LOW',
        priority: 'P4',
        slackChannelId: null,
        service: { id: 'srv-1', name: 'Payments API', autoCreateWarRoom: true },
      } as any);
      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        enabled: true,
        autoCreateOnUrgency: ['HIGH'],
        autoCreateOnPriority: ['P1', 'P2'],
      } as any);

      const result = await createIncidentWarRoom('inc-104');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Incident does not meet urgency/priority threshold');
    });

    it('should create a war-room below threshold when forced', async () => {
      // The incident page renders "Create War-Room" for every incident. Pressing
      // it must not be refused by the thresholds that govern auto-creation.
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-abcdef123456',
        title: 'Minor Glitch',
        urgency: 'LOW',
        priority: 'P4',
        status: 'OPEN',
        slackChannelId: null,
        serviceId: 'srv-1',
        service: {
          id: 'srv-1',
          name: 'Payments API',
          autoCreateWarRoom: false, // per-service auto-creation off
          warRoomVideoBridge: 'JITSI',
          slackIntegration: { workspaceId: 'workspace-1' },
        },
        assignee: null,
      } as any);

      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        enabled: true,
        channelPrefix: 'inc',
        autoCreateOnUrgency: ['HIGH'],
        autoCreateOnPriority: ['P1', 'P2'],
        defaultVideoBridge: 'JITSI',
      } as any);

      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: 'srv-1',
        policy: { steps: [] },
      } as any);
      vi.mocked(prisma.incident.update).mockResolvedValue({} as any);
      vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as any);

      vi.mocked(retryModule.retryFetch).mockReset();
      vi.mocked(retryModule.retryFetch).mockImplementation((async (url: any) => {
        if (String(url).includes('conversations.create')) {
          return {
            json: async () => ({
              ok: true,
              channel: { id: 'C555444', name: 'inc-123456-payments-api' },
            }),
          };
        }
        return { json: async () => ({ ok: true }) };
      }) as any);

      const result = await createIncidentWarRoom('inc-abcdef123456', { force: true });

      expect(result.success).toBe(true);
      expect(result.channelId).toBe('C555444');
    });

    it('should still refuse auto-creation below threshold when not forced', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-104',
        urgency: 'LOW',
        priority: 'P4',
        slackChannelId: null,
        service: { id: 'srv-1', name: 'Payments API', autoCreateWarRoom: true },
      } as any);
      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        enabled: true,
        autoCreateOnUrgency: ['HIGH'],
        autoCreateOnPriority: ['P1', 'P2'],
      } as any);

      const result = await createIncidentWarRoom('inc-104', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Incident does not meet urgency/priority threshold');
    });

    it('should successfully create Slack channel and update incident', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-abcdef123456',
        title: 'Database Overload',
        urgency: 'HIGH',
        status: 'OPEN',
        slackChannelId: null,
        serviceId: 'srv-1',
        service: {
          id: 'srv-1',
          name: 'Database Cluster',
          autoCreateWarRoom: true,
          warRoomVideoBridge: 'JITSI',
          slackIntegration: { workspaceId: 'workspace-1' },
        },
        assignee: { id: 'usr-1', name: 'Dev', email: 'dev@test.com' },
      } as any);

      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        enabled: true,
        channelPrefix: 'inc',
        autoCreateOnUrgency: ['HIGH'],
        autoCreateOnPriority: ['P1'],
        defaultVideoBridge: 'JITSI',
      } as any);

      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: 'srv-1',
        policy: { steps: [] },
      } as any);

      // Mock Slack API calls (conversations.create, setTopic)
      vi.spyOn(retryModule, 'retryFetch')
        .mockResolvedValueOnce({
          json: async () => ({
            ok: true,
            channel: { id: 'C999888', name: 'inc-123456-database-cluster' },
          }),
        } as any)
        .mockResolvedValueOnce({
          json: async () => ({ ok: true }),
        } as any);

      vi.mocked(prisma.incident.update).mockResolvedValue({} as any);
      vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as any);

      const result = await createIncidentWarRoom('inc-abcdef123456');
      expect(result.success).toBe(true);
      expect(result.channelId).toBe('C999888');
      expect(result.warRoomUrl).toBe('https://meet.jit.si/opsknight-inc-ef123456');
      expect(prisma.incident.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inc-abcdef123456' },
          data: expect.objectContaining({
            slackChannelId: 'C999888',
          }),
        })
      );
    });

    it('should look up responders via HTTP GET and invite them to the channel', async () => {
      // Regression guard for a bug fixed five separate times: users.lookupByEmail
      // must be a GET with query params. POST+JSON returns invalid_arguments and
      // silently invites nobody, leaving an empty war-room.
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-abcdef123456',
        title: 'Database Overload',
        urgency: 'HIGH',
        status: 'OPEN',
        slackChannelId: null,
        serviceId: 'srv-1',
        assigneeId: 'usr-1',
        service: {
          id: 'srv-1',
          name: 'Database Cluster',
          autoCreateWarRoom: true,
          warRoomVideoBridge: 'JITSI',
          slackIntegration: { workspaceId: 'workspace-1' },
        },
        assignee: { id: 'usr-1', name: 'Dev', email: 'dev@test.com' },
      } as any);

      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        enabled: true,
        channelPrefix: 'inc',
        autoCreateOnUrgency: ['HIGH'],
        autoCreateOnPriority: ['P1'],
        defaultVideoBridge: 'JITSI',
      } as any);

      vi.mocked(prisma.service.findUnique).mockResolvedValue({
        id: 'srv-1',
        policy: { steps: [] },
      } as any);

      // Mixed case on purpose — the lookup must normalise before querying Slack
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: 'usr-1', name: 'Dev', email: 'Dev@Test.com' },
      ] as any);
      vi.mocked(prisma.incident.update).mockResolvedValue({} as any);
      vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as any);

      const requests: Array<{ url: string; method: string; body?: unknown }> = [];
      vi.mocked(retryModule.retryFetch).mockReset();
      vi.mocked(retryModule.retryFetch).mockImplementation((async (url: any, init: any) => {
        const href = String(url);
        requests.push({ url: href, method: init?.method || 'GET', body: init?.body });

        if (href.includes('conversations.create')) {
          return {
            json: async () => ({
              ok: true,
              channel: { id: 'C999888', name: 'inc-123456-database-cluster' },
            }),
          };
        }
        if (href.includes('users.lookupByEmail')) {
          return { json: async () => ({ ok: true, user: { id: 'U-SLACK-1' } }) };
        }
        return { json: async () => ({ ok: true }) };
      }) as any);

      const result = await createIncidentWarRoom('inc-abcdef123456');
      expect(result.success).toBe(true);

      const lookup = requests.find(r => r.url.includes('users.lookupByEmail'));
      expect(lookup).toBeDefined();
      expect(lookup!.method).toBe('GET');
      expect(lookup!.body).toBeUndefined();
      expect(lookup!.url).toContain(`email=${encodeURIComponent('dev@test.com')}`);

      const invite = requests.find(r => r.url.includes('conversations.invite'));
      expect(invite).toBeDefined();
      expect(JSON.parse(String(invite!.body))).toMatchObject({
        channel: 'C999888',
        users: 'U-SLACK-1',
      });
    });
  });

  describe('postWarRoomUpdate', () => {
    it('should refuse to post into an archived channel', async () => {
      // The channel id is retained after archiving, so presence alone is not
      // enough — posting there sends updates where nobody will read them.
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: 'C123',
        serviceId: 'srv-1',
        warRoomArchivedAt: new Date('2026-08-16T10:00:00Z'),
      } as any);

      const result = await postWarRoomUpdate('inc-104', 'Status update');
      expect(result.success).toBe(false);
      expect(result.error).toBe('War-room channel is archived');
    });

    it('should return error if no channel is linked', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: null,
      } as any);

      const result = await postWarRoomUpdate('inc-104', 'Test note');
      expect(result.success).toBe(false);
      expect(result.error).toBe('No war-room channel for this incident');
    });

    it('should post message to Slack channel', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: 'C123',
        serviceId: 'srv-1',
      } as any);

      vi.spyOn(retryModule, 'retryFetch').mockResolvedValue({
        json: async () => ({ ok: true }),
      } as any);

      const result = await postWarRoomUpdate('inc-104', 'Updating database parameters');
      expect(result.success).toBe(true);
    });
  });

  describe('archiveWarRoomChannel', () => {
    it('should return error if no channel exists', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: null,
      } as any);

      const result = await archiveWarRoomChannel('inc-104');
      expect(result.success).toBe(false);
    });

    it('should archive channel when archiveOnResolve is enabled', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: 'C123',
        slackChannelName: 'inc-104-payments',
        serviceId: 'srv-1',
      } as any);

      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        archiveOnResolve: true,
      } as any);

      vi.spyOn(retryModule, 'retryFetch').mockResolvedValue({
        json: async () => ({ ok: true }),
      } as any);

      vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as any);

      const result = await archiveWarRoomChannel('inc-104');
      expect(result.success).toBe(true);
    });

    it('should refuse to auto-archive when archiveOnResolve is disabled', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: 'C123',
        slackChannelName: 'inc-104-payments',
        serviceId: 'srv-1',
      } as any);

      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        archiveOnResolve: false,
      } as any);

      const result = await archiveWarRoomChannel('inc-104');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Archive on resolve is disabled');
    });

    it('should stamp warRoomArchivedAt so the channel stops reading as live', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: 'C123',
        slackChannelName: 'inc-104-payments',
        serviceId: 'srv-1',
      } as any);
      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        archiveOnResolve: true,
      } as any);
      vi.mocked(prisma.incident.update).mockResolvedValue({} as any);
      vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as any);
      vi.spyOn(retryModule, 'retryFetch').mockResolvedValue({
        json: async () => ({ ok: true }),
      } as any);

      await archiveWarRoomChannel('inc-104');

      expect(prisma.incident.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inc-104' },
          data: expect.objectContaining({ warRoomArchivedAt: expect.any(Date) }),
        })
      );
    });

    it('should archive when forced even if archiveOnResolve is disabled', async () => {
      // The Archive button on the incident page is an explicit operator action.
      // The auto-archive setting governs resolve-time behaviour only.
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: 'C123',
        slackChannelName: 'inc-104-payments',
        serviceId: 'srv-1',
      } as any);

      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        archiveOnResolve: false,
      } as any);

      vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as any);
      vi.spyOn(retryModule, 'retryFetch').mockResolvedValue({
        json: async () => ({ ok: true }),
      } as any);

      const result = await archiveWarRoomChannel('inc-104', { force: true });
      expect(result.success).toBe(true);
    });
  });

  describe('archived war-room guards', () => {
    it('should not invite a user into an archived channel', async () => {
      // Reassigning an incident after its channel was archived must not drag
      // people into a dead channel.
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: 'C123',
        slackChannelName: 'inc-104-payments',
        serviceId: 'srv-1',
        warRoomArchivedAt: new Date('2026-08-16T10:00:00Z'),
      } as any);

      const result = await inviteUserToWarRoom('inc-104', 'usr-1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('War-room channel is archived');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should treat a second archive as a no-op', async () => {
      // Resolve can reach archiving from the server action, bulk resolve and the
      // Slack button; without this the farewell message posts more than once.
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: 'C123',
        slackChannelName: 'inc-104-payments',
        serviceId: 'srv-1',
        warRoomArchivedAt: new Date('2026-08-16T10:00:00Z'),
      } as any);
      vi.mocked(retryModule.retryFetch).mockReset();

      const result = await archiveWarRoomChannel('inc-104');

      expect(result.success).toBe(true);
      expect(retryModule.retryFetch).not.toHaveBeenCalled();
      expect(prisma.incidentEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('slackApiCall', () => {
    it('should return an error result rather than throwing when Slack rate limits', async () => {
      // retryFetch surfaces 429/5xx as a thrown `HTTP <status>` error. Callers
      // branch on result.ok, so throwing made rate limits crash some paths and
      // get silently swallowed on others.
      vi.mocked(retryModule.retryFetch).mockReset();
      vi.mocked(retryModule.retryFetch).mockRejectedValue(new Error('HTTP 429: Too Many Requests'));

      const result = await slackApiCall('chat.postMessage', 'xoxb-test-token', {
        channel: 'C123',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('429');
    });
  });
});
