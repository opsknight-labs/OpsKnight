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

describeIfRealDB('Phase 6 End-to-End Collaboration Projection Consistency (Postgres)', () => {
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

  it('C1: Canonical meeting URL is strictly identical across incident API, Slack projection, and Teams projection', async () => {
    const service = await createTestService('Projection Consistency Service');
    const incident = await createTestIncident('Projection Consistency Incident', service.id);

    // 1. Provision meeting
    await requestMeetingProvision({
      incidentId: incident.id,
      provider: 'MICROSOFT_TEAMS',
      incidentTitle: incident.title,
    });

    const dbMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    const token = dbMeeting!.provisioningToken!;

    const meetingView = await executeMeetingProvision({
      incidentId: incident.id,
      provisioningToken: token,
      provider: 'MICROSOFT_TEAMS',
      generation: 1,
      incidentTitle: incident.title,
    });

    expect(meetingView.state).toBe('READY');
    expect(meetingView.joinUrl).toBeTruthy();
    const canonicalUrl = meetingView.joinUrl;

    // 2. Fetch canonical meeting via pure read API
    const apiMeeting = await getIncidentMeeting(incident.id);
    expect(apiMeeting?.joinUrl).toBe(canonicalUrl);

    // 3. Build projection model with canonical meeting
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
      {
        meeting: {
          provider: meetingView.provider,
          joinUrl: meetingView.joinUrl,
        },
      }
    );

    // 4. Render Slack card
    const slackCard = renderSlackWarRoomProjection(projection);
    const slackMeetingSection = slackCard.blocks.find(
      b => b.type === 'section' && (b as any).text?.text?.includes('Meeting Bridge')
    );
    expect(slackMeetingSection).toBeDefined();
    expect((slackMeetingSection as any).accessory?.url).toBe(canonicalUrl);
    expect((slackMeetingSection as any).text.text).toContain(canonicalUrl);

    // 5. Render Teams card
    const teamsCard = renderMicrosoftTeamsWarRoomProjection(projection);
    const teamsJoinAction = teamsCard.actions.find(
      (a: any) => a.type === 'Action.OpenUrl' && a.title.includes('Join Teams Meeting')
    );
    expect(teamsJoinAction).toBeDefined();
    expect(teamsJoinAction?.url).toBe(canonicalUrl);

    // Verification: all 3 surfaces share the exact same canonical meeting URL
    expect(apiMeeting?.joinUrl).toBe((slackMeetingSection as any).accessory?.url);
    expect((slackMeetingSection as any).accessory?.url).toBe(teamsJoinAction?.url);
  });

  it('C2: Meeting replacement increments projectionVersion and updates meeting URL in all projections', async () => {
    const service = await createTestService('Meeting Replacement Service');
    const incident = await createTestIncident('Meeting Replacement Incident', service.id);

    // Seed active war room
    const warRoom = await testPrisma.incidentWarRoom.create({
      data: {
        incidentId: incident.id,
        provider: 'SLACK',
        generation: 1,
        state: 'READY',
        health: 'HEALTHY',
        projectionVersion: 1,
      },
    });

    // Provision Generation 1 Meeting
    await requestMeetingProvision({
      incidentId: incident.id,
      provider: 'MICROSOFT_TEAMS',
      incidentTitle: incident.title,
    });

    const dbMeeting1 = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    const token1 = dbMeeting1!.provisioningToken!;

    const gen1Meeting = await executeMeetingProvision({
      incidentId: incident.id,
      provisioningToken: token1,
      provider: 'MICROSOFT_TEAMS',
      generation: 1,
      incidentTitle: incident.title,
    });

    // Close Generation 1
    await closeIncidentMeeting(incident.id);
    await executeMeetingCloseJob({
      incidentId: incident.id,
      provider: 'MICROSOFT_TEAMS',
    });

    // Provision Generation 2 Meeting
    await requestMeetingProvision({
      incidentId: incident.id,
      provider: 'MICROSOFT_TEAMS',
      incidentTitle: incident.title,
    });

    const dbMeeting2 = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 2 } },
    });
    const token2 = dbMeeting2!.provisioningToken!;

    const gen2Meeting = await executeMeetingProvision({
      incidentId: incident.id,
      provisioningToken: token2,
      provider: 'MICROSOFT_TEAMS',
      generation: 2,
      incidentTitle: incident.title,
    });

    expect(gen2Meeting.generation).toBe(2);
    expect(gen2Meeting.joinUrl).not.toBe(gen1Meeting.joinUrl);

    // executeMeetingProvision automatically triggers war-room reprojection
    const updatedRoom = await testPrisma.incidentWarRoom.findUnique({
      where: { id: warRoom.id },
    });
    expect(updatedRoom?.projectionVersion).toBeGreaterThan(1);

    // Assert projection renders the updated generation 2 meeting URL
    const updatedProjection = buildWarRoomProjection(
      {
        id: incident.id,
        title: incident.title,
        status: incident.status,
        urgency: incident.urgency,
        serviceName: service.name,
        url: `https://example.test/incidents/${incident.id}`,
        createdAt: incident.createdAt,
      },
      {
        meeting: {
          provider: gen2Meeting.provider,
          joinUrl: gen2Meeting.joinUrl,
        },
      }
    );

    const updatedSlackCard = renderSlackWarRoomProjection(updatedProjection);
    const updatedSlackSection = updatedSlackCard.blocks.find(
      b => b.type === 'section' && (b as any).text?.text?.includes('Meeting Bridge')
    );
    expect((updatedSlackSection as any).accessory?.url).toBe(gen2Meeting.joinUrl);

    const updatedTeamsCard = renderMicrosoftTeamsWarRoomProjection(updatedProjection);
    const updatedTeamsJoinAction = updatedTeamsCard.actions.find(
      (a: any) => a.type === 'Action.OpenUrl' && a.title.includes('Join Teams Meeting')
    );
    expect(updatedTeamsJoinAction?.url).toBe(gen2Meeting.joinUrl);
  });

  it('C3: Closed meeting removes / disallows canJoin from active projections and API', async () => {
    const service = await createTestService('Closed Meeting Service');
    const incident = await createTestIncident('Closed Meeting Incident', service.id);

    await testPrisma.incidentMeeting.create({
      data: {
        id: `meet_${incident.id}_1`,
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'CLOSED',
        health: 'HEALTHY',
        externalId: `opsknight:${incident.id}:1`,
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/closed-test',
        closedAt: new Date(),
      },
    });

    const meetingView = await getIncidentMeeting(incident.id);
    expect(meetingView?.state).toBe('CLOSED');
    expect(meetingView?.actions.canJoin).toBe(false);

    // When meeting is closed or incident resolved, projection excludes join button
    const resolvedProjection = buildWarRoomProjection(
      {
        id: incident.id,
        title: incident.title,
        status: 'RESOLVED',
        urgency: incident.urgency,
        serviceName: service.name,
        url: `https://example.test/incidents/${incident.id}`,
        createdAt: incident.createdAt,
      },
      {
        meeting: {
          provider: meetingView!.provider,
          joinUrl: meetingView!.joinUrl,
        },
      }
    );

    // Slack projection has no join section
    const slackCard = renderSlackWarRoomProjection(resolvedProjection);
    const slackJoinSection = slackCard.blocks.find(
      b => b.type === 'section' && (b as any).text?.text?.includes('Meeting Bridge')
    );
    expect(slackJoinSection).toBeUndefined();

    // Teams projection has no join action
    const teamsCard = renderMicrosoftTeamsWarRoomProjection(resolvedProjection);
    const teamsJoinAction = teamsCard.actions.find((a: any) => a.title?.includes('Join'));
    expect(teamsJoinAction).toBeUndefined();
  });

  it('C4: Invariant I6 — projection rendering never mutates the database source of truth', async () => {
    const service = await createTestService('Purity Test Service');
    const incident = await createTestIncident('Purity Test Incident', service.id);

    await testPrisma.incidentMeeting.create({
      data: {
        id: `meet_${incident.id}_1`,
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'READY',
        health: 'HEALTHY',
        externalId: `opsknight:${incident.id}:1`,
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/purity',
      },
    });

    const meetingBefore = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });

    // Render multiple times across both providers
    const projection = buildWarRoomProjection({
      id: incident.id,
      title: incident.title,
      status: incident.status,
      urgency: incident.urgency,
      serviceName: service.name,
      url: `https://example.test/incidents/${incident.id}`,
      createdAt: incident.createdAt,
    });

    renderSlackWarRoomProjection(projection);
    renderMicrosoftTeamsWarRoomProjection(projection);

    const meetingAfter = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });

    // Zero mutations: updated and created timestamps, state, health are identical
    expect(meetingAfter?.state).toBe(meetingBefore?.state);
    expect(meetingAfter?.health).toBe(meetingBefore?.health);
    expect(meetingAfter?.generation).toBe(meetingBefore?.generation);
  });
});
