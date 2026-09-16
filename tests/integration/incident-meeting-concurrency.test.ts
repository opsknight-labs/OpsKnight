import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  requestMeetingProvision,
  closeIncidentMeeting,
} from '@/lib/incident-collaboration/meeting-store';
import {
  createTestService,
  createTestIncident,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('Incident Meeting Database Concurrency & Control-Plane Fencing', () => {
  beforeEach(resetDatabase);

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('50 simultaneous requestMeetingProvision calls create exactly 1 generation and 1 BackgroundJob', async () => {
    const service = await createTestService('Meeting Concurrency Service');
    const incident = await createTestIncident('Concurrent Meeting Incident', service.id);

    // Ensure Teams config exists with an organizer
    await testPrisma.microsoftTeamsConfig.upsert({
      where: { id: 'default' },
      update: {
        enabled: true,
        tenantId: 'mock-tenant-id',
        defaultMeetingOrganizerUpn: 'incident-organizer@example.com',
      },
      create: {
        id: 'default',
        enabled: true,
        tenantId: 'mock-tenant-id',
        clientId: 'mock-client-id',
        clientSecret: 'mock-client-secret',
        defaultMeetingOrganizerUpn: 'incident-organizer@example.com',
      },
    });

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        requestMeetingProvision({
          incidentId: incident.id,
          incidentTitle: `Concurrent Provision ${i}`,
          provider: 'MICROSOFT_TEAMS',
        })
      )
    );

    expect(results).toHaveLength(50);
    const first = results[0];
    expect(first.state).toBe('PROVISIONING');
    expect(first.generation).toBe(1);

    // Exactly 1 IncidentMeeting row exists in PostgreSQL
    const meetings = await testPrisma.incidentMeeting.findMany({
      where: { incidentId: incident.id },
    });
    expect(meetings).toHaveLength(1);
    expect(meetings[0].generation).toBe(1);
    expect(meetings[0].state).toBe('PROVISIONING');

    // Exactly 1 MEETING_PROVISION BackgroundJob exists
    const allJobs = await testPrisma.backgroundJob.findMany({
      where: { type: 'MEETING_PROVISION' },
    });
    const incidentJobs = allJobs.filter(
      j => (j.payload as { incidentId?: string })?.incidentId === incident.id
    );
    expect(incidentJobs).toHaveLength(1);

    const jobPayload = incidentJobs[0].payload as { provisioningToken: string; generation: number };
    expect(jobPayload.provisioningToken).toBe(meetings[0].provisioningToken);
    expect(jobPayload.generation).toBe(1);

    // All 50 promises received the same meeting ID and external ID
    for (const r of results) {
      expect(r.id).toBe(first.id);
      expect(r.externalId).toBe(first.externalId);
    }
  });

  it('50 simultaneous closeIncidentMeeting calls transition to CLOSING and create exactly 1 MEETING_CLOSE BackgroundJob', async () => {
    const service = await createTestService('Meeting Close Concurrency Service');
    const incident = await createTestIncident('Close Concurrency Incident', service.id);

    // Seed a READY meeting with providerMeetingId
    await testPrisma.incidentMeeting.create({
      data: {
        id: `meet_${incident.id}_1`,
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'READY',
        health: 'HEALTHY',
        externalId: `opsknight:${incident.id}:1`,
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/test',
        providerMeetingId: 'teams-meeting-guid-999',
        organizerEmail: 'organizer@example.com',
      },
    });

    const closePromises = Array.from({ length: 50 }, () => closeIncidentMeeting(incident.id));
    await Promise.all(closePromises);

    // State in DB transitioned to CLOSING
    const meeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(meeting?.state).toBe('CLOSING');

    // Exactly 1 MEETING_CLOSE BackgroundJob was created
    const allJobs = await testPrisma.backgroundJob.findMany({
      where: { type: 'MEETING_CLOSE' },
    });
    const closeJobs = allJobs.filter(
      j => (j.payload as { incidentId?: string })?.incidentId === incident.id
    );
    expect(closeJobs).toHaveLength(1);
  });
});
