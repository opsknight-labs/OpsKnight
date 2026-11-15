import { describe, expect, it } from 'vitest';
import {
  followUpClusters,
  runbookHealthInsights,
  runStatsFromRollup,
  stepStatsFromRollup,
  summarizeRunbookEffectiveness,
  type RunbookHealthInput,
  type RunbookStepStats,
} from '@/lib/intelligence/runbook-health/insights';
import {
  clusterNotes,
  draftRunbookFromNotes,
  extractImperativeSteps,
  missingRunbookProblems,
  noteRefsFromHrefs,
} from '@/lib/intelligence/runbook-health/notes';
import { createRunbookSchema, runbookDefinitionSchema } from '@/lib/runbooks/schemas';

const step = (overrides: Partial<RunbookStepStats>): RunbookStepStats => ({
  stepKey: 'restart',
  name: 'Restart service',
  runs: 0,
  failed: 0,
  retried: 0,
  topErrorCode: null,
  topErrorCount: 0,
  ...overrides,
});

const input = (overrides: Partial<RunbookHealthInput> = {}): RunbookHealthInput => ({
  runbookId: 'rb1',
  archived: false,
  publishedDaysAgo: 91,
  lastRunDaysAgo: 1,
  windowDays: 90,
  eligible: 20,
  succeeded: 19,
  steps: [],
  followUpRuns: 0,
  followUps: [],
  ...overrides,
});

const keys = (value: RunbookHealthInput) => runbookHealthInsights(value).map(item => item.key);

// floor(4 * log2(seconds)), as ops.runbook.run stores it.
const bucket = (seconds: number) => Math.floor(4 * Math.log2(seconds));

describe('runStatsFromRollup', () => {
  const points = [
    {
      count: 2,
      tags: { status: 'SUCCEEDED', onIncident: true, fixMinutes: 30, durationBucket: bucket(60) },
    },
    {
      count: 1,
      tags: { status: 'SUCCEEDED', onIncident: true, fixMinutes: 300, durationBucket: bucket(60) },
    },
    {
      count: 1,
      tags: { status: 'FAILED', onIncident: true, fixMinutes: null, durationBucket: bucket(600) },
    },
    {
      count: 1,
      tags: { status: 'TIMED_OUT', onIncident: false, fixMinutes: null, durationBucket: null },
    },
  ];

  it('applies the fix window on read, so a wider window counts the slower fix', () => {
    expect(runStatsFromRollup(points, 120)).toMatchObject({
      eligible: 5,
      succeeded: 3,
      incidentRuns: 4,
      fixed: 2,
    });
    expect(runStatsFromRollup(points, 600).fixed).toBe(3);
  });

  it('takes the median from the duration histogram within its resolution', () => {
    const median = runStatsFromRollup(points, 120).medianDurationMs as number;
    expect(Math.abs(median - 60_000) / 60_000).toBeLessThan(0.1);
    expect(runStatsFromRollup([], 120).medianDurationMs).toBeNull();
  });

  it('ignores malformed tags', () => {
    expect(runStatsFromRollup([{ count: 3, tags: null }], 120)).toMatchObject({
      eligible: 3,
      succeeded: 0,
      fixed: 0,
    });
  });
});

describe('stepStatsFromRollup', () => {
  it('merges days and names the top error code of a step failing 4 of 6 runs', () => {
    const steps = stepStatsFromRollup([
      {
        count: 2,
        tags: {
          stepKey: 'restart',
          name: 'Old name',
          status: 'SUCCEEDED',
          retried: false,
          errorCode: null,
        },
      },
      {
        count: 3,
        tags: {
          stepKey: 'restart',
          name: 'Restart pods',
          status: 'FAILED',
          retried: false,
          errorCode: 'E_TIMEOUT',
        },
      },
      {
        count: 1,
        tags: {
          stepKey: 'restart',
          name: 'Restart pods',
          status: 'FAILED',
          retried: true,
          errorCode: 'E_OOM',
        },
      },
      {
        count: 6,
        tags: { stepKey: 'verify', name: 'Verify', status: 'SUCCEEDED', retried: false },
      },
    ]);
    expect(steps).toEqual([
      {
        stepKey: 'restart',
        name: 'Restart pods',
        runs: 6,
        failed: 4,
        retried: 1,
        topErrorCode: 'E_TIMEOUT',
        topErrorCount: 3,
      },
      {
        stepKey: 'verify',
        name: 'Verify',
        runs: 6,
        failed: 0,
        retried: 0,
        topErrorCode: null,
        topErrorCount: 0,
      },
    ]);
  });
});

