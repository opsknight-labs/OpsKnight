import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  requestMeetingProvision,
  closeIncidentMeeting,
  executeMeetingProvision,
  executeMeetingCloseJob,
  getIncidentMeeting,
} from '@/lib/incident-collaboration/meeting-store';
import { collaborationProviderHarness } from '../helpers/collaboration-provider-harness';
import {
  createTestService,
  createTestIncident,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';
import { WarRoomRetryableError } from '@/lib/war-room/errors';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('Phase 6 Incident Collaboration Chaos & Fault Matrix (Postgres)', () => {
  beforeEach(async () => {
    await resetDatabase();
    collaborationProviderHarness.install();
    collaborationProviderHarness.reset();

    // Default Teams config
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

  afterEach(() => {
    collaborationProviderHarness.reset();
  });

  afterAll(async () => {
    collaborationProviderHarness.restore();
    await testPrisma.$disconnect();
  });

  // ── Workstream E: 429 Retry Backoff ───────────────────────────────────────
  it('E1: Provider 429 throws WarRoomRetryableError, keeps PROVISIONING, and retries successfully', async () => {
    const service = await createTestService('Chaos 429 Service');
    const incident = await createTestIncident('Chaos 429 Incident', service.id);

    // Initial claim
    await requestMeetingProvision({
      incidentId: incident.id,
      provider: 'MICROSOFT_TEAMS',
      incidentTitle: '429 Test',
    });

    const initDbMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    const token = initDbMeeting!.provisioningToken!;

    // 1st attempt: 429 Rate Limited
    collaborationProviderHarness.meeting.setCreateBehavior({
      behavior: 'RATE_LIMITED',
      retryAfterMs: 45000,
    });

    let caughtError: unknown;
    try {
      await executeMeetingProvision({
        incidentId: incident.id,
        provisioningToken: token,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        incidentTitle: '429 Test',
        attempt: 1,
        maxAttempts: 5,
      });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(WarRoomRetryableError);
    expect((caughtError as WarRoomRetryableError).retryAfterMs).toBe(45000);

    // Assert meeting remains in PROVISIONING state with DEGRADED health
    const dbMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(dbMeeting?.state).toBe('PROVISIONING');
    expect(dbMeeting?.health).toBe('DEGRADED');

    // 2nd attempt: Rate limit cleared, SUCCESS
    collaborationProviderHarness.meeting.setCreateBehavior('SUCCESS');
    const successMeeting = await executeMeetingProvision({
      incidentId: incident.id,
      provisioningToken: dbMeeting!.provisioningToken!,
      provider: 'MICROSOFT_TEAMS',
      generation: 1,
      incidentTitle: '429 Test',
      attempt: 2,
      maxAttempts: 5,
    });

    expect(successMeeting.state).toBe('READY');
    expect(successMeeting.health).toBe('HEALTHY');
    expect(successMeeting.joinUrl).toContain('teams.microsoft.com');
  });

  it('E2: Teams Meeting DELETE 429 honors Retry-After, remains CLOSING, and succeeds on next attempt', async () => {
    const service = await createTestService('Chaos Close 429 Service');
    const incident = await createTestIncident('Chaos Close 429 Incident', service.id);

    // Seed READY meeting
    await testPrisma.incidentMeeting.create({
      data: {
        id: `meet_${incident.id}_1`,
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'READY',
        health: 'HEALTHY',
        externalId: `opsknight:${incident.id}:1`,
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/e2-test',
        providerMeetingId: 'ext-meet-e2',
        organizerEmail: 'organizer@example.com',
      },
    });

    await closeIncidentMeeting(incident.id);

    const closingRow = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(closingRow?.state).toBe('CLOSING');

    // 1st attempt: 429 on DELETE
    collaborationProviderHarness.meeting.setCloseBehavior({
      behavior: 'RATE_LIMITED',
      retryAfterMs: 30000,
    });

    let caughtCloseError: unknown;
    try {
      await executeMeetingCloseJob({
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        providerMeetingId: 'ext-meet-e2',
        organizerEmail: 'organizer@example.com',
      });
    } catch (err) {
      caughtCloseError = err;
    }

    expect(caughtCloseError).toBeInstanceOf(WarRoomRetryableError);

    // Meeting must remain CLOSING (never force to CLOSED prematurely on retryable error)
    const stillClosing = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(stillClosing?.state).toBe('CLOSING');

    // 2nd attempt: Success
    collaborationProviderHarness.meeting.setCloseBehavior('SUCCESS');
    await executeMeetingCloseJob({
      incidentId: incident.id,
      provider: 'MICROSOFT_TEAMS',
      providerMeetingId: 'ext-meet-e2',
      organizerEmail: 'organizer@example.com',
    });

    const closedMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(closedMeeting?.state).toBe('CLOSED');
    expect(closedMeeting?.health).toBe('HEALTHY');
    expect(closedMeeting?.externalCleanupPending).toBe(false);
  });

  // ── Workstream E: 401/403 Terminal Behavior ───────────────────────────────
  it('E3: Terminal 403 permission failure settles cleanly without infinite retry', async () => {
    const service = await createTestService('Chaos 403 Service');
    const incident = await createTestIncident('Chaos 403 Incident', service.id);

    await requestMeetingProvision({
      incidentId: incident.id,
      provider: 'MICROSOFT_TEAMS',
      incidentTitle: '403 Terminal Test',
    });

    const initDbMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    const token = initDbMeeting!.provisioningToken!;

    collaborationProviderHarness.meeting.setCreateBehavior('PERMISSION_DENIED');

    const result = await executeMeetingProvision({
      incidentId: incident.id,
      provisioningToken: token,
      provider: 'MICROSOFT_TEAMS',
      generation: 1,
      incidentTitle: '403 Terminal Test',
      attempt: 1,
      maxAttempts: 5,
    });

    expect(result.state).toBe('FAILED');
    expect(result.health).toBe('UNAVAILABLE');
    expect(result.actions.canRetry).toBe(true);

    const dbMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(dbMeeting?.state).toBe('FAILED');
    expect(dbMeeting?.health).toBe('UNAVAILABLE');
    expect(dbMeeting?.lastErrorCode).toBe('PROVISION_FAILED');
  });

  // ── Workstream E: 404 Idempotent Delete ───────────────────────────────────
  it('E4: 404 on Graph DELETE is treated idempotently as success', async () => {
    const service = await createTestService('Chaos 404 Service');
    const incident = await createTestIncident('Chaos 404 Incident', service.id);

    await testPrisma.incidentMeeting.create({
      data: {
        id: `meet_${incident.id}_1`,
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'CLOSING',
        health: 'HEALTHY',
        externalId: `opsknight:${incident.id}:1`,
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/e4',
        providerMeetingId: 'ext-meet-already-deleted',
      },
    });

    collaborationProviderHarness.meeting.setCloseBehavior('NOT_FOUND');

    await executeMeetingCloseJob({
      incidentId: incident.id,
      provider: 'MICROSOFT_TEAMS',
      providerMeetingId: 'ext-meet-already-deleted',
    });

    const meeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });

    // 404 treated as success: state becomes CLOSED with NO cleanup debt
    expect(meeting?.state).toBe('CLOSED');
    expect(meeting?.health).toBe('HEALTHY');
    expect(meeting?.externalCleanupPending).toBe(false);
  });

  // ── Workstream F: Lost Response / Ambiguous External Success ──────────────
  it('F1: Ambiguous external success (lost response timeout) recovers idempotently via deterministic externalId', async () => {
    const service = await createTestService('Chaos Lost Response Service');
    const incident = await createTestIncident('Chaos Lost Response Incident', service.id);

    await requestMeetingProvision({
      incidentId: incident.id,
      provider: 'MICROSOFT_TEAMS',
      incidentTitle: 'Lost Response Test',
    });

    const dbMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    const token = dbMeeting!.provisioningToken!;

    // 1st attempt: meeting created externally, but client receives TIMEOUT
    collaborationProviderHarness.meeting.setCreateBehavior('SUCCESS_THEN_TIMEOUT');

    let timeoutError: unknown;
    try {
      await executeMeetingProvision({
        incidentId: incident.id,
        provisioningToken: token,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        incidentTitle: 'Lost Response Test',
        attempt: 1,
        maxAttempts: 3,
      });
    } catch (err) {
      timeoutError = err;
    }
    expect(timeoutError).toBeInstanceOf(WarRoomRetryableError);

    // Verify meeting was created in external provider store
    expect(collaborationProviderHarness.meeting.externalMeetings.size).toBe(1);

    // 2nd attempt: background queue retries
    const recoveredMeeting = await executeMeetingProvision({
      incidentId: incident.id,
      provisioningToken: token,
      provider: 'MICROSOFT_TEAMS',
      generation: 1,
      incidentTitle: 'Lost Response Test',
      attempt: 2,
      maxAttempts: 3,
    });

    // Assert: provider called twice, but external meeting count is still exactly 1
    expect(collaborationProviderHarness.meeting.createCalls.length).toBeGreaterThanOrEqual(2);
    expect(collaborationProviderHarness.meeting.externalMeetings.size).toBe(1);

    // Exactly 1 IncidentMeeting row in database
    const allMeetings = await testPrisma.incidentMeeting.findMany({
      where: { incidentId: incident.id },
    });
    expect(allMeetings).toHaveLength(1);
    expect(recoveredMeeting.state).toBe('READY');
    expect(recoveredMeeting.joinUrl).toContain('lost-response');
  });

  // ── Workstream G: Worker Crash Certification ──────────────────────────────
  it('G1: Worker crash between provider delete and CLOSED settlement recovers idempotently on retry', async () => {
    const service = await createTestService('Chaos Crash Service');
    const incident = await createTestIncident('Chaos Crash Incident', service.id);

    await testPrisma.incidentMeeting.create({
      data: {
        id: `meet_${incident.id}_1`,
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'CLOSING',
        health: 'HEALTHY',
        externalId: `opsknight:${incident.id}:1`,
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/g1',
        providerMeetingId: 'ext-meet-crash-test',
      },
    });

    // Step 1: External Graph DELETE succeeds (meeting deleted)
    await collaborationProviderHarness.meeting.closeMeeting({
      providerMeetingId: 'ext-meet-crash-test',
    });
    expect(collaborationProviderHarness.meeting.deletedMeetingIds.has('ext-meet-crash-test')).toBe(
      true
    );

    // Simulated Crash: worker dies before updating Postgres. Meeting row remains CLOSING.
    const crashRow = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(crashRow?.state).toBe('CLOSING');

    // Step 2: Queue redelivers job to new worker. External provider now returns 404 NOT_FOUND.
    collaborationProviderHarness.meeting.setCloseBehavior('NOT_FOUND');
    await executeMeetingCloseJob({
      incidentId: incident.id,
      provider: 'MICROSOFT_TEAMS',
      providerMeetingId: 'ext-meet-crash-test',
    });

    // Successfully settles to CLOSED
    const recoveredMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(recoveredMeeting?.state).toBe('CLOSED');
    expect(recoveredMeeting?.health).toBe('HEALTHY');
  });

  // ── Workstream E: Provider Failure Isolation ──────────────────────────────
  it('E5: Invariant I5 — provider failure never rolls back a successful resource from another provider', async () => {
    const service = await createTestService('Chaos Failure Isolation Service');
    const incident = await createTestIncident('Chaos Failure Isolation Incident', service.id);

    // Teams meeting succeeds
    collaborationProviderHarness.meeting.setCreateBehavior('SUCCESS');
    await requestMeetingProvision({
      incidentId: incident.id,
      provider: 'MICROSOFT_TEAMS',
      incidentTitle: 'Isolation Test',
    });

    const initDbMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    const token = initDbMeeting!.provisioningToken!;

    const readyMeeting = await executeMeetingProvision({
      incidentId: incident.id,
      provisioningToken: token,
      provider: 'MICROSOFT_TEAMS',
      generation: 1,
      incidentTitle: 'Isolation Test',
    });
    expect(readyMeeting.state).toBe('READY');

    // Seed a Slack war room that experiences an external failure
    await testPrisma.incidentWarRoom.create({
      data: {
        incidentId: incident.id,
        provider: 'SLACK',
        generation: 1,
        state: 'FAILED',
        lastErrorCode: 'SLACK_OUTAGE',
        lastError: 'Slack API 500 error',
      },
    });

    // Invariant I5: Teams meeting remains READY, healthy, and completely untouched!
    const persistedMeeting = await getIncidentMeeting(incident.id);
    expect(persistedMeeting?.state).toBe('READY');
    expect(persistedMeeting?.health).toBe('HEALTHY');

    const warRooms = await testPrisma.incidentWarRoom.findMany({
      where: { incidentId: incident.id },
    });
    expect(warRooms.find(r => r.provider === 'SLACK')?.state).toBe('FAILED');
  });
});
