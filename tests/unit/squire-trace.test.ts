import { describe, expect, it } from 'vitest';
import { withTrace } from '@/lib/intelligence/squire/chat';
import { squireTraceSchema, type SquireEvent } from '@/lib/intelligence/squire/contract';

async function* from(events: SquireEvent[]): AsyncGenerator<SquireEvent> {
  yield* events;
}

async function collect(events: SquireEvent[], served = {}) {
  const out: SquireEvent[] = [];
  for await (const event of withTrace(from(events), served, Date.now() - 1_500)) out.push(event);
  return out;
}

const served = {
  model: 'm',
  provider: 'Anthropic',
  tokens: { input: 900, output: 40, cacheRead: 800 },
};

describe('turn trace', () => {
  it('sends what the AI answer read, its model and tokens just before done', async () => {
    const out = await collect(
      [
        { type: 'meta', mode: 'ai', name: 'Pip' },
        { type: 'tool', label: 'Reading the incident' },
        {
          type: 'investigation',
          step: {
            index: 1,
            title: 'Check',
            status: 'done',
            calls: [
              { tool: 'get_incident', label: 'Reading the incident' },
              { tool: 'list_alerts', label: 'Reading the alerts' },
            ],
          },
        },
        { type: 'delta', text: 'The pool is exhausted.' },
        {
          type: 'citations',
          items: [{ kind: 'incident', id: 'i1', label: 'Pool exhausted', href: '/incidents/i1' }],
        },
        {
          type: 'memory',
          turn: { mode: 'ai', verified: true },
        },
        { type: 'done' },
      ],
      served
    );
    expect(out.map(event => event.type).slice(-2)).toEqual(['trace', 'done']);
    const trace = out.find(event => event.type === 'trace');
    if (trace?.type !== 'trace') throw new Error('no trace');
    expect(trace.trace).toMatchObject({
      mode: 'ai',
      tools: ['Reading the incident', 'Reading the alerts'],
      sources: ['Pool exhausted'],
      ...served,
      verified: true,
    });
    expect(trace.trace.durationMs).toBeGreaterThanOrEqual(1_500);
    expect(squireTraceSchema.safeParse(trace.trace).success).toBe(true);
  });

  it('leaves the model out of a basic answer, even one that replaced a failed model call', async () => {
    const out = await collect(
      [
        { type: 'meta', mode: 'ai', name: 'Pip' },
        { type: 'meta', mode: 'basic', name: 'Pip' },
        { type: 'delta', text: 'Two incidents are open.' },
        { type: 'done' },
      ],
      served
    );
    const trace = out.find(event => event.type === 'trace');
    expect(trace).toEqual({
      type: 'trace',
      trace: {
        mode: 'basic',
        tools: [],
        sources: [],
        durationMs: expect.any(Number),
        verified: false,
      },
    });
  });

  it('sends no trace for a turn that ends in an error', async () => {
    const out = await collect([
      { type: 'meta', mode: 'ai', name: 'Pip' },
      { type: 'error', message: 'Something went wrong. Please try again.' },
    ]);
    expect(out.some(event => event.type === 'trace')).toBe(false);
  });
});
