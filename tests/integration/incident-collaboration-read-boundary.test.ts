import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { getIncidentCollaborationView } from '@/lib/incident-collaboration/get-incident-collaboration';
import { getIncidentMeeting } from '@/lib/incident-collaboration/meeting-store';
import {
  createTestService,
  createTestIncident,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;

describeIfRealDB('Incident Collaboration Read Boundary & Purity (Postgres)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await resetDatabase();
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('Invariant I6: getIncidentMeeting makes ZERO external network calls and zero DB mutations', async () => {
    const service = await createTestService('Runtime Boundary Service');
    const incident = await createTestIncident('Runtime Boundary Incident', service.id);

    await testPrisma.incidentMeeting.create({
      data: {
        id: `meet_${incident.id}_1`,
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'READY',
        health: 'HEALTHY',
        externalId: `opsknight:${incident.id}:1`,
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/purity-test',
        providerMeetingId: 'teams-meeting-1',
      },
    });

    fetchSpy.mockClear();

    const meetingView = await getIncidentMeeting(incident.id);

    // Strict assertion: zero network fetch calls
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(meetingView?.state).toBe('READY');
    expect(meetingView?.joinUrl).toBe('https://teams.microsoft.com/l/meetup-join/purity-test');

    // Zero background jobs enqueued
    const jobs = await testPrisma.backgroundJob.findMany({
      where: { payload: { path: ['incidentId'], equals: incident.id } },
    });
    expect(jobs).toHaveLength(0);
  });

  it('Invariant I6: getIncidentCollaborationView makes ZERO external network calls', async () => {
    const service = await createTestService('Collaboration View Purity Service');
    const incident = await createTestIncident('Collaboration View Purity Incident', service.id);

    await testPrisma.incidentMeeting.create({
      data: {
        id: `meet_${incident.id}_1`,
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'READY',
        health: 'HEALTHY',
        externalId: `opsknight:${incident.id}:1`,
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/collab-purity',
      },
    });

    fetchSpy.mockClear();

    const collabView = await getIncidentCollaborationView({
      incidentId: incident.id,
    });

    // Pure database read: zero external provider calls
    const externalCalls = (fetchSpy.mock.calls as Array<[unknown, ...unknown[]]>).filter(
      call => !String(call[0]).includes('/api/logs/ingest')
    );
    expect(externalCalls).toHaveLength(0);
    expect(collabView.visible).toBe(true);
    expect(collabView.meeting?.joinUrl).toBe(
      'https://teams.microsoft.com/l/meetup-join/collab-purity'
    );
  });
});
