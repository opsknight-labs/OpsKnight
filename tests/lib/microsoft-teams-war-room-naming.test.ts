import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import {
  readableWarRoomChannelDescription,
  readableWarRoomChannelName,
  teamsChannelCapacityLevel,
} from '@/lib/war-room/providers/microsoft-teams/provision';
import { warRoomMarker } from '@/lib/microsoft-teams/graph/channels';

describe('Teams war-room channel naming', () => {
  it('is readable, unique per incident/generation and within the 50-character limit', () => {
    const name = readableWarRoomChannelName({
      incidentId: 'cmabcdef1234567890',
      generation: 1,
      title: 'Payments: checkout <fails> for "EU" users / 50% of traffic',
      priority: 'P1',
    });
    expect(name.length).toBeLessThanOrEqual(50);
    expect(name.startsWith('P1 Payments checkout fails for EU')).toBe(true);
    expect(name).toContain('…');
    expect(name.endsWith(' · 34567890')).toBe(true);
    expect(name).not.toMatch(/[~#%&*{}+/\\:<>?|'"]/);
    expect(
      readableWarRoomChannelName({ incidentId: 'cmabcdef1234567890', generation: 3, title: 'x' })
    ).toBe('x · 34567890 r3');
  });

  it('keeps the reconciliation marker in the description, matched by substring', () => {
    const marker = warRoomMarker('inc-1', 2);
    const description = readableWarRoomChannelDescription({
      title: 'y'.repeat(2000),
      serviceName: 'payments-api',
      marker,
    });
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description.includes(marker)).toBe(true);
    expect(description.includes(warRoomMarker('inc-1', 20))).toBe(false);
  });

  it('warns near and refuses at the Teams channel cap', () => {
    expect(teamsChannelCapacityLevel(120)).toBe('OK');
    expect(teamsChannelCapacityLevel(900)).toBe('NEAR');
    expect(teamsChannelCapacityLevel(990)).toBe('FULL');
  });
});
