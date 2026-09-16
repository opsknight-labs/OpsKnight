import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveWarRoomProviders,
  resolveEffectiveMeetingProvider,
  getServiceWarRoomPolicy,
} from '@/lib/incident-collaboration/policy';

describe('Incident War Room Policy Resolver', () => {
  it('inherits global default when serviceProviders is null', () => {
    const result = resolveEffectiveWarRoomProviders({
      globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
      serviceProviders: null,
      availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
      globalWarRoomsEnabled: true,
      serviceWarRoomsEnabled: true,
    });

    expect(result.isInherited).toBe(true);
    expect(result.isDisabled).toBe(false);
    expect(result.effectiveProviders).toEqual(['SLACK', 'MICROSOFT_TEAMS']);
    expect(result.unavailableDesiredProviders).toEqual([]);
  });

  it('respects service-level override for Slack only', () => {
    const result = resolveEffectiveWarRoomProviders({
      globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
      serviceProviders: ['SLACK'],
      availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
      globalWarRoomsEnabled: true,
      serviceWarRoomsEnabled: true,
    });

    expect(result.isInherited).toBe(false);
    expect(result.effectiveProviders).toEqual(['SLACK']);
    expect(result.desiredProviders).toEqual(['SLACK']);
  });

  it('respects service-level override for Teams only', () => {
    const result = resolveEffectiveWarRoomProviders({
      globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
      serviceProviders: ['MICROSOFT_TEAMS'],
      availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
      globalWarRoomsEnabled: true,
      serviceWarRoomsEnabled: true,
    });

    expect(result.isInherited).toBe(false);
    expect(result.effectiveProviders).toEqual(['MICROSOFT_TEAMS']);
    expect(result.desiredProviders).toEqual(['MICROSOFT_TEAMS']);
  });

  it('disables war rooms when service sets empty provider list', () => {
    const result = resolveEffectiveWarRoomProviders({
      globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
      serviceProviders: [],
      availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
      globalWarRoomsEnabled: true,
      serviceWarRoomsEnabled: true,
    });

    expect(result.isDisabled).toBe(true);
    expect(result.effectiveProviders).toEqual([]);
  });

  it('disables war rooms when global feature is disabled', () => {
    const result = resolveEffectiveWarRoomProviders({
      globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
      serviceProviders: null,
      availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
      globalWarRoomsEnabled: false,
      serviceWarRoomsEnabled: true,
    });

    expect(result.isDisabled).toBe(true);
    expect(result.effectiveProviders).toEqual([]);
  });

  it('never silently falls back to Slack when Teams is desired but unavailable', () => {
    const result = resolveEffectiveWarRoomProviders({
      globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
      serviceProviders: ['MICROSOFT_TEAMS'], // Service specifically configured for Teams
      availableProviders: ['SLACK'], // Only Slack is connected, Teams is disconnected
      globalWarRoomsEnabled: true,
      serviceWarRoomsEnabled: true,
    });

    // Invariant: MUST NOT fall back to Slack!
    expect(result.effectiveProviders).toEqual([]);
    expect(result.desiredProviders).toEqual(['MICROSOFT_TEAMS']);
    expect(result.unavailableDesiredProviders).toEqual(['MICROSOFT_TEAMS']);
  });

  it('reports unavailable desired providers when global default includes disconnected provider', () => {
    const result = resolveEffectiveWarRoomProviders({
      globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
      serviceProviders: null,
      availableProviders: ['SLACK'], // Teams disconnected
      globalWarRoomsEnabled: true,
      serviceWarRoomsEnabled: true,
    });

    expect(result.effectiveProviders).toEqual(['SLACK']);
    expect(result.unavailableDesiredProviders).toEqual(['MICROSOFT_TEAMS']);
  });

  it('defaults service war rooms to disabled when not explicitly configured', async () => {
    const policy = await getServiceWarRoomPolicy('svc-unconfigured');
    expect(policy.warRoomsEnabled).toBe(false);
    expect(policy.serviceProviders).toEqual([]);
    expect(policy.autoCreate).toBe(false);
  });
});

describe('Incident Meeting Policy Resolver', () => {
  it('inherits global default meeting provider when serviceMeetingProvider is null', () => {
    const result = resolveEffectiveMeetingProvider({
      globalMeetingProvider: 'JITSI',
      serviceMeetingProvider: null,
      isTeamsMeetingAvailable: true,
      globalWarRoomsEnabled: true,
      serviceWarRoomsEnabled: true,
    });

    expect(result.isInherited).toBe(true);
    expect(result.isDisabled).toBe(false);
    expect(result.effectiveProvider).toBe('JITSI');
  });

  it('allows service to override meeting provider to MICROSOFT_TEAMS', () => {
    const result = resolveEffectiveMeetingProvider({
      globalMeetingProvider: 'JITSI',
      serviceMeetingProvider: 'MICROSOFT_TEAMS',
      isTeamsMeetingAvailable: true,
      globalWarRoomsEnabled: true,
      serviceWarRoomsEnabled: true,
    });

    expect(result.isInherited).toBe(false);
    expect(result.isDisabled).toBe(false);
    expect(result.effectiveProvider).toBe('MICROSOFT_TEAMS');
    expect(result.isUnavailable).toBe(false);
  });

  it('strictly rejects silent fallback when Microsoft Teams Meeting is desired but unavailable', () => {
    const result = resolveEffectiveMeetingProvider({
      globalMeetingProvider: 'MICROSOFT_TEAMS',
      serviceMeetingProvider: null,
      isTeamsMeetingAvailable: false, // Graph permissions missing or app disabled
      globalWarRoomsEnabled: true,
      serviceWarRoomsEnabled: true,
    });

    // Invariant: MUST NOT fall back to Jitsi or Zoom!
    expect(result.effectiveProvider).toBe('NONE');
    expect(result.desiredProvider).toBe('MICROSOFT_TEAMS');
    expect(result.isUnavailable).toBe(true);
    expect(result.unavailableReason).toContain('Microsoft Graph');
  });

  it('disables meeting when service sets meeting provider to NONE', () => {
    const result = resolveEffectiveMeetingProvider({
      globalMeetingProvider: 'JITSI',
      serviceMeetingProvider: 'NONE',
      isTeamsMeetingAvailable: true,
      globalWarRoomsEnabled: true,
      serviceWarRoomsEnabled: true,
    });

    expect(result.isDisabled).toBe(true);
    expect(result.effectiveProvider).toBe('NONE');
  });

  it('allows meeting bridge even when chat war rooms are disabled (decoupled meeting enablement)', () => {
    const result = resolveEffectiveMeetingProvider({
      globalMeetingProvider: 'MICROSOFT_TEAMS',
      serviceMeetingProvider: null,
      isTeamsMeetingAvailable: true,
      globalWarRoomsEnabled: false,
      serviceWarRoomsEnabled: false,
    });

    expect(result.isDisabled).toBe(false);
    expect(result.effectiveProvider).toBe('MICROSOFT_TEAMS');
  });

  it('disables meeting when global meeting provider is NONE', () => {
    const result = resolveEffectiveMeetingProvider({
      globalMeetingProvider: 'NONE',
      serviceMeetingProvider: null,
      isTeamsMeetingAvailable: true,
      globalWarRoomsEnabled: true,
      serviceWarRoomsEnabled: true,
    });

    expect(result.isDisabled).toBe(true);
    expect(result.effectiveProvider).toBe('NONE');
  });
});
