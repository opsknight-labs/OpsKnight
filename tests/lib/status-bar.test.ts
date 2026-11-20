import { describe, expect, it } from 'vitest';
import {
  connectionLabel,
  connectionState,
  deriveOnCall,
  EMPTY_HEALTH,
  buildSignals,
  compactElapsed,
  splitSignals,
  awaitingAckDetail,
  awaitingAckLabel,
  maintenanceDetail,
  maintenanceHref,
  maintenanceLabel,
  slaAtRiskDetail,
  slaAtRiskLabel,
  formatShiftTime,
  myWorkLabel,
  nextOnCallChange,
  onCallLabel,
  type StatusBarShift,
} from '@/lib/status-bar';

const NOW = Date.parse('2026-11-20T10:00:00Z'); // Friday

const shift = (overrides: Partial<StatusBarShift>): StatusBarShift => ({
  scheduleId: 'sched-1',
  scheduleName: 'Primary',
  start: '2026-11-20T08:00:00Z',
  end: '2026-11-20T18:00:00Z',
  endClamped: false,
  ...overrides,
});

describe('on-call state and labels', () => {
  it('labels a current shift with its end time', () => {
    const state = deriveOnCall([shift({})], NOW);
    expect(state).toEqual({
      kind: 'on',
      scheduleId: 'sched-1',
      scheduleName: 'Primary',
      until: '2026-11-20T18:00:00Z',
    });
    expect(onCallLabel(state!, NOW, 'UTC')).toBe('On call · Primary · until 18:00');
  });

  it('adds the weekday when the shift ends on another day', () => {
    const state = deriveOnCall([shift({ end: '2026-11-21T09:30:00Z' })], NOW);
    expect(onCallLabel(state!, NOW, 'UTC')).toBe('On call · Primary · until Sat 09:30');
  });

  it('drops "until" when the end is only the lookahead limit', () => {
    const state = deriveOnCall([shift({ endClamped: true })], NOW);
    expect(onCallLabel(state!, NOW, 'UTC')).toBe('On call · Primary');
  });

  it('labels off call with the next shift start', () => {
    const shifts = [
      shift({ scheduleId: 'later', start: '2026-11-24T09:00:00Z', end: '2026-11-25T09:00:00Z' }),
      shift({ scheduleId: 'next', start: '2026-11-22T09:00:00Z', end: '2026-11-23T09:00:00Z' }),
    ];
    const state = deriveOnCall(shifts, NOW);
    expect(state).toMatchObject({ kind: 'off', scheduleId: 'next' });
    expect(onCallLabel(state!, NOW, 'UTC')).toBe('Off call · next Sun 09:00');
  });

  it('returns null when the user is in no rotation', () => {
    expect(deriveOnCall([], NOW)).toBeNull();
    // A shift that already ended is not a rotation the bar can show.
    expect(deriveOnCall([shift({ end: '2026-11-20T09:00:00Z' })], NOW)).toBeNull();
  });

  it('prefers the current shift that ends first', () => {
    const state = deriveOnCall(
      [shift({ scheduleId: 'b', end: '2026-11-20T20:00:00Z' }), shift({ scheduleId: 'a' })],
      NOW
    );
    expect(state).toMatchObject({ kind: 'on', scheduleId: 'a' });
  });

  it('formats times in the user timezone', () => {
    const state = deriveOnCall([shift({})], NOW)!;
    // 18:00Z is 23:30 in Kolkata, same calendar day.
    expect(onCallLabel(state, NOW, 'Asia/Kolkata')).toBe('On call · Primary · until 23:30');
    // In Auckland (NZDT, +13) now is Fri 23:00 and 18:00Z is Sat 07:00, so the weekday shows.
    expect(onCallLabel(state, NOW, 'Pacific/Auckland')).toBe('On call · Primary · until Sat 07:00');
    expect(formatShiftTime(Date.parse('2026-11-20T18:00:00Z'), NOW, 'America/New_York')).toBe(
      '13:00'
    );
  });
});

describe('nextOnCallChange', () => {
  it('returns the next real start or end, ignoring clamped ends', () => {
    expect(nextOnCallChange([shift({})], NOW)).toBe(Date.parse('2026-11-20T18:00:00Z'));
    expect(
      nextOnCallChange(
        [
          shift({ endClamped: true }),
          shift({ start: '2026-11-21T00:00:00Z', end: '2026-11-22T00:00:00Z' }),
        ],
        NOW
      )
    ).toBe(Date.parse('2026-11-21T00:00:00Z'));
    expect(nextOnCallChange([shift({ endClamped: true })], NOW)).toBeNull();
  });
});

