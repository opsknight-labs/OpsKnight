import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import { buildCatchUp } from '@/lib/intelligence/squire/catch-up';
import { buildSquireTools } from '@/lib/intelligence/squire/tools';
import { resetBasicReadCaches } from '@/lib/intelligence/squire/basic/reads';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';
import {
  createTestIncident,
  createTestOnCallSchedule,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

const HOUR = 3_600_000;
const ago = (hours: number) => new Date(Date.now() - hours * HOUR);

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  resetBasicReadCaches();
});

/**
 * Bea's last shift (8-hour rotation with a teammate) ended three hours ago; her next starts in five.
 * Around it: incidents on her team before and after the hand-off, one in another team, and notes.
 */
async function world() {
  const team = await createTestTeam('Checkout');
  const outsiders = await createTestTeam('Outsiders');
  const bea = await createTestUser({
    role: 'USER',
    name: 'Bea Responder',
    email: 'bea@example.com',
  });
  const teammate = await createTestUser({ role: 'USER', name: 'Tom Teammate' });
  for (const user of [bea, teammate])
    await db.teamMember.create({ data: { userId: user.id, teamId: team.id, role: 'MEMBER' } });
  const schedule = await createTestOnCallSchedule('Checkout primary', [
    { start: ago(11), rotationLengthHours: 8, userIds: [bea.id, teammate.id] },
  ]);
  const service = await createTestService('Checkout API', team.id, { name: 'Checkout API' });
  const hiddenService = await createTestService('Payroll', outsiders.id, { name: 'Payroll' });

  const duringShift = await createTestIncident('Disk full during shift', service.id, {
    urgency: 'LOW',
    createdAt: ago(6),
  });
  const mine = await createTestIncident('Checkout latency', service.id, {
    assigneeId: bea.id,
    urgency: 'MEDIUM',
    createdAt: ago(2),
  });
  const fire = await createTestIncident('Checkout down', service.id, {
    urgency: 'HIGH',
    createdAt: ago(1),
  });
  const fixed = await createTestIncident('Cart errors', service.id, {
    urgency: 'MEDIUM',
    status: 'RESOLVED',
    createdAt: ago(2.5),
    resolvedAt: ago(0.5),
  });
  const hidden = await createTestIncident('Payroll outage', hiddenService.id, {
    urgency: 'HIGH',
    createdAt: ago(1),
  });
  await db.incidentNote.createMany({
    data: [
      { incidentId: fire.id, userId: teammate.id, content: '@Bea can you check the pool?' },
      { incidentId: fire.id, userId: bea.id, content: 'Bea Responder looking' },
      { incidentId: hidden.id, userId: teammate.id, content: '@Bea payroll secret' },
      { incidentId: mine.id, userId: teammate.id, content: 'Unrelated note' },
    ],
  });
  await db.aiSettings.create({
    data: { id: 'default', enabled: false, squireEnabled: true, squireHistoryEnabled: false },
  });
  const actor = (await resolveUserActor(bea.id))!;
  return { actor, schedule, duringShift, mine, fire, fixed, hidden };
}

describe('catch me up', () => {
  it('starts where the last shift ended and covers the person’s teams, work, notes and next shift', async () => {
    const { actor, schedule, duringShift, mine, fire, fixed, hidden } = await world();
    const result = await buildCatchUp(actor);

    expect(result.basis).toBe('last-shift');
    expect(result.lastShift?.scheduleId).toBe(schedule.id);
    expect(Math.abs(new Date(result.since).getTime() - ago(3).getTime())).toBeLessThan(60_000);
    expect(result.counts).toMatchObject({ opened: 3, resolved: 1 });
    expect(result.opened.map(row => row.id)).toEqual(expect.arrayContaining([mine.id, fire.id]));
    expect(result.opened.map(row => row.id)).not.toContain(duringShift.id);
    expect(result.stillOpenHighUrgency.map(row => row.id)).toEqual([fire.id]);
    expect(result.assignedToMe.map(row => row.id)).toEqual([mine.id]);
    expect(result.resolved.map(row => row.id)).toEqual([fixed.id]);
    // Notes by someone else that mention her, on incidents she can read; never her own, never hidden.
    expect(result.notesMentioningMe).toEqual([
      expect.objectContaining({ incidentId: fire.id, by: 'Tom Teammate' }),
    ]);
    expect(result.onCallNow).toBeNull();
    expect(result.nextShift?.scheduleId).toBe(schedule.id);
    expect(Math.abs(new Date(result.nextShift!.start).getTime() - ago(-5).getTime())).toBeLessThan(
      60_000
    );
    expect(JSON.stringify(result)).not.toContain(hidden.id);
    expect(JSON.stringify(result)).not.toContain('payroll');
  });

  it('uses the window the person names, at most seven days back', async () => {
    const { actor, mine } = await world();
    const recent = await buildCatchUp(actor, { hours: 1.5 });
    expect(recent.basis).toBe('window');
    expect(recent.opened.map(row => row.id)).not.toContain(mine.id);
    const long = await buildCatchUp(actor, { since: ago(24 * 30) });
    expect(long.capped).toBe(true);
    expect(Math.abs(new Date(long.since).getTime() - ago(24 * 7).getTime())).toBeLessThan(60_000);
  });

  it('is a Personal read tool with validated input, offered only for Personal data', async () => {
    const { actor, fire } = await world();
    const personal = buildSquireTools(actor, { personal: true });
    const tool = personal.find(candidate => candidate.name === 'get_catch_up')!;
    expect(tool.kind).toBe('READ');
    expect(await tool.execute!({ hours: 400 })).toEqual({ error: 'Invalid input' });
    expect(await tool.execute!({ since: 'yesterday' })).toEqual({ error: 'Invalid input' });
    const result = (await tool.execute!({ hours: 12 })) as {
      stillOpenHighUrgency: { id: string }[];
    };
    expect(result.stillOpenHighUrgency.map(row => row.id)).toEqual([fire.id]);
    expect(
      buildSquireTools(actor, { personal: false }).some(
        candidate => candidate.name === 'get_catch_up'
      )
    ).toBe(false);
  });

  it('answers in basic mode, with citations, from "catch me up" and /catchup', async () => {
    const { actor, fire } = await world();
    for (const message of ['Catch me up', '/catchup 4h']) {
      const events: SquireEvent[] = [];
      for await (const event of streamSquire(actor, { message, history: [] })) events.push(event);
      const text = events
        .filter(event => event.type === 'delta')
        .map(event => (event as { text: string }).text)
        .join('');
      expect(events.find(event => event.type === 'meta')).toMatchObject({ intent: 'CATCH_UP' });
      expect(text).toContain('Checkout down');
      expect(text).toContain('Notes that mention you');
      expect(text).toContain('Your next shift');
      expect(text).not.toContain('Payroll');
      const citations = events.find(event => event.type === 'citations') as
        { items: Array<{ id?: string }> } | undefined;
      expect(JSON.stringify(citations?.items ?? [])).toContain(fire.id);
      if (message === 'Catch me up') expect(text).toContain('since your last on-call shift');
    }
  });
});