describe('summarizeRunbookEffectiveness', () => {
  const base = {
    windowDays: 90,
    fixWindowMinutes: 120,
    runs: { eligible: 20, succeeded: 19, incidentRuns: 10, fixed: 8, medianDurationMs: 42_000 },
    steps: [] as RunbookStepStats[],
    lastRunAt: null,
    lastEditedAt: null,
  };

  it('reports rates with a Wilson lower bound below the raw rate', () => {
    const summary = summarizeRunbookEffectiveness(base);
    expect(summary.successRate).toBeCloseTo(0.95);
    expect(summary.successLowerBound).toBeGreaterThan(0.7);
    expect(summary.successLowerBound).toBeLessThan(0.95);
    expect(summary.fixedRate).toBeCloseTo(0.8);
    expect(summary.fixedLowerBound).toBeLessThan(0.8);
    expect(summary.medianDurationMs).toBe(42_000);
  });

  it('has no rates without runs and no fix rate without incident runs', () => {
    const summary = summarizeRunbookEffectiveness({
      ...base,
      runs: { eligible: 0, succeeded: 0, incidentRuns: 0, fixed: 0, medianDurationMs: null },
    });
    expect(summary.successRate).toBeNull();
    expect(summary.successLowerBound).toBeNull();
    expect(summary.fixedRate).toBeNull();
    expect(summary.mostFailingStep).toBeNull();
  });

  it('picks the step that fails most reliably, not the one that failed once out of once', () => {
    const summary = summarizeRunbookEffectiveness({
      ...base,
      steps: [
        step({ stepKey: 'once', name: 'Once', runs: 1, failed: 1 }),
        step({ stepKey: 'often', name: 'Often', runs: 20, failed: 12, topErrorCode: 'E_TIMEOUT' }),
        step({ stepKey: 'fine', name: 'Fine', runs: 20, failed: 0 }),
      ],
    });
    expect(summary.mostFailingStep).toMatchObject({
      stepKey: 'often',
      failureRate: 0.6,
      topErrorCode: 'E_TIMEOUT',
    });
  });
});

describe('runbookHealthInsights', () => {
  it('says nothing about a healthy runbook', () => {
    expect(runbookHealthInsights(input())).toEqual([]);
  });

  it('flags a runbook that fails often, critical when most runs fail', () => {
    const [warning] = runbookHealthInsights(input({ eligible: 6, succeeded: 2 }));
    expect(warning).toMatchObject({ key: 'fails-often', severity: 'WARNING' });
    expect(warning.draftHref).toBe('/runbooks/rb1?tab=builder');
    expect(runbookHealthInsights(input({ eligible: 20, succeeded: 2 }))[0].severity).toBe(
      'CRITICAL'
    );
  });

  it('does not call failures "often" with too few runs', () => {
    expect(keys(input({ eligible: 3, succeeded: 1 }))).toEqual([]);
  });

  it('flags a published runbook unused for 90 days, but not a new or unpublished one', () => {
    expect(keys(input({ lastRunDaysAgo: 91 }))).toEqual(['unused']);
    expect(keys(input({ lastRunDaysAgo: null }))).toEqual(['unused']);
    expect(keys(input({ lastRunDaysAgo: 89 }))).toEqual([]);
    expect(keys(input({ lastRunDaysAgo: null, publishedDaysAgo: 10 }))).toEqual([]);
    expect(keys(input({ lastRunDaysAgo: null, publishedDaysAgo: null }))).toEqual([]);
    expect(keys(input({ lastRunDaysAgo: null, archived: true }))).toEqual([]);
  });

  it('flags a step failing in more than 30% of runs and names its top error', () => {
    const failing = step({ runs: 6, failed: 4, topErrorCode: 'E_TIMEOUT', topErrorCount: 3 });
    const [item] = runbookHealthInsights(input({ steps: [failing] }));
    expect(item.key).toBe('step-failing:restart');
    expect(item.summary).toContain('E_TIMEOUT');
    expect(item.evidence.facts).toContainEqual({ label: 'Failed', value: '4 of 6 runs' });
    expect(keys(input({ steps: [step({ runs: 6, failed: 1 })] }))).toEqual([]);
    expect(keys(input({ steps: [step({ runs: 4, failed: 4 })] }))).toEqual([]);
  });

  it('flags a step that needed a retry in every run', () => {
    expect(keys(input({ steps: [step({ runs: 3, retried: 3 })] }))).toEqual([
      'step-retried:restart',
    ]);
    expect(keys(input({ steps: [step({ runs: 3, retried: 2 })] }))).toEqual([]);
  });
});

