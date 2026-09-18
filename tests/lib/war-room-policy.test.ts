import { describe, expect, it } from 'vitest';
import { evaluateWarRoomPolicy } from '@/lib/war-room/policy';

const base = {
  incident: { urgency: 'HIGH' as const, priority: 'P1', visibility: 'PUBLIC' as const },
  service: { autoCreate: true },
  destination: {
    enabled: true,
    warRoomEnabled: true,
    autoCreate: true,
    membershipType: 'STANDARD' as const,
  },
  config: {
    enabled: true,
    warRoomsEnabled: true,
    autoCreateOnUrgency: ['HIGH'],
    autoCreateOnPriority: ['P1'],
    defaultMembershipType: 'STANDARD' as const,
  },
  manual: false,
};

describe('Teams war-room policy', () => {
  it('allows an eligible automatic room', () =>
    expect(evaluateWarRoomPolicy(base)).toEqual({
      allowed: true,
      membershipType: 'STANDARD',
      reason: 'THRESHOLD',
    }));
  it('lets an authorized manual request bypass only threshold and auto-create gates', () =>
    expect(
      evaluateWarRoomPolicy({
        ...base,
        manual: true,
        service: { autoCreate: false },
        destination: { ...base.destination, autoCreate: false },
      })
    ).toEqual({ allowed: true, membershipType: 'STANDARD', reason: 'MANUAL' }));
  it('fails closed when the destination is disabled', () =>
    expect(
      evaluateWarRoomPolicy({ ...base, destination: { ...base.destination, enabled: false } })
    ).toEqual({ allowed: false, code: 'DESTINATION_UNAVAILABLE' }));
  it('requires private membership for private incidents', () =>
    expect(
      evaluateWarRoomPolicy({
        ...base,
        incident: { ...base.incident, visibility: 'PRIVATE' },
        destination: { ...base.destination, membershipType: 'STANDARD' },
      })
    ).toEqual({ allowed: true, membershipType: 'PRIVATE', reason: 'THRESHOLD' }));
  it('strictly enforces private room for manual requests on private incidents even when destination requests STANDARD', () => {
    const decision = evaluateWarRoomPolicy({
      ...base,
      manual: true,
      incident: { ...base.incident, visibility: 'PRIVATE' },
      destination: { ...base.destination, membershipType: 'STANDARD' },
    });
    expect(decision).toEqual({ allowed: true, membershipType: 'PRIVATE', reason: 'MANUAL' });
    if (decision.allowed) {
      expect(decision.membershipType).not.toBe('STANDARD');
    }
  });
  it('does not bypass global enablement for manual requests', () =>
    expect(
      evaluateWarRoomPolicy({
        ...base,
        manual: true,
        config: { ...base.config, warRoomsEnabled: false },
      })
    ).toEqual({ allowed: false, code: 'WAR_ROOMS_DISABLED' }));
});
