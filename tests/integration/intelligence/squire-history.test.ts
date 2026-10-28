import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { updateAiSettings } from '@/lib/intelligence/ai/settings';
import {
  CONVERSATION_LIMITS,
  getConversation,
  listConversations,
  purgeConversations,
  recordExchange,
} from '@/lib/intelligence/conversations/store';
import { DELETE as deleteAll, GET as list } from '@/app/api/intelligence/squire/conversations/route';
import { DELETE as deleteOne, GET as getOne } from '@/app/api/intelligence/squire/conversations/[id]/route';
import { createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

const actor = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: actor.get }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) throw new Error('Dedicated test DB required');
  await resetDatabase();
  actor.get.mockReset();
});

async function configure(adminId: string, history: { enabled: boolean; retentionDays?: number }) {
  const current = await db.aiSettings.findUnique({ where: { id: 'default' } });
  await updateAiSettings(
    {
      enabled: true, squireEnabled: true, squireName: 'Pip', allowExternalFallback: false,
      requestsPerMinutePerUser: 100, dailyTokenBudget: 500_000, maxOutputTokens: 1024, requestTimeoutMs: 10_000,
      allowedDataRegions: [], squireHistoryEnabled: history.enabled, squireHistoryRetentionDays: history.retentionDays ?? 30,
      expectedRevision: current?.revision ?? 0,
    },
    { actorId: adminId, source: 'UI' }
  );
}

const URL_ = 'http://localhost:3000/api/intelligence/squire/conversations';
const request = (path = '', method = 'GET', headers: Record<string, string> = {}) =>
  new NextRequest(`${URL_}${path}`, { method, headers });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (response: Response) => (await response.json()) as { data: Record<string, unknown> };

