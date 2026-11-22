import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import { executeSquireAction } from '@/lib/intelligence/squire/actions/execute';
import { resetDialogueMemory } from '@/lib/intelligence/assistant/dialogue-state';
import { parseDuration } from '@/lib/intelligence/squire/basic/nlu';
import type { SquireEvent, SquireRequest } from '@/lib/intelligence/squire/contract';
import {
  createTestIncident,
  createTestOnCallSchedule,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

type Actor = NonNullable<Awaited<ReturnType<typeof resolveUserActor>>>;

async function settings(extendedActions: boolean) {
  await db.aiSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      enabled: false,
      squireEnabled: true,
      squireHistoryEnabled: false,
      squireExtendedActions: extendedActions,
      updatedAt: new Date(),
    },
    update: { squireExtendedActions: extendedActions },
  });
}

async function ask(actor: Actor, message: string, where: Partial<SquireRequest> = {}) {
  const events: SquireEvent[] = [];
  for await (const event of streamSquire(actor, { message, history: [], ...where }))
    events.push(event);
  return {
    text: events
      .filter(e => e.type === 'delta')
      .map(e => (e as { text: string }).text)
      .join(''),
    intent: (events.find(e => e.type === 'meta') as { intent?: string } | undefined)?.intent,
    cards: events
      .filter(e => e.type === 'proposal')
      .map(e => (e as Extract<SquireEvent, { type: 'proposal' }>).proposal),
  };
}

async function world() {
  const admin = await createTestUser({ role: 'ADMIN', name: 'Slash Admin' });
  const team = await createTestTeam('Slash');
  const service = await createTestService('Checkout', team.id, { name: 'Checkout' });
  const incident = await createTestIncident('Checkout errors', service.id, { teamId: team.id });
  const schedule = await createTestOnCallSchedule('Primary', [{ userIds: [admin.id] }]);
  return { admin: (await resolveUserActor(admin.id))!, team, service, incident, schedule };
}

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  await resetDialogueMemory();
  await settings(true);
});

describe('parseDuration', () => {
  it('reads only compact durations', () => {
    expect(parseDuration('30m')).toBe(1_800_000);
    expect(parseDuration('2H')).toBe(7_200_000);
    expect(parseDuration('1d')).toBe(86_400_000);
    for (const bad of ['', '0h', '2', 'h', '2 hours', '1.5h', '2h30m', '-1h', '99999m'])
      expect(parseDuration(bad)).toBeNull();
  });
});

describe('basic-mode change commands', () => {
  it('/tag on an incident proposes and applies the tag', async () => {
    const { admin, incident } = await world();
    const answer = await ask(admin, '/tag database', { incidentId: incident.id });
    expect(answer.text).toContain('tagging');
    expect(answer.cards).toHaveLength(1);
    expect(answer.cards[0].action).toBe('run_operation');
    expect((await executeSquireAction(admin, answer.cards[0].token)).ok).toBe(true);
    const tags = await db.incidentTag.findMany({
      where: { incidentId: incident.id },
      include: { tag: true },
    });
    expect(tags.map(row => row.tag.name)).toContain('database');
  });

  it('/maintenance on a service opens a window from now for the duration', async () => {
    const { admin, service } = await world();
    const before = Date.now();
    const answer = await ask(admin, '/maintenance 2h DB upgrade', {
      pageContext: { kind: 'service', id: service.id },
    });
    expect(answer.text).toContain('"DB upgrade"');
    expect(answer.cards).toHaveLength(1);
    expect((await executeSquireAction(admin, answer.cards[0].token)).ok).toBe(true);
    const window = await db.maintenanceWindow.findFirst({ where: { title: 'DB upgrade' } });
    expect(window).not.toBeNull();
    const length = window!.endsAt.getTime() - window!.startsAt.getTime();
    expect(length).toBe(7_200_000);
    expect(window!.startsAt.getTime()).toBeGreaterThanOrEqual(before - 1_000);

    const fallback = await ask(admin, '/maintenance 30m', {
      pageContext: { kind: 'service', id: service.id },
    });
    expect(fallback.text).toContain('"Maintenance via Squire"');
    expect(fallback.cards).toHaveLength(1);
  });

  it('/override on a schedule puts the asker on call from now', async () => {
    const { admin, schedule } = await world();
    const answer = await ask(admin, '/override 4h', {
      pageContext: { kind: 'schedule', id: schedule.id },
    });
    expect(answer.intent).toBe('ON_CALL');
    expect(answer.cards).toHaveLength(1);
    expect((await executeSquireAction(admin, answer.cards[0].token)).ok).toBe(true);
    const override = await db.onCallOverride.findFirst({ where: { scheduleId: schedule.id } });
    expect(override?.userId).toBe(admin.id);
    expect(override!.end.getTime() - override!.start.getTime()).toBe(4 * 3_600_000);
  });

  it('/rename on a service proposes the new name', async () => {
    const { admin, service } = await world();
    const answer = await ask(admin, '/rename Checkout Web', {
      pageContext: { kind: 'service', id: service.id },
    });
    expect(answer.text).toContain('"Checkout Web"');
    expect((await executeSquireAction(admin, answer.cards[0].token)).ok).toBe(true);
    expect((await db.service.findUnique({ where: { id: service.id } }))!.name).toBe('Checkout Web');
  });

  it('answers with the usage line instead of guessing', async () => {
    const { admin, service, schedule } = await world();
    const onService = { pageContext: { kind: 'service' as const, id: service.id } };
    for (const message of [
      '/maintenance',
      '/maintenance soon',
      '/maintenance 8d',
      '/maintenance 2 hours',
    ])
      expect(await ask(admin, message, onService)).toMatchObject({
        cards: [],
        text: expect.stringContaining('Usage: /maintenance'),
      });
    expect((await ask(admin, '/rename', onService)).text).toContain('Usage: /rename');
    const onSchedule = { pageContext: { kind: 'schedule' as const, id: schedule.id } };
    for (const message of ['/override', '/override 2h now', '/override 8d'])
      expect((await ask(admin, message, onSchedule)).text).toContain('Usage: /override');
    // The wrong page never borrows a target.
    expect((await ask(admin, '/override 2h', onService)).text).toContain('Open the schedule first');
    expect((await ask(admin, '/tag db', onService)).text).toContain('Open the incident first');
    expect((await ask(admin, '/rename X')).cards).toHaveLength(0);
  });

  it('says plainly why there is no card', async () => {
    const { admin, team, service } = await world();
    const responder = await createTestUser({ role: 'USER', name: 'Slash Responder' });
    await db.teamMember.create({ data: { userId: responder.id, teamId: team.id, role: 'MEMBER' } });
    const user = (await resolveUserActor(responder.id))!;
    const onService = { pageContext: { kind: 'service' as const, id: service.id } };
    const denied = await ask(user, '/maintenance 1h', onService);
    expect(denied.cards).toHaveLength(0);
    expect(denied.text).toContain("You don't have permission for that change: it needs ");

    await settings(false);
    const off = await ask(admin, '/rename Checkout Web', onService);
    expect(off.cards).toHaveLength(0);
    expect(off.text).toContain('Extended assistant actions');
    expect(off.text).not.toContain('I can propose');
  });
});
