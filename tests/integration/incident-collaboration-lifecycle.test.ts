/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  requestMeetingProvision,
  executeMeetingProvision,
  closeIncidentMeeting,
  executeMeetingCloseJob,
  getIncidentMeeting,
} from '@/lib/incident-collaboration/meeting-store';
import { buildWarRoomProjection } from '@/lib/war-room/projection-model';
import { renderSlackWarRoomProjection } from '@/lib/war-room/providers/slack/render';
import { renderMicrosoftTeamsWarRoomProjection } from '@/lib/war-room/providers/microsoft-teams/render';
import { collaborationProviderHarness } from '../helpers/collaboration-provider-harness';
import {
  createTestService,
  createTestIncident,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB(
  'Phase 6 Incident Collaboration 11-Combination Lifecycle Matrix (Postgres)',
  () => {
    beforeEach(async () => {
      await resetDatabase();
      collaborationProviderHarness.install();
      collaborationProviderHarness.reset();

      await testPrisma.microsoftTeamsConfig.upsert({
        where: { id: 'default' },
        update: {
          enabled: true,
          tenantId: 'mock-tenant-id',
          defaultMeetingOrganizerUpn: 'organizer@example.com',
        },
        create: {
          id: 'default',
          enabled: true,
          tenantId: 'mock-tenant-id',
          clientId: 'mock-client-id',
          clientSecret: 'mock-client-secret',
          defaultMeetingOrganizerUpn: 'organizer@example.com',
        },
      });
    });

    afterEach(() => {
      collaborationProviderHarness.reset();
    });

    afterAll(async () => {
      collaborationProviderHarness.restore();
      await testPrisma.$disconnect();
    });

    // ── Combination A: Slack room only ─────────────────────────────────────────
    it('Combination A: Slack room only (no meeting bridge)', async () => {
      const service = await createTestService('Combo A Service');
      const incident = await createTestIncident('Combo A Incident', service.id);

      const slackRoom = await testPrisma.incidentWarRoom.create({
        data: {
          incidentId: incident.id,
          provider: 'SLACK',
          generation: 1,
          state: 'READY',
          health: 'HEALTHY',
          providerChannelId: 'C12345_A',
          providerChannelUrl: 'https://slack.com/archives/C12345_A',
        },
      });

      const projection = buildWarRoomProjection({
        id: incident.id,
        title: incident.title,
        status: incident.status,
        urgency: incident.urgency,
        serviceName: service.name,
        url: `https://example.test/incidents/${incident.id}`,
        createdAt: incident.createdAt,
      });

      const card = renderSlackWarRoomProjection(projection);
      expect(card.blocks.some(b => (b as any).text?.text?.includes('Meeting Bridge'))).toBe(false);

      // Resolve incident and close room
      await testPrisma.incidentWarRoom.update({
        where: { id: slackRoom.id },
        data: { state: 'CLOSED', closedAt: new Date() },
      });

      const closedRoom = await testPrisma.incidentWarRoom.findUnique({
        where: { id: slackRoom.id },
      });
      expect(closedRoom?.state).toBe('CLOSED');
    });

    // ── Combination B: Teams room only ─────────────────────────────────────────
    it('Combination B: Teams room only (no meeting bridge)', async () => {
      const service = await createTestService('Combo B Service');
      const incident = await createTestIncident('Combo B Incident', service.id);

      const teamsRoom = await testPrisma.incidentWarRoom.create({
        data: {
          incidentId: incident.id,
          provider: 'MICROSOFT_TEAMS',
          generation: 1,
          state: 'READY',
          health: 'HEALTHY',
          providerChannelId: '19:teams_b@thread.tacv2',
          providerChannelUrl: 'https://teams.microsoft.com/l/channel/19:teams_b',
        },
      });

      const projection = buildWarRoomProjection({
        id: incident.id,
        title: incident.title,
        status: incident.status,
        urgency: incident.urgency,
        serviceName: service.name,
        url: `https://example.test/incidents/${incident.id}`,
        createdAt: incident.createdAt,
      });

      const card = renderMicrosoftTeamsWarRoomProjection(projection);
      expect(card.actions.some((a: any) => a.title?.includes('Join'))).toBe(false);

      await testPrisma.incidentWarRoom.update({
        where: { id: teamsRoom.id },
        data: { state: 'CLOSED', closedAt: new Date() },
      });
      const closedRoom = await testPrisma.incidentWarRoom.findUnique({
        where: { id: teamsRoom.id },
      });
      expect(closedRoom?.state).toBe('CLOSED');
    });

    // ── Combination C: Slack room + Teams room ─────────────────────────────────
    it('Combination C: Slack room + Teams room (multi-provider rooms, no meeting)', async () => {
      const service = await createTestService('Combo C Service');
      const incident = await createTestIncident('Combo C Incident', service.id);

      await testPrisma.incidentWarRoom.create({
        data: {
          incidentId: incident.id,
          provider: 'SLACK',
          generation: 1,
          state: 'READY',
          health: 'HEALTHY',
          providerChannelId: 'C12345_C',
          providerChannelUrl: 'https://slack.com/archives/C12345_C',
        },
      });

      await testPrisma.incidentWarRoom.create({
        data: {
          incidentId: incident.id,
          provider: 'MICROSOFT_TEAMS',
          generation: 1,
          state: 'READY',
          health: 'HEALTHY',
          providerChannelId: '19:teams_c@thread.tacv2',
          providerChannelUrl: 'https://teams.microsoft.com/l/channel/19:teams_c',
        },
      });

      const rooms = await testPrisma.incidentWarRoom.findMany({
        where: { incidentId: incident.id },
      });
      expect(rooms).toHaveLength(2);
      expect(rooms.every(r => r.state === 'READY')).toBe(true);

      // Resolve & close both
      await testPrisma.incidentWarRoom.updateMany({
        where: { incidentId: incident.id },
        data: { state: 'CLOSED', closedAt: new Date() },
      });
      const closedRooms = await testPrisma.incidentWarRoom.findMany({
        where: { incidentId: incident.id },
      });
      expect(closedRooms.every(r => r.state === 'CLOSED')).toBe(true);
    });

    // ── Combination D: Slack room + Zoom meeting ───────────────────────────────
    it('Combination D: Slack room + Zoom meeting', async () => {
      const service = await createTestService('Combo D Service');
      const incident = await createTestIncident('Combo D Incident', service.id);

      await testPrisma.incidentWarRoom.create({
        data: {
          incidentId: incident.id,
          provider: 'SLACK',
          generation: 1,
          state: 'READY',
          health: 'HEALTHY',
          providerChannelId: 'C12345_D',
        },
      });

      await requestMeetingProvision({
        incidentId: incident.id,
        provider: 'ZOOM',
        incidentTitle: incident.title,
      });

      const dbMeeting = await testPrisma.incidentMeeting.findUnique({
        where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
      });

      const meetingView = await executeMeetingProvision({
        incidentId: incident.id,
        provisioningToken: dbMeeting!.provisioningToken!,
        provider: 'ZOOM',
        generation: 1,
        incidentTitle: incident.title,
        customTemplate: 'https://company.zoom.us/j/123456789',
      });

      expect(meetingView.state).toBe('READY');
      expect(meetingView.joinUrl).toBe('https://company.zoom.us/j/123456789');

      // Slack projection renders Zoom Meeting Bridge
      const projection = buildWarRoomProjection(
        {
          id: incident.id,
          title: incident.title,
          status: incident.status,
          urgency: incident.urgency,
          serviceName: service.name,
          url: `https://example.test/incidents/${incident.id}`,
          createdAt: incident.createdAt,
        },
        { meeting: { provider: 'ZOOM', joinUrl: meetingView.joinUrl } }
      );

      const slackCard = renderSlackWarRoomProjection(projection);
      expect(slackCard.blocks.some(b => (b as any).text?.text?.includes('Join Zoom Meeting'))).toBe(
        true
      );

      // Teardown
      await closeIncidentMeeting(incident.id);
      const closedMeeting = await getIncidentMeeting(incident.id);
      expect(closedMeeting?.state).toBe('CLOSED');
    });

    // ── Combination E: Slack room + Google Meet ───────────────────────────────
    it('Combination E: Slack room + Google Meet', async () => {
      const service = await createTestService('Combo E Service');
      const incident = await createTestIncident('Combo E Incident', service.id);

      await requestMeetingProvision({
        incidentId: incident.id,
        provider: 'GOOGLE_MEET',
        incidentTitle: incident.title,
      });

      const dbMeeting = await testPrisma.incidentMeeting.findUnique({
        where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
      });

      const meetingView = await executeMeetingProvision({
        incidentId: incident.id,
        provisioningToken: dbMeeting!.provisioningToken!,
        provider: 'GOOGLE_MEET',
        generation: 1,
        incidentTitle: incident.title,
        customTemplate: 'https://meet.google.com/abc-defg-hij',
      });

      expect(meetingView.state).toBe('READY');
      expect(meetingView.joinUrl).toBe('https://meet.google.com/abc-defg-hij');

      const projection = buildWarRoomProjection(
        {
          id: incident.id,
          title: incident.title,
          status: incident.status,
          urgency: incident.urgency,
          serviceName: service.name,
          url: `https://example.test/incidents/${incident.id}`,
          createdAt: incident.createdAt,
        },
        { meeting: { provider: 'GOOGLE_MEET', joinUrl: meetingView.joinUrl } }
      );

      const slackCard = renderSlackWarRoomProjection(projection);
      expect(
        slackCard.blocks.some(b => (b as any).text?.text?.includes('Join Google Meet Meeting'))
      ).toBe(true);

      await closeIncidentMeeting(incident.id);
      const closed = await getIncidentMeeting(incident.id);
      expect(closed?.state).toBe('CLOSED');
    });

    // ── Combination F: Teams room + Teams meeting ─────────────────────────────
    it('Combination F: Teams room + Teams meeting', async () => {
      const service = await createTestService('Combo F Service');
      const incident = await createTestIncident('Combo F Incident', service.id);

      await testPrisma.incidentWarRoom.create({
        data: {
          incidentId: incident.id,
          provider: 'MICROSOFT_TEAMS',
          generation: 1,
          state: 'READY',
          health: 'HEALTHY',
          providerChannelId: '19:teams_f@thread.tacv2',
        },
      });

      await requestMeetingProvision({
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        incidentTitle: incident.title,
      });

      const dbMeeting = await testPrisma.incidentMeeting.findUnique({
        where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
      });

      const meetingView = await executeMeetingProvision({
        incidentId: incident.id,
        provisioningToken: dbMeeting!.provisioningToken!,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        incidentTitle: incident.title,
      });

      expect(meetingView.state).toBe('READY');
      expect(meetingView.joinUrl).toContain('teams.microsoft.com');

      const projection = buildWarRoomProjection(
        {
          id: incident.id,
          title: incident.title,
          status: incident.status,
          urgency: incident.urgency,
          serviceName: service.name,
          url: `https://example.test/incidents/${incident.id}`,
          createdAt: incident.createdAt,
        },
        { meeting: { provider: 'MICROSOFT_TEAMS', joinUrl: meetingView.joinUrl } }
      );

      const teamsCard = renderMicrosoftTeamsWarRoomProjection(projection);
      expect(teamsCard.actions.some((a: any) => a.title?.includes('Join Teams Meeting'))).toBe(
        true
      );

      // Full lifecycle close
      await closeIncidentMeeting(incident.id);
      await executeMeetingCloseJob({
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        providerMeetingId: meetingView.providerMeetingId,
      });

      const finalMeeting = await getIncidentMeeting(incident.id);
      expect(finalMeeting?.state).toBe('CLOSED');
      expect(finalMeeting?.externalCleanupPending).toBe(false);
    });

    // ── Combination G: Teams room + Zoom meeting ───────────────────────────────
    it('Combination G: Teams room + Zoom meeting', async () => {
      const service = await createTestService('Combo G Service');
      const incident = await createTestIncident('Combo G Incident', service.id);

      await requestMeetingProvision({
        incidentId: incident.id,
        provider: 'ZOOM',
        incidentTitle: incident.title,
      });

      const dbMeeting = await testPrisma.incidentMeeting.findUnique({
        where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
      });

      const meetingView = await executeMeetingProvision({
        incidentId: incident.id,
        provisioningToken: dbMeeting!.provisioningToken!,
        provider: 'ZOOM',
        generation: 1,
        incidentTitle: incident.title,
        customTemplate: 'https://myorg.zoom.us/j/987654321',
      });

      expect(meetingView.state).toBe('READY');

      const projection = buildWarRoomProjection(
        {
          id: incident.id,
          title: incident.title,
          status: incident.status,
          urgency: incident.urgency,
          serviceName: service.name,
          url: `https://example.test/incidents/${incident.id}`,
          createdAt: incident.createdAt,
        },
        { meeting: { provider: 'ZOOM', joinUrl: meetingView.joinUrl } }
      );

      const teamsCard = renderMicrosoftTeamsWarRoomProjection(projection);
      expect(teamsCard.actions.some((a: any) => a.title?.includes('Join Zoom Meeting'))).toBe(true);
    });

    // ── Combination H: Teams room + Google Meet ───────────────────────────────
    it('Combination H: Teams room + Google Meet', async () => {
      const service = await createTestService('Combo H Service');
      const incident = await createTestIncident('Combo H Incident', service.id);

      await requestMeetingProvision({
        incidentId: incident.id,
        provider: 'GOOGLE_MEET',
        incidentTitle: incident.title,
      });

      const dbMeeting = await testPrisma.incidentMeeting.findUnique({
        where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
      });

      const meetingView = await executeMeetingProvision({
        incidentId: incident.id,
        provisioningToken: dbMeeting!.provisioningToken!,
        provider: 'GOOGLE_MEET',
        generation: 1,
        incidentTitle: incident.title,
        customTemplate: 'https://meet.google.com/xyz-uvwx-rst',
      });

      expect(meetingView.state).toBe('READY');

      const projection = buildWarRoomProjection(
        {
          id: incident.id,
          title: incident.title,
          status: incident.status,
          urgency: incident.urgency,
          serviceName: service.name,
          url: `https://example.test/incidents/${incident.id}`,
          createdAt: incident.createdAt,
        },
        { meeting: { provider: 'GOOGLE_MEET', joinUrl: meetingView.joinUrl } }
      );

      const teamsCard = renderMicrosoftTeamsWarRoomProjection(projection);
      expect(
        teamsCard.actions.some((a: any) => a.title?.includes('Join Google Meet Meeting'))
      ).toBe(true);
    });

    // ── Combination I: Slack room + Teams room + Teams meeting ────────────────
    it('Combination I: Slack room + Teams room + Teams meeting', async () => {
      const service = await createTestService('Combo I Service');
      const incident = await createTestIncident('Combo I Incident', service.id);

      await testPrisma.incidentWarRoom.createMany({
        data: [
          {
            incidentId: incident.id,
            provider: 'SLACK',
            generation: 1,
            state: 'READY',
            health: 'HEALTHY',
            providerChannelId: 'C123_I',
          },
          {
            incidentId: incident.id,
            provider: 'MICROSOFT_TEAMS',
            generation: 1,
            state: 'READY',
            health: 'HEALTHY',
            providerChannelId: '19:teams_i@thread.tacv2',
          },
        ],
      });

      await requestMeetingProvision({
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        incidentTitle: incident.title,
      });

      const dbMeeting = await testPrisma.incidentMeeting.findUnique({
        where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
      });

      const meetingView = await executeMeetingProvision({
        incidentId: incident.id,
        provisioningToken: dbMeeting!.provisioningToken!,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        incidentTitle: incident.title,
      });

      // Both Slack and Teams cards project the exact same Teams meeting join URL
      const projection = buildWarRoomProjection(
        {
          id: incident.id,
          title: incident.title,
          status: incident.status,
          urgency: incident.urgency,
          serviceName: service.name,
          url: `https://example.test/incidents/${incident.id}`,
          createdAt: incident.createdAt,
        },
        { meeting: { provider: 'MICROSOFT_TEAMS', joinUrl: meetingView.joinUrl } }
      );

      const slackCard = renderSlackWarRoomProjection(projection);
      const teamsCard = renderMicrosoftTeamsWarRoomProjection(projection);

      const slackBtn = (slackCard.blocks.find(b => (b as any).accessory?.url) as any)?.accessory
        ?.url;
      const teamsBtn = teamsCard.actions.find((a: any) => a.url)?.url;

      expect(slackBtn).toBe(meetingView.joinUrl);
      expect(teamsBtn).toBe(meetingView.joinUrl);
    });

    // ── Combination J: Slack room + Teams room + Zoom meeting ─────────────────
    it('Combination J: Slack room + Teams room + Zoom meeting', async () => {
      const service = await createTestService('Combo J Service');
      const incident = await createTestIncident('Combo J Incident', service.id);

      await requestMeetingProvision({
        incidentId: incident.id,
        provider: 'ZOOM',
        incidentTitle: incident.title,
      });

      const dbMeeting = await testPrisma.incidentMeeting.findUnique({
        where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
      });

      const meetingView = await executeMeetingProvision({
        incidentId: incident.id,
        provisioningToken: dbMeeting!.provisioningToken!,
        provider: 'ZOOM',
        generation: 1,
        incidentTitle: incident.title,
        customTemplate: 'https://zoom.us/j/combo-j-123',
      });

      const projection = buildWarRoomProjection(
        {
          id: incident.id,
          title: incident.title,
          status: incident.status,
          urgency: incident.urgency,
          serviceName: service.name,
          url: `https://example.test/incidents/${incident.id}`,
          createdAt: incident.createdAt,
        },
        { meeting: { provider: 'ZOOM', joinUrl: meetingView.joinUrl } }
      );

      const slackCard = renderSlackWarRoomProjection(projection);
      const teamsCard = renderMicrosoftTeamsWarRoomProjection(projection);

      expect(slackCard.blocks.some(b => (b as any).text?.text?.includes('Join Zoom Meeting'))).toBe(
        true
      );
      expect(teamsCard.actions.some((a: any) => a.title?.includes('Join Zoom Meeting'))).toBe(true);
    });

    // ── Combination K: Meeting only (no room), Teams meeting ───────────────────
    it('Combination K: Meeting only (no room), Teams meeting', async () => {
      const service = await createTestService('Combo K Service');
      const incident = await createTestIncident('Combo K Incident', service.id);

      // No war rooms created
      const warRooms = await testPrisma.incidentWarRoom.findMany({
        where: { incidentId: incident.id },
      });
      expect(warRooms).toHaveLength(0);

      // Provision meeting directly
      await requestMeetingProvision({
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        incidentTitle: incident.title,
      });

      const dbMeeting = await testPrisma.incidentMeeting.findUnique({
        where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
      });

      const meetingView = await executeMeetingProvision({
        incidentId: incident.id,
        provisioningToken: dbMeeting!.provisioningToken!,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        incidentTitle: incident.title,
      });

      expect(meetingView.state).toBe('READY');
      expect(meetingView.actions.canJoin).toBe(true);
      expect(meetingView.actions.closeLabel).toBe('End Meeting');

      // Incident closed -> meeting closed
      await closeIncidentMeeting(incident.id);
      await executeMeetingCloseJob({
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        providerMeetingId: meetingView.providerMeetingId,
      });

      const closedMeeting = await getIncidentMeeting(incident.id);
      expect(closedMeeting?.state).toBe('CLOSED');
      expect(closedMeeting?.actions.canJoin).toBe(false);
    });
  }
);
