import { describe, expect, it } from 'vitest';
import {
  assertSafeRegex,
  matcherSchema,
  noiseControlDefinitionSchema,
  type PrePagingInput,
} from '@/lib/intelligence/noise-controls/contract';
import {
  isWindowActiveAt,
  occurrencesBetween,
  parseRecurrence,
  windowSpans,
} from '@/lib/intelligence/noise-controls/recurrence';
import { compileMatcher, isLabelSubset, matches } from '@/lib/intelligence/noise-controls/matchers';
import {
  countTransitions,
  decideStatic,
  evaluatePrePagingControls,
  type CompiledPolicy,
  type PrePagingLookups,
  type PrePagingSnapshot,
} from '@/lib/intelligence/noise-controls/evaluate';

const T0 = new Date('2026-03-02T10:00:00Z'); // a Monday

type DefinitionOverrides = Omit<Partial<CompiledPolicy['definition']>, 'orchestration'>;

function policy(
  overrides: DefinitionOverrides & {
    mode?: 'OFF' | 'SHADOW' | 'ON';
    orchestration?: CompiledPolicy['orchestration'];
  } = {}
): CompiledPolicy {
  const { mode, orchestration, ...definition } = overrides;
  return {
    scopeKey: 'global',
    serviceId: null,
    mode: mode ?? 'ON',
    revision: 3,
    definition: noiseControlDefinitionSchema.parse({ schemaVersion: 1, ...definition }),
    orchestration: orchestration ?? [],
  };
}

function snapshot(
  partial: Partial<PrePagingSnapshot> & { policy?: CompiledPolicy } = {}
): PrePagingSnapshot {
  const { policy: p, ...rest } = partial;
  return {
    loadedAt: T0.getTime(),
    policies: new Map([[p?.scopeKey ?? 'global', p ?? policy()]]),
    windows: [],
    rules: [],
    serviceTeams: new Map(),
    topology: new Map(),
    ...rest,
  };
}

function input(overrides: Partial<PrePagingInput> = {}): PrePagingInput {
  return {
    serviceId: 'svc-1',
    teamId: null,
    source: 'prometheus',
    summary: 'Disk usage high on db-01',
    severity: 'warning',
    urgency: 'MEDIUM',
    labels: { env: 'prod', region: 'eu-west-1' },
    resourceKey: 'db-01',
    fingerprintHash: 'abc123',
    dedupKey: 'disk-db-01',
    receivedAt: T0,
    ...overrides,
  };
}

const quiet: PrePagingLookups = {
  findOpenIncidentByFingerprint: async () => null,
  countRecentIncidents: async () => 0,
  findStormParent: async () => null,
  recentAlertStatuses: async () => [],
};

