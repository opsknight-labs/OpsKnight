import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { encrypt } from '@/lib/encryption';
import { resolveUserActor } from '@/lib/authorization-actors';
import { inAppNotificationHref } from '@/lib/notification-links';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';
import {
  BACKGROUND_LIMITS,
  cancelBackgroundTurn,
  hasBackgroundHandOff,
  listBackgroundTurns,
  sweepBackgroundTurns,
} from '@/lib/intelligence/conversations/background';
import {
  settleBackgroundTurns,
  startBackgroundTurns,
} from '@/lib/intelligence/conversations/background-run';
import { getConversation } from '@/lib/intelligence/conversations/store';
import { POST, GET } from '@/app/api/intelligence/squire/background/route';
import { POST as chat } from '@/app/api/intelligence/squire/route';
import { DELETE } from '@/app/api/intelligence/squire/background/[id]/route';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

const actor = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ getCurrentAuthorizationActor: actor.get }));

// The real turn by default; a test can swap in one that waits until it is cancelled.
const turn = vi.hoisted(() => ({ override: null as null | ((signal?: AbortSignal) => unknown) }));
vi.mock('@/lib/intelligence/squire/chat', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/intelligence/squire/chat')>();
  return {
    ...real,
    streamSquire: (...args: Parameters<typeof real.streamSquire>) =>
      turn.override ? turn.override(args[2]) : real.streamSquire(...args),
  };
});

const URL_ = 'http://localhost:3000/api/intelligence/squire/background';
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function world(history = true) {
  const team = await createTestTeam('Checkout');
  const user = await createTestUser({ role: 'USER', name: 'Bea Responder' });
  const other = await createTestUser({ role: 'USER', name: 'Oscar Other' });
  await db.teamMember.create({ data: { userId: user.id, teamId: team.id, role: 'MEMBER' } });
  const service = await createTestService('Checkout API', team.id, { name: 'Checkout API' });
  const incident = await createTestIncident('Pool exhausted', service.id, { assigneeId: user.id });
  await db.aiSettings.create({
    data: {
      id: 'default',
      enabled: false,
      squireEnabled: true,
      squireName: 'Pip',
      squireHistoryEnabled: history,
    },
  });
  const asUser = (await resolveUserActor(user.id))!;
  const asOther = (await resolveUserActor(other.id))!;
  actor.get.mockResolvedValue(asUser);
  return { user, other, incident, asUser, asOther };
}

async function queued(userId: string, message: string) {
  return db.squireBackgroundTurn.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      requestEncrypted: await encrypt(JSON.stringify({ message, history: [] })),
    },
  });
}

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  // Stop whatever an earlier test left waiting, so it cannot write into this one.
  for (const row of await db.squireBackgroundTurn.findMany({
    where: { status: { in: ['QUEUED', 'RUNNING'] } },
  }))
    await cancelBackgroundTurn(row.userId, row.id);
  await settleBackgroundTurns();
  await resetDatabase();
  actor.get.mockReset();
  turn.override = null;
});

