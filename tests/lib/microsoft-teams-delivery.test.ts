import { describe, it, expect } from 'vitest';
import {
  microsoftTeamsDeliveryLockKey,
  teamsDeliveryIdempotencyKey,
} from '@/lib/microsoft-teams/delivery';

describe('teamsDeliveryIdempotencyKey', () => {
  const base = {
    incidentId: 'inc_123',
    destinationId: 'dest_456',
    incidentUpdatedAt: new Date('2026-09-12T10:00:00.000Z'),
  } as const;

  it('is deterministic for the same incidentVersion', () => {
    const a = teamsDeliveryIdempotencyKey({ ...base, eventType: 'triggered', escalationGeneration: 0 });
    const b = teamsDeliveryIdempotencyKey({ ...base, eventType: 'triggered', escalationGeneration: 0 });
    expect(a).toBe(b);
    expect(a).toBe('teams:delivery:inc_123:dest_456:triggered:2026-09-12T10:00:00.000Z:g0');
  });

  it('encodes escalationGeneration only for triggered', () => {
    const gen0 = teamsDeliveryIdempotencyKey({ ...base, eventType: 'triggered', escalationGeneration: 0 });
    const gen1 = teamsDeliveryIdempotencyKey({ ...base, eventType: 'triggered', escalationGeneration: 1 });
    expect(gen0).not.toBe(gen1);
    expect(gen1).toContain(':g1');

    const ack0 = teamsDeliveryIdempotencyKey({ ...base, eventType: 'acknowledged' });
    const ack1 = teamsDeliveryIdempotencyKey({ ...base, eventType: 'acknowledged', escalationGeneration: 5 });
    // ack/resolved must not include generation — same incidentVersion must not fork
    expect(ack0).toBe(ack1);
    expect(ack0).not.toContain(':g');

    const resolved = teamsDeliveryIdempotencyKey({ ...base, eventType: 'resolved', escalationGeneration: 9 });
    expect(resolved).not.toContain(':g');
  });

  it('changes when incidentUpdatedAt changes (incidentVersion fence)', () => {
    const a = teamsDeliveryIdempotencyKey({ ...base, eventType: 'acknowledged', incidentUpdatedAt: new Date('2026-09-12T10:00:00.000Z') });
    const b = teamsDeliveryIdempotencyKey({ ...base, eventType: 'acknowledged', incidentUpdatedAt: new Date('2026-09-12T10:00:01.000Z') });
    expect(a).not.toBe(b);
  });

  it('scopes by destination — different services produce different keys', () => {
    const a = teamsDeliveryIdempotencyKey({ ...base, destinationId: 'dest_A', eventType: 'triggered' });
    const b = teamsDeliveryIdempotencyKey({ ...base, destinationId: 'dest_B', eventType: 'triggered' });
    expect(a).not.toBe(b);
  });

  it('scopes by eventType', () => {
    const t = teamsDeliveryIdempotencyKey({ ...base, eventType: 'triggered' });
    const ack = teamsDeliveryIdempotencyKey({ ...base, eventType: 'acknowledged' });
    const res = teamsDeliveryIdempotencyKey({ ...base, eventType: 'resolved' });
    expect(new Set([t, ack, res]).size).toBe(3);
  });

  it('defaults missing escalationGeneration to 0 for triggered', () => {
    const a = teamsDeliveryIdempotencyKey({ ...base, eventType: 'triggered' });
    const b = teamsDeliveryIdempotencyKey({ ...base, eventType: 'triggered', escalationGeneration: 0 });
    expect(a).toBe(b);
  });
});

describe('microsoftTeamsDeliveryLockKey', () => {
  it('is deterministic for the same incident+destination', () => {
    const a = microsoftTeamsDeliveryLockKey('inc_123', 'dest_456');
    const b = microsoftTeamsDeliveryLockKey('inc_123', 'dest_456');
    expect(a).toBe(b);
    expect(typeof a).toBe('bigint');
  });

  it('differs for different incident or destination', () => {
    const a = microsoftTeamsDeliveryLockKey('inc_123', 'dest_456');
    const b = microsoftTeamsDeliveryLockKey('inc_123', 'dest_789');
    const c = microsoftTeamsDeliveryLockKey('inc_999', 'dest_456');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('is scoped to Teams namespace and not equal to other advisory keys', () => {
    // LOCK_KEYS.MICROSOFT_TEAMS_DELIVERY = 0x544d000000000000 namespace
    // Two replicas racing the same incidentVersion must contend on this key, not on a global key.
    const k = microsoftTeamsDeliveryLockKey('inc_A', 'dest_A');
    // Namespace high bits are 0x544d — lower 48 bits are hash-derived.
    const namespace = BigInt('0x544d000000000000');
    expect((k & BigInt('0xffff000000000000')) === (namespace & BigInt('0xffff000000000000'))).toBe(true);
  });

  it('treats id pair as ordered — incident/destination are not interchangeable', () => {
    const a = microsoftTeamsDeliveryLockKey('inc_A', 'dest_B');
    const b = microsoftTeamsDeliveryLockKey('dest_B', 'inc_A');
    expect(a).not.toBe(b);
  });
});