describe('followUpClusters (missing step)', () => {
  const run = (id: string, text?: string) => ({
    executionId: id,
    notes: text ? [{ kind: 'note' as const, id: `n-${id}`, incidentId: `i-${id}`, text }] : [],
  });
  const flush = [
    'Flushed the CDN cache for the api domain',
    'flush CDN cache for api domain',
    'Flushed CDN cache on the api domain again',
  ];

  it('suggests a step when most runs are followed by the same note, storing ids only', () => {
    const clusters = followUpClusters([
      run('a', flush[0]),
      run('b', flush[1]),
      run('c', flush[2]),
      run('d'),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].runsWithNote).toBe(3);
    const items = runbookHealthInsights(input({ followUpRuns: 4, followUps: clusters }));
    expect(items[0].key).toBe(`missing-step:${clusters[0].signature}`);
    expect(items[0].evidence.examples?.[0].href).toBe('/incidents/i-a#note-n-a');
    expect(JSON.stringify(items)).not.toMatch(/CDN|flush/i);
  });

  it('stays quiet when the note follows only a minority of runs or there are too few runs', () => {
    expect(
      followUpClusters([
        run('a', flush[0]),
        run('b', flush[1]),
        run('c', flush[2]),
        run('d'),
        run('e'),
        run('f'),
      ])
    ).toEqual([]);
    expect(followUpClusters([run('a', flush[0]), run('b', flush[1])])).toEqual([]);
  });
});

describe('noteRefsFromHrefs', () => {
  it('round-trips the incident links insights store and skips anything else', () => {
    expect(
      noteRefsFromHrefs([
        '/incidents/i1#note-n1',
        '/incidents/i2#event-e2',
        'https://x.test',
        undefined,
      ])
    ).toEqual([
      { incidentId: 'i1', kind: 'note', id: 'n1' },
      { incidentId: 'i2', kind: 'event', id: 'e2' },
    ]);
  });
});

describe('clusterNotes', () => {
  it('groups notes that describe the same fix and drops acknowledgements', () => {
    const clusters = clusterNotes([
      { text: 'Restarted the api pods and cleared the redis cache' },
      { text: 'fixed' },
      { text: 'Restart api pods, clear redis cache' },
      { text: 'Rotated the expired TLS certificate on the load balancer' },
      { text: 'Restarting api pods then clearing redis cache' },
    ]);
    expect(clusters.map(cluster => cluster.members.length)).toEqual([3, 1]);
  });

  it('gives a cluster the same signature whatever order later notes arrive in', () => {
    const a = { text: 'Scaled the worker pool to 6 replicas' };
    const b = { text: 'scaled worker pool to 12 replicas' };
    const c = { text: 'Scaled the worker pool to 8 replicas' };
    expect(clusterNotes([a, b, c])[0].signature).toBe(clusterNotes([a, c, b])[0].signature);
  });
});

describe('extractImperativeSteps', () => {
  it('turns past-tense actions into ordered imperative steps and merges repeats', () => {
    expect(
      extractImperativeSteps([
        'Resolved: Restarted the api pods, cleared the redis cache and then verified the queue depth.',
        '1. restart api pods\n2. clear redis cache\nIt was a memory leak again.',
        'We ran kubectl rollout restart deploy/api; cleared the redis cache',
      ])
    ).toEqual([
      { name: 'Restart the api pods', support: 2 },
      { name: 'Clear the redis cache', support: 3 },
      { name: 'Verify the queue depth', support: 1 },
      { name: 'Run kubectl rollout restart deploy/api', support: 1 },
    ]);
  });

  it('keeps a non-action clause attached and ignores prose', () => {
    expect(
      extractImperativeSteps([
        'The disk was full. Rolled back the release, which had a bad config.',
        'kubectl delete pod api-0',
      ])
    ).toEqual([
      { name: 'Roll back the release, which had a bad config', support: 1 },
      { name: 'Run kubectl delete pod api-0', support: 1 },
    ]);
  });

  it('caps the number of steps', () => {
    const note = Array.from(
      { length: 20 },
      (_, index) => `restart service-${'x'.repeat(index + 1)}`
    );
    expect(extractImperativeSteps([note.join('\n')], 5)).toHaveLength(5);
  });
});

