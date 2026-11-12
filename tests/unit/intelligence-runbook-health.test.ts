import { describe, expect, it } from 'vitest';
import {
  missingStepInsights,
  runbookHealthInsights,
  summarizeRunbookEffectiveness,
  type RunbookHealthInput,
  type RunbookStepStats,
} from '@/lib/intelligence/runbook-health/insights';
import {
  clusterNotes,
  extractImperativeSteps,
  missingRunbookInsights,
  draftRunbookFromSuggestion,
} from '@/lib/intelligence/runbook-health/notes';
import { createRunbookSchema, runbookDefinitionSchema } from '@/lib/runbooks/schemas';

const NOW = new Date('2026-11-12T00:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

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
  publishedAt: daysAgo(200),
  archived: false,
  lastEditedAt: daysAgo(30),
  lastRunAt: daysAgo(1),
  windowDays: 90,
  runs: { eligible: 20, succeeded: 19, incidentRuns: 10, fixed: 8, medianDurationMs: 42_000 },
  steps: [],
  ...overrides,
});

const kinds = (value: RunbookHealthInput) =>
  runbookHealthInsights(value, NOW).map(item => item.kind);

describe('summarizeRunbookEffectiveness', () => {
  it('reports rates with a Wilson lower bound below the raw rate', () => {
    const summary = summarizeRunbookEffectiveness(input());
    expect(summary.successRate).toBeCloseTo(0.95);
    expect(summary.successLowerBound).toBeGreaterThan(0.7);
    expect(summary.successLowerBound).toBeLessThan(0.95);
    expect(summary.fixedRate).toBeCloseTo(0.8);
    expect(summary.fixedLowerBound).toBeLessThan(0.8);
    expect(summary.medianDurationMs).toBe(42_000);
  });

  it('has no rates without runs and no fix rate without incident runs', () => {
    const summary = summarizeRunbookEffectiveness(
      input({
        runs: { eligible: 0, succeeded: 0, incidentRuns: 0, fixed: 0, medianDurationMs: null },
      })
    );
    expect(summary.successRate).toBeNull();
    expect(summary.successLowerBound).toBeNull();
    expect(summary.fixedRate).toBeNull();
    expect(summary.mostFailingStep).toBeNull();
  });

  it('picks the step that fails most reliably, not the one that failed once out of once', () => {
    const summary = summarizeRunbookEffectiveness(
      input({
        steps: [
          step({ stepKey: 'once', name: 'Once', runs: 1, failed: 1 }),
          step({
            stepKey: 'often',
            name: 'Often',
            runs: 20,
            failed: 12,
            topErrorCode: 'E_TIMEOUT',
          }),
          step({ stepKey: 'fine', name: 'Fine', runs: 20, failed: 0 }),
        ],
      })
    );
    expect(summary.mostFailingStep).toMatchObject({
      stepKey: 'often',
      failureRate: 0.6,
      topErrorCode: 'E_TIMEOUT',
    });
  });
});

describe('runbookHealthInsights', () => {
  it('says nothing about a healthy runbook', () => {
    expect(runbookHealthInsights(input(), NOW)).toEqual([]);
  });

  it('flags a runbook that fails often, critical when most runs fail', () => {
    const half = runbookHealthInsights(
      input({
        runs: { eligible: 20, succeeded: 10, incidentRuns: 0, fixed: 0, medianDurationMs: null },
      }),
      NOW
    );
    expect(half).toMatchObject([
      { key: 'fails-often', kind: 'RUNBOOK_FAILS_OFTEN', severity: 'warning' },
    ]);
    expect(half[0].evidence).toMatchObject({ failed: 10, eligible: 20, failureRate: 0.5 });
    const most = runbookHealthInsights(
      input({
        runs: { eligible: 20, succeeded: 2, incidentRuns: 0, fixed: 0, medianDurationMs: null },
      }),
      NOW
    );
    expect(most[0].severity).toBe('critical');
  });

  it('does not call two failures out of three "often"', () => {
    expect(
      kinds(
        input({
          runs: { eligible: 3, succeeded: 1, incidentRuns: 0, fixed: 0, medianDurationMs: null },
        })
      )
    ).toEqual([]);
  });

  it('flags a published runbook unused for 90 days, but not a new or unpublished one', () => {
    const idle = { eligible: 0, succeeded: 0, incidentRuns: 0, fixed: 0, medianDurationMs: null };
    expect(kinds(input({ runs: idle, lastRunAt: daysAgo(91) }))).toEqual(['RUNBOOK_UNUSED']);
    expect(kinds(input({ runs: idle, lastRunAt: null }))).toEqual(['RUNBOOK_UNUSED']);
    expect(kinds(input({ runs: idle, lastRunAt: daysAgo(89) }))).toEqual([]);
    expect(kinds(input({ runs: idle, lastRunAt: null, publishedAt: daysAgo(10) }))).toEqual([]);
    expect(kinds(input({ runs: idle, lastRunAt: null, publishedAt: null }))).toEqual([]);
    expect(kinds(input({ runs: idle, lastRunAt: null, archived: true }))).toEqual([]);
  });

  it('flags a step failing in more than 30% of runs and names its top error', () => {
    const items = runbookHealthInsights(
      input({
        steps: [
          step({ runs: 10, failed: 4, topErrorCode: 'AGENT_TIMEOUT', topErrorCount: 3 }),
          step({ stepKey: 'edge', name: 'Edge', runs: 10, failed: 3 }),
          step({ stepKey: 'few', name: 'Few', runs: 4, failed: 4 }),
        ],
      }),
      NOW
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'step-failing:restart',
      kind: 'RUNBOOK_STEP_FAILING',
      severity: 'warning',
      title: 'Step "Restart service" fails in 40% of runs (mostly AGENT_TIMEOUT)',
    });
  });

  it('flags a step that needed a retry in every run', () => {
    expect(
      runbookHealthInsights(
        input({
          steps: [
            step({ runs: 4, retried: 4 }),
            step({ stepKey: 'mostly', name: 'Mostly', runs: 4, retried: 3 }),
            step({ stepKey: 'twice', name: 'Twice', runs: 2, retried: 2 }),
          ],
        }),
        NOW
      )
    ).toMatchObject([{ key: 'step-retried:restart', kind: 'RUNBOOK_STEP_ALWAYS_RETRIED' }]);
  });
});

