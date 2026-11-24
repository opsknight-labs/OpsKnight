import { trace } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { traceReadTool, traceTurn } from '@/lib/intelligence/squire/tracing';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';
import { installFakeTracer, type FakeSpan } from '../helpers/fake-tracer';

const SECRET_ID = 'inc_cmws5g6s6000rbozpa3erkv0l';
const QUESTION = 'why is checkout slow for customer acme?';

let spans: FakeSpan[];
beforeEach(() => {
  trace.disable();
  spans = installFakeTracer();
});
afterEach(() => {
  trace.disable();
  vi.useRealTimers();
});

async function* events(list: SquireEvent[]): AsyncGenerator<SquireEvent> {
  for (const event of list) yield event;
}

async function drain(turn: AsyncGenerator<SquireEvent>) {
  for await (const _event of turn) void _event;
}

/** Only bounded categories, counts and flags: no id, question or answer text anywhere on the span. */
function expectBounded(span: FakeSpan) {
  const text = JSON.stringify(span);
  expect(text).not.toContain(SECRET_ID);
  expect(text).not.toContain('acme');
  expect(text).not.toContain('Checkout');
  for (const value of Object.values(span.attributes))
    if (typeof value === 'string') expect(value).toMatch(/^[A-Za-z_]+$/);
}

describe('squire.turn span', () => {
  it('records mode, outcome and counts for a completed AI turn', async () => {
    await drain(
      traceTurn(
        events([
          { type: 'meta', mode: 'ai', name: 'Pip' },
          { type: 'tool', label: 'Reading the incident' },
          { type: 'tool', label: 'Checking recent changes' },
          { type: 'delta', text: `Checkout ${SECRET_ID} is slow (${QUESTION})` },
          {
            type: 'citations',
            items: [
              { kind: 'incident', id: SECRET_ID, label: 'x', href: `/incidents/${SECRET_ID}` },
            ],
          },
          {
            type: 'proposal',
            proposal: { incidentId: SECRET_ID } as never,
          },
          { type: 'done' },
        ])
      )
    );
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      name: 'squire.turn',
      ended: true,
      attributes: {
        'squire.mode': 'ai',
        'squire.outcome': 'completed',
        'squire.tool_calls': 2,
        'squire.proposals': 1,
        'squire.interrupted': false,
      },
    });
    expectBounded(spans[0]);
  });

  it('reports investigation reads once per step and an error outcome', async () => {
    const step = { index: 0, title: SECRET_ID, calls: [{ tool: 'get_incident', label: 'x' }] };
    await drain(
      traceTurn(
        events([
          { type: 'meta', mode: 'ai', name: 'Pip' },
          { type: 'investigation', step: { ...step, status: 'running' } },
          { type: 'investigation', step: { ...step, status: 'done' } },
          { type: 'error', message: `failed on ${SECRET_ID}` },
        ])
      )
    );
    expect(spans[0].attributes).toMatchObject({
      'squire.mode': 'investigation',
      'squire.outcome': 'error',
      'squire.tool_calls': 1,
    });
    expectBounded(spans[0]);
  });

  it('marks a turn stopped mid-answer as aborted and interrupted', async () => {
    const controller = new AbortController();
    const turn = traceTurn(
      events([
        { type: 'meta', mode: 'basic', name: 'Pip' },
        { type: 'delta', text: QUESTION },
        { type: 'done' },
      ]),
      controller.signal
    );
    await turn.next();
    await turn.next();
    controller.abort();
    await turn.return(undefined);
    expect(spans[0]).toMatchObject({
      ended: true,
      attributes: {
        'squire.mode': 'basic',
        'squire.outcome': 'aborted',
        'squire.interrupted': true,
      },
    });
    expectBounded(spans[0]);
  });
});

describe('squire.tool span', () => {
  const tool = (execute: (input: unknown) => Promise<unknown>) =>
    traceReadTool({
      name: 'get_incident',
      description: 'd',
      kind: 'READ',
      inputSchema: {},
      execute,
    });

  it('names the tool and records ok or error by outcome only', async () => {
    await tool(async () => ({ title: 'Checkout', id: SECRET_ID })).execute!({ id: SECRET_ID });
    await tool(async () => ({ error: 'Not found' })).execute!({ id: SECRET_ID });
    await expect(
      tool(async () => Promise.reject(new Error(SECRET_ID))).execute!({ id: SECRET_ID })
    ).rejects.toThrow();
    expect(
      spans.map(span => [
        span.name,
        span.attributes['squire.tool'],
        span.attributes['squire.tool.outcome'],
      ])
    ).toEqual([
      ['squire.tool', 'get_incident', 'ok'],
      ['squire.tool', 'get_incident', 'error'],
      ['squire.tool', 'get_incident', 'error'],
    ]);
    spans.forEach(expectBounded);
  });

  it('records a deadline as a timeout', async () => {
    vi.useFakeTimers();
    const running = tool(() => new Promise(() => undefined)).execute!({});
    const settled = expect(running).rejects.toMatchObject({ name: 'ToolDeadlineError' });
    await vi.advanceTimersByTimeAsync(20_001);
    await settled;
    expect(spans[0].attributes['squire.tool.outcome']).toBe('timeout');
  });

  it('leaves proposal tools untouched', () => {
    const proposal = {
      name: 'propose_x',
      description: 'd',
      kind: 'PROPOSE_WRITE' as const,
      inputSchema: {},
    };
    expect(traceReadTool(proposal)).toBe(proposal);
  });
});
