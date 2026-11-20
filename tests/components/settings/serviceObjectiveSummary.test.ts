import { describe, expect, it } from 'vitest';
import { summarizeObjective } from '@/components/settings/serviceObjectiveSummary';

const snap = (value: number | null, breached: boolean | null, dataState = 'AVAILABLE') => ({
  value,
  breached,
  dataState,
  periodEnd: new Date(),
});
const uptime = { metricType: 'UPTIME', target: 99.9, comparator: 'GREATER_THAN_OR_EQUAL' };

describe('summarizeObjective', () => {
  it('derives error budget and health for percent targets', () => {
    expect(
      summarizeObjective({ ...uptime, snapshot: snap(99.95, false), canReadHistory: true })
    ).toMatchObject({ health: 'MEETING', budgetRemaining: expect.closeTo(0.5, 5) });
    expect(
      summarizeObjective({ ...uptime, snapshot: snap(99.91, false), canReadHistory: true }).health
    ).toBe('AT_RISK');
    expect(
      summarizeObjective({ ...uptime, snapshot: snap(99, true), canReadHistory: true })
    ).toMatchObject({ health: 'BREACHED', budgetRemaining: 0 });
  });
  it('never treats missing measurements as compliance', () => {
    expect(
      summarizeObjective({ ...uptime, snapshot: snap(null, null, 'NO_DATA'), canReadHistory: true })
    ).toMatchObject({ health: 'NO_DATA', value: null, budgetRemaining: null });
    expect(summarizeObjective({ ...uptime, snapshot: null, canReadHistory: true }).health).toBe(
      'NOT_MEASURED'
    );
    expect(summarizeObjective({ ...uptime, snapshot: null, canReadHistory: false }).health).toBe(
      'RESTRICTED'
    );
  });
  it('has no error budget for minute targets or legacy metrics', () => {
    expect(
      summarizeObjective({
        metricType: 'MTTA',
        target: 15,
        comparator: 'LESS_THAN_OR_EQUAL',
        snapshot: snap(9, false),
        canReadHistory: true,
      })
    ).toMatchObject({ health: 'MEETING', value: 9, budgetRemaining: null });
    expect(
      summarizeObjective({
        metricType: 'LATENCY_P99',
        target: 250,
        comparator: 'LESS_THAN_OR_EQUAL',
        snapshot: null,
        canReadHistory: true,
      }).health
    ).toBe('LEGACY');
  });
});