describe('missingStepInsights', () => {
  const run = (executionId: string, ...notes: string[]) => ({ executionId, notes });

  it('suggests a step when most runs are followed by the same note', () => {
    const items = missingStepInsights([
      run('e1', 'Cleared the CDN cache afterwards'),
      run('e2', 'cleared CDN cache afterwards.', 'cleared CDN cache afterwards.'),
      run('e3', 'Clearing the CDN cache afterwards'),
      run('e4', 'Paged the database team'),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'RUNBOOK_MISSING_STEP', severity: 'info' });
    expect(items[0].evidence).toMatchObject({ runsWithNote: 3, runs: 4 });
  });

  it('stays quiet when the note follows only a minority of runs or there are too few runs', () => {
    const repeated = 'Cleared the CDN cache afterwards';
    expect(
      missingStepInsights([
        run('e1', repeated),
        run('e2', repeated),
        run('e3', repeated),
        run('e4'),
        run('e5'),
        run('e6'),
      ])
    ).toEqual([]);
    expect(missingStepInsights([run('e1', repeated), run('e2', repeated)])).toEqual([]);
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

describe('missingRunbookInsights', () => {
  const notes = (count: number, text = 'Restarted the api pods and cleared the redis cache') =>
    Array.from({ length: count }, (_, index) => ({ incidentId: `i${index}`, text }));
  const problem = { templateHash: 'h1', template: 'api latency above <num> ms', runbookRuns: 0 };

  it('suggests a runbook for three similar hand-written fixes with no runbook run', () => {
    const items = missingRunbookInsights([{ ...problem, notes: notes(3) }], { boundRunbooks: 0 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'h1', kind: 'RUNBOOK_MISSING', severity: 'info' });
    expect(items[0].evidence).toMatchObject({
      noteCount: 3,
      incidentIds: ['i0', 'i1', 'i2'],
      steps: [
        { name: 'Restart the api pods', support: 3 },
        { name: 'Clear the redis cache', support: 3 },
      ],
    });
  });

  it('stays quiet with two notes, dissimilar notes, a runbook run, or no recognisable action', () => {
    const none = (value: Parameters<typeof missingRunbookInsights>[0]) =>
      expect(missingRunbookInsights(value, { boundRunbooks: 0 })).toEqual([]);
    none([{ ...problem, notes: notes(2) }]);
    none([
      {
        ...problem,
        notes: [
          { incidentId: 'a', text: 'Restarted the api pods' },
          { incidentId: 'b', text: 'Rotated the TLS certificate' },
          { incidentId: 'c', text: 'Increased the disk quota on the volume' },
        ],
      },
    ]);
    none([{ ...problem, notes: notes(5), runbookRuns: 1 }]);
    none([{ ...problem, notes: notes(4, 'It was the upstream provider outage again') }]);
  });

  it('counts incidents, not repeated notes on one incident', () => {
    const same = Array.from({ length: 4 }, () => ({
      incidentId: 'i0',
      text: 'Restarted the api pods and cleared the redis cache',
    }));
    expect(missingRunbookInsights([{ ...problem, notes: same }], { boundRunbooks: 0 })).toEqual([]);
  });

  it('orders problems by how many incidents back them', () => {
    const items = missingRunbookInsights(
      [
        { ...problem, templateHash: 'small', notes: notes(3) },
        { ...problem, templateHash: 'big', notes: notes(6) },
      ],
      { boundRunbooks: 2 }
    );
    expect(items.map(item => item.key)).toEqual(['big', 'small']);
    expect(items[0].evidence.boundRunbooks).toBe(2);
  });
});

describe('draftRunbookFromSuggestion', () => {
  it('builds a manual-only draft the runbook editor accepts', () => {
    const draft = draftRunbookFromSuggestion(
      {
        template: 'Queue depth high on <host>  ',
        noteCount: 3,
        sampleNotes: ['Restarted the api pods and cleared the redis cache'],
        steps: [
          { name: 'Restart the api pods', support: 3 },
          { name: 'Clear the redis cache', support: 2 },
        ],
      },
      'Checkout'
    );
    expect(draft.name).toBe('Queue depth high on <host>');
    expect(draft.slug).toBe('queue-depth-high-on-host');
    expect(draft.description).toContain('3 hand-written resolution notes on Checkout');
    expect(draft.definition.steps.map(step => [step.key, step.type, step.name])).toEqual([
      ['step_1', 'MANUAL', 'Restart the api pods'],
      ['step_2', 'MANUAL', 'Clear the redis cache'],
    ]);
    expect(runbookDefinitionSchema.safeParse(draft.definition).success).toBe(true);
    expect(createRunbookSchema.safeParse(draft).success).toBe(true);
  });

  it('falls back to a safe name and slug for an empty template', () => {
    const draft = draftRunbookFromSuggestion(
      {
        template: ' ',
        noteCount: 3,
        sampleNotes: [],
        steps: [{ name: 'Restart it now', support: 3 }],
      },
      'Checkout'
    );
    expect(draft.name).toBe('Suggested runbook');
    expect(draft.slug).toBe('suggested-runbook');
  });
});
