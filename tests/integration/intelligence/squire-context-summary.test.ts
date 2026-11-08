import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { breakers, invalidateGatewayCache } from '@/lib/intelligence/ai/gateway';
import { saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import { recordExchange } from '@/lib/intelligence/conversations/store';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import { SQUIRE_LIMITS, type SquireEvent } from '@/lib/intelligence/squire/contract';
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

type Body = { stream?: boolean; messages: Array<{ role: string; content: string }> };

async function longConversation() {
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
  let conversationId: string | undefined;
  // Seven exchanges are fourteen turns: four fall outside the ten-turn replay window.
  for (let i = 1; i <= 7; i += 1)
    conversationId = await recordExchange({
      userId: admin.id,
      conversationId,
      question: `Question number ${i} about the checkout pool`,
      answer: `Answer number ${i}.`,
    });
  const actor = await resolveUserActor(admin.id);
  if (!actor) throw new Error('actor');
  return { actor, conversationId: conversationId! };
}

async function run(actor: NonNullable<Awaited<ReturnType<typeof resolveUserActor>>>, id: string) {
  const events: SquireEvent[] = [];
  for await (const event of streamSquire(actor, {
    message: 'What did we decide?',
    history: [],
    conversationId: id,
  }))
    events.push(event);
  return events;
}

describe('earlier-turn summary in AI conversations', () => {
  it('summarises turns beyond the replay window with the SUMMARIZE route, right after the system prompt', async () => {
    const { actor, conversationId } = await longConversation();
    model.script.push({ content: '- Asked about the checkout pool twice' }, { content: 'Done.' });
    const events = await run(actor, conversationId);
    expect(events.at(-1)).toEqual({ type: 'done' });
    const summaryCall = model.requests[0].body as unknown as Body;
    expect(summaryCall.stream).not.toBe(true);
    expect(summaryCall.messages.at(-1)!.content).toContain('Question number 1');
    expect(summaryCall.messages.at(-1)!.content).not.toContain('Question number 7');

    const chat = model.requests[1].body as unknown as Body;
    expect(chat.messages[0].role).toBe('system');
    expect(chat.messages[1].role).toBe('system');
    expect(chat.messages[1].content).toContain('Summary of earlier conversation turns');
    expect(chat.messages[1].content).toContain('- Asked about the checkout pool twice');
    // The replay window is unchanged: only the most recent turns are verbatim.
    const verbatim = chat.messages.slice(2, -1).map(message => message.content);
    expect(verbatim.length).toBeLessThanOrEqual(SQUIRE_LIMITS.historyMax);
    expect(verbatim.join('\n')).not.toContain('Question number 1 ');
    expect(chat.messages.at(-1)).toMatchObject({ role: 'user', content: 'What did we decide?' });
  });

  it('uses a deterministic digest when the summary model fails', async () => {
    const { actor, conversationId } = await longConversation();
    // The SDK retries once, so both attempts fail.
    model.script.push({ status: 500 }, { status: 500 }, { content: 'Done.' });
    const events = await run(actor, conversationId);
    expect(events.at(-1)).toEqual({ type: 'done' });
    const chat = model.requests.at(-1)!.body as unknown as Body;
    expect(chat.messages[1].content).toContain(
      '- Asked: Question number 1 about the checkout pool'
    );
  });
});
