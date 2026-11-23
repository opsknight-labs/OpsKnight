import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';

// A fake turn: it waits for the abort signal, then sends what it has, as an investigation does.
const turn = vi.hoisted(() => ({
  run: null as null | ((signal: AbortSignal) => AsyncGenerator<SquireEvent>),
}));
vi.mock('@/lib/intelligence/squire/chat', () => ({
  streamSquire: (_actor: unknown, _request: unknown, signal: AbortSignal) => turn.run!(signal),
}));

import { collectSquireTurn } from '@/lib/intelligence/squire/surfaces';

const actor = { id: 'u1', role: 'RESPONDER', status: 'ACTIVE', teamIds: [] } as never;
const aborted = (signal: AbortSignal) =>
  new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
const step = { type: 'investigation', step: { index: 1, title: 'Read', calls: [] } } as never;

afterEach(() => {
  vi.useRealTimers();
});

describe('collectSquireTurn deadlines', () => {
  it('keeps the partial answer an investigation sends after the deadline', async () => {
    turn.run = async function* (signal) {
      yield step;
      await aborted(signal);
      yield { type: 'delta', text: '## Investigation (partial)\n\nI stopped before…' };
    };
    const answer = await collectSquireTurn(
      actor,
      { message: 'why is checkout failing?' },
      { timeoutMs: 20, investigationTimeoutMs: 60 }
    );
    expect(answer.error).toBeUndefined();
    expect(answer.text).toContain('Investigation (partial)');
    expect(answer.notices).toContain('This answer was cut short.');
  });

  it('gives an investigation its longer bound instead of the ordinary one', async () => {
    let stoppedAfter = 0;
    turn.run = async function* (signal) {
      const started = Date.now();
      yield step;
      await aborted(signal);
      stoppedAfter = Date.now() - started;
      yield { type: 'delta', text: 'partial' };
    };
    await collectSquireTurn(
      actor,
      { message: 'investigate' },
      { timeoutMs: 10, investigationTimeoutMs: 120 }
    );
    expect(stoppedAfter).toBeGreaterThanOrEqual(100);
  });

  it('stops waiting for a turn that never winds down', async () => {
    vi.useFakeTimers();
    turn.run = async function* () {
      yield { type: 'delta', text: 'so far' };
      await new Promise(() => undefined);
    };
    const pending = collectSquireTurn(actor, { message: 'hello' }, { timeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000 + 10_000);
    const answer = await pending;
    expect(answer.text).toBe('so far');
    expect(answer.notices).toContain('This answer was cut short.');
  });
});
