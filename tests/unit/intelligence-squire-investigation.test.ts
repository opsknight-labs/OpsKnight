import { describe, expect, it, vi } from 'vitest';
import type {
  AiStructuredRequest,
  AiToolDefinition,
  LanguageModelPort,
} from '@/lib/intelligence/ai/port';
import {
  INVESTIGATION_LIMITS,
  renderDiagnosis,
  runInvestigation,
  type EvidenceEntry,
  type InvestigationInput,
  type InvestigationOutcome,
} from '@/lib/intelligence/squire/investigation/engine';
import {
  diagnosticCue,
  wantsInvestigation,
} from '@/lib/intelligence/squire/investigation/classify';
import type { SquireInvestigationStep } from '@/lib/intelligence/squire/contract';

type Plan = { thought: string; calls: Array<{ tool: string; input: string }>; done: boolean };
type Diagnosis = {
  summary: string;
  hypotheses: Array<{ title: string; explanation: string; confidence: number; evidence: string[] }>;
  nextChecks: string[];
};

/** A scripted model: each structured call takes the next object; usage is configurable per call. */
function scriptedPort(
  objects: Array<Plan | Diagnosis | Error>,
  usage: [number, number] = [100, 50]
): LanguageModelPort & { requests: AiStructuredRequest<unknown>[] } {
  const requests: AiStructuredRequest<unknown>[] = [];
  return {
    requests,
    generate: vi.fn(),
    stream: vi.fn(),
    async generateStructured<T>(request: AiStructuredRequest<T>) {
      requests.push(request as AiStructuredRequest<unknown>);
      const next = objects.shift();
      if (!next || next instanceof Error) throw next ?? new Error('script exhausted');
      const checked = request.schema.safeParse(next);
      if (!checked.success) throw new Error('invalid scripted object');
      return {
        object: checked.data,
        usage: { inputTokens: usage[0], outputTokens: usage[1] },
        served: { providerId: 'p', model: 'm', fallbackDepth: 0 },
      };
    },
  } as LanguageModelPort & { requests: AiStructuredRequest<unknown>[] };
}

/** A ledger that records one evidence entry per successful read, like the real registry. */
function harness(options: { delayMs?: number; fail?: Set<string> } = {}) {
  const entries: EvidenceEntry[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const calls: Array<{ tool: string; input: unknown }> = [];
  const tool = (name: string): AiToolDefinition => ({
    name,
    description: `Read ${name}`,
    kind: 'READ',
    inputSchema: { type: 'object' },
    execute: async input => {
      calls.push({ tool: name, input });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, options.delayMs ?? 5));
      inFlight -= 1;
      if (options.fail?.has(name)) return { error: 'Not found, or you do not have access to it.' };
      const id = `${name}-${entries.length + 1}`;
      const handle = `00000000-0000-4000-8000-${String(entries.length + 1).padStart(12, '0')}`;
      entries.push({ handle, kind: 'alert', id, label: `Alert ${id}`, href: `/alerts/${id}` });
      return { data: { id }, evidence: [{ handle }] };
    },
  });
  return {
    entries,
    calls,
    get maxInFlight() {
      return maxInFlight;
    },
    tools: [
      'get_alert_payload',
      'get_recent_changes',
      'get_service',
      'get_slo_status',
      'list_alerts',
    ].map(tool),
  };
}

function inputFor(
  h: ReturnType<typeof harness>,
  planner: LanguageModelPort,
  diagnoser: LanguageModelPort,
  extra: Partial<InvestigationInput> = {}
): InvestigationInput {
  return {
    question: 'Why is checkout failing?',
    preamble: [{ role: 'system', content: 'rules', dataClass: 'PERSONAL' }],
    context: { actorId: 'u1', callSite: 'interactive', dataClass: 'PERSONAL' },
    dataClass: 'PERSONAL',
    planner,
    diagnoser,
    tools: h.tools,
    labels: { get_alert_payload: 'Reading the alert payload' },
    ledger: { entries: () => h.entries },
    envelope: value => `[untrusted]\n${JSON.stringify(value)}`,
    ...extra,
  };
}

