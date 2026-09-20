import { describe, expect, it, vi } from 'vitest';
import { projectIncidentSlaState, type IncidentSlaProjectionInput } from '@/lib/incident-sla/state';

const minute = 60_000;
const origin = new Date('2026-01-01T00:00:00.000Z');
const at = (ms: number) => new Date(origin.getTime() + ms);
const input = (
  overrides: Partial<IncidentSlaProjectionInput> = {}
): IncidentSlaProjectionInput => ({
  status: 'OPEN',
  createdAt: origin,
  acknowledgedAt: null,
  resolvedAt: null,
  slaAckTargetMs: 10 * minute,
  slaResolveTargetMs: 60 * minute,
  slaTargetSource: 'priority',
  slaTargetCapturedAt: origin,
  slaPausedMs: BigInt(0),
  slaPauseStartedAt: null,
  slaAckElapsedMs: null,
  slaResolveElapsedMs: null,
  ...overrides,
});

function state(overrides: Partial<IncidentSlaProjectionInput> = {}, now = at(0)) {
  const result = projectIncidentSlaState(input(overrides), { now });
  expect(result.valid).toBe(true);
  if (!result.valid) throw new Error(result.reason);
  return result;
}

describe('projectIncidentSlaState', () => {
  it('projects only the original captured contract and optional provenance', () => {
    const result = state({ slaPolicyId: 'policy-1', slaPolicyVersion: 3, slaPolicyRule: 'P1' });
    expect(result.contract).toEqual({
      ackTargetMs: 10 * minute,
      resolveTargetMs: 60 * minute,
      source: 'priority',
      capturedAt: origin,
      policyId: 'policy-1',
      policyVersion: 3,
      policyRule: 'P1',
      priorityAtCapture: null,
    });
    expect(result.ack).toMatchObject({
      targetMs: 10 * minute,
      elapsedMs: 0,
      remainingMs: 10 * minute,
      progress: 0,
      status: 'PENDING',
      warning: 'NONE',
      completedAt: null,
      warningAt: at(7.5 * minute),
      breachAt: at(10 * minute + 1),
    });
    expect(result.clock).toEqual({
      evaluatedAt: origin,
      pausedMs: 0,
      pauseStartedAt: null,
      paused: false,
    });
  });

  it('measures both phases from creation rather than restarting resolution at ACK', () => {
    const result = state(
      { status: 'ACKNOWLEDGED', acknowledgedAt: at(8 * minute) },
      at(20 * minute)
    );
    expect(result.ack.elapsedMs).toBe(8 * minute);
    expect(result.resolve.elapsedMs).toBe(20 * minute);
    expect(result.ack.status).toBe('MET');
    expect(result.ack.warning).toBe('NONE');
    expect(result.ack.warningAt).toBeNull();
    expect(result.ack.breachAt).toBeNull();
    expect(result.resolve.status).toBe('PENDING');
  });

  it('prefers captured ACK duration over later materialized pauses', () => {
    const result = state(
      {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: at(12 * minute),
        slaAckElapsedMs: BigInt(12 * minute),
        slaPausedMs: BigInt(30 * minute),
      },
      at(50 * minute)
    );
    expect(result.ack.elapsedMs).toBe(12 * minute);
    expect(result.ack.status).toBe('BREACHED');
    expect(result.ack.warning).toBe('NONE');
    expect(result.resolve.elapsedMs).toBe(20 * minute);
  });

  it.each([0, BigInt(0), 5 * minute, BigInt(5 * minute)])(
    'uses captured resolution duration %s',
    captured => {
      const result = state(
        {
          status: 'RESOLVED',
          resolvedAt: at(90 * minute),
          slaResolveElapsedMs: captured,
        },
        at(120 * minute)
      );
      expect(result.resolve.elapsedMs).toBe(Number(captured));
      expect(result.resolve.status).toBe('MET');
      expect(result.resolve.completedAt).toEqual(at(90 * minute));
      expect(result.resolve.warning).toBe('NONE');
      expect(result.resolve.warningAt).toBeNull();
      expect(result.resolve.breachAt).toBeNull();
    }
  );

  it('classifies resolution without acknowledgement as an ACK breach', () => {
    const result = state(
      {
        status: 'RESOLVED',
        resolvedAt: at(70 * minute),
        slaAckElapsedMs: null,
      },
      at(80 * minute)
    );
    expect(result.ack).toMatchObject({
      status: 'BREACHED',
      elapsedMs: 70 * minute,
      remainingMs: -60 * minute,
      progress: 1,
      warning: 'NONE',
      completedAt: null,
      warningAt: null,
      breachAt: null,
    });
    expect(result.resolve.status).toBe('BREACHED');
    expect(result.resolve.elapsedMs).toBe(70 * minute);
    expect(result.resolve.warning).toBe('NONE');
  });

  it('marks timely source recovery as ACK not required', () => {
    const result = state({
      status: 'RESOLVED',
      resolvedAt: at(5 * minute),
      resolutionKind: 'SOURCE_RECOVERY',
      slaResolveElapsedMs: BigInt(5 * minute),
    });
    expect(result.ack).toMatchObject({
      applicability: 'NOT_REQUIRED',
      status: 'NOT_REQUIRED',
      reason: 'Source recovered before the acknowledgement deadline',
    });
  });

  it.each([
    ['SOURCE_RECOVERY', 11 * minute],
    ['MANUAL', 5 * minute],
    ['UNKNOWN', 5 * minute],
  ] as const)('keeps %s resolution at %dms in the ACK denominator', (resolutionKind, elapsed) => {
    expect(
      state({
        status: 'RESOLVED',
        resolvedAt: at(elapsed),
        resolutionKind,
        slaResolveElapsedMs: BigInt(elapsed),
      }).ack
    ).toMatchObject({ applicability: 'REQUIRED', status: 'BREACHED' });
  });

  it('falls back to canonical materialized elapsed at completion for legacy uncaptured durations', () => {
    const result = state(
      {
        status: 'RESOLVED',
        acknowledgedAt: at(15 * minute),
        resolvedAt: at(70 * minute),
        slaPausedMs: BigInt(5 * minute),
      },
      at(90 * minute)
    );
    expect(result.ack.elapsedMs).toBe(10 * minute);
    expect(result.resolve.elapsedMs).toBe(65 * minute);
  });

  it.each(['SNOOZED', 'SUPPRESSED'] as const)(
    'freezes canonical %s pause without notification warnings',
    status => {
      const paused = input({
        status,
        slaPausedMs: BigInt(2 * minute),
        slaPauseStartedAt: at(10 * minute),
      });
      const earlier = projectIncidentSlaState(paused, { now: at(20 * minute) });
      const later = projectIncidentSlaState(paused, { now: at(60 * minute) });
      expect(earlier.valid && later.valid).toBe(true);
      if (!earlier.valid || !later.valid) return;
      expect(earlier.ack).toEqual(later.ack);
      expect(later.ack.elapsedMs).toBe(8 * minute);
      expect(later.resolve.elapsedMs).toBe(8 * minute);
      expect(later.ack.warning).toBe('NONE');
      expect(later.ack.warningAt).toBeNull();
      expect(later.ack.breachAt).toBeNull();
      expect(later.clock).toMatchObject({
        pausedMs: 2 * minute,
        paused: true,
        pauseStartedAt: at(10 * minute),
      });
    }
  );

  it('retains a breached status while paused but suppresses actionable warnings', () => {
    const result = state({ slaPauseStartedAt: at(11 * minute) }, at(100 * minute));
    expect(result.clock.paused).toBe(true);
    expect(result.ack.status).toBe('BREACHED');
    expect(result.ack.warning).toBe('NONE');
    expect(result.ack.remainingMs).toBe(-minute);
  });

  it('resumes without double subtraction and shifts deadlines by closed pause time', () => {
    const paused = state({ status: 'SNOOZED', slaPauseStartedAt: at(5 * minute) }, at(25 * minute));
    const resumed = state({ slaPausedMs: BigInt(20 * minute) }, at(25 * minute));
    expect(resumed.ack.elapsedMs).toBe(paused.ack.elapsedMs);
    expect(resumed.ack.warningAt).toEqual(at(27.5 * minute));
    expect(resumed.ack.breachAt).toEqual(at(30 * minute + 1));
    expect(state({ slaPausedMs: 20 * minute }, at(30 * minute + 1)).ack.status).toBe('BREACHED');
  });

  it('reopening retains first-ACK truth and continues resolution from original creation', () => {
    const result = state(
      {
        status: 'OPEN',
        slaPausedMs: BigInt(20 * minute),
        slaAckElapsedMs: BigInt(5 * minute),
        slaFirstAcknowledgedAt: at(5 * minute),
        slaResolveElapsedMs: null,
      },
      at(90 * minute)
    );
    expect(result.contract.ackTargetMs).toBe(10 * minute);
    expect(result.contract.resolveTargetMs).toBe(60 * minute);
    expect(result.ack.elapsedMs).toBe(5 * minute);
    expect(result.resolve.elapsedMs).toBe(70 * minute);
    expect(result.ack.completedAt).toEqual(at(5 * minute));
    expect(result.resolve.completedAt).toBeNull();
    expect(result.resolve.status).toBe('BREACHED');
    expect(result.ack.status).toBe('MET');
    expect(result.ack.warning).toBe('NONE');
    expect(result.ack.warningAt).toBeNull();
    expect(result.ack.breachAt).toBeNull();
  });

  it('clamps before-creation evaluation and excessive pause budgets to zero', () => {
    expect(state({}, at(-minute)).ack.elapsedMs).toBe(0);
    expect(state({ slaPausedMs: BigInt(50 * minute) }, at(10 * minute)).ack.elapsedMs).toBe(0);
    expect(state({ slaPausedMs: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1) }).clock.pausedMs).toBe(
      Number.MAX_SAFE_INTEGER
    );
  });

  it('matches canonical bigint saturation for captured durations', () => {
    const result = state({
      status: 'ACKNOWLEDGED',
      acknowledgedAt: at(minute),
      slaAckElapsedMs: BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1),
    });
    expect(result.ack.elapsedMs).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.ack.progress).toBe(1);
    expect(Number.isFinite(result.ack.remainingMs)).toBe(true);
  });

  it('uses the default evaluation time only when no explicit now is supplied', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(at(minute));
      expect(projectIncidentSlaState(input()).clock.evaluatedAt).toEqual(at(minute));
      expect(projectIncidentSlaState(input(), { now: at(0) }).clock.evaluatedAt).toEqual(at(0));
    } finally {
      vi.useRealTimers();
    }
  });

  it('is deterministic and does not mutate frozen input or Date values', () => {
    const row = Object.freeze(input({ slaPauseStartedAt: Object.freeze(at(5 * minute)) }));
    const before = { ...row };
    const now = Object.freeze(at(10 * minute));
    expect(projectIncidentSlaState(row, { now })).toEqual(projectIncidentSlaState(row, { now }));
    expect(row).toEqual(before);
    expect(origin.getTime()).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
  });
});

