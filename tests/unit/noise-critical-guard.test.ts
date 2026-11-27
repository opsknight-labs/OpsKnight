import { describe, expect, it } from 'vitest';
import { compilePolicy } from '@/lib/intelligence/noise-controls/cache';
import {
  decideStatic,
  type CompiledWindow,
  type PrePagingSnapshot,
} from '@/lib/intelligence/noise-controls/evaluate';
import type { PrePagingInput } from '@/lib/intelligence/noise-controls/contract';

/**
 * The guard keeps a critical or HIGH-urgency alert paging. An earlier orchestration rule that lowers the
 * alert's urgency or severity must not strip that protection from the DROP, SUPPRESS, window or rule behind it.
 */
const NOW = new Date('2026-06-01T12:00:00Z');
const matchPrometheus = [{ field: 'source', op: 'equals', value: 'prometheus' }];

function policyWith(rules: unknown[]) {
  return compilePolicy({
    scopeKey: 'global',
    serviceId: null,
    mode: 'ON',
    revision: 1,
    definition: { schemaVersion: 1, orchestration: { rules } },
  });
}
const window: CompiledWindow = {
  id: 'w1',
  name: 'Patching',
  scope: 'ALL',
  serviceId: null,
  teamId: null,
  labelKey: null,
  labelValue: null,
  startsAt: new Date(NOW.getTime() - 3_600_000),
  endsAt: new Date(NOW.getTime() + 3_600_000),
  recurrence: null,
  effect: 'SUPPRESS',
  downgradeUrgency: null,
  coversCritical: false,
  endedAt: null,
};
const snapshotOf = (
  policy: ReturnType<typeof policyWith>,
  withWindow = false
): PrePagingSnapshot => ({
  loadedAt: NOW.getTime(),
  policies: new Map([['global', policy]]),
  windows: withWindow ? [window] : [],
  rules: [],
  serviceTeams: new Map(),
  topology: new Map(),
});
const input = (overrides: Partial<PrePagingInput>): PrePagingInput => ({
  serviceId: 'svc-1',
  source: 'prometheus',
  summary: 'Primary database down',
  severity: 'warning',
  urgency: 'MEDIUM',
  labels: {},
  resourceKey: null,
  fingerprintHash: null,
  dedupKey: 'db',
  receivedAt: NOW,
  ...overrides,
});
const lowerThenDrop = policyWith([
  {
    id: 'lower',
    name: 'Lower',
    conditions: matchPrometheus,
    actions: [
      { type: 'SET_URGENCY', value: 'LOW' },
      { type: 'SET_SEVERITY', value: 'info' },
      { type: 'DROP' },
    ],
  },
]);

describe('the critical guard remembers how the alert arrived', () => {
  it('does not drop a HIGH alert after a rule lowers its urgency and severity', () => {
    const stage = decideStatic(
      input({ urgency: 'HIGH' }),
      lowerThenDrop,
      snapshotOf(lowerThenDrop),
      NOW
    );
    expect(stage.decision).toBeNull();
    expect(stage.guarded.map(item => item.control)).toContain('ORCHESTRATION');
  });

  it('does not drop a critical-severity alert after a rule lowers its severity', () => {
    const stage = decideStatic(
      input({ severity: 'critical' }),
      lowerThenDrop,
      snapshotOf(lowerThenDrop),
      NOW
    );
    expect(stage.decision).toBeNull();
  });

  it('does not let a window suppress it after the same rule lowered it', () => {
    const lowerOnly = policyWith([
      {
        id: 'lower',
        name: 'Lower',
        conditions: matchPrometheus,
        actions: [
          { type: 'SET_URGENCY', value: 'LOW' },
          { type: 'SET_SEVERITY', value: 'info' },
        ],
      },
    ]);
    const stage = decideStatic(
      input({ urgency: 'HIGH' }),
      lowerOnly,
      snapshotOf(lowerOnly, true),
      NOW
    );
    expect(stage.decision).toBeNull();
    expect(stage.guarded.map(item => item.control)).toContain('MAINTENANCE');
  });

  it('still drops an alert that was never critical', () => {
    const stage = decideStatic(input({}), lowerThenDrop, snapshotOf(lowerThenDrop), NOW);
    expect(stage.decision?.action).toBe('DROP');
  });
});