async function drain(
  run: AsyncGenerator<
    { type: 'investigation'; step: SquireInvestigationStep },
    InvestigationOutcome
  >
) {
  const steps: SquireInvestigationStep[] = [];
  for (;;) {
    const next = await run.next();
    if (next.done) return { steps, outcome: next.value };
    steps.push(next.value.step);
  }
}

const call = (tool: string, input: Record<string, unknown> = { id: 'x' }) => ({
  tool,
  input: JSON.stringify(input),
});

describe('investigation loop', () => {
  it('runs planned reads in parallel (at most 4 per step) and concludes with ranked, evidence-backed hypotheses', async () => {
    const h = harness({ delayMs: 20 });
    const planner = scriptedPort([
      {
        thought: 'Check the alert, changes, service and SLOs together',
        calls: [
          call('get_alert_payload', { incidentId: 'i', alertId: 'a' }),
          call('get_recent_changes', { hours: 6 }),
          call('get_service', { id: 's' }),
          call('get_slo_status', { serviceId: 's' }),
          call('list_alerts', { id: 'i' }),
        ],
        done: false,
      },
      { thought: 'Enough', calls: [], done: true },
    ]);
    const diagnoser = scriptedPort([]);
    // The diagnosis cites the first two reads, an unknown handle, and one hypothesis with no evidence.
    const run = runInvestigation(
      inputFor(h, planner, {
        ...diagnoser,
        generateStructured: async <T>(request: AiStructuredRequest<T>) =>
          scriptedPort([
            {
              summary: 'Most likely the deploy.',
              hypotheses: [
                {
                  title: 'Pool exhausted',
                  explanation: 'Alert shows connection errors.',
                  confidence: 0.4,
                  evidence: [h.entries[0].handle],
                },
                {
                  title: 'Bad deploy',
                  explanation: 'A deploy landed 10 minutes before onset.',
                  confidence: 0.8,
                  evidence: [h.entries[1].handle, 'ffffffff-ffff-4fff-8fff-ffffffffffff'],
                },
                {
                  title: 'Cosmic rays',
                  explanation: 'No evidence.',
                  confidence: 0.9,
                  evidence: ['nope'],
                },
              ],
              nextChecks: ['Roll back the deploy in staging'],
            },
          ]).generateStructured(request),
      })
    );
    const { steps, outcome } = await drain(run);
    expect(h.calls).toHaveLength(4);
    expect(h.maxInFlight).toBe(4);
    expect(h.calls.map(c => c.tool)).not.toContain('list_alerts');
    expect(planner.requests[0].context.capability).toBe('CLASSIFY');
    // Running then done for step 1, then the conclusion step.
    expect(steps.map(step => `${step.index}:${step.status}`)).toEqual([
      '1:running',
      '1:done',
      '2:running',
      '2:done',
    ]);
    expect(outcome.partial).toBe(false);
    expect(outcome.stop).toBe('concluded');
    expect(outcome.reads).toBe(4);
    const text = outcome.answer;
    expect(text.indexOf('Bad deploy')).toBeLessThan(text.indexOf('Pool exhausted'));
    expect(text).toContain('confidence 80% (high)');
    expect(text).not.toContain('Cosmic rays');
    expect(text).toContain('1 suggested explanation was left out');
    expect(text).toContain(`(${h.entries[1].href})`);
    expect(text).not.toContain('ffffffff-ffff');
    expect(text).toContain('Roll back the deploy in staging');
  });

  it('uses the DIAGNOSE capability for the conclusion and passes evidence handles to it', async () => {
    const h = harness();
    const planner = scriptedPort([
      { thought: 'read', calls: [call('get_service')], done: false },
      { thought: 'done', calls: [], done: true },
    ]);
    const diagnoser = scriptedPort([{ summary: 's', hypotheses: [], nextChecks: [] }]);
    const { outcome } = await drain(runInvestigation(inputFor(h, planner, diagnoser)));
    expect(diagnoser.requests[0].context.capability).toBe('DIAGNOSE');
    const prompt = diagnoser.requests[0].messages.at(-1)!.content;
    expect(prompt).toContain(h.entries[0].handle);
    expect(prompt).toContain('[untrusted]');
    expect(outcome.answer).toContain('No hypothesis was supported by evidence');
  });

  it('stops at 12 steps and returns a partial answer from the evidence read', async () => {
    const h = harness({ delayMs: 0 });
    const plans: Plan[] = Array.from({ length: 20 }, (_, i) => ({
      thought: `step ${i + 1}`,
      calls: [call('get_service', { id: `s${i}` })],
      done: false,
    }));
    const planner = scriptedPort(plans, [10, 10]);
    const diagnoser = scriptedPort([]);
    const { steps, outcome } = await drain(
      runInvestigation(inputFor(h, planner, diagnoser, { maxSteps: 50 }))
    );
    expect(planner.requests).toHaveLength(INVESTIGATION_LIMITS.maxSteps);
    expect(new Set(steps.map(step => step.index)).size).toBe(12);
    expect(outcome).toMatchObject({ partial: true, stop: 'steps', reads: 12 });
    expect(diagnoser.requests).toHaveLength(0);
    expect(outcome.answer).toContain('## Investigation (partial)');
    expect(outcome.answer).toContain('the step limit (12) was reached');
    expect(outcome.answer).toContain(`[Alert ${h.entries[0].id}](${h.entries[0].href})`);
  });

  it('stops under the token ceiling and never calls the diagnosis model it cannot afford', async () => {
    const h = harness();
    const planner = scriptedPort(
      Array.from({ length: 5 }, (_, i) => ({
        thought: `t${i}`,
        calls: [call('get_service', { id: `s${i}` })],
        done: false,
      })),
      [5_000, 1_000]
    );
    const diagnoser = scriptedPort([]);
    const { outcome } = await drain(
      runInvestigation(inputFor(h, planner, diagnoser, { tokenCeiling: 20_000 }))
    );
    expect(outcome.stop).toBe('budget');
    expect(outcome.partial).toBe(true);
    expect(outcome.tokens).toBeLessThanOrEqual(20_000);
    expect(planner.requests.length).toBeLessThan(5);
    expect(diagnoser.requests).toHaveLength(0);
    expect(outcome.answer).toContain('token budget was reached');
  });

  it('skips unknown tools, malformed input and repeated calls', async () => {
    const h = harness();
    const planner = scriptedPort([
      {
        thought: 'mixed',
        calls: [
          { tool: 'drop_database', input: '{}' },
          { tool: 'get_service', input: 'not json' },
          call('get_service', { id: 'a' }),
          call('get_service', { id: 'a' }),
        ],
        done: false,
      },
      { thought: 'again', calls: [call('get_service', { id: 'a' })], done: false },
    ]);
    const diagnoser = scriptedPort([{ summary: 's', hypotheses: [], nextChecks: [] }]);
    const { outcome } = await drain(runInvestigation(inputFor(h, planner, diagnoser)));
    expect(h.calls).toEqual([{ tool: 'get_service', input: { id: 'a' } }]);
    // The second plan only repeats a read, so the loop concludes.
    expect(outcome.stop).toBe('concluded');
  });

  it('records failed reads and still concludes', async () => {
    const h = harness({ fail: new Set(['get_slo_status']) });
    const planner = scriptedPort([
      { thought: 'slo', calls: [call('get_slo_status', { serviceId: 'hidden' })], done: false },
      { thought: 'done', calls: [], done: true },
    ]);
    const diagnoser = scriptedPort([{ summary: 's', hypotheses: [], nextChecks: [] }]);
    const { steps } = await drain(runInvestigation(inputFor(h, planner, diagnoser)));
    expect(steps[1]).toMatchObject({ status: 'failed', calls: [{ ok: false }] });
  });

  it('throws when planning fails before anything is read, so the caller can fall back', async () => {
    const h = harness();
    const planner = scriptedPort([new Error('provider down')]);
    await expect(drain(runInvestigation(inputFor(h, planner, scriptedPort([]))))).rejects.toThrow(
      'provider down'
    );
  });

  it('returns a partial answer when planning or diagnosis fails after reads', async () => {
    const h = harness();
    const plannerFails = scriptedPort([
      { thought: 'read', calls: [call('get_service')], done: false },
      new Error('Daily AI budget reached'),
    ]);
    const first = await drain(runInvestigation(inputFor(h, plannerFails, scriptedPort([]))));
    expect(first.outcome).toMatchObject({ partial: true, stop: 'budget' });

    const diagnosisFails = scriptedPort([
      { thought: 'read', calls: [call('get_service', { id: 'z' })], done: false },
      { thought: 'done', calls: [], done: true },
    ]);
    const second = await drain(
      runInvestigation(inputFor(h, diagnosisFails, scriptedPort([new Error('bad output')])))
    );
    expect(second.outcome).toMatchObject({ partial: true, stop: 'diagnosis_failed' });
    expect(second.steps.at(-1)).toMatchObject({ title: 'Weighing the evidence', status: 'failed' });
    expect(second.outcome.answer).toContain('### Evidence read');
  });

  it('stops when the request is cancelled', async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort();
    const { outcome } = await drain(
      runInvestigation(
        inputFor(h, scriptedPort([]), scriptedPort([]), {
          context: {
            actorId: 'u',
            callSite: 'interactive',
            dataClass: 'PERSONAL',
            signal: controller.signal,
          },
        })
      )
    );
    expect(outcome).toMatchObject({ partial: true, stop: 'aborted', reads: 0 });
  });
});

