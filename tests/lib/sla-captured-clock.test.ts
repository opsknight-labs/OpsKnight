import { describe, expect, it } from 'vitest';
import { capturedOrEffectiveElapsedMs } from '@/lib/metrics/domain/sla-clock';

describe('captured SLA lifecycle clock', () => {
  it('does not subtract pauses which occurred after ACK', () => {
    expect(capturedOrEffectiveElapsedMs({
      capturedElapsedMs: BigInt(10 * 60_000),
      startedAt: new Date('2026-09-06T10:00:00Z'),
      evaluationAt: new Date('2026-09-06T10:10:00Z'),
      pauses: [{ startedAt: new Date('2026-09-06T10:20:00Z'), endedAt: new Date('2026-09-06T10:40:00Z') }],
    })).toBe(10 * 60_000);
  });

  it('uses pause-union fallback for pre-migration rows', () => {
    expect(capturedOrEffectiveElapsedMs({
      capturedElapsedMs: null,
      startedAt: new Date('2026-09-06T10:00:00Z'),
      evaluationAt: new Date('2026-09-06T11:00:00Z'),
      pauses: [
        { startedAt: new Date('2026-09-06T10:10:00Z'), endedAt: new Date('2026-09-06T10:30:00Z') },
        { startedAt: new Date('2026-09-06T10:20:00Z'), endedAt: new Date('2026-09-06T10:40:00Z') },
      ],
    })).toBe(30 * 60_000);
  });
});
