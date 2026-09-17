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
import { processJob } from '@/lib/jobs/queue';
import { retryIncidentMeetingCleanup } from '@/lib/incident-collaboration/meeting-reconciliation';

const describeIfRealDB = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;

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
  it('E1: Provider 429 reschedules background job with Retry-After backoff and succeeds on retry', async () => {
    const service = await createTestService('Chaos 429 Service');
    const incident = await createTestIncident('Chaos 429 Incident', service.id);

    // Initial claim enqueues a MEETING_PROVISION job
    await requestMeetingProvision({
      incidentId: incident.id,
      provider: 'MICROSOFT_TEAMS',
      incidentTitle: '429 Test',
    });

    const initDbMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(initDbMeeting?.state).toBe('PROVISIONING');

    const job = await testPrisma.backgroundJob.findFirst({
      where: { type: 'MEETING_PROVISION', status: 'PENDING' },
    });
    expect(job).not.toBeNull();

    // 1st attempt: Rate Limited with 45s Retry-After
    collaborationProviderHarness.meeting.setCreateBehavior({
      behavior: 'RATE_LIMITED',
      retryAfterMs: 45000,
    });

    // Mark job processing and execute via queue engine
    await testPrisma.backgroundJob.update({
      where: { id: job!.id },
      data: { status: 'PROCESSING', startedAt: new Date(), attempts: 1 },
    });
    const processingJob = await testPrisma.backgroundJob.findUnique({ where: { id: job!.id } });
    await processJob(processingJob as any);

    // Queue worker automatically caught WarRoomRetryableError and rescheduled with backoff
    const rescheduledJob = await testPrisma.backgroundJob.findUnique({
      where: { id: job!.id },
    });
    expect(rescheduledJob?.status).toBe('PENDING');
    const delay = rescheduledJob!.scheduledAt.getTime() - Date.now();
    expect(delay).toBeGreaterThan(40000); // 45s backoff honored!

    // Assert meeting remains in PROVISIONING state with DEGRADED health
    const dbMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(dbMeeting?.state).toBe('PROVISIONING');
    expect(dbMeeting?.health).toBe('DEGRADED');

    // 2nd attempt: Rate limit cleared, advance scheduled time, execute queue again
    collaborationProviderHarness.meeting.setCreateBehavior('SUCCESS');
    await testPrisma.backgroundJob.update({
      where: { id: job!.id },
      data: { status: 'PROCESSING', scheduledAt: new Date(Date.now() - 1000), attempts: 2 },
    });
    const readyJob = await testPrisma.backgroundJob.findUnique({ where: { id: job!.id } });
    const success = await processJob(readyJob as any);
    expect(success).toBe(true);

    const completedJob = await testPrisma.backgroundJob.findUnique({ where: { id: job!.id } });
    expect(completedJob?.status).toBe('COMPLETED');

    const readyMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { incidentId_generation: { incidentId: incident.id, generation: 1 } },
    });
    expect(readyMeeting?.state).toBe('READY');
    expect(readyMeeting?.health).toBe('HEALTHY');
    expect(readyMeeting?.joinUrl).toContain('teams.microsoft.com');
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

    // Inject Slack API outage via multi-provider harness
    collaborationProviderHarness.slack.setBehavior({
      behavior: 'SERVER_ERROR',
      statusCode: 500,
      errorMessage: 'Slack API 500 error: internal server error',
    });

    // Create a Slack war room and run through processJob() with the registered mock adapter
    const slackRoom = await testPrisma.incidentWarRoom.create({
      data: {
        incidentId: incident.id,
        provider: 'SLACK',
        generation: 1,
        state: 'PROVISIONING',
        provisioningToken: 'tok-slack-prov',
      },
    });

    const slackJob = await testPrisma.backgroundJob.create({
      data: {
        type: 'WAR_ROOM_PROVISION',
        status: 'PENDING',
        scheduledAt: new Date(),
        maxAttempts: 1,
        payload: {
          warRoomId: slackRoom.id,
          provisioningToken: 'tok-slack-prov',
        },
      },
    });

    // Process job through real queue worker
    await processJob(slackJob.id);

    // Slack war room transitions to FAILED
    const failedSlackRoom = await testPrisma.incidentWarRoom.findUnique({
      where: { id: slackRoom.id },
    });
    expect(failedSlackRoom?.state).toBe('FAILED');

    // Invariant I5: Teams meeting remains READY, healthy, and completely untouched!
    const persistedMeeting = await getIncidentMeeting(incident.id);
    expect(persistedMeeting?.state).toBe('READY');
    expect(persistedMeeting?.health).toBe('HEALTHY');
  });

  // ── Scenario E6: Cleanup-Repair Terminal Failure Exhaustion ──────────────
  it('E6: Cleanup-repair retry exhaustion preserves cleanup debt, marks health DEGRADED, and releases closeToken', async () => {
    const service = await createTestService('Chaos Cleanup Exhaustion Service');
    const incident = await createTestIncident('Chaos Cleanup Exhaustion Incident', service.id);

    const meeting = await testPrisma.incidentMeeting.create({
      data: {
        id: `meet_${incident.id}_1`,
        incidentId: incident.id,
        provider: 'MICROSOFT_TEAMS',
        generation: 1,
        state: 'CLOSED',
        health: 'HEALTHY',
        externalId: `opsknight:${incident.id}:1`,
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/e6',
        providerMeetingId: 'ext-meet-debt-e6',
        externalCleanupPending: true,
        closeToken: null,
        cleanupRetryCount: 0,
      },
    });

    // Request cleanup retry: claims row and creates MEETING_CLOSE job with cleanupRepair: true
    const retryResult = await retryIncidentMeetingCleanup(meeting.id);
    expect(retryResult.success).toBe(true);
    expect(retryResult.jobId).toBeDefined();

    // Verify row is claimed with closeToken
    const claimedMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { id: meeting.id },
    });
    expect(claimedMeeting?.closeToken).toBeTruthy();
    expect(claimedMeeting?.cleanupRetryCount).toBe(1);

    // Mock Graph DELETE failure (500 Server Error)
    collaborationProviderHarness.meeting.setCloseBehavior('SERVER_ERROR');

    // Set job maxAttempts to 1 so the failure is terminal upon this execution
    await testPrisma.backgroundJob.update({
      where: { id: retryResult.jobId! },
      data: { maxAttempts: 1 },
    });

    // Process job through queue machinery
    await processJob(retryResult.jobId!);

    // Terminal failure settlement must have preserved debt, degraded health, and released closeToken
    const settledMeeting = await testPrisma.incidentMeeting.findUnique({
      where: { id: meeting.id },
    });
    expect(settledMeeting?.state).toBe('CLOSED');
    expect(settledMeeting?.externalCleanupPending).toBe(true);
    expect(settledMeeting?.health).toBe('DEGRADED');
    expect(settledMeeting?.closeToken).toBeNull();
    expect(settledMeeting?.lastErrorCode).toBe('PROVIDER_CLOSE_FAILED');
    expect(settledMeeting?.lastErrorMessage).toContain('External meeting cleanup failed');
  });

  // ── Scenario E7: War Room Provider Chaos (429 Backoff & 403 Terminal Rejection) ──
  it('E7: War room adapter 429 reschedules with Retry-After backoff and 403 fails without retry', async () => {
    const service = await createTestService('Chaos War Room Backoff Service');
    const incident = await createTestIncident('Chaos War Room Backoff Incident', service.id);

    // 1. Rate-limiting (429) backoff
    collaborationProviderHarness.slack.setBehavior({
      behavior: 'RATE_LIMITED',
      retryAfterMs: 45000,
    });

    const room429 = await testPrisma.incidentWarRoom.create({
      data: {
        incidentId: incident.id,
        provider: 'SLACK',
        generation: 1,
        state: 'PROVISIONING',
        provisioningToken: 'tok-slack-429',
      },
    });

    const job429 = await testPrisma.backgroundJob.create({
      data: {
        type: 'WAR_ROOM_PROVISION',
        status: 'PENDING',
        scheduledAt: new Date(),
        maxAttempts: 5,
        payload: {
          warRoomId: room429.id,
          provisioningToken: 'tok-slack-429',
        },
      },
    });

    const before = Date.now();
    await processJob(job429.id);

    const rescheduledJob = await testPrisma.backgroundJob.findUnique({
      where: { id: job429.id },
    });
    expect(rescheduledJob?.status).toBe('PENDING');
    expect(rescheduledJob?.attempts).toBe(1);
    expect(rescheduledJob?.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 40000);

    // 2. Permission Denied (403) terminal failure
    collaborationProviderHarness.slack.setBehavior('PERMISSION_DENIED');

    const room403 = await testPrisma.incidentWarRoom.create({
      data: {
        incidentId: incident.id,
        provider: 'SLACK',
        generation: 2,
        state: 'PROVISIONING',
        provisioningToken: 'tok-slack-403',
      },
    });

    const job403 = await testPrisma.backgroundJob.create({
      data: {
        type: 'WAR_ROOM_PROVISION',
        status: 'PENDING',
        scheduledAt: new Date(),
        maxAttempts: 5,
        payload: {
          warRoomId: room403.id,
          provisioningToken: 'tok-slack-403',
        },
      },
    });

    await processJob(job403.id);

    const terminalJob = await testPrisma.backgroundJob.findUnique({
      where: { id: job403.id },
    });
    // Non-retryable error fails immediately without further attempts
    expect(terminalJob?.status).toBe('FAILED');
  });
});
