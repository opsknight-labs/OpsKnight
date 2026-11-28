import { describe, expect, it } from 'vitest';
import { buildInsight } from '@/components/dashboard/live/LiveCommandStrip';
import type { LiveSummary } from '@/lib/dashboard/live-incidents-shared';

const quiet = {
  active: 1,
  critical: 0,
  slaAtRisk: 0,
  slaBreached: 0,
  unassigned: 0,
} as LiveSummary;

describe('buildInsight', () => {
  it('never says everything is within SLA while an active incident has breached', () => {
    const insight = buildInsight({ ...quiet, slaBreached: 1 });
    expect(insight.text).toBe('1 active incident has breached SLA');
    expect(insight.tone).toBe('rose');
    expect(buildInsight({ ...quiet, slaBreached: 3 }).text).toBe(
      '3 active incidents have breached SLA'
    );
  });

  it('keeps the all-owned message when nothing is breached', () => {
    expect(buildInsight(quiet).text).toBe('1 active, all owned and within SLA');
  });
});
