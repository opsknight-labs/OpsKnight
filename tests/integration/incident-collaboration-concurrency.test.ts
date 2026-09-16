import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  requestMeetingProvision,
  closeIncidentMeeting,
  executeMeetingProvision,
  executeMeetingCloseJob,
  getIncidentMeeting,
} from '@/lib/incident-collaboration/meeting-store';
import { MeetingProviderRegistry } from '@/lib/incident-collaboration/meeting-registry';
import { claimWarRoomProvisioning } from '@/lib/war-room/repository';
import { runSerializableTransaction } from '@/lib/db-utils';
import {
  createTestService,
  createTestIncident,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';
import { InvariantPredicates } from '@/lib/incident-collaboration/invariants';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('Phase 6 Concurrency, Fencing, and Lifecycle Races (Postgres)', () => {
  beforeEach(async () => {
    await resetDatabase();
    // Configure default Teams integration
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
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  // ── Scenario B1: 50 simultaneous meeting creates ────────────────────────────
  it('B1: 50 simultaneous meeting creates produce exactly 1 generation, 1 claim, and 1 BackgroundJob', async () => {
    const service = await createTestService('B1 Concurrency Service');
    const incident = await createTestIncident('B1 50 Simultaneous Creates', service.id);

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        requestMeetingProvision({
          incidentId: incident.id,
          provider: 'JITSI',
          incidentTitle: `Concurrency certification ${i}`,
        })
      )
    );

    expect(results).toHaveLength(50);
    const first = results[0];
    expect(first.state).toBe('PROVISIONING');
    expect(first.generation).toBe(1);

    // Invariant I9 & I1: Exactly 1 row in PostgreSQL
    const meetings = await testPrisma.incidentMeeting.findMany({
      where: { incidentId: incident.id },
    });
    expect(meetings).toHaveLength(1);
    expect(meetings[0].generation).toBe(1);
    expect(meetings[0].state).toBe('PROVISIONING');

    // Invariant I1: Single effective provisioning owner
    const tokens = meetings.map(m => m.provisioningToken);
    expect(InvariantPredicates.hasSingleMeetingOwner(tokens)).toBe(true);

    // Exactly 1 BackgroundJob created
    const jobs = await testPrisma.backgroundJob.findMany({
      where: { type: 'MEETING_PROVISION' },
    });
    const incidentJobs = jobs.filter(
      j => (j.payload as { incidentId?: string })?.incidentId === incident.id
    );
    expect(incidentJobs).toHaveLength(1);
    expect((incidentJobs[0].payload as { provisioningToken: string }).provisioningToken).toBe(
      meetings[0].provisioningToken
    );

    // All 50 callers received identical meeting ID and externalId
    for (const r of results) {
      expect(r.id).toBe(first.id);
      expect(r.externalId).toBe(first.externalId);
    }
  });

  // ── Scenario B2: 50 simultaneous meeting closes ────────────────────────────
  it('B2: 50 simultaneous meeting closes atomically transition to CLOSING with exactly 1 close job', async () => {
    const service = await createTestService('B2 Close Concurrency Service');
    const incident = await createTestIncident('B2 Close Incident', service.id);

    // Seed a READY meeting
    await testPrisma.incidentMeeting.create({
      data: {
        id: `meet_${incident.id}_1`,
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'READY',
        health: 'HEALTHY',
        externalId: `opsknight:${incident.id}:1`,
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/b2-test',
        providerMeetingId: 'teams-b2-meeting-id',
        organizerEmail: 'organizer@example.com',
      },
    });

    const closePromises = Array.from({ length: 50 }, () => closeIncidentMeeting(incident.id));
    await Promise.all(closePromises);

    const meetingAfterClaim = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(meetingAfterClaim?.state).toBe('CLOSING');
    expect(meetingAfterClaim?.closeStartedAt).not.toBeNull();

    // Exactly 1 close job created
    const jobs = await testPrisma.backgroundJob.findMany({
      where: { type: 'MEETING_CLOSE' },
    });
    const incidentCloseJobs = jobs.filter(
      j => (j.payload as { incidentId?: string })?.incidentId === incident.id
    );
    expect(incidentCloseJobs).toHaveLength(1);

    // Now execute worker close job
    await executeMeetingCloseJob({
      incidentId: incident.id,
      provider: 'MICROSOFT_TEAMS',
      providerMeetingId: 'teams-b2-meeting-id',
      organizerEmail: 'organizer@example.com',
    });

    const settledMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(settledMeeting?.state).toBe('CLOSED');
    expect(settledMeeting?.health).toBe('HEALTHY');
    expect(settledMeeting?.externalCleanupPending).toBe(false);
    expect(settledMeeting?.closedAt).not.toBeNull();
  });

  // ── Scenario B3: Create vs Close CAS Race ──────────────────────────────────
  it('B3: Invariant I4 — close/closing always wins over an in-flight provision (CAS protection)', async () => {
    const service = await createTestService('B3 CAS Race Service');
    const incident = await createTestIncident('B3 CAS Race Incident', service.id);

    const activeToken = 'token-worker-a-inflight';
    await testPrisma.incidentMeeting.create({
      data: {
        id: `meet_${incident.id}_1`,
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'PROVISIONING',
        health: 'HEALTHY',
        externalId: `opsknight:${incident.id}:1`,
        joinUrl: '',
        provisioningToken: activeToken,
        provisioningStartedAt: new Date(),
        providerMeetingId: 'teams-in-flight-id',
      },
    });

    // While Worker A has call in flight, Worker B initiates close
    await closeIncidentMeeting(incident.id);

    const meetingAfterClose = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(meetingAfterClose?.state).toBe('CLOSING');

    // Worker A now finishes external creation and attempts to settle to READY with activeToken
    const settled = await executeMeetingProvision({
      incidentId: incident.id,
      provisioningToken: activeToken,
      provider: 'MICROSOFT_TEAMS',
      generation: 1,
      incidentTitle: 'B3 In Flight',
    });

    // Invariant I4: Meeting state must NOT become READY
    expect(settled.state).not.toBe('READY');
    expect(['CLOSING', 'CLOSED']).toContain(settled.state);

    const dbMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(dbMeeting?.state).not.toBe('READY');
    expect(['CLOSING', 'CLOSED']).toContain(dbMeeting?.state);
  });

  // ── Scenario B4: Stale generation worker rejection ─────────────────────────
  it('B4: Invariant I3 — a stale generation-1 job cannot mutate generation 2', async () => {
    const service = await createTestService('B4 Stale Generation Service');
    const incident = await createTestIncident('B4 Stale Worker Incident', service.id);

    // Generation 1: CLOSED
    await testPrisma.incidentMeeting.create({
      data: {
        id: `meet_${incident.id}_1`,
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'CLOSED',
        health: 'HEALTHY',
        externalId: `opsknight:${incident.id}:1`,
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/gen1',
        closedAt: new Date(),
      },
    });

    // Generation 2: active READY
    const gen2Url = 'https://teams.microsoft.com/l/meetup-join/gen2-active';
    await testPrisma.incidentMeeting.create({
      data: {
        id: `meet_${incident.id}_2`,
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        generation: 2,
        state: 'READY',
        health: 'HEALTHY',
        externalId: `opsknight:${incident.id}:2`,
        joinUrl: gen2Url,
        readyAt: new Date(),
        provisioningToken: 'token-gen-2',
      },
    });

    // Stale generation 1 worker tries to execute provision with generation 1 parameters
    await executeMeetingProvision({
      incidentId: incident.id,
      provisioningToken: 'stale-gen-1-token',
      provider: 'MICROSOFT_TEAMS',
      generation: 1,
      incidentTitle: 'Stale Replay Attempt',
    });

    // Verify Generation 2 in DB was NOT mutated
    const gen2Meeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 2 } },
    });
    expect(gen2Meeting?.state).toBe('READY');
    expect(gen2Meeting?.joinUrl).toBe(gen2Url);
    expect(gen2Meeting?.generation).toBe(2);

    // Verify latest meeting view remains Generation 2
    const latestView = await getIncidentMeeting(incident.id);
    expect(latestView?.generation).toBe(2);
    expect(latestView?.joinUrl).toBe(gen2Url);
  });

  // ── Scenario B5: Simultaneous Slack + Teams room creation concurrency ───────
  it('B5: Invariant I2 — concurrent room requests for Slack and Teams produce exactly 1 room per provider', async () => {
    const service = await createTestService('B5 Multi-Provider Service');
    const incident = await createTestIncident('B5 Multi-Provider Incident', service.id);

    // Run 50 concurrent claims across Slack and Teams
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => [
        runSerializableTransaction(tx =>
          claimWarRoomProvisioning(tx, {
            incidentId: incident.id,
            provider: 'SLACK',
          })
        ),
        runSerializableTransaction(tx =>
          claimWarRoomProvisioning(tx, {
            incidentId: incident.id,
            provider: 'MICROSOFT_TEAMS',
          })
        ),
      ]).flat()
    );

    const warRooms = await testPrisma.incidentWarRoom.findMany({
      where: { incidentId: incident.id },
    });

    const slackRooms = warRooms.filter(r => r.provider === 'SLACK');
    const teamsRooms = warRooms.filter(r => r.provider === 'MICROSOFT_TEAMS');

    // Invariant I2: exactly 1 per provider per generation (no duplicates!)
    expect(slackRooms).toHaveLength(1);
    expect(teamsRooms).toHaveLength(1);
    expect(slackRooms[0].generation).toBe(1);
    expect(teamsRooms[0].generation).toBe(1);
  });
});
