import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const actor = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: actor.get }));

const turns = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('@/lib/intelligence/squire/chat', () => ({ streamSquire: turns.run }));

const store = vi.hoisted(() => ({ status: vi.fn(), record: vi.fn() }));
vi.mock('@/lib/intelligence/conversations/store', () => ({
  getHistoryStatus: store.status,
  recordExchange: store.record,
}));

const background = vi.hoisted(() => ({ handedOff: vi.fn() }));
vi.mock('@/lib/intelligence/conversations/background', () => ({
  hasBackgroundHandOff: background.handedOff,
}));
vi.mock('@/lib/intelligence/conversations/background-run', () => ({
  startBackgroundTurns: vi.fn(async () => undefined),
}));

const incidents = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/intelligence/squire/deterministic', () => ({
  readIncidentForActor: incidents.read,
}));

import { POST } from '@/app/api/intelligence/squire/route';

const URL_ = 'http://localhost:3000/api/intelligence/squire';
const make = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function* events() {
  yield { type: 'meta', mode: 'basic', name: 'Squire' };
  yield { type: 'delta', text: 'hi' };
  yield { type: 'done' };
}

beforeEach(() => {
  actor.get.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' });
  turns.run.mockReset().mockImplementation(events);
  store.status.mockReset().mockResolvedValue({ enabled: false, retentionDays: 30 });
  store.record.mockReset().mockResolvedValue('conv1');
  background.handedOff.mockReset().mockResolvedValue(false);
  incidents.read
    .mockReset()
    .mockImplementation(async (_actor: unknown, id: string) => (id === 'inc1' ? { id } : null));
});