describe('counts and misc labels', () => {
  it('hides my work when both counts are zero', () => {
    expect(myWorkLabel({ assigned: 0, unacked: 0 })).toBeNull();
    expect(myWorkLabel({ assigned: 3, unacked: 1 })).toBe('3 assigned · 1 unacked');
    expect(myWorkLabel({ assigned: 2, unacked: 0 })).toBe('2 assigned · 0 unacked');
  });

  it('words the awaiting-ack and delivery items', () => {
    expect(awaitingAckLabel(3)).toBe('3 awaiting ack');
    expect(awaitingAckDetail(1)).toBe('1 incident is open and unacknowledged');
    expect(awaitingAckDetail(3)).toBe('3 incidents are open and unacknowledged');
    expect(slaAtRiskLabel(2)).toBe('2 SLA at risk');
    expect(slaAtRiskDetail(1)).toContain('1 incident is close to');
    const one = {
      count: 1,
      serviceId: 's1',
      serviceName: 'Payments',
      endsAt: '2026-01-01T12:00:00.000Z',
    };
    expect(maintenanceLabel(one)).toBe('Payments in maintenance');
    expect(maintenanceHref(one)).toBe('/services/s1');
    expect(maintenanceLabel({ ...one, count: 3 })).toBe('3 services in maintenance');
    expect(maintenanceHref({ ...one, count: 3 })).toBe('/services');
    expect(maintenanceDetail(one, 'UTC')).toContain('ends');
  });

  it('derives the connection state', () => {
    const base = {
      available: true,
      isConnected: false,
      isRevoked: false,
      online: true,
      everConnected: false,
    };
    expect(connectionState({ ...base, isConnected: true })).toBe('live');
    expect(connectionState(base)).toBe('connecting');
    expect(connectionState({ ...base, everConnected: true })).toBe('reconnecting');
    expect(connectionState({ ...base, online: false })).toBe('offline');
    expect(connectionState({ ...base, isRevoked: true })).toBe('offline');
    expect(connectionState({ ...base, available: false })).toBe('offline');
    expect(connectionLabel('reconnecting')).toBe('Reconnecting…');
  });
});

describe('right-side signals', () => {
  it('is empty on a calm day', () => {
    expect(buildSignals(EMPTY_HEALTH, 'UTC')).toEqual([]);
  });

  it('formats compact elapsed time', () => {
    const at = '2026-01-01T10:00:00.000Z';
    expect(compactElapsed(at, Date.parse(at) + 12 * 60_000)).toBe('12m');
    expect(compactElapsed(at, Date.parse(at) + 185 * 60_000)).toBe('3h 05m');
    expect(compactElapsed(at, Date.parse(at) + 50 * 3_600_000)).toBe('2d');
  });

  it('maps tones, hrefs and the status page severity', () => {
    const signals = buildSignals(
      {
        ...EMPTY_HEALTH,
        statusPage: {
          status: 'DEGRADED',
          pageName: 'Main',
          more: 0,
          href: '/settings/status-pages',
        },
        runbooksRunning: 1,
        ingestionDelayed: true,
      },
      'UTC'
    );
    const by = Object.fromEntries(signals.map(signal => [signal.key, signal]));
    expect(by.statusPage).toMatchObject({ tone: 'elevated', href: '/settings/status-pages' });
    expect(by.runbooks).toMatchObject({ tone: 'info', label: '1 runbook running' });
    expect(by.ingestion).toMatchObject({ tone: 'critical', label: 'Ingestion delayed' });
  });

  it('words and links the coverage gap, ranked right after SLA', () => {
    const one = buildSignals(
      { ...EMPTY_HEALTH, coverageGap: { count: 1, scheduleId: 's9', scheduleName: 'Primary' } },
      'UTC'
    )[0];
    expect(one).toMatchObject({
      label: 'Primary has no one on call',
      href: '/schedules/s9',
      tone: 'critical',
    });
    const many = buildSignals(
      {
        ...EMPTY_HEALTH,
        slaAtRisk: 1,
        coverageGap: { count: 3, scheduleId: 's9', scheduleName: 'P' },
      },
      'UTC'
    );
    expect(many.find(signal => signal.key === 'coverage')).toMatchObject({
      label: '3 schedules with no one on call',
      href: '/schedules',
    });
    expect(splitSignals(many, 2).inline.map(signal => signal.key)).toEqual(['sla', 'coverage']);
  });

  it('keeps the highest-priority signals inline and overflows the rest', () => {
    const signals = buildSignals(
      { ...EMPTY_HEALTH, awaitingAck: 1, slaAtRisk: 1, runbooksRunning: 1, ingestionDelayed: true },
      'UTC'
    );
    const { inline, overflow } = splitSignals(signals, 2);
    expect(inline.map(signal => signal.key)).toEqual(['sla', 'ingestion']);
    expect(overflow.map(signal => signal.key)).toEqual(['ack', 'runbooks']);
    expect(splitSignals(signals, 9).overflow).toEqual([]);
  });
});
