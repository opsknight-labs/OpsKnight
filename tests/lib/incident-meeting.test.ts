import { describe, expect, it } from 'vitest';
import {
  MeetingProviderRegistry,
  TeamsMeetingAdapter,
  JitsiMeetingAdapter,
  ZoomMeetingAdapter,
  GoogleMeetAdapter,
} from '@/lib/incident-collaboration/meeting-registry';
import {
  provisionIncidentMeeting,
  getIncidentMeeting,
  closeIncidentMeeting,
} from '@/lib/incident-collaboration/meeting-store';

describe('Meeting Provider Registry and Adapters', () => {
  it('Jitsi adapter provides instant 0-setup deterministic meeting links', async () => {
    const adapter = new JitsiMeetingAdapter();
    const available = await adapter.isAvailable();
    expect(available.available).toBe(true);

    const result = await adapter.createOrGetMeeting({
      incidentId: 'inc-abc-1234',
      incidentTitle: 'Payment Service Latency Spike',
      generation: 1,
    });

    expect(result.externalId).toBe('opsknight:inc-abc-1234:1');
    expect(result.joinUrl).toContain('meet.jit.si');
    expect(result.joinUrl).toContain('inc-abc-1234'.slice(-8));
  });

  it('Zoom adapter supports custom bridge template substitution', async () => {
    const adapter = new ZoomMeetingAdapter();
    const result = await adapter.createOrGetMeeting({
      incidentId: 'inc-9999',
      incidentTitle: 'Database Deadlock',
      generation: 2,
      customTemplate: 'https://myorg.zoom.us/j/{incidentId}',
    });

    expect(result.externalId).toBe('opsknight:inc-9999:2');
    expect(result.joinUrl).toBe('https://myorg.zoom.us/j/inc-9999');
  });

  it('Google Meet adapter supports custom bridge template substitution', async () => {
    const adapter = new GoogleMeetAdapter();
    const result = await adapter.createOrGetMeeting({
      incidentId: 'inc-8888',
      incidentTitle: 'API Gateway 502',
      generation: 1,
      customTemplate: 'https://meet.google.com/lookup/{incidentId}',
    });

    expect(result.externalId).toBe('opsknight:inc-8888:1');
    expect(result.joinUrl).toBe('https://meet.google.com/lookup/inc-8888');
  });

  it('Teams meeting adapter rejects silent fallback when integration is disabled', async () => {
    const adapter = new TeamsMeetingAdapter();
    const avail = await adapter.isAvailable();
    // Default in test env is unconfigured
    expect(avail.available).toBe(false);
    expect(avail.reason).toBeDefined();

    await expect(
      adapter.createOrGetMeeting({
        incidentId: 'inc-fail-1',
        incidentTitle: 'Test Failure',
        generation: 1,
      })
    ).rejects.toThrow(/disabled|not configured|missing/i);
  });

  it('Registry returns correct adapter and handles NONE as disabled', async () => {
    expect(MeetingProviderRegistry.getAdapter('JITSI')).toBeInstanceOf(JitsiMeetingAdapter);
    expect(MeetingProviderRegistry.getAdapter('MICROSOFT_TEAMS')).toBeInstanceOf(
      TeamsMeetingAdapter
    );
    expect(MeetingProviderRegistry.getAdapter('ZOOM')).toBeInstanceOf(ZoomMeetingAdapter);
    expect(MeetingProviderRegistry.getAdapter('GOOGLE_MEET')).toBeInstanceOf(GoogleMeetAdapter);

    const noneAvail = await MeetingProviderRegistry.isAvailable('NONE');
    expect(noneAvail.available).toBe(false);
  });
});

describe('Incident Meeting Store & Provisioning Lifecycle', () => {
  it('provisions and retrieves Jitsi meeting bridge idempotently', async () => {
    const incidentId = 'inc-store-test-1';

    const meeting1 = await provisionIncidentMeeting({
      incidentId,
      incidentTitle: 'Core Banking API Down',
      provider: 'JITSI',
      generation: 1,
    });

    expect(meeting1.state).toBe('READY');
    expect(meeting1.provider).toBe('JITSI');
    expect(meeting1.joinUrl).toContain('meet.jit.si');
    expect(meeting1.actions.canJoin).toBe(true);

    // Calling again without forceRetry must return identical meeting
    const meeting2 = await provisionIncidentMeeting({
      incidentId,
      incidentTitle: 'Core Banking API Down',
      provider: 'JITSI',
      generation: 1,
    });

    expect(meeting2.id).toBe(meeting1.id);
    expect(meeting2.joinUrl).toBe(meeting1.joinUrl);

    // Can close meeting
    await closeIncidentMeeting(incidentId);
    const closed = await getIncidentMeeting(incidentId);
    expect(closed?.state).toBe('CLOSED');
    expect(closed?.actions.canJoin).toBe(false);
  });

  it('handles provisioning failure cleanly with FAILED state and retry action', async () => {
    const incidentId = 'inc-store-fail-1';

    // Teams meeting fails in test env because Entra is unconfigured
    const meeting = await provisionIncidentMeeting({
      incidentId,
      incidentTitle: 'Entra Meeting Failure Test',
      provider: 'MICROSOFT_TEAMS',
      generation: 1,
    });

    expect(meeting.state).toBe('FAILED');
    expect(meeting.health).toBe('UNAVAILABLE');
    expect(meeting.lastErrorCode).toBe('PROVISION_FAILED');
    expect(meeting.actions.canRetry).toBe(true);
    expect(meeting.actions.canJoin).toBe(false);
  });
});