describe('POST /api/intelligence/squire', () => {
  it('streams newline-delimited JSON events with safe headers', async () => {
    const response = await POST(make({ message: 'hello' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    const lines = (await response.text())
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(lines).toEqual([
      { type: 'meta', mode: 'basic', name: 'Squire' },
      { type: 'delta', text: 'hi' },
      { type: 'done' },
    ]);
    expect(turns.run).toHaveBeenCalledWith(
      { id: 'u1', role: 'ADMIN' },
      { message: 'hello', history: [] },
      expect.any(AbortSignal)
    );
  });

  it('rejects cross-site requests, non-JSON bodies and anonymous callers before doing any work', async () => {
    expect(
      (
        await POST(
          make({ message: 'x' }, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })
        )
      ).status
    ).toBe(403);
    // A sibling subdomain is also refused: it could be a different, less trusted application.
    expect((await POST(make({ message: 'x' }, { 'sec-fetch-site': 'same-site' }))).status).toBe(
      403
    );
    expect((await POST(make({ message: 'x' }, { 'content-type': 'text/plain' }))).status).toBe(415);
    actor.get.mockRejectedValueOnce(new Error('no session'));
    expect((await POST(make({ message: 'x' }))).status).toBe(401);
    expect(turns.run).not.toHaveBeenCalled();
  });

  it('accepts same-origin browser requests even when a proxy changes the host the server sees', async () => {
    // Browser origin differs from the URL the server was reached on, as behind a reverse proxy.
    const proxied = make(
      { message: 'x' },
      { 'sec-fetch-site': 'same-origin', origin: 'https://ops.example.com' }
    );
    expect((await POST(proxied)).status).toBe(200);
    expect((await POST(make({ message: 'x' }, { 'sec-fetch-site': 'none' }))).status).toBe(200);
  });

  it('validates the body strictly and bounds its size', async () => {
    expect((await POST(make('{not json'))).status).toBe(400);
    expect((await POST(make({ message: '' }))).status).toBe(400);
    expect(
      (await POST(make({ message: 'x', history: [{ role: 'system', content: 'root' }] }))).status
    ).toBe(400);
    expect((await POST(make({ message: 'x', admin: true }))).status).toBe(400);
    expect((await POST(make({ message: 'x'.repeat(70_000) }))).status).toBe(413);
    expect(turns.run).not.toHaveBeenCalled();
  });

  it('accepts at most five @-mentions of known kinds, as bare kind and id', async () => {
    const mention = (kind: string, id = 'svc_1') => ({ kind, id });
    const bad = [
      [mention('alert')],
      [mention('service', '')],
      [mention('service', 'x'.repeat(65))],
      [{ ...mention('service'), label: 'Checkout API' }],
      Array.from({ length: 6 }, (_, i) => mention('team', `t${i}`)),
    ];
    for (const mentions of bad)
      expect((await POST(make({ message: 'x', mentions }))).status).toBe(400);
    expect(turns.run).not.toHaveBeenCalled();

    const mentions = [mention('service'), mention('person', 'u2'), mention('incident', 'inc1')];
    expect((await POST(make({ message: 'x', mentions }))).status).toBe(200);
    expect(turns.run).toHaveBeenCalledWith(
      expect.anything(),
      { message: 'x', history: [], mentions },
      expect.any(AbortSignal)
    );
  });

  it('aborts the turn when the client disconnects', async () => {
    let signal: AbortSignal | undefined;
    turns.run.mockImplementation(async function* (
      _actor: unknown,
      _request: unknown,
      s: AbortSignal
    ) {
      signal = s;
      yield { type: 'delta', text: 'a' };
      yield { type: 'delta', text: 'b' };
    });
    const response = await POST(make({ message: 'x' }));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(signal?.aborted).toBe(true);
  });

  it('sends the first events without waiting for history persistence lookups', async () => {
    store.status.mockImplementation(() => new Promise(() => undefined));
    const response = await POST(make({ message: 'hello' }));
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('meta');
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('delta');
    expect(store.status).not.toHaveBeenCalled();
    await reader.cancel();
  });

  it('cancels an oversized streaming body before consuming its remaining chunks', async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(65_537));
        controller.enqueue(new Uint8Array(10));
      },
      cancel: cancelled,
    });
    const request = new NextRequest(URL_, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half',
    } as NonNullable<ConstructorParameters<typeof NextRequest>[1]> & { duplex: 'half' });
    expect((await POST(request)).status).toBe(413);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(turns.run).not.toHaveBeenCalled();
  });

  it('keeps a partial answer as interrupted when the client disconnects', async () => {
    store.status.mockResolvedValue({ enabled: true, retentionDays: 30 });
    turns.run.mockImplementation(async function* () {
      yield { type: 'delta', text: 'partial answer' };
      await new Promise(() => undefined);
    });
    const response = await POST(
      make({ message: 'hello', incidentId: 'inc1', conversationId: 'c-interrupted' })
    );
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    // It first waits briefly for a hand-off sent as the tab closed. (Earlier tests' cancelled streams
    // may still be finishing, so this looks for this request's save rather than counting calls.)
    await vi.waitFor(
      () =>
        expect(store.record).toHaveBeenCalledWith(
          expect.objectContaining({
            incidentId: 'inc1',
            answer: 'partial answer',
            turn: expect.objectContaining({ completion: 'INTERRUPTED', verified: false }),
          })
        ),
      { timeout: 4_000 }
    );
    expect(background.handedOff).toHaveBeenCalledWith('u1', 'c-interrupted', expect.any(Date));
  });

  it('does not save an interrupted first turn: the client would never learn the new conversation', async () => {
    store.status.mockResolvedValue({ enabled: true, retentionDays: 30 });
    turns.run.mockImplementation(async function* () {
      yield { type: 'delta', text: 'partial answer' };
      await new Promise(() => undefined);
    });
    const response = await POST(make({ message: 'first question' }));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise(resolve => setTimeout(resolve, 1_800));
    expect(store.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ answer: 'partial answer', question: 'first question' })
    );
    expect(background.handedOff).not.toHaveBeenCalled();
  });

  it('keeps pinging while a slow save finishes after the answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      store.status.mockResolvedValue({ enabled: true, retentionDays: 30 });
      let finishSave: (id: string) => void = () => undefined;
      store.record.mockImplementation(() => new Promise<string>(resolve => (finishSave = resolve)));
      const response = await POST(make({ message: 'hello' }));
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const lines: string[] = [];
      const readLine = async () => {
        const { value } = await reader.read();
        lines.push(decoder.decode(value));
      };
      // meta, delta, done
      for (let i = 0; i < 3; i += 1) await readLine();
      const ping = readLine();
      await vi.advanceTimersByTimeAsync(10_000);
      await ping;
      expect(lines.at(-1)).toContain('"ping"');
      finishSave('conv1');
      await readLine();
      expect(lines.at(-1)).toContain('"conversation"');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not save a cut-off copy of an answer handed to the background', async () => {
    store.status.mockResolvedValue({ enabled: true, retentionDays: 30 });
    background.handedOff.mockResolvedValue(true);
    turns.run.mockImplementation(async function* () {
      yield { type: 'delta', text: 'partial answer' };
      await new Promise(() => undefined);
    });
    const response = await POST(make({ message: 'hello', conversationId: 'c1' }));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(
      () => expect(background.handedOff).toHaveBeenCalledWith('u1', 'c1', expect.any(Date)),
      { timeout: 4_000 }
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(store.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'c1' })
    );
  });

  it('pings while a step is slow so the client can tell slow from stalled', async () => {
    vi.useFakeTimers();
    try {
      let release: () => void = () => undefined;
      turns.run.mockImplementation(async function* () {
        await new Promise<void>(resolve => {
          release = resolve;
        });
        yield { type: 'done' };
      });
      const reader = (await POST(make({ message: 'hello' }))).body!.getReader();
      const first = reader.read();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(new TextDecoder().decode((await first).value)).toBe('{"type":"ping"}\n');
      release();
      const next = await reader.read();
      expect(new TextDecoder().decode(next.value)).toBe('{"type":"done"}\n');
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves nothing while history is off', async () => {
    const lines = (await (await POST(make({ message: 'hello' }))).text())
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(lines.map(line => line.type)).toEqual(['meta', 'delta', 'done']);
    expect(store.record).not.toHaveBeenCalled();
  });

  it('with history on, saves the finished answer for the asker and returns the conversation id last', async () => {
    store.status.mockResolvedValue({ enabled: true, retentionDays: 30 });
    const response = await POST(
      make({ message: 'hello', conversationId: 'conv0', incidentId: 'inc1' })
    );
    const lines = (await response.text())
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(lines.at(-1)).toEqual({ type: 'conversation', id: 'conv1' });
    expect(store.record).toHaveBeenCalledWith({
      userId: 'u1',
      conversationId: 'conv0',
      incidentId: 'inc1',
      question: 'hello',
      answer: 'hi',
      dataClass: undefined,
      turn: {
        completion: 'COMPLETED',
        context: { kind: 'incident', id: 'inc1' },
        citations: [],
        actions: [],
        notices: [],
      },
    });
  });

  it('never links a saved conversation to an incident the asker cannot read', async () => {
    store.status.mockResolvedValue({ enabled: true, retentionDays: 30 });
    await (await POST(make({ message: 'hello', incidentId: 'someone-elses' }))).text();
    expect(store.record).toHaveBeenCalledWith(expect.objectContaining({ incidentId: undefined }));
  });

  it('does not save failed answers, and a storage failure never breaks the answer', async () => {
    store.status.mockResolvedValue({ enabled: true, retentionDays: 30 });
    turns.run.mockImplementation(async function* () {
      yield { type: 'delta', text: 'partial' };
      yield { type: 'error', message: 'boom' };
    });
    await (await POST(make({ message: 'hello' }))).text();
    expect(store.record).not.toHaveBeenCalled();

    turns.run.mockImplementation(events);
    store.record.mockRejectedValue(new Error('db down'));
    const lines = (await (await POST(make({ message: 'hello' }))).text())
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(lines.map(line => line.type)).toEqual(['meta', 'delta', 'done', 'notice']);
    expect(lines.at(-1).text).toContain('could not be saved');
  });

  it('rejects malformed conversation ids', async () => {
    expect((await POST(make({ message: 'x', conversationId: '../../etc' }))).status).toBe(400);
  });
});

