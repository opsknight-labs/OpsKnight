import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  recurredActionItemIds,
  suggestForActionItemDraft,
} from '@/lib/intelligence/helpers/action-item-suggest-loader';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

async function actorFor(userId: string) {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
}

const switches = (opsHelpersEnabled: boolean) =>
  db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true, opsHelpersEnabled },
  });

async function incidentWithItem(
  serviceId: string,
  title: string,
  createdAt: Date,
  item?: { title: string; createdById?: string; status?: 'OPEN' | 'COMPLETED' }
) {
  const incident = await createTestIncident(title, serviceId, {
    createdAt,
    status: 'RESOLVED',
    resolvedAt: createdAt,
    visibility: 'PUBLIC',
  });
  await db.$transaction(tx => indexIncident(incident.id, tx));
  if (!item) return { incident, itemId: null };
  const postmortem = await db.postmortem.create({
    data: { incidentId: incident.id, title: 'PM', createdById: item.createdById },
  });
  const action = await db.actionItem.create({
    data: {
      postmortemId: postmortem.id,
      incidentId: incident.id,
      title: item.title,
      status: item.status ?? 'OPEN',
      createdAt,
    },
  });
  return { incident, itemId: action.id };
}

describe('action item draft suggestions', () => {
  it('suggests the service, its team lead and readable open look-alikes only', async () => {
    await switches(true);
    const lead = await createTestUser({ name: 'Lead' });
    const reader = await createTestUser({ name: 'Reader' });
    const team = await createTestTeam('Payments', { teamLeadId: lead.id });
    await db.teamMember.create({ data: { teamId: team.id, userId: reader.id } });
    const mine = await createTestService('Checkout', team.id);
    const other = await createTestService('Hidden', (await createTestTeam('Other')).id);
    const now = new Date();
    const target = await incidentWithItem(mine.id, 'DB pool exhausted', now, {
      title: 'Add connection pool alerting',
      createdById: reader.id,
    });
    await incidentWithItem(other.id, 'Other', now, { title: 'Add connection pool alerting' });
    await incidentWithItem(mine.id, 'Done', now, {
      title: 'Add connection pool alerting',
      status: 'COMPLETED',
    });

    const result = await suggestForActionItemDraft(await actorFor(reader.id), {
      incidentId: target.incident.id,
      title: 'Add connection pool alerting',
    });
    expect(result?.service?.id).toBe(mine.id);
    expect(result?.owner).toMatchObject({ userId: lead.id, name: 'Lead' });
    expect(result?.duplicates.map(item => item.id)).toEqual([target.itemId]);
  });

  it('falls back to the postmortem author and is off without the helpers switch', async () => {
    const author = await createTestUser({ role: 'ADMIN', name: 'Author' });
    const service = await createTestService('Lonely');
    const { incident } = await incidentWithItem(service.id, 'x', new Date(), {
      title: 'Something',
      createdById: author.id,
    });
    const actor = await actorFor(author.id);
    await switches(false);
    expect(await suggestForActionItemDraft(actor, { incidentId: incident.id, title: 'a' })).toBe(
      null
    );
    await db.intelligenceSettings.update({
      where: { id: 'default' },
      data: { opsHelpersEnabled: true },
    });
    const result = await suggestForActionItemDraft(actor, { incidentId: incident.id, title: '' });
    expect(result?.owner).toMatchObject({ userId: author.id, reason: 'Wrote this postmortem' });
  });
});

describe('action items whose cause recurred', () => {
  it('marks unfinished items whose problem came back after they were written', async () => {
    await switches(true);
    const service = await createTestService('Checkout');
    const day = 86_400_000;
    const now = Date.now();
    const recurred = await incidentWithItem(
      service.id,
      'Database connection errors on db-primary-1',
      new Date(now - 10 * day),
      { title: 'Fix pool' }
    );
    const quiet = await incidentWithItem(
      service.id,
      'Disk full on node-7',
      new Date(now - 10 * day),
      { title: 'Add disk alert' }
    );
    const done = await incidentWithItem(
      service.id,
      'Database connection errors on db-primary-2',
      new Date(now - 9 * day),
      { title: 'Done', status: 'COMPLETED' }
    );
    await incidentWithItem(
      service.id,
      'Database connection errors on db-primary-3',
      new Date(now - day)
    );

    const ids = [recurred.itemId!, quiet.itemId!, done.itemId!];
    expect([...(await recurredActionItemIds(ids))]).toEqual([recurred.itemId]);
    await db.intelligenceSettings.update({
      where: { id: 'default' },
      data: { opsHelpersEnabled: false },
    });
    expect((await recurredActionItemIds(ids)).size).toBe(0);
  });
});