describe('recurrence subset', () => {
  it('parses the supported subset and rejects the rest', () => {
    expect(parseRecurrence('FREQ=WEEKLY;BYDAY=SA,SU;INTERVAL=2')).toMatchObject({
      freq: 'WEEKLY',
      byDay: [0, 6],
      interval: 2,
    });
    expect(() => parseRecurrence('FREQ=HOURLY')).toThrow(/FREQ/);
    expect(() => parseRecurrence('FREQ=DAILY;BYSETPOS=1')).toThrow(/Unsupported/);
    expect(() => parseRecurrence('FREQ=DAILY;FREQ=WEEKLY')).toThrow(/Duplicate/);
    expect(() => parseRecurrence('FREQ=DAILY;BYDAY=MO')).toThrow(/BYDAY/);
    expect(() => parseRecurrence('INTERVAL=2')).toThrow(/needs FREQ/);
  });

  it('expands daily, weekly-by-day and monthly occurrences, honouring COUNT and UNTIL', () => {
    const daily = occurrencesBetween(
      T0,
      parseRecurrence('FREQ=DAILY;INTERVAL=2;COUNT=3'),
      T0,
      new Date('2026-03-30T00:00:00Z')
    );
    expect(daily.map(d => d.toISOString().slice(0, 10))).toEqual([
      '2026-03-02',
      '2026-03-04',
      '2026-03-06',
    ]);
    const weekends = occurrencesBetween(
      new Date('2026-03-07T22:00:00Z'), // Saturday
      parseRecurrence('FREQ=WEEKLY;BYDAY=SA,SU;UNTIL=20260316T000000Z'),
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-31T00:00:00Z')
    );
    expect(weekends.map(d => d.toISOString().slice(0, 10))).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-14',
      '2026-03-15',
    ]);
    const monthly = occurrencesBetween(
      new Date('2026-01-31T01:00:00Z'),
      parseRecurrence('FREQ=MONTHLY;COUNT=4'),
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-12-31T00:00:00Z')
    );
    // February has no 31st and is skipped, like RRULE does.
    expect(monthly.map(d => d.toISOString().slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
      '2026-07-31',
    ]);
  });

  it('answers whether a recurring window is active at an instant', () => {
    const window = {
      startsAt: new Date('2026-02-28T22:00:00Z'),
      endsAt: new Date('2026-03-01T06:00:00Z'),
      recurrence: 'FREQ=WEEKLY;BYDAY=SA',
    };
    expect(isWindowActiveAt(window, new Date('2026-03-07T23:30:00Z'))).toBe(true);
    expect(isWindowActiveAt(window, new Date('2026-03-08T07:00:00Z'))).toBe(false);
    expect(isWindowActiveAt(window, new Date('2026-03-10T23:30:00Z'))).toBe(false);
    expect(
      windowSpans(
        window.startsAt,
        window.endsAt,
        null,
        new Date('2026-03-01T05:00:00Z'),
        new Date('2026-03-01T05:00:00Z')
      )
    ).toHaveLength(1);
    expect(
      windowSpans(
        window.startsAt,
        window.endsAt,
        null,
        new Date('2026-03-02T05:00:00Z'),
        new Date('2026-03-02T05:00:00Z')
      )
    ).toHaveLength(0);
  });
});

describe('matchers', () => {
  it('matches fields and labels case-insensitively with every operator', () => {
    const alert = input();
    expect(
      matches(compileMatcher({ field: 'severity', op: 'equals', value: 'WARNING' }), alert)
    ).toBe(true);
    expect(
      matches(compileMatcher({ field: 'summary', op: 'contains', value: 'disk usage' }), alert)
    ).toBe(true);
    expect(
      matches(compileMatcher({ field: 'resourceKey', op: 'prefix', value: 'db-' }), alert)
    ).toBe(true);
    expect(
      matches(compileMatcher({ field: 'summary', op: 'regex', value: 'db-\\d+' }), alert)
    ).toBe(true);
    expect(
      matches(compileMatcher({ field: 'label', key: 'env', op: 'equals', value: 'prod' }), alert)
    ).toBe(true);
    expect(matches(compileMatcher({ field: 'label', key: 'tier', op: 'exists' }), alert)).toBe(
      false
    );
    expect(
      matches(compileMatcher({ field: 'source', op: 'equals', value: 'datadog' }), alert)
    ).toBe(false);
  });

  it('rejects patterns that can blow up and label matchers without a key', () => {
    expect(() => assertSafeRegex('(a+)+$')).toThrow(/quantifiers/);
    expect(() => assertSafeRegex('(.*)\\1')).toThrow(/Back-references/);
    expect(() => assertSafeRegex('[unclosed')).toThrow(/valid regular expression/);
    expect(matcherSchema.safeParse({ field: 'label', op: 'equals', value: 'x' }).success).toBe(
      false
    );
    expect(matcherSchema.safeParse({ field: 'summary', op: 'regex', value: '(a+)+' }).success).toBe(
      false
    );
    expect(matcherSchema.safeParse({ field: 'summary', op: 'exists' }).success).toBe(true);
  });

  it('checks label subsets', () => {
    expect(isLabelSubset({ env: 'prod' }, { env: 'prod', region: 'eu' })).toBe(true);
    expect(isLabelSubset({ env: 'prod', region: 'us' }, { env: 'prod', region: 'eu' })).toBe(false);
    expect(isLabelSubset({}, null)).toBe(true);
    expect(isLabelSubset({ env: 'prod' }, null)).toBe(false);
  });
});