it('keeps internal memory off the wire and saves action references without confirmation tokens', async () => {
  store.status.mockResolvedValue({ enabled: true, retentionDays: 30 });
  turns.run.mockImplementation(async function* () {
    yield { type: 'delta', text: 'Review this action.' };
    yield {
      type: 'proposal',
      proposal: {
        kind: 'WRITE',
        receiptId: '37c680f0-124a-4530-841a-a6110f79f7c6',
        action: 'add_note',
        title: 'Add note',
        incidentId: 'inc1',
        token: 'sealed-confirmation-canary',
      },
    };
    yield {
      type: 'memory',
      turn: {
        dataClass: 'SENSITIVE',
        verified: true,
        authorizationHash: 'a'.repeat(64),
        sources: [],
      },
    };
    yield { type: 'done' };
  });
  const response = await POST(make({ message: 'Review' }));
  const lines = (await response.text())
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  expect(lines.some(line => line.type === 'memory')).toBe(false);
  expect(store.record).toHaveBeenCalledWith(
    expect.objectContaining({
      dataClass: 'SENSITIVE',
      turn: expect.objectContaining({
        verified: true,
        actions: [
          {
            receiptId: '37c680f0-124a-4530-841a-a6110f79f7c6',
            action: 'add_note',
            title: 'Add note',
            incidentId: 'inc1',
          },
        ],
      }),
    })
  );
  expect(JSON.stringify(store.record.mock.calls)).not.toContain('sealed-confirmation-canary');
});

it('refuses API-key callers before starting a conversation', async () => {
  actor.get.mockResolvedValue({ id: 'u1', role: 'ADMIN', apiKey: { id: 'key-1' } });
  expect((await POST(make({ message: 'hello' }))).status).toBe(403);
  expect(turns.run).not.toHaveBeenCalled();
});