describe('invalid projections', () => {
  const invalidContract: Partial<IncidentSlaProjectionInput>[] = [
    { slaAckTargetMs: null },
    { slaResolveTargetMs: null },
    ...[0, -1, NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1].flatMap(value => [
      { slaAckTargetMs: value },
      { slaResolveTargetMs: value },
    ]),
    { slaTargetSource: null },
    { slaTargetSource: '' },
    { slaTargetSource: '  ' },
    { slaTargetCapturedAt: null },
    { slaTargetCapturedAt: new Date(NaN) },
  ];
  it.each(invalidContract)('rejects invalid immutable contract %# without fallbacks', overrides => {
    const result = projectIncidentSlaState(input(overrides), { now: at(minute) });
    expect(result).toMatchObject({
      valid: false,
      contractState: 'INVALID',
      reason: expect.any(String),
      contract: null,
      ack: null,
      resolve: null,
      clock: { evaluatedAt: at(minute) },
    });
  });

  it.each([
    { createdAt: new Date(NaN) },
    { acknowledgedAt: new Date(NaN) },
    { acknowledgedAt: at(-1) },
    { resolvedAt: at(-1) },
    { slaPauseStartedAt: new Date(NaN) },
    { slaPauseStartedAt: at(-1) },
    { status: 'RESOLVED' },
    { status: 'ACKNOWLEDGED' },
    { status: 'SNOOZED' },
    { status: 'SUPPRESSED' },
    ...[-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, BigInt(-1)].flatMap(value => [
      { slaPausedMs: value },
      { slaAckElapsedMs: value },
      { slaResolveElapsedMs: value },
    ]),
  ] satisfies Partial<IncidentSlaProjectionInput>[])(
    'rejects malformed lifecycle/clock input %#',
    overrides => {
      expect(projectIncidentSlaState(input(overrides), { now: at(minute) }).valid).toBe(false);
    }
  );

  it('rejects transport strings rather than parsing them in the core', () => {
    for (const key of [
      'createdAt',
      'acknowledgedAt',
      'resolvedAt',
      'slaTargetCapturedAt',
      'slaPauseStartedAt',
    ]) {
      const row = {
        ...input(),
        [key]: origin.toISOString(),
      } as unknown as IncidentSlaProjectionInput;
      expect(projectIncidentSlaState(row, { now: at(minute) }).valid).toBe(false);
    }
  });

  it('rejects invalid evaluation date or warning policy explicitly', () => {
    expect(projectIncidentSlaState(input(), { now: new Date(NaN) }).valid).toBe(false);
    expect(
      projectIncidentSlaState(input(), {
        now: origin,
        warningPolicy: { ratio: NaN, ackCeilingMs: minute, resolveCeilingMs: minute },
      }).valid
    ).toBe(false);
  });
});