describe('pre-paging evaluation', () => {
  it('fails open when there is no snapshot or the policy is OFF, and never applies in SHADOW', async () => {
    expect(await evaluatePrePagingControls(input(), null, quiet)).toMatchObject({
      action: 'NONE',
      apply: false,
      failOpen: { reason: 'cache_cold' },
    });
    expect(
      await evaluatePrePagingControls(input(), snapshot({ policy: policy({ mode: 'OFF' }) }), quiet)
    ).toMatchObject({ action: 'NONE', apply: false, failOpen: { reason: 'off' } });
    const shadow = snapshot({
      policy: policy({ mode: 'SHADOW' }),
      windows: [
        {
          id: 'w1',
          name: 'Weekend patching',
          scope: 'ALL',
          serviceId: null,
          teamId: null,
          labelKey: null,
          labelValue: null,
          startsAt: new Date(T0.getTime() - 3600_000),
          endsAt: new Date(T0.getTime() + 3600_000),
          recurrence: null,
          effect: 'SUPPRESS',
          downgradeUrgency: null,
          endedAt: null,
        },
      ],
    });
    expect(await evaluatePrePagingControls(input(), shadow, quiet)).toMatchObject({
      action: 'SUPPRESS',
      control: 'MAINTENANCE',
      mode: 'SHADOW',
      apply: false,
      sourceId: 'w1',
      policyRevision: 3,
    });
  });

  it('applies maintenance windows by scope, respects early ends, and downgrades only downwards', async () => {
    const base = {
      id: 'w',
      name: 'Window',
      labelKey: null,
      labelValue: null,
      startsAt: new Date(T0.getTime() - 60_000),
      endsAt: new Date(T0.getTime() + 60_000),
      recurrence: null,
      endedAt: null,
      downgradeUrgency: null,
    };
    const service = snapshot({
      windows: [
        { ...base, scope: 'SERVICE', serviceId: 'svc-1', teamId: null, effect: 'SUPPRESS' },
      ],
    });
    expect((await evaluatePrePagingControls(input(), service, quiet)).action).toBe('SUPPRESS');
    expect(
      (await evaluatePrePagingControls(input({ serviceId: 'svc-2' }), service, quiet)).action
    ).toBe('NONE');
    const team = snapshot({
      windows: [{ ...base, scope: 'TEAM', serviceId: null, teamId: 'team-a', effect: 'SUPPRESS' }],
      serviceTeams: new Map([['svc-1', 'team-a']]),
    });
    expect((await evaluatePrePagingControls(input(), team, quiet)).action).toBe('SUPPRESS');
    const label = snapshot({
      windows: [
        {
          ...base,
          scope: 'LABEL',
          serviceId: null,
          teamId: null,
          labelKey: 'env',
          labelValue: 'PROD',
          effect: 'DOWNGRADE',
          downgradeUrgency: 'LOW',
        },
      ],
    });
    expect(await evaluatePrePagingControls(input(), label, quiet)).toMatchObject({
      action: 'DOWNGRADE',
      urgency: 'LOW',
      apply: true,
    });
    // A downgrade can never raise urgency.
    expect((await evaluatePrePagingControls(input({ urgency: 'LOW' }), label, quiet)).action).toBe(
      'NONE'
    );
    const ended = snapshot({
      windows: [
        {
          ...base,
          scope: 'ALL',
          serviceId: null,
          teamId: null,
          effect: 'SUPPRESS',
          endedAt: new Date(T0.getTime() - 1),
        },
      ],
    });
    expect((await evaluatePrePagingControls(input(), ended, quiet)).action).toBe('NONE');
  });

  it('applies suppression rules with all matchers, honouring expiry and service scope', async () => {
    const rule = {
      id: 'r1',
      name: 'Mute staging disk',
      serviceId: null,
      matchers: [
        compileMatcher({ field: 'summary', op: 'regex', value: '^disk' }),
        compileMatcher({ field: 'label', key: 'env', op: 'equals', value: 'prod' }),
      ],
      effect: 'SUPPRESS' as const,
      downgradeUrgency: null,
      expiresAt: null,
    };
    expect(
      await evaluatePrePagingControls(input(), snapshot({ rules: [rule] }), quiet)
    ).toMatchObject({
      action: 'SUPPRESS',
      control: 'SUPPRESSION',
      sourceName: 'Mute staging disk',
    });
    expect(
      (
        await evaluatePrePagingControls(
          input({ labels: { env: 'staging' } }),
          snapshot({ rules: [rule] }),
          quiet
        )
      ).action
    ).toBe('NONE');
    expect(
      (
        await evaluatePrePagingControls(
          input(),
          snapshot({ rules: [{ ...rule, expiresAt: new Date(T0.getTime() - 1) }] }),
          quiet
        )
      ).action
    ).toBe('NONE');
    expect(
      (
        await evaluatePrePagingControls(
          input(),
          snapshot({ rules: [{ ...rule, serviceId: 'other' }] }),
          quiet
        )
      ).action
    ).toBe('NONE');
  });

  it('runs orchestration rules in order: transforms accumulate, DROP and SUPPRESS decide', async () => {
    const orchestration: CompiledPolicy['orchestration'] = [
      {
        id: 'tag',
        name: 'Tag prod',
        conditions: [compileMatcher({ field: 'label', key: 'env', op: 'equals', value: 'prod' })],
        actions: [
          { type: 'SET_LABEL', key: 'Tier', value: 'gold' },
          { type: 'SET_URGENCY', value: 'LOW' },
          { type: 'ADD_NOTE', text: 'tagged' },
        ],
      },
      {
        id: 'drop-test',
        name: 'Drop tests',
        conditions: [compileMatcher({ field: 'source', op: 'equals', value: 'synthetic' })],
        actions: [{ type: 'DROP' }],
      },
    ];
    const snap = snapshot({ policy: policy({ orchestration }) });
    const transformed = await evaluatePrePagingControls(input(), snap, quiet);
    expect(transformed).toMatchObject({
      action: 'TRANSFORM',
      control: 'ORCHESTRATION',
      apply: true,
    });
    expect(transformed.transform).toEqual({
      labels: { tier: 'gold' },
      urgency: 'LOW',
      notes: ['tagged'],
    });
    expect(
      await evaluatePrePagingControls(input({ source: 'synthetic' }), snap, quiet)
    ).toMatchObject({ action: 'DROP', sourceId: 'drop-test' });
    const stage = decideStatic(
      input({ source: 'synthetic' }),
      snap.policies.get('global')!,
      snap,
      T0
    );
    expect(stage.decision?.evidence).toMatchObject({ matchedRules: ['tag', 'drop-test'] });
  });

  it('appends to an open incident with the same content when the labels are a subset', async () => {
    const snap = snapshot({
      policy: policy({
        contentDedup: { enabled: true, windowSeconds: 900, requireLabelSubset: true },
      }),
    });
    const open = {
      ...quiet,
      findOpenIncidentByFingerprint: async (serviceId: string, hash: string, since: Date) =>
        hash === 'abc123' && since.getTime() === T0.getTime() - 900_000
          ? { id: 'inc-open', labels: { env: 'prod', region: 'eu-west-1', extra: 'x' } }
          : null,
    };
    expect(await evaluatePrePagingControls(input(), snap, open)).toMatchObject({
      action: 'APPEND',
      control: 'CONTENT_DEDUP',
      targetIncidentId: 'inc-open',
      apply: true,
    });
    const different = {
      ...open,
      findOpenIncidentByFingerprint: async () => ({ id: 'inc-open', labels: { env: 'staging' } }),
    };
    expect((await evaluatePrePagingControls(input(), snap, different)).action).toBe('NONE');
    const loose = snapshot({
      policy: policy({
        contentDedup: { enabled: true, windowSeconds: 900, requireLabelSubset: false },
      }),
    });
    expect((await evaluatePrePagingControls(input(), loose, different)).action).toBe('APPEND');
  });

  it('suppresses flapping keys and groups or holds storms, never holding HIGH urgency', async () => {
    const flapping = snapshot({
      policy: policy({
        flapping: { enabled: true, windowSeconds: 180, threshold: 4, keyOnFingerprint: true },
      }),
    });
    const oscillating = {
      ...quiet,
      recentAlertStatuses: async () => [
        'TRIGGERED',
        'RESOLVED',
        'TRIGGERED',
        'RESOLVED',
        'TRIGGERED',
      ],
    };
    expect(await evaluatePrePagingControls(input(), flapping, oscillating)).toMatchObject({
      action: 'SUPPRESS',
      control: 'FLAPPING',
      evidence: { transitions: 4 },
    });
    expect(countTransitions(['TRIGGERED', 'TRIGGERED', 'RESOLVED'])).toBe(1);

    const storm = snapshot({
      policy: policy({
        storm: {
          enabled: true,
          threshold: 10,
          windowSeconds: 60,
          holdSeconds: 30,
          topology: false,
        },
      }),
    });
    const busy = {
      ...quiet,
      countRecentIncidents: async () => 12,
      findStormParent: async () => ({ id: 'inc-parent' }),
    };
    expect(await evaluatePrePagingControls(input(), storm, busy)).toMatchObject({
      action: 'GROUP_CHILD',
      control: 'STORM',
      targetIncidentId: 'inc-parent',
    });
    const rising = { ...quiet, countRecentIncidents: async () => 6 };
    const held = await evaluatePrePagingControls(input(), storm, rising);
    expect(held).toMatchObject({ action: 'HOLD', control: 'STORM' });
    expect(held.holdUntil?.getTime()).toBe(T0.getTime() + 30_000);
    // HIGH urgency is left alone by dedup/flapping/storm unless the service opts in, and is never held.
    expect((await evaluatePrePagingControls(input({ urgency: 'HIGH' }), storm, busy)).action).toBe(
      'NONE'
    );
    const optIn = snapshot({
      policy: policy({
        allowHighUrgency: true,
        storm: {
          enabled: true,
          threshold: 10,
          windowSeconds: 60,
          holdSeconds: 30,
          topology: false,
        },
      }),
    });
    expect((await evaluatePrePagingControls(input({ urgency: 'HIGH' }), optIn, busy)).action).toBe(
      'GROUP_CHILD'
    );
    expect(
      (await evaluatePrePagingControls(input({ urgency: 'HIGH' }), optIn, rising)).action
    ).toBe('NONE');
  });

  it('fails open on the deadline and on lookup errors, within a few milliseconds', async () => {
    const snap = snapshot({
      policy: policy({
        storm: { enabled: true, threshold: 10, windowSeconds: 60, holdSeconds: 0, topology: false },
      }),
    });
    const stuck = { ...quiet, countRecentIncidents: () => new Promise<number>(() => {}) };
    const started = performance.now();
    const timedOut = await evaluatePrePagingControls(input(), snap, stuck, { deadlineMs: 5 });
    expect(performance.now() - started).toBeLessThan(100);
    expect(timedOut).toMatchObject({
      action: 'NONE',
      apply: false,
      failOpen: { reason: 'deadline' },
    });
    const broken = {
      ...quiet,
      countRecentIncidents: async () => {
        throw new Error('db down');
      },
    };
    expect(await evaluatePrePagingControls(input(), snap, broken)).toMatchObject({
      action: 'NONE',
      apply: false,
      failOpen: { reason: 'error' },
    });
    // Static controls need no lookups, so a stuck database cannot delay a maintenance decision.
    const windowed = snapshot({
      windows: [
        {
          id: 'w',
          name: 'Now',
          scope: 'ALL',
          serviceId: null,
          teamId: null,
          labelKey: null,
          labelValue: null,
          startsAt: new Date(T0.getTime() - 1),
          endsAt: new Date(T0.getTime() + 1),
          recurrence: null,
          effect: 'SUPPRESS',
          downgradeUrgency: null,
          endedAt: null,
        },
      ],
    });
    expect((await evaluatePrePagingControls(input(), windowed, stuck)).action).toBe('SUPPRESS');
  });
});

describe('noise control definition', () => {
  it('bounds every knob and rejects duplicate orchestration ids', () => {
    expect(noiseControlDefinitionSchema.parse({ schemaVersion: 1 }).storm.holdSeconds).toBe(0);
    expect(
      noiseControlDefinitionSchema.safeParse({ schemaVersion: 1, storm: { holdSeconds: 61 } })
        .success
    ).toBe(false);
    const rule = {
      id: 'a',
      name: 'A',
      conditions: [{ field: 'source', op: 'exists' }],
      actions: [{ type: 'DROP' }],
    };
    expect(
      noiseControlDefinitionSchema.safeParse({
        schemaVersion: 1,
        orchestration: { rules: [rule, rule] },
      }).success
    ).toBe(false);
  });
});
