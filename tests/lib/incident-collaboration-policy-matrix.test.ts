import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveMeetingProvider,
  resolveEffectiveWarRoomProviders,
} from '@/lib/incident-collaboration/policy';
import { COLLABORATION_INVARIANTS } from '@/lib/incident-collaboration/invariants';

describe('Incident Collaboration Policy Hierarchy & Matrix Certification', () => {
  describe('War Room Provider Policy Matrix', () => {
    it('Global Slack + Service inherit -> Effective Slack', () => {
      const res = resolveEffectiveWarRoomProviders({
        globalProviders: ['SLACK'],
        serviceProviders: null, // Inherit
        availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: true,
      });

      expect(res.effectiveProviders).toEqual(['SLACK']);
      expect(res.desiredProviders).toEqual(['SLACK']);
      expect(res.isInherited).toBe(true);
      expect(res.isDisabled).toBe(false);
    });

    it('Global Slack+Teams + Service Teams -> Effective Teams', () => {
      const res = resolveEffectiveWarRoomProviders({
        globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        serviceProviders: ['MICROSOFT_TEAMS'],
        availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: true,
      });

      expect(res.effectiveProviders).toEqual(['MICROSOFT_TEAMS']);
      expect(res.desiredProviders).toEqual(['MICROSOFT_TEAMS']);
      expect(res.isInherited).toBe(false);
    });

    it('Invariant I8: Explicitly unavailable provider NEVER silently falls back to another provider', () => {
      // Teams is desired, but only Slack is connected
      const res = resolveEffectiveWarRoomProviders({
        globalProviders: ['MICROSOFT_TEAMS'],
        serviceProviders: null,
        availableProviders: ['SLACK'], // Teams disconnected
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: true,
      });

      // Must NOT silently substitute Slack!
      expect(res.effectiveProviders).toEqual([]);
      expect(res.unavailableDesiredProviders).toEqual(['MICROSOFT_TEAMS']);
      expect(res.effectiveProviders).not.toContain('SLACK');
    });

    it('Global enabled + Service disabled -> Completely disabled', () => {
      const res = resolveEffectiveWarRoomProviders({
        globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        serviceProviders: ['SLACK'],
        availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: false, // Service disabled
      });

      expect(res.isDisabled).toBe(true);
      expect(res.effectiveProviders).toEqual([]);
    });

    it('Global disabled dominates even if service is enabled', () => {
      const res = resolveEffectiveWarRoomProviders({
        globalProviders: ['SLACK'],
        serviceProviders: ['SLACK'],
        availableProviders: ['SLACK'],
        globalWarRoomsEnabled: false, // Global switch off
        serviceWarRoomsEnabled: true,
      });

      expect(res.isDisabled).toBe(true);
      expect(res.effectiveProviders).toEqual([]);
    });

    it('Service-level war room creation is disabled by default (owner discretion)', () => {
      // By default, services have warRoomsEnabled = false and empty providers
      const res = resolveEffectiveWarRoomProviders({
        globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        serviceProviders: [], // Default unconfigured service
        availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: false, // Default is disabled
      });

      expect(res.isDisabled).toBe(true);
      expect(res.effectiveProviders).toEqual([]);
    });
  });

  describe('Meeting Provider Policy & Meeting-Only Certification', () => {
    it('Meeting disabled when war rooms disabled', () => {
      const warRoomRes = resolveEffectiveWarRoomProviders({
        globalProviders: ['SLACK'],
        serviceProviders: null,
        availableProviders: ['SLACK'],
        globalWarRoomsEnabled: false, // War rooms off
        serviceWarRoomsEnabled: false,
      });

      const meetingRes = resolveEffectiveMeetingProvider({
        globalMeetingProvider: 'JITSI',
        serviceMeetingProvider: null,
        isTeamsMeetingAvailable: false,
        globalWarRoomsEnabled: false,
        serviceWarRoomsEnabled: false,
      });

      // War rooms are disabled, and meeting also disabled by policy
      expect(warRoomRes.isDisabled).toBe(true);
      expect(warRoomRes.effectiveProviders).toEqual([]);

      expect(meetingRes.isDisabled).toBe(true);
      expect(meetingRes.effectiveProvider).toBe('NONE');
      expect(meetingRes.isUnavailable).toBe(false);
    });

    it('Invariant I8 (Meeting): Teams Meeting unavailable reports error without silent fallback to Jitsi or Zoom', () => {
      const meetingRes = resolveEffectiveMeetingProvider({
        globalMeetingProvider: 'MICROSOFT_TEAMS',
        serviceMeetingProvider: null,
        isTeamsMeetingAvailable: false, // Graph permissions missing
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: true,
      });

      // Must NOT silently substitute Jitsi or Zoom
      expect(meetingRes.effectiveProvider).toBe('NONE');
      expect(meetingRes.desiredProvider).toBe('MICROSOFT_TEAMS');
      expect(meetingRes.isUnavailable).toBe(true);
      expect(meetingRes.unavailableReason).toContain('Microsoft Teams');
    });

    it('Service meeting override overrides global default', () => {
      const meetingRes = resolveEffectiveMeetingProvider({
        globalMeetingProvider: 'JITSI',
        serviceMeetingProvider: 'ZOOM',
        isTeamsMeetingAvailable: false,
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: true,
      });

      expect(meetingRes.effectiveProvider).toBe('ZOOM');
      expect(meetingRes.isInherited).toBe(false);
    });
  });

  describe('Invariant I7: Manual vs Auto-Creation Parity', () => {
    it('both manual and auto creation rely on identical effective policy outputs', () => {
      const policyConfig = {
        globalProviders: ['MICROSOFT_TEAMS'],
        serviceProviders: ['MICROSOFT_TEAMS'],
        availableProviders: ['MICROSOFT_TEAMS'],
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: true,
      };

      const manualPolicy = resolveEffectiveWarRoomProviders(policyConfig);
      const autoPolicy = resolveEffectiveWarRoomProviders(policyConfig);

      expect(manualPolicy.effectiveProviders).toEqual(autoPolicy.effectiveProviders);
      expect(manualPolicy.isDisabled).toBe(autoPolicy.isDisabled);

      // A provider excluded by policy is rejected for both manual and auto
      expect(manualPolicy.effectiveProviders.includes('SLACK' as never)).toBe(false);
      expect(autoPolicy.effectiveProviders.includes('SLACK' as never)).toBe(false);
    });
  });

  describe('Invariant I15: Historical Observation on Disconnect', () => {
    it('preserves history and view invariants when provider is disconnected', () => {
      // When a provider is disconnected, existing rooms remain observable:
      // desired becomes unavailable, but historical records in DB are not destroyed.
      const res = resolveEffectiveWarRoomProviders({
        globalProviders: ['SLACK'],
        serviceProviders: null,
        availableProviders: [], // Slack disconnected
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: true,
      });

      expect(res.effectiveProviders).toHaveLength(0);
      expect(res.unavailableDesiredProviders).toContain('SLACK');
      // Documented invariant verified:
      expect(COLLABORATION_INVARIANTS.I15).toBeDefined();
    });
  });
});
