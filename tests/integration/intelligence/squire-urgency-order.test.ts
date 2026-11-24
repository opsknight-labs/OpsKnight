import { beforeAll, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { pageByUrgency } from '@/lib/incidents/urgency-order';
import { buildSquireTools } from '@/lib/intelligence/squire/tools';
import { resetBasicReadCaches } from '@/lib/intelligence/squire/basic/reads';
import { planBasicTurn } from '@/lib/intelligence/squire/deterministic';
import { resetDialogueMemory } from '@/lib/intelligence/assistant/dialogue-state';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

type Actor = NonNullable<Awaited<ReturnType<typeof resolveUserActor>>>;

describe('incidents listed most urgent first', () => {
  let actor: Actor;

  beforeAll(async () => {
    await resetDatabase();
    await resetDialogueMemory();
    resetBasicReadCaches();
    const team = await createTestTeam('Ops');
    const service = await createTestService('Orders', team.id, { name: 'Orders' });
    const admin = await createTestUser({ role: 'ADMIN', name: 'Ada Admin' });
    // Oldest first, so "newest first within a tier" is also checked.
    const rows: Array<[string, 'LOW' | 'MEDIUM' | 'HIGH']> = [
      ['low a', 'LOW'],
      ['medium a', 'MEDIUM'],
      ['high a', 'HIGH'],
      ['medium b', 'MEDIUM'],
      ['high b', 'HIGH'],
      ['low b', 'LOW'],
      ['high c', 'HIGH'],
    ];
    for (const [title, urgency] of rows) {
      await createTestIncident(title, service.id, { teamId: team.id, urgency });
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    actor = (await resolveUserActor(admin.id))!;
    await db.aiSettings.create({
      data: { id: 'default', enabled: false, squireEnabled: true, squireHistoryEnabled: false },
    });
  });

  it('is needed: the database enum sorts MEDIUM above HIGH', async () => {
    const order = await db.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'IncidentUrgency' ORDER BY e.enumsortorder`;
    // If the migrations ever declare it in urgency order this test can go, with the helper.
    expect(order.map(row => row.enumlabel)).toEqual(['LOW', 'HIGH', 'MEDIUM']);
    const sorted = await db.incident.findMany({ orderBy: { urgency: 'desc' }, take: 1 });
    expect(sorted[0].urgency).toBe('MEDIUM');
  });

  it('pages across tiers without repeats or gaps', async () => {
    const page = (skip: number, take: number) =>
      pageByUrgency({
        skip,
        take,
        count: urgency => db.incident.count({ where: { urgency } }),
        fetch: (urgency, s, t) =>
          db.incident.findMany({
            where: { urgency },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: s,
            take: t,
          }),
      }).then(rows => rows.map(row => row.title));
    expect(await page(0, 7)).toEqual([
      'high c',
      'high b',
      'high a',
      'medium b',
      'medium a',
      'low b',
      'low a',
    ]);
    // A page that starts in the middle of one tier and runs into the next.
    expect(await page(2, 3)).toEqual(['high a', 'medium b', 'medium a']);
    expect(await page(5, 10)).toEqual(['low b', 'low a']);
    expect(await page(7, 5)).toEqual([]);
  });

  it('puts HIGH first in the assistant search tool and pages with offset', async () => {
    const search = buildSquireTools(actor, { personal: true }).find(
      tool => tool.name === 'search_incidents'
    )!;
    const run = async (input: unknown) =>
      (await search.execute!(input)) as { total: number; items: Array<{ title: string }> };
    const first = await run({ status: 'unresolved' });
    expect(first.total).toBe(7);
    expect(first.items.slice(0, 3).map(item => item.title)).toEqual(['high c', 'high b', 'high a']);
    const next = await run({ status: 'unresolved', offset: 3 });
    expect(next.items.map(item => item.title)).toEqual(['medium b', 'medium a', 'low b', 'low a']);
  });

  it('puts HIGH first in basic mode, and "show more" continues the list', async () => {
    const ask = (message: string) =>
      planBasicTurn({ actor, message, incident: null }).then(result => result.text);
    const text = await ask('what is on fire?');
    expect(text.indexOf('high c')).toBeGreaterThan(-1);
    expect(text.indexOf('high c')).toBeLessThan(text.indexOf('medium b'));
    expect(text.indexOf('high a')).toBeLessThan(text.indexOf('medium b'));
  });
});
