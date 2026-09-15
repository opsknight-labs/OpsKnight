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
import { adoptWarRoomChannel, claimWarRoomProvisioning } from '@/lib/war-room/repository';
import {
  findSlackWarRoomAuthority,
  projectSlackWarRoomToLegacyIncident,
} from '@/lib/war-room/slack-compatibility';
import { projectIncidentWarRoomParticipants } from '@/lib/war-room/participant-desired-state';
import { scheduleJob } from '@/lib/jobs/queue';
import { requestSlackWarRoom } from '@/lib/war-room/providers/slack/provision';

vi.mock('@/lib/war-room/providers/slack/provision', () => ({
  requestSlackWarRoom: vi.fn(),
  provisionSlackWarRoom: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    incident: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    chatOpsConfig: {
      findUnique: vi.fn(),
    },
    service: {
      findUnique: vi.fn(),
    },
    slackIntegration: {
      findFirst: vi.fn(),
    },
    backgroundJob: {
      create: vi.fn(),
    },
    incidentEvent: {
      create: vi.fn(),
    },
    incidentWarRoom: {
      findUnique: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: vi.fn((callback: (tx: object) => unknown) => callback({})),
}));

vi.mock('@/lib/war-room/repository', () => ({
  claimWarRoomProvisioning: vi.fn(),
  adoptWarRoomChannel: vi.fn(),
}));

vi.mock('@/lib/war-room/slack-compatibility', () => ({
  findSlackWarRoomAuthority: vi.fn(),
  projectSlackWarRoomToLegacyIncident: vi.fn(),
}));

vi.mock('@/lib/war-room/participant-desired-state', () => ({
  projectIncidentWarRoomParticipants: vi.fn(),
  requestWarRoomParticipant: vi.fn(),
}));

vi.mock('@/lib/jobs/queue', () => ({ scheduleJob: vi.fn() }));

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
  const activeSlackRoom = {
    id: 'slack-room-1',
    state: 'READY',
    providerChannelId: 'C123',
    providerChannelName: 'inc-104-payments',
    providerChannelUrl: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findSlackWarRoomAuthority).mockResolvedValue(null as unknown as never);
    vi.mocked(projectSlackWarRoomToLegacyIncident).mockResolvedValue(undefined);
    vi.mocked(projectIncidentWarRoomParticipants).mockResolvedValue(undefined);
    vi.mocked(scheduleJob).mockResolvedValue('job-1');
    vi.mocked(claimWarRoomProvisioning).mockResolvedValue({
      claimed: true,
      warRoom: {
        id: 'slack-room-1',
        state: 'PROVISIONING',
        provisioningToken: 'slack-lease-1',
      },
    } as never);
    vi.mocked(adoptWarRoomChannel).mockResolvedValue('READY');
    vi.mocked(prisma.incidentWarRoom.updateMany).mockResolvedValue({ count: 1 });
    vi.mocked(requestSlackWarRoom).mockResolvedValue({
      accepted: true,
      warRoomId: 'slack-room-1',
      state: 'PROVISIONING',
    } as never);
    vi.mocked(prisma.incidentWarRoom.findUnique).mockResolvedValue({
      id: 'slack-room-1',
      state: 'PROVISIONING',
      providerChannelId: null,
      providerChannelName: null,
      providerChannelUrl: null,
    } as never);
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
      vi.mocked(prisma.incident.findUnique).mockResolvedValue(null as unknown as never);
      const result = await createIncidentWarRoom('inc-missing');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Incident not found');
    });

    it('should provision a fresh channel when the previous one was archived', async () => {
      // Reopening must enqueue a fresh generation even though a prior
      // IncidentWarRoom is ARCHIVED — legacy channelId is not authority.
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
      } as never);
      // Durable request boundary — Slack I/O is owned by the worker.
      vi.mocked(requestSlackWarRoom).mockResolvedValue({
        accepted: true,
        warRoomId: 'slack-room-1',
        state: 'PROVISIONING',
      } as never);
      vi.mocked(prisma.incidentWarRoom.findUnique).mockResolvedValue({
        id: 'slack-room-1',
        state: 'PROVISIONING',
        providerChannelId: null,
        providerChannelName: null,
        providerChannelUrl: null,
      } as never);

      const result = await createIncidentWarRoom('inc-abcdef123456');

      expect(requestSlackWarRoom).toHaveBeenCalledWith('inc-abcdef123456', {
        manual: false,
        allowNewGeneration: true,
      });
      expect(result.success).toBe(true);
      expect(result.warRoomId).toBe('slack-room-1');
      expect(result.state).toBe('PROVISIONING');
      expect(retryModule.retryFetch).not.toHaveBeenCalled();
    });

    it('should return existing war-room if already created', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-104',
        service: { id: 'srv-1', name: 'Payments API' },
      } as never);
      vi.mocked(findSlackWarRoomAuthority).mockResolvedValue({
        id: 'slack-room-existing',
        state: 'READY',
        providerChannelId: 'C123456',
        providerChannelName: 'inc-104-payments',
        providerChannelUrl: null,
      } as never);

      const result = await createIncidentWarRoom('inc-104');
      expect(result.success).toBe(true);
      expect(result.channelId).toBe('C123456');
    });

    it('should return error if ChatOps is disabled globally', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-104',
        urgency: 'HIGH',
        status: 'OPEN',
        slackChannelId: null,
        service: { id: 'srv-1', name: 'Payments API', autoCreateWarRoom: true },
      } as never);
      vi.mocked(requestSlackWarRoom).mockResolvedValue({
        accepted: false,
        code: 'CHATOPS_DISABLED',
      } as never);

      const result = await createIncidentWarRoom('inc-104');
      expect(result.success).toBe(false);
      expect(result.error).toBe('ChatOps is not enabled');
    });

    it('should return error if incident does not meet urgency threshold', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-104',
        urgency: 'LOW',
        priority: 'P4',
        status: 'OPEN',
        slackChannelId: null,
        service: { id: 'srv-1', name: 'Payments API', autoCreateWarRoom: true },
      } as never);
      vi.mocked(requestSlackWarRoom).mockResolvedValue({
        accepted: false,
        code: 'THRESHOLD_NOT_MET',
      } as never);

      const result = await createIncidentWarRoom('inc-104');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Incident does not meet urgency/priority threshold');
    });

    it('should create a war-room below threshold when forced', async () => {
      // Manual creation (force: true) must enqueue even when the thresholds
      // that govern auto-creation would otherwise deny it. The policy boundary
      // inside requestSlackWarRoom receives manual=true.
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
          autoCreateWarRoom: false,
          warRoomVideoBridge: 'JITSI',
          slackIntegration: { workspaceId: 'workspace-1' },
        },
        assignee: null,
      } as never);
      vi.mocked(requestSlackWarRoom).mockResolvedValue({
        accepted: true,
        warRoomId: 'slack-room-1',
        state: 'PROVISIONING',
      } as never);
      vi.mocked(prisma.incidentWarRoom.findUnique).mockResolvedValue({
        id: 'slack-room-1',
        state: 'PROVISIONING',
        providerChannelId: null,
        providerChannelName: null,
        providerChannelUrl: null,
      } as never);

      const result = await createIncidentWarRoom('inc-abcdef123456', { force: true });

      expect(requestSlackWarRoom).toHaveBeenCalledWith('inc-abcdef123456', {
        manual: true,
        allowNewGeneration: true,
      });
      expect(result.success).toBe(true);
      expect(result.state).toBe('PROVISIONING');
    });

    it('should still refuse auto-creation below threshold when not forced', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        id: 'inc-104',
        urgency: 'LOW',
        priority: 'P4',
        status: 'OPEN',
        slackChannelId: null,
        service: { id: 'srv-1', name: 'Payments API', autoCreateWarRoom: true },
      } as never);
      vi.mocked(requestSlackWarRoom).mockResolvedValue({
        accepted: false,
        code: 'THRESHOLD_NOT_MET',
      } as never);

      const result = await createIncidentWarRoom('inc-104', {});
      expect(result.success).toBe(false);
      expect(result.error).toBe('Incident does not meet urgency/priority threshold');
    });

    it('should successfully create Slack channel and update incident', async () => {
      // Durable boundary: request path enqueues creation and returns the
      // generation immediately; the queue worker owns conversations.create,
      // topic/bridge setup and adoption.
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
      } as never);
      vi.mocked(requestSlackWarRoom).mockResolvedValue({
        accepted: true,
        warRoomId: 'slack-room-1',
        state: 'PROVISIONING',
      } as never);
      vi.mocked(prisma.incidentWarRoom.findUnique).mockResolvedValue({
        id: 'slack-room-1',
        state: 'PROVISIONING',
        providerChannelId: null,
        providerChannelName: null,
        providerChannelUrl: null,
      } as never);

      const result = await createIncidentWarRoom('inc-abcdef123456');
      expect(result.success).toBe(true);
      expect(result.warRoomId).toBe('slack-room-1');
      expect(result.state).toBe('PROVISIONING');
      expect(requestSlackWarRoom).toHaveBeenCalledWith('inc-abcdef123456', {
        manual: false,
        allowNewGeneration: true,
      });
      expect(retryModule.retryFetch).not.toHaveBeenCalled();
    });

    it('should enqueue durable participant setup through the worker path', async () => {
      // No direct Slack invite is performed on the request path — participant
      // projection is owned by the worker after the channel exists. This
      // asserts the old direct-invite path stays dead.
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
      } as never);
      vi.mocked(requestSlackWarRoom).mockResolvedValue({
        accepted: true,
        warRoomId: 'slack-room-1',
        state: 'PROVISIONING',
      } as never);
      vi.mocked(prisma.incidentWarRoom.findUnique).mockResolvedValue({
        id: 'slack-room-1',
        state: 'PROVISIONING',
        providerChannelId: null,
        providerChannelName: null,
        providerChannelUrl: null,
      } as never);
      vi.mocked(retryModule.retryFetch).mockReset();

      const result = await createIncidentWarRoom('inc-abcdef123456');
      expect(result.success).toBe(true);
      expect(requestSlackWarRoom).toHaveBeenCalledWith('inc-abcdef123456', {
        manual: false,
        allowNewGeneration: true,
      });
      expect(projectIncidentWarRoomParticipants).not.toHaveBeenCalled();
      expect(scheduleJob).not.toHaveBeenCalledWith(
        'WAR_ROOM_PARTICIPANT_SYNC',
        expect.any(Date),
        expect.anything(),
        expect.anything()
      );
      expect(retryModule.retryFetch).not.toHaveBeenCalled();
    });
  });

  describe('postWarRoomUpdate', () => {
    beforeEach(() => {
      vi.mocked(findSlackWarRoomAuthority).mockResolvedValue(activeSlackRoom as unknown as never);
    });

    it('should refuse to post into an archived channel', async () => {
      // The channel id is retained after archiving, so presence alone is not
      // enough — posting there sends updates where nobody will read them.
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        serviceId: 'srv-1',
      } as never);
      vi.mocked(findSlackWarRoomAuthority).mockResolvedValue({
        ...activeSlackRoom,
        state: 'ARCHIVED',
      } as unknown as never);

      const result = await postWarRoomUpdate('inc-104', 'Status update');
      expect(result.success).toBe(false);
      expect(result.error).toBe('War-room channel is archived');
    });

    it('should return error if no channel is linked', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: null,
      } as never);
      vi.mocked(findSlackWarRoomAuthority).mockResolvedValue(null as unknown as never);

      const result = await postWarRoomUpdate('inc-104', 'Test note');
      expect(result.success).toBe(false);
      expect(result.error).toBe('No war-room channel for this incident');
    });

    it('should post message to Slack channel', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: 'C123',
        serviceId: 'srv-1',
      } as never);

      // chat.postMessage is non-idempotent — slackApiCall uses fetch directly (single attempt, no retryFetch)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
          text: async () => '',
        } as unknown as Response)
      );

      const result = await postWarRoomUpdate('inc-104', 'Updating database parameters');
      expect(result.success).toBe(true);
      vi.unstubAllGlobals();
    });
  });

  describe('archiveWarRoomChannel', () => {
    beforeEach(() => {
      vi.mocked(findSlackWarRoomAuthority).mockResolvedValue(activeSlackRoom as unknown as never);
    });

    it('should return error if no channel exists', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: null,
      } as never);
      vi.mocked(findSlackWarRoomAuthority).mockResolvedValue(null as unknown as never);

      const result = await archiveWarRoomChannel('inc-104');
      expect(result.success).toBe(false);
    });

    it('should archive channel when archiveOnResolve is enabled', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: 'C123',
        slackChannelName: 'inc-104-payments',
        serviceId: 'srv-1',
      } as never);

      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        archiveOnResolve: true,
      } as never);

      vi.spyOn(retryModule, 'retryFetch').mockResolvedValue({
        json: async () => ({ ok: true }),
      } as never);

      vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as never);

      const result = await archiveWarRoomChannel('inc-104');
      expect(result.success).toBe(true);
    });

    it('should refuse to auto-archive when archiveOnResolve is disabled', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: 'C123',
        slackChannelName: 'inc-104-payments',
        serviceId: 'srv-1',
      } as never);

      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        archiveOnResolve: false,
      } as never);

      const result = await archiveWarRoomChannel('inc-104');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Archive on resolve is disabled');
    });

    it('should archive the neutral authority so the channel stops reading as live', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: 'C123',
        slackChannelName: 'inc-104-payments',
        serviceId: 'srv-1',
      } as never);
      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        archiveOnResolve: true,
      } as never);
      vi.mocked(prisma.incident.update).mockResolvedValue({} as never);
      vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as never);
      vi.spyOn(retryModule, 'retryFetch').mockResolvedValue({
        json: async () => ({ ok: true }),
      } as never);

      await archiveWarRoomChannel('inc-104');

      expect(prisma.incidentWarRoom.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'slack-room-1' }),
          data: expect.objectContaining({ state: 'ARCHIVED', archivedAt: expect.any(Date) }),
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
      } as never);

      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        archiveOnResolve: false,
      } as never);

      vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as never);
      vi.spyOn(retryModule, 'retryFetch').mockResolvedValue({
        json: async () => ({ ok: true }),
      } as never);

      const result = await archiveWarRoomChannel('inc-104', { force: true });
      expect(result.success).toBe(true);
    });

    it('should treat already_archived as idempotent success and archive neutral authority', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: 'C123',
        slackChannelName: 'inc-104-payments',
        serviceId: 'srv-1',
      } as never);
      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        archiveOnResolve: true,
      } as never);
      vi.mocked(prisma.incident.update).mockResolvedValue({} as never);
      vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as never);
      vi.spyOn(retryModule, 'retryFetch').mockResolvedValue({
        json: async () => ({ ok: false, error: 'already_archived' }),
      } as never);

      const result = await archiveWarRoomChannel('inc-104');
      expect(result.success).toBe(true);
      expect(prisma.incidentWarRoom.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'slack-room-1' }),
          data: expect.objectContaining({ state: 'ARCHIVED', archivedAt: expect.any(Date) }),
        })
      );
    });

    it('should treat channel_not_found as idempotent success and archive neutral authority', async () => {
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        slackChannelId: 'C123',
        slackChannelName: 'inc-104-payments',
        serviceId: 'srv-1',
      } as never);
      vi.mocked(prisma.chatOpsConfig.findUnique).mockResolvedValue({
        archiveOnResolve: true,
      } as never);
      vi.mocked(prisma.incident.update).mockResolvedValue({} as never);
      vi.mocked(prisma.incidentEvent.create).mockResolvedValue({} as never);
      vi.spyOn(retryModule, 'retryFetch').mockResolvedValue({
        json: async () => ({ ok: false, error: 'channel_not_found' }),
      } as never);

      const result = await archiveWarRoomChannel('inc-104');
      expect(result.success).toBe(true);
      expect(prisma.incidentWarRoom.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'slack-room-1' }),
          data: expect.objectContaining({ state: 'ARCHIVED', archivedAt: expect.any(Date) }),
        })
      );
    });
  });

  describe('archived war-room guards', () => {
    it('should not invite a user into an archived channel', async () => {
      // Reassigning an incident after its channel was archived must not drag
      // people into a dead channel.
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        serviceId: 'srv-1',
      } as never);
      vi.mocked(findSlackWarRoomAuthority).mockResolvedValue({
        ...activeSlackRoom,
        state: 'ARCHIVED',
      } as unknown as never);

      const result = await inviteUserToWarRoom('inc-104', 'usr-1');
      expect(result.success).toBe(false);
      expect(result.error).toBe('War-room channel is archived');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should treat a second archive as a no-op', async () => {
      // Resolve can reach archiving from the server action, bulk resolve and the
      // Slack button; without this the farewell message posts more than once.
      vi.mocked(prisma.incident.findUnique).mockResolvedValue({
        serviceId: 'srv-1',
      } as never);
      vi.mocked(findSlackWarRoomAuthority).mockResolvedValue({
        ...activeSlackRoom,
        state: 'ARCHIVED',
      } as unknown as never);
      vi.mocked(retryModule.retryFetch).mockReset();

      const result = await archiveWarRoomChannel('inc-104');

      expect(result.success).toBe(true);
      expect(retryModule.retryFetch).not.toHaveBeenCalled();
      expect(prisma.incidentEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('slackApiCall', () => {
    it('should return an error result rather than throwing when Slack rate limits', async () => {
      // chat.postMessage is non-idempotent — provider client uses direct fetch (single attempt),
      // not retryFetch. HTTP 429 must surface as { ok:false } without throwing so callers
      // can branch on result.ok (and classify AMBIGUOUS vs retryable).
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 429,
          text: async () => 'HTTP 429: Too Many Requests',
          json: async () => ({ ok: false, error: 'ratelimited' }),
        } as unknown as Response)
      );

      const result = await slackApiCall('chat.postMessage', 'xoxb-test-token', {
        channel: 'C123',
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('429');
      vi.unstubAllGlobals();
    });
  });
});