describe('saved assistant conversations', () => {
  it('stores exchanges encrypted, continues a conversation, and shows it only to its owner', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const other = await createTestUser({ role: 'RESPONDER' });
    await configure(admin.id, { enabled: true });

    const id = await recordExchange({ userId: admin.id, question: 'Why is checkout failing?', answer: 'Look at INC-1.', incidentId: 'inc-1' });
    const same = await recordExchange({ userId: admin.id, conversationId: id, question: 'And payments?', answer: 'Also INC-2.' });
    expect(same).toBe(id);

    // Encrypted at rest: no plaintext in the database.
    const raw = await db.squireMessage.findMany({ where: { conversationId: id } });
    expect(raw).toHaveLength(4);
    expect(JSON.stringify(raw)).not.toContain('checkout');
    const conversation = await db.squireConversation.findUniqueOrThrow({ where: { id } });
    expect(conversation.titleEncrypted).not.toContain('checkout');

    const detail = await getConversation(admin.id, id);
    expect(detail?.title).toBe('Why is checkout failing?');
    expect(detail?.messages.map(message => message.content)).toEqual(['Why is checkout failing?', 'Look at INC-1.', 'And payments?', 'Also INC-2.']);
    expect(detail?.incidentId).toBe('inc-1');

    // Someone else can neither read nor continue it: their message starts a conversation of their own.
    expect(await getConversation(other.id, id)).toBeNull();
    const theirs = await recordExchange({ userId: other.id, conversationId: id, question: 'hi', answer: 'hello' });
    expect(theirs).not.toBe(id);
    expect((await getConversation(admin.id, id))?.messages).toHaveLength(4);
  });

  it('serves owner-only HTTP endpoints, refuses cross-site and API-key callers, and deletes on request', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const other = await createTestUser({ role: 'ADMIN' });
    await configure(admin.id, { enabled: true });
    const id = await recordExchange({ userId: admin.id, question: 'q1', answer: 'a1' });
    await recordExchange({ userId: admin.id, question: 'q2', answer: 'a2' });

    actor.get.mockResolvedValue({ id: admin.id, role: 'ADMIN', status: 'ACTIVE', teamIds: [] });
    const listed = await json(await list(request()));
    expect((listed.data.conversations as Array<{ title: string }>).map(c => c.title)).toEqual(['q2', 'q1']);
    expect((await getOne(request(`/${id}`), params(id))).status).toBe(200);
    expect((await list(request('', 'GET', { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect((await getOne(request('/bad id'), params('bad id'))).status).toBe(404);

    actor.get.mockResolvedValue({ id: admin.id, role: 'ADMIN', status: 'ACTIVE', teamIds: [], apiKey: { id: 'k', scopes: [] } });
    expect((await list(request())).status).toBe(403);

    actor.get.mockResolvedValue({ id: other.id, role: 'ADMIN', status: 'ACTIVE', teamIds: [] });
    expect((await getOne(request(`/${id}`), params(id))).status).toBe(404);
    expect((await deleteOne(request(`/${id}`, 'DELETE'), params(id))).status).toBe(404);
    expect(await db.squireConversation.count()).toBe(2);

    actor.get.mockResolvedValue({ id: admin.id, role: 'ADMIN', status: 'ACTIVE', teamIds: [] });
    expect((await deleteOne(request(`/${id}`, 'DELETE'), params(id))).status).toBe(200);
    expect(await db.squireMessage.count({ where: { conversationId: id } })).toBe(0);
    expect((await json(await deleteAll(request('', 'DELETE')))).data.deleted).toBe(1);
    expect(await db.squireConversation.count()).toBe(0);

    actor.get.mockRejectedValue(new Error('no session'));
    expect((await list(request())).status).toBe(401);
  });

  it('keeps storage bounded per person and per conversation', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await configure(admin.id, { enabled: true });
    let first = '';
    for (let i = 0; i < CONVERSATION_LIMITS.perUser + 2; i += 1) {
      const id = await recordExchange({ userId: admin.id, question: `q${i}`, answer: 'a' });
      if (i === 0) first = id;
    }
    const conversations = await listConversations(admin.id);
    expect(conversations).toHaveLength(CONVERSATION_LIMITS.perUser);
    expect(conversations.map(c => c.id)).not.toContain(first);

    const latest = conversations[0].id;
    await db.squireConversation.update({ where: { id: latest }, data: { messageCount: CONVERSATION_LIMITS.messagesPerConversation } });
    const next = await recordExchange({ userId: admin.id, conversationId: latest, question: 'more', answer: 'a' });
    expect(next).not.toBe(latest);
  });

  it('is fully off unless enabled, purges by retention, and deletes everything when history is turned off', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await configure(admin.id, { enabled: false });
    actor.get.mockResolvedValue({ id: admin.id, role: 'ADMIN', status: 'ACTIVE', teamIds: [] });
    expect((await list(request())).status).toBe(404);

    await configure(admin.id, { enabled: true, retentionDays: 7 });
    const old = await recordExchange({ userId: admin.id, question: 'old', answer: 'a' });
    const fresh = await recordExchange({ userId: admin.id, question: 'fresh', answer: 'a' });
    await db.$executeRaw`UPDATE "SquireConversation" SET "updatedAt" = now() - interval '8 days' WHERE id = ${old}`;
    expect(await purgeConversations()).toEqual({ deleted: 1, more: false });
    expect((await listConversations(admin.id)).map(c => c.id)).toEqual([fresh]);

    await configure(admin.id, { enabled: false });
    expect((await purgeConversations()).deleted).toBe(1);
    expect(await db.squireConversation.count()).toBe(0);
  });

  it('deletes a person’s conversations with the person', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const user = await createTestUser({ role: 'RESPONDER' });
    await configure(admin.id, { enabled: true });
    await recordExchange({ userId: user.id, question: 'q', answer: 'a' });
    await db.user.delete({ where: { id: user.id } });
    expect(await db.squireConversation.count()).toBe(0);
    expect(await db.squireMessage.count()).toBe(0);
  });
});