describe('missingRunbookProblems', () => {
  const note = (incidentId: string, text: string) => ({
    kind: 'event' as const,
    id: `e-${incidentId}`,
    incidentId,
    text,
  });
  const fix = [
    note('i1', 'Restarted the api pods and cleared the redis cache'),
    note('i2', 'Restart api pods, clear redis cache'),
    note('i3', 'Restarting api pods then clearing redis cache'),
  ];

  it('suggests a runbook for three similar hand-written fixes with no runbook run', () => {
    const [problem] = missingRunbookProblems([{ templateHash: 'h1', notes: fix, runbookRuns: 0 }]);
    expect(problem).toMatchObject({ templateHash: 'h1', noteCount: 3 });
    expect(problem.stepCount).toBeGreaterThan(0);
    expect(problem.refs.map(ref => ref.id)).toEqual(['e-i1', 'e-i2', 'e-i3']);
    expect(JSON.stringify(problem)).not.toMatch(/redis/);
  });

  it('stays quiet with two notes, a runbook run, one incident, or no recognisable action', () => {
    expect(
      missingRunbookProblems([{ templateHash: 'h', notes: fix.slice(0, 2), runbookRuns: 0 }])
    ).toEqual([]);
    expect(missingRunbookProblems([{ templateHash: 'h', notes: fix, runbookRuns: 1 }])).toEqual([]);
    const oneIncident = fix.map(item => ({ ...item, incidentId: 'i1' }));
    expect(
      missingRunbookProblems([{ templateHash: 'h', notes: oneIncident, runbookRuns: 0 }])
    ).toEqual([]);
    const prose = ['i1', 'i2', 'i3'].map(id => note(id, 'The api latency was high today'));
    expect(missingRunbookProblems([{ templateHash: 'h', notes: prose, runbookRuns: 0 }])).toEqual(
      []
    );
  });

  it('orders problems by how many incidents back them', () => {
    const four = [...fix, note('i4', 'restarted api pods and cleared redis cache')];
    expect(
      missingRunbookProblems([
        { templateHash: 'small', notes: fix, runbookRuns: 0 },
        { templateHash: 'big', notes: four, runbookRuns: 0 },
      ]).map(problem => problem.templateHash)
    ).toEqual(['big', 'small']);
  });
});

describe('draftRunbookFromNotes', () => {
  it('builds a manual-only draft the runbook editor accepts', () => {
    const draft = draftRunbookFromNotes(
      {
        template: 'Queue depth high on <host>  ',
        notes: [
          'Restarted the api pods and cleared the redis cache',
          'restart api pods, clear redis cache',
          'Restarting api pods',
        ],
      },
      'Checkout'
    );
    expect(draft.name).toBe('Queue depth high on <host>');
    expect(draft.slug).toBe('queue-depth-high-on-host');
    expect(draft.description).toContain('3 hand-written resolution notes on Checkout');
    expect(draft.definition.steps.map(item => [item.key, item.type])).toEqual([
      ['step_1', 'MANUAL'],
      ['step_2', 'MANUAL'],
    ]);
    expect(runbookDefinitionSchema.safeParse(draft.definition).success).toBe(true);
    expect(createRunbookSchema.safeParse(draft).success).toBe(true);
  });

  it('falls back to a safe name and slug for an empty template', () => {
    const draft = draftRunbookFromNotes({ template: ' ', notes: ['Restart it now'] }, 'Checkout');
    expect(draft.name).toBe('Suggested runbook for Checkout');
    expect(draft.slug).toBe('suggested-runbook-for-checkout');
  });
});
