import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { breakers, invalidateGatewayCache } from '@/lib/intelligence/ai/gateway';
import { saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import { recordExchange } from '@/lib/intelligence/conversations/store';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import { authorizationContextHash } from '@/lib/intelligence/squire/context-proof';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';
import { startFakeModel, type FakeServer } from '../../helpers/fake-model-server';
import { createTestUser, resetDatabase } from '../../helpers/test-db';

let model: FakeServer;
beforeAll(async () => {
  model = await startFakeModel();
});
afterAll(async () => {
  await model.close();
});
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  model.requests.length = 0;
  model.script.length = 0;
  invalidateGatewayCache();
});

type Body = {
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ function: { name: string } }>;
};

async function conversation() {
  const admin = await createTestUser({ role: 'ADMIN' });
  const audit = { actorId: admin.id, source: 'UI' as const };
  await updateAiSettings(
    {
      enabled: true,
      squireEnabled: true,
      squireName: 'Pip',
      allowExternalFallback: false,
      requestsPerMinutePerUser: 100,
      dailyTokenBudget: 500_000,
      maxOutputTokens: 256,
      requestTimeoutMs: 10_000,
      squireHistoryEnabled: true,
      expectedRevision: 0,
    },
    audit
  );
  const provider = await saveAiProvider(
    null,
    {
      name: 'Local',
      kind: 'OPENAI_COMPATIBLE',
      model: 'm',
      baseUrl: model.url,
      apiKey: 'k',
      enabled: true,
      isExternal: false,
      maxDataClass: 'PERSONAL',
      allowPrivateNetwork: true,
      priority: 1,
    },
    audit
  );
  breakers.recordSuccess(provider.id);
  invalidateGatewayCache();
  const actor = await resolveUserActor(admin.id);
  if (!actor) throw new Error('actor');
  // A saved answer is replayed only when it was recorded under the person's current access.
  const turn = { mode: 'ai' as const, authorizationHash: authorizationContextHash(actor) };
  let conversationId: string | undefined;
  // Answers of several sentences: replaying the latest in full and older ones digested would differ.
  for (let i = 1; i <= 2; i += 1)
    conversationId = await recordExchange({
      userId: admin.id,
      conversationId,
      question: `Question number ${i} about the checkout pool`,
      answer: `Answer number ${i}. The pool hit its limit at 10:0${i}. Restarting the workers cleared it.`,
      turn,
    });
  return { actor, conversationId: conversationId!, turn };
}

async function ask(
  actor: NonNullable<Awaited<ReturnType<typeof resolveUserActor>>>,
  conversationId: string,
  message: string
) {
  const events: SquireEvent[] = [];
  for await (const event of streamSquire(actor, { message, history: [], conversationId }))
    events.push(event);
  return events;
}

describe('cache-friendly Squire turns', () => {
  it('sends the same tools and an append-only history prefix on consecutive turns', async () => {
    const { actor, conversationId, turn } = await conversation();
    model.script.push({ content: 'First.' }, { content: 'Second.' });
    // Questions of different kinds: a per-question tool subset would differ between them.
    await ask(actor, conversationId, 'show the error rate metrics for checkout');
    await recordExchange({
      userId: actor.id,
      conversationId,
      question: 'Question number 3 about the checkout pool',
      answer: 'Answer number 3. It has been quiet since. Nothing else changed.',
      turn,
    });
    await ask(actor, conversationId, 'who is on call?');
    const [before, after] = model.requests.map(request => request.body as unknown as Body);
    expect(after.tools?.length).toBeGreaterThan(0);
    expect(after.tools).toEqual(before.tools);
    // Everything before the first turn's question opens the second turn's request unchanged.
    const history = before.messages.slice(0, -1);
    expect(after.messages.slice(0, history.length)).toEqual(history);
    expect(history.at(-1)?.content).toContain('Restarting the workers cleared it.');
    expect(after.messages.at(-2)?.content).toContain('Nothing else changed.');
  });

  it('keeps an interrupted earlier answer as a stand-in, without a notice on every later turn', async () => {
    const { actor, conversationId, turn } = await conversation();
    await recordExchange({
      userId: actor.id,
      conversationId,
      question: 'Question number 3 about the checkout pool',
      answer: 'Half an answer',
      turn: { ...turn, completion: 'INTERRUPTED' },
    });
    model.script.push({ content: 'First.' }, { content: 'Second.' });
    for (const message of ['is the pool ok now?', 'and now?']) {
      const events = await ask(actor, conversationId, message);
      expect(events.filter(event => event.type === 'notice')).toEqual([]);
    }
    const body = model.requests[0].body as unknown as Body;
    // The question stays, followed by a stand-in for its answer, so the turns keep their order.
    const at = body.messages.findIndex(m => m.content.includes('Question number 3'));
    expect(body.messages[at + 1]).toMatchObject({
      role: 'assistant',
      content: expect.stringMatching(/^\[Earlier answer not included/),
    });
    expect(JSON.stringify(body)).not.toContain('Half an answer');
  });

  it('ends the turn with a trace of the model, tokens and time', async () => {
    const { actor, conversationId } = await conversation();
    model.script.push({ content: 'The pool is fine now.', usage: [900, 12], cachedTokens: 800 });
    const events = await ask(actor, conversationId, 'is the pool ok now?');
    expect(events.map(event => event.type).slice(-2)).toEqual(['trace', 'done']);
    const trace = events.find(event => event.type === 'trace');
    if (trace?.type !== 'trace') throw new Error('no trace');
    expect(trace.trace).toMatchObject({
      mode: 'ai',
      tools: [],
      model: 'm',
      provider: 'OpenAI-compatible',
      tokens: { input: 900, output: 12, cacheRead: 800 },
      verified: false,
    });
    expect(trace.trace.durationMs).toBeGreaterThanOrEqual(0);
  });
});