describe('rendering', () => {
  it('renders evidence without a page as plain text and strips link syntax from labels', () => {
    const { text, shown } = renderDiagnosis(
      {
        summary: 'x',
        hypotheses: [{ title: 'T', explanation: 'E', confidence: 0.2, evidence: ['h1', 'h1'] }],
        nextChecks: [],
      },
      [{ handle: 'h1', kind: 'person', id: 'u1', label: 'A [b](c)', href: null }],
      { steps: 1, reads: 1 }
    );
    expect(shown).toBe(1);
    expect(text).toContain('Evidence: A b(c) (person)');
    expect(text).toContain('confidence 20% (low)');
  });
});

describe('investigation trigger', () => {
  it('decides clear cases without a model', () => {
    expect(diagnosticCue('Why is checkout returning 500s?')).toBe('yes');
    expect(diagnosticCue('investigate this incident')).toBe('yes');
    expect(diagnosticCue('What is the root cause?')).toBe('yes');
    expect(diagnosticCue('is the latency spike related to the deploy?')).toBe('maybe');
    expect(diagnosticCue('who is on call?')).toBe('no');
    expect(diagnosticCue('acknowledge this incident')).toBe('no');
    expect(diagnosticCue('/resolve fixed')).toBe('no');
    expect(diagnosticCue('list open incidents')).toBe('no');
  });

  it('asks the classifier only for ambiguous questions on an incident, and treats failure as no', async () => {
    const context = {
      actorId: 'u',
      callSite: 'interactive' as const,
      dataClass: 'PERSONAL' as const,
    };
    const classifier = vi.fn(
      async () =>
        ({
          generateStructured: async () => ({
            object: { investigate: true },
            usage: { inputTokens: 1, outputTokens: 1 },
            served: { providerId: 'p', model: 'm', fallbackDepth: 0 },
          }),
        }) as unknown as LanguageModelPort
    );
    const base = { classifier, context, dataClass: 'PERSONAL' as const };
    expect(await wantsInvestigation('why is it down?', { ...base, onIncident: false })).toBe(true);
    expect(classifier).not.toHaveBeenCalled();
    expect(await wantsInvestigation('is the spike related?', { ...base, onIncident: false })).toBe(
      false
    );
    expect(await wantsInvestigation('is the spike related?', { ...base, onIncident: true })).toBe(
      true
    );
    expect(classifier).toHaveBeenCalledTimes(1);
    expect(
      await wantsInvestigation('is the spike related?', {
        ...base,
        onIncident: true,
        classifier: async () =>
          ({
            generateStructured: async () => {
              throw new Error('down');
            },
          }) as unknown as LanguageModelPort,
      })
    ).toBe(false);
  });
});
