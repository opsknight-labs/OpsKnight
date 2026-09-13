import { describe, expect, it } from 'vitest';
import { warRoomChannelName, warRoomMarker } from '@/lib/microsoft-teams/graph/channels';

describe('Teams war-room channel identity', () => {
  it('uses a deterministic, bounded, generation-aware name', () => {
    const one = warRoomChannelName('incident-abcdefgh', 1, 'Payments API outage');
    const two = warRoomChannelName('incident-abcdefgh', 2, 'Payments API outage');
    expect(one).toBe('inc-abcdefgh-g1-payments-api-outage');
    expect(two).toBe('inc-abcdefgh-g2-payments-api-outage');
    expect(one).not.toBe(two);
    expect(warRoomChannelName('incident-abcdefgh', 12, 'x'.repeat(200))).toHaveLength(50);
  });

  it('uses the incident and generation marker rather than a mutable title', () => {
    expect(warRoomMarker('incident-abcdefgh', 2)).toBe('[OKWR:incident-abcdefgh:g2]');
    expect(warRoomMarker('incident-abcdefgh', 10)).not.toContain(warRoomMarker('incident-abcdefgh', 1));
  });
});
