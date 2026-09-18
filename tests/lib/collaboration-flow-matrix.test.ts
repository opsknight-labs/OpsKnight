import { describe, it, expect } from 'vitest';
import {
  resolveIncidentCollaborationPolicy,
  shouldAutoCreateCollaboration,
  resolveEffectiveWarRoomProviders,
  resolveEffectiveMeetingProvider,
} from '@/lib/incident-collaboration/policy';
import type { GlobalWarRoomPolicy, ServiceWarRoomPolicy } from '@/lib/incident-collaboration/types';
import { evaluateWarRoomPolicy } from '@/lib/war-room/policy';

describe('Collaboration Flow Matrix (Global → Service → Incident)', () => {
  const baseGlobalPolicy: GlobalWarRoomPolicy = {
    enabled: true,
    defaultProviders: ['SLACK', 'MICROSOFT_TEAMS'],
    defaultMeetingProvider: 'MICROSOFT_TEAMS',
    autoCreateOnUrgency: ['HIGH'],
    autoCreateOnPriority: ['P1', 'P2'],
    archiveOnResolve: true,
  };

  describe('1. Global Provider Inheritance Matrix', () => {
    it('INHERIT: service inherits global default providers (Both Slack & Teams)', () => {
      const res = resolveEffectiveWarRoomProviders({
        globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        serviceProviders: null, // INHERIT
        availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: true,
      });
      expect(res.isInherited).toBe(true);
      expect(res.effectiveProviders).toEqual(['SLACK', 'MICROSOFT_TEAMS']);
      expect(res.isDisabled).toBe(false);
    });

    it('EXPLICIT SLACK: service selects only Slack', () => {
      const res = resolveEffectiveWarRoomProviders({
        globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        serviceProviders: ['SLACK'],
        availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: true,
      });
      expect(res.isInherited).toBe(false);
      expect(res.effectiveProviders).toEqual(['SLACK']);
      expect(res.desiredProviders).toEqual(['SLACK']);
    });

    it('EXPLICIT TEAMS: service selects only Teams', () => {
      const res = resolveEffectiveWarRoomProviders({
        globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        serviceProviders: ['MICROSOFT_TEAMS'],
        availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: true,
      });
      expect(res.isInherited).toBe(false);
      expect(res.effectiveProviders).toEqual(['MICROSOFT_TEAMS']);
    });

    it('EXPLICIT BOTH: service explicitly requests both', () => {
      const res = resolveEffectiveWarRoomProviders({
        globalProviders: ['SLACK'],
        serviceProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: true,
      });
      expect(res.effectiveProviders).toEqual(['SLACK', 'MICROSOFT_TEAMS']);
    });

    it('DISABLED: service explicitly disables collaboration', () => {
      const res = resolveEffectiveWarRoomProviders({
        globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        serviceProviders: [],
        availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: false,
      });
      expect(res.isDisabled).toBe(true);
      expect(res.effectiveProviders).toEqual([]);
    });

    it('GLOBAL DISABLED: if global ChatOps is disabled, all services are disabled', () => {
      const res = resolveEffectiveWarRoomProviders({
        globalProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        serviceProviders: ['MICROSOFT_TEAMS'],
        availableProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        globalWarRoomsEnabled: false,
        serviceWarRoomsEnabled: true,
      });
      expect(res.isDisabled).toBe(true);
      expect(res.effectiveProviders).toEqual([]);
    });
  });

  describe('2. Unified Auto-Create & Threshold Matrix', () => {
    it('service autoCreate OFF → collaboration is not auto-created even on HIGH/P1', () => {
      const autoCreate = shouldAutoCreateCollaboration({
        serviceAutoCreate: false,
        incidentUrgency: 'HIGH',
        incidentPriority: 'P1',
        autoCreateOnUrgency: ['HIGH'],
        autoCreateOnPriority: ['P1', 'P2'],
      });
      expect(autoCreate).toBe(false);
    });

    it('service autoCreate ON + HIGH urgency → auto-creates collaboration', () => {
      const autoCreate = shouldAutoCreateCollaboration({
        serviceAutoCreate: true,
        incidentUrgency: 'HIGH',
        incidentPriority: 'P3',
        autoCreateOnUrgency: ['HIGH'],
        autoCreateOnPriority: ['P1', 'P2'],
      });
      expect(autoCreate).toBe(true);
    });

    it('service autoCreate ON + LOW urgency + P2 priority → auto-creates collaboration via priority threshold', () => {
      const autoCreate = shouldAutoCreateCollaboration({
        serviceAutoCreate: true,
        incidentUrgency: 'LOW',
        incidentPriority: 'P2',
        autoCreateOnUrgency: ['HIGH'],
        autoCreateOnPriority: ['P1', 'P2'],
      });
      expect(autoCreate).toBe(true);
    });

    it('service autoCreate ON + LOW urgency + P4 priority (no match) → does NOT auto-create', () => {
      const autoCreate = shouldAutoCreateCollaboration({
        serviceAutoCreate: true,
        incidentUrgency: 'LOW',
        incidentPriority: 'P4',
        autoCreateOnUrgency: ['HIGH'],
        autoCreateOnPriority: ['P1', 'P2'],
      });
      expect(autoCreate).toBe(false);
    });
  });

  describe('3. Private Incident Security Invariants', () => {
    it('PRIVATE incident strictly requires PRIVATE room in evaluateWarRoomPolicy', () => {
      const decision = evaluateWarRoomPolicy({
        incident: { urgency: 'HIGH', priority: 'P1', visibility: 'PRIVATE' },
        service: { autoCreate: true },
        destination: {
          enabled: true,
          warRoomEnabled: true,
          autoCreate: true,
          membershipType: 'STANDARD',
        },
        config: {
          enabled: true,
          warRoomsEnabled: true,
          autoCreateOnUrgency: ['HIGH'],
          autoCreateOnPriority: ['P1'],
          defaultMembershipType: 'STANDARD',
        },
        manual: false,
      });

      expect(decision.allowed).toBe(true);
      if (decision.allowed) {
        expect(decision.membershipType).toBe('PRIVATE');
      }
    });

    it('PRIVATE incident ignores operator manual request for STANDARD and strictly enforces PRIVATE', () => {
      const decision = evaluateWarRoomPolicy({
        incident: { urgency: 'LOW', priority: 'P4', visibility: 'PRIVATE' },
        service: { autoCreate: false },
        destination: {
          enabled: true,
          warRoomEnabled: true,
          autoCreate: false,
          membershipType: 'STANDARD',
        },
        config: {
          enabled: true,
          warRoomsEnabled: true,
          autoCreateOnUrgency: ['HIGH'],
          autoCreateOnPriority: ['P1'],
          defaultMembershipType: 'STANDARD',
        },
        manual: true,
      });

      expect(decision.allowed).toBe(true);
      if (decision.allowed) {
        expect(decision.membershipType).toBe('PRIVATE');
      }
    });

    it('PUBLIC incident honors standard membership configuration', () => {
      const decision = evaluateWarRoomPolicy({
        incident: { urgency: 'HIGH', priority: 'P1', visibility: 'PUBLIC' },
        service: { autoCreate: true },
        destination: {
          enabled: true,
          warRoomEnabled: true,
          autoCreate: true,
          membershipType: 'STANDARD',
        },
        config: {
          enabled: true,
          warRoomsEnabled: true,
          autoCreateOnUrgency: ['HIGH'],
          autoCreateOnPriority: ['P1'],
          defaultMembershipType: 'STANDARD',
        },
        manual: false,
      });

      expect(decision.allowed).toBe(true);
      if (decision.allowed) {
        expect(decision.membershipType).toBe('STANDARD');
      }
    });
  });

  describe('4. Destination Capabilities & Readiness Matrix', () => {
    it('destination with warRoomEnabled: false rejects room evaluation with DESTINATION_UNAVAILABLE', () => {
      const decision = evaluateWarRoomPolicy({
        incident: { urgency: 'HIGH', priority: 'P1', visibility: 'PUBLIC' },
        service: { autoCreate: true },
        destination: {
          enabled: true,
          warRoomEnabled: false,
          autoCreate: true,
          membershipType: 'STANDARD',
        },
        config: {
          enabled: true,
          warRoomsEnabled: true,
          autoCreateOnUrgency: ['HIGH'],
          autoCreateOnPriority: ['P1'],
          defaultMembershipType: 'STANDARD',
        },
        manual: false,
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe('DESTINATION_UNAVAILABLE');
      }
    });

    it('destination with enabled: false rejects room evaluation', () => {
      const decision = evaluateWarRoomPolicy({
        incident: { urgency: 'HIGH', priority: 'P1', visibility: 'PUBLIC' },
        service: { autoCreate: true },
        destination: {
          enabled: false,
          warRoomEnabled: true,
          autoCreate: true,
          membershipType: 'STANDARD',
        },
        config: {
          enabled: true,
          warRoomsEnabled: true,
          autoCreateOnUrgency: ['HIGH'],
          autoCreateOnPriority: ['P1'],
          defaultMembershipType: 'STANDARD',
        },
        manual: false,
      });

      expect(decision.allowed).toBe(false);
      if (!decision.allowed) {
        expect(decision.code).toBe('DESTINATION_UNAVAILABLE');
      }
    });
  });

  describe('5. Lifecycle & Resolution Persistence Matrix', () => {
    it('archiveOnResolve: true indicates Auto-Close on resolution', () => {
      const resolution = resolveIncidentCollaborationPolicy({
        incident: { urgency: 'HIGH', priority: 'P1', visibility: 'PUBLIC' },
        globalPolicy: { ...baseGlobalPolicy, archiveOnResolve: true },
        servicePolicy: {
          warRoomsEnabled: true,
          autoCreate: true,
          serviceProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        },
        availableIntegrations: ['SLACK', 'MICROSOFT_TEAMS'],
        isTeamsMeetingAvailable: true,
      });

      expect(resolution.archiveOnResolve).toBe(true);
    });

    it('archiveOnResolve: false indicates Persistent collaboration on resolution', () => {
      const resolution = resolveIncidentCollaborationPolicy({
        incident: { urgency: 'HIGH', priority: 'P1', visibility: 'PUBLIC' },
        globalPolicy: { ...baseGlobalPolicy, archiveOnResolve: false },
        servicePolicy: {
          warRoomsEnabled: true,
          autoCreate: true,
          serviceProviders: ['SLACK', 'MICROSOFT_TEAMS'],
        },
        availableIntegrations: ['SLACK', 'MICROSOFT_TEAMS'],
        isTeamsMeetingAvailable: true,
      });

      expect(resolution.archiveOnResolve).toBe(false);
    });
  });

  describe('6. Meeting Readiness & Inheritance Matrix', () => {
    it('MICROSOFT_TEAMS meeting inherits global default when service is null', () => {
      const res = resolveEffectiveMeetingProvider({
        globalMeetingProvider: 'MICROSOFT_TEAMS',
        serviceMeetingProvider: null,
        isTeamsMeetingAvailable: true,
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: true,
      });
      expect(res.isInherited).toBe(true);
      expect(res.effectiveProvider).toBe('MICROSOFT_TEAMS');
      expect(res.isUnavailable).toBe(false);
    });

    it('MICROSOFT_TEAMS reports isUnavailable when Teams integration lacks graph/connectivity', () => {
      const res = resolveEffectiveMeetingProvider({
        globalMeetingProvider: 'MICROSOFT_TEAMS',
        serviceMeetingProvider: null,
        isTeamsMeetingAvailable: false,
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: true,
      });
      expect(res.effectiveProvider).toBe('NONE');
      expect(res.isUnavailable).toBe(true);
      expect(res.unavailableReason).toContain('Microsoft Teams online meetings are not configured');
    });

    it('service override NONE disables meeting without error', () => {
      const res = resolveEffectiveMeetingProvider({
        globalMeetingProvider: 'MICROSOFT_TEAMS',
        serviceMeetingProvider: 'NONE',
        isTeamsMeetingAvailable: true,
        globalWarRoomsEnabled: true,
        serviceWarRoomsEnabled: true,
      });
      expect(res.effectiveProvider).toBe('NONE');
      expect(res.isDisabled).toBe(true);
      expect(res.isUnavailable).toBe(false);
    });
  });
});