describe('answers that finish in the background', () => {
  it('runs a handed-over question as the person, saves it to their history and notifies them', async () => {
    const { user, incident } = await world();
    const response = await POST(post({ message: 'My open incidents', history: [] }));
    expect(response.status).toBe(202);
    const { data } = (await response.json()) as { data: { id: string } };
    await settleBackgroundTurns();

    const row = await db.squireBackgroundTurn.findUniqueOrThrow({ where: { id: data.id } });
    expect(row.status).toBe('DONE');
    expect(row.requestEncrypted).not.toContain('My open incidents');
    expect(row.resultConversationId).toBeTruthy();
    const conversation = await getConversation(user.id, row.resultConversationId!);
    expect(conversation?.messages.map(message => message.role)).toEqual(['user', 'assistant']);
    expect(conversation?.messages[1].content).toContain('Pool exhausted');
    expect(conversation?.messages[1].content).toContain(incident.id);

    const [notification] = await db.inAppNotification.findMany({ where: { userId: user.id } });
    expect(notification.title).toBe('Pip finished your answer');
    expect(inAppNotificationHref(notification)).toBe(
      `/?squire=open&conversation=${row.resultConversationId}`
    );

    const list = await GET(new Request(URL_));
    const listed = (await list.json()) as {
      data: { turns: Array<{ id: string; status: string }> };
    };
    expect(listed.data.turns).toEqual([
      expect.objectContaining({ id: data.id, status: 'DONE', title: 'My open incidents' }),
    ]);
  });

  it('continues the conversation it was asked in', async () => {
    const { user } = await world();
    const first = await POST(post({ message: 'My open incidents', history: [] }));
    await settleBackgroundTurns();
    const { resultConversationId } = await db.squireBackgroundTurn.findUniqueOrThrow({
      where: { id: ((await first.json()) as { data: { id: string } }).data.id },
    });
    await POST(
      post({ message: 'Who is on call?', history: [], conversationId: resultConversationId })
    );
    await settleBackgroundTurns();
    const conversation = await getConversation(user.id, resultConversationId!);
    expect(conversation?.messages).toHaveLength(4);
  });

  it('applies the chat route checks and explains when history is off', async () => {
    await world(false);
    expect((await POST(post({ message: 'hi' }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(
      403
    );
    expect((await POST(post({ message: '' }))).status).toBe(400);
    expect(
      (
        await POST(
          new NextRequest(URL_, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: 'x'.repeat(70_000),
          })
        )
      ).status
    ).toBe(413);
    const off = await POST(post({ message: 'My open incidents' }));
    expect(off.status).toBe(409);
    expect(((await off.json()) as { error: string }).error).toMatch(/saved conversations are on/);
    expect(await db.squireBackgroundTurn.count()).toBe(0);
  });

  it('refuses API keys and signed-out callers', async () => {
    const { asUser } = await world();
    actor.get.mockResolvedValueOnce({ ...asUser, apiKey: { id: 'k' } });
    expect((await POST(post({ message: 'hi' }))).status).toBe(403);
    actor.get.mockRejectedValueOnce(new Error('signed out'));
    expect((await POST(post({ message: 'hi' }))).status).toBe(401);
  });

  it('caps each person at three answers queued or running', async () => {
    const { user, other, asOther } = await world();
    for (let i = 0; i < BACKGROUND_LIMITS.activePerPerson; i++) await queued(user.id, `q${i}`);
    const refused = await POST(post({ message: 'one more' }));
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: string }).error).toMatch(/already have 3/);
    // Someone else is not affected by this person's answers.
    actor.get.mockResolvedValue(asOther);
    turn.override = signal => waitUntilCancelled(signal);
    expect((await POST(post({ message: 'mine' }))).status).toBe(202);
    expect(await db.squireBackgroundTurn.count({ where: { userId: other.id } })).toBe(1);
  });

  it('refuses to run for someone who lost access in the meantime', async () => {
    const { user } = await world();
    const row = await queued(user.id, 'My open incidents');
    await db.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });
    await startBackgroundTurns();
    await settleBackgroundTurns();
    const after = await db.squireBackgroundTurn.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: 'FAILED', failureCode: 'ACCESS_LOST' });
    expect(await db.squireConversation.count()).toBe(0);
  });

  it('answers under the permissions the person has when it runs', async () => {
    const { user, incident } = await world();
    const row = await queued(user.id, 'My open incidents');
    // Removed from the team and unassigned after asking: the incident is no longer theirs to read.
    await db.teamMember.deleteMany({ where: { userId: user.id } });
    await db.incident.update({ where: { id: incident.id }, data: { assigneeId: null } });
    await startBackgroundTurns();
    await settleBackgroundTurns();
    const after = await db.squireBackgroundTurn.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe('DONE');
    const conversation = await getConversation(user.id, after.resultConversationId!);
    expect(conversation?.messages[1].content).not.toContain('Pool exhausted');
  });

  it('lets only the owner see and cancel an answer; a cancelled one saves nothing', async () => {
    const { user, asOther } = await world();
    turn.override = signal => waitUntilCancelled(signal);
    const response = await POST(post({ message: 'Investigate checkout' }));
    const { data } = (await response.json()) as { data: { id: string } };
    await vi.waitFor(async () =>
      expect(
        (await db.squireBackgroundTurn.findUniqueOrThrow({ where: { id: data.id } })).status
      ).toBe('RUNNING')
    );

    actor.get.mockResolvedValue(asOther);
    expect((await DELETE(new Request(URL_, { method: 'DELETE' }), params(data.id))).status).toBe(
      404
    );
    expect(
      ((await (await GET(new Request(URL_))).json()) as { data: { turns: unknown[] } }).data.turns
    ).toEqual([]);

    actor.get.mockResolvedValue(await resolveUserActor(user.id));
    expect((await DELETE(new Request(URL_, { method: 'DELETE' }), params(data.id))).status).toBe(
      200
    );
    await settleBackgroundTurns();
    expect(
      await db.squireBackgroundTurn.findUniqueOrThrow({ where: { id: data.id } })
    ).toMatchObject({ status: 'CANCELLED', resultConversationId: null });
    expect(await db.squireConversation.count()).toBe(0);
    expect(await db.inAppNotification.count()).toBe(0);
  });

  it('keeps a live answer going when it is handed over, instead of asking the model again', async () => {
    const { user } = await world();
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    turn.override = () => {
      runs += 1;
      return (async function* (): AsyncGenerator<SquireEvent> {
        yield { type: 'delta', text: 'Checked the pool. ' };
        await gate;
        yield { type: 'delta', text: 'It is exhausted.' };
        yield { type: 'done' };
      })();
    };
    const body = { message: 'Investigate checkout', history: [] };
    const reader = (await chat(post(body))).body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('Checked the pool');

    const handed = await POST(post(body));
    const { data } = (await handed.json()) as { data: { id: string } };
    expect(
      (await db.squireBackgroundTurn.findUniqueOrThrow({ where: { id: data.id } })).status
    ).toBe('RUNNING');
    // The browser leaves; the answer goes on without it.
    await reader.cancel();
    release();
    await settleBackgroundTurns();

    expect(runs).toBe(1);
    const row = await db.squireBackgroundTurn.findUniqueOrThrow({ where: { id: data.id } });
    expect(row).toMatchObject({ status: 'DONE', failureCode: null });
    const conversation = await getConversation(user.id, row.resultConversationId!);
    expect(conversation?.messages.map(message => message.content)).toEqual([
      'Investigate checkout',
      'Checked the pool. It is exhausted.',
    ]);
    expect(await db.squireConversation.count()).toBe(1);
    expect(await db.inAppNotification.count()).toBe(1);
  });

  it('tells the chat route a question was handed over, so it skips its cut-off copy', async () => {
    const { user } = await world();
    const since = new Date(Date.now() - 1_000);
    expect(await hasBackgroundHandOff(user.id, undefined, since)).toBe(false);
    await queued(user.id, 'q');
    expect(await hasBackgroundHandOff(user.id, undefined, since)).toBe(true);
    expect(await hasBackgroundHandOff(user.id, 'other-conversation', since)).toBe(false);
    expect(await hasBackgroundHandOff(user.id, undefined, new Date(Date.now() + 1_000))).toBe(
      false
    );
  });

  it('fails and announces answers a restart orphaned, ages out old ones, and drops all when history goes off', async () => {
    const { user } = await world();
    const orphan = await queued(user.id, 'Orphaned question');
    await db.squireBackgroundTurn.update({
      where: { id: orphan.id },
      data: { status: 'RUNNING', startedAt: new Date(Date.now() - BACKGROUND_LIMITS.staleMs - 1) },
    });
    const old = await queued(user.id, 'Old question');
    await db.squireBackgroundTurn.update({
      where: { id: old.id },
      data: { status: 'DONE', createdAt: new Date(Date.now() - BACKGROUND_LIMITS.keepMs - 1) },
    });
    await sweepBackgroundTurns();
    expect(await db.squireBackgroundTurn.findUnique({ where: { id: old.id } })).toBeNull();
    expect(
      await db.squireBackgroundTurn.findUniqueOrThrow({ where: { id: orphan.id } })
    ).toMatchObject({ status: 'FAILED', failureCode: 'INTERRUPTED' });
    const [notification] = await db.inAppNotification.findMany({ where: { userId: user.id } });
    expect(notification.title).toBe('Pip could not finish your answer');
    expect(inAppNotificationHref(notification)).toBe('/?squire=open');
    const listed = await listBackgroundTurns(user.id);
    expect(listed[0].failure).toMatch(/restarted/);

    await db.aiSettings.update({ where: { id: 'default' }, data: { squireHistoryEnabled: false } });
    await sweepBackgroundTurns();
    expect(await db.squireBackgroundTurn.count()).toBe(0);
  });
});

async function* waitUntilCancelled(signal?: AbortSignal): AsyncGenerator<SquireEvent> {
  yield { type: 'delta', text: 'Looking…' };
  await new Promise<void>(resolve => {
    if (signal?.aborted) resolve();
    signal?.addEventListener('abort', () => resolve(), { once: true });
  });
}
