import { describe, expect, it } from 'vitest';
import {
  deriveProviderCanCreate,
  deriveWarRoomActions,
} from '@/lib/incident-collaboration/capabilities';
import {
  getHealthPresentation,
  getLifecyclePresentation,
  toUserFacingWarRoomError,
} from '@/lib/incident-collaboration/presentation';
import { getProviderDeepLinkUrl } from '@/lib/incident-collaboration/urls';

describe('incident collaboration capabilities and state rules', () => {
  it('allows open only when channel url exists and room is ready, closed, or archived', () => {
    const ready = deriveWarRoomActions({
      state: 'READY',
      channelUrl: 'https://teams.microsoft.com/channel-1',
      incidentStatus: 'OPEN',
      canManage: true,
    });
    expect(ready.canOpen).toBe(true);
    expect(ready.canClose).toBe(true);
    expect(ready.canSyncParticipants).toBe(true);
    expect(ready.canReconcile).toBe(true);

    const provisioning = deriveWarRoomActions({
      state: 'PROVISIONING',
      channelUrl: null,
      incidentStatus: 'OPEN',
      canManage: true,
    });
    expect(provisioning.canOpen).toBe(false);
    expect(provisioning.canClose).toBe(false);
    expect(provisioning.canSyncParticipants).toBe(false);
  });

  it('prevents room closing on resolved incidents', () => {
    const actions = deriveWarRoomActions({
      state: 'READY',
      channelUrl: 'https://slack.com/archives/C123',
      incidentStatus: 'RESOLVED',
      canManage: true,
    });
    expect(actions.canClose).toBe(false);
    expect(actions.canSyncParticipants).toBe(false);
    // Historical room can still be opened
    expect(actions.canOpen).toBe(true);
  });

  it('enforces duplicate creation prevention when an active or transitional room exists', () => {
    // If room is PROVISIONING, canCreate must be false
    expect(
      deriveProviderCanCreate({
        availability: 'AVAILABLE',
        incidentStatus: 'OPEN',
        canManage: true,
        latestRoomState: 'PROVISIONING',
      })
    ).toBe(false);

    // If room is AMBIGUOUS, canCreate must be false
    expect(
      deriveProviderCanCreate({
        availability: 'AVAILABLE',
        incidentStatus: 'OPEN',
        canManage: true,
        latestRoomState: 'AMBIGUOUS',
      })
    ).toBe(false);

    // If room is READY, canCreate must be false
    expect(
      deriveProviderCanCreate({
        availability: 'AVAILABLE',
        incidentStatus: 'OPEN',
        canManage: true,
        latestRoomState: 'READY',
      })
    ).toBe(false);

    // If room is CLOSING, canCreate must be false
    expect(
      deriveProviderCanCreate({
        availability: 'AVAILABLE',
        incidentStatus: 'OPEN',
        canManage: true,
        latestRoomState: 'CLOSING',
      })
    ).toBe(false);

    // If latest room is CLOSED, new generation creation is permitted on active incident
    expect(
      deriveProviderCanCreate({
        availability: 'AVAILABLE',
        incidentStatus: 'OPEN',
        canManage: true,
        latestRoomState: 'CLOSED',
      })
    ).toBe(true);

    // If latest room is FAILED, retry/new generation creation is permitted
    expect(
      deriveProviderCanCreate({
        availability: 'AVAILABLE',
        incidentStatus: 'OPEN',
        canManage: true,
        latestRoomState: 'FAILED',
      })
    ).toBe(true);
  });

  it('forbids creation when provider is disabled or incident is resolved', () => {
    expect(
      deriveProviderCanCreate({
        availability: 'DISABLED',
        incidentStatus: 'OPEN',
        canManage: true,
      })
    ).toBe(false);

    expect(
      deriveProviderCanCreate({
        availability: 'AVAILABLE',
        incidentStatus: 'RESOLVED',
        canManage: true,
      })
    ).toBe(false);

    expect(
      deriveProviderCanCreate({
        availability: 'AVAILABLE',
        incidentStatus: 'OPEN',
        canManage: false,
      })
    ).toBe(false);
  });
});

describe('incident collaboration presentation mapping', () => {
  it('maps lifecycle states to proper presentation labels and tones', () => {
    expect(getLifecyclePresentation('PROVISIONING')).toEqual({
      label: 'Creating…',
      tone: 'info',
      description: expect.any(String),
    });

    expect(getLifecyclePresentation('READY')).toEqual({
      label: 'Active',
      tone: 'success',
      description: expect.any(String),
    });

    expect(getLifecyclePresentation('AMBIGUOUS')).toEqual({
      label: 'Confirming creation…',
      tone: 'warning',
      description: expect.any(String),
    });

    expect(getLifecyclePresentation('FAILED')).toEqual({
      label: 'Creation failed',
      tone: 'destructive',
      description: expect.any(String),
    });
  });

  it('maps health states independently from lifecycle', () => {
    expect(getHealthPresentation('HEALTHY')).toEqual({
      label: 'Healthy',
      tone: 'success',
      description: expect.any(String),
    });

    expect(getHealthPresentation('DEGRADED')).toEqual({
      label: 'Needs attention',
      tone: 'warning',
      description: expect.any(String),
    });

    expect(getHealthPresentation('PERMISSION_ERROR')).toEqual({
      label: 'Permissions required',
      tone: 'destructive',
      description: expect.any(String),
    });
  });

  it('maps backend errors to user-friendly messages', () => {
    const permErr = toUserFacingWarRoomError('MISSING_PERMISSION: ChannelMember.ReadWrite.Group');
    expect(permErr.title).toBe('Permissions required');

    const inProgress = toUserFacingWarRoomError('CREATE_ALREADY_IN_PROGRESS');
    expect(inProgress.title).toBe('Creation in progress');
  });
});

describe('incident collaboration deep links', () => {
  it('formats Slack deep link protocol when channelId is present', () => {
    const link = getProviderDeepLinkUrl('SLACK', { channelId: 'C12345' });
    expect(link).toBe('slack://channel?id=C12345');
  });

  it('formats Microsoft Teams deep link protocol for desktop app', () => {
    const link = getProviderDeepLinkUrl('MICROSOFT_TEAMS', {
      channelUrl: 'https://teams.microsoft.com/l/channel/19%3Achannel@thread.tacv2/General',
    });
    expect(link).toBe('msteams:/l/channel/19%3Achannel@thread.tacv2/General');
  });
});

describe('getIncidentCollaborationView end-to-end derivation', () => {
  it('is importable and has correct contract signature', async () => {
    const { getIncidentCollaborationView } =
      await import('@/lib/incident-collaboration/get-incident-collaboration');
    expect(typeof getIncidentCollaborationView).toBe('function');
  });
});
