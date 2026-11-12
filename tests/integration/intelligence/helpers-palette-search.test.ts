import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { searchPaletteKnowledge } from '@/lib/intelligence/helpers/palette-search-loader';
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

async function switches(opsHelpersEnabled: boolean, knowledgeEnabled = true) {
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true, opsHelpersEnabled },
  });
  await db.squireMemorySettings.create({ data: { id: 'default', knowledgeEnabled } });
}

/** A resolution note in the index, as the knowledge sync would have written it. */
async function note(title: string, text: string, serviceId: string, teamId: string | null) {
  const incident = await createTestIncident(title, serviceId, {
    status: 'RESOLVED',
    resolvedAt: new Date(),
    teamId,
  });
  await db.knowledgeChunk.create({
    data: {
      sourceKind: 'RESOLUTION_NOTE',
      sourceId: `note-${incident.id}`,
      incidentId: incident.id,
      serviceId,
      teamId,
      title,
      text,
      contentHash: incident.id,
      sourceCreatedAt: new Date(),
      sourceUpdatedAt: new Date(),
    },
  });
  return incident;
}

const QUESTION = 'how did we fix checkout payment timeouts';

describe('command palette knowledge search', () => {
  it('finds past incidents by what was written about them', async () => {
    await switches(true);
    const admin = await createTestUser({ role: 'ADMIN' });
    const service = await createTestService('Checkout');
    const fixed = await note(
      'Checkout errors',
      'Payment timeouts fixed by raising the gateway pool size',
      service.id,
      null
    );
    await note('Disk full', 'Rotated logs on the batch host', service.id, null);

    const hits = await searchPaletteKnowledge(await actorFor(admin.id), QUESTION);
    expect(hits).toEqual([
      {
        kind: 'incident',
        href: `/incidents/${fixed.id}`,
        title: 'Checkout errors',
        snippet: 'Payment timeouts fixed by raising the gateway pool size',
      },
    ]);
  });

  it('is silent for name lookups and while either switch is off', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const service = await createTestService('Checkout');
    await switches(false);
    await note('Checkout errors', 'Payment timeouts fixed by raising the pool', service.id, null);
    const actor = await actorFor(admin.id);

    expect(await searchPaletteKnowledge(actor, QUESTION)).toEqual([]);
    await db.intelligenceSettings.update({
      where: { id: 'default' },
      data: { opsHelpersEnabled: true },
    });
    expect(await searchPaletteKnowledge(actor, 'checkout')).toEqual([]);
    await db.squireMemorySettings.update({
      where: { id: 'default' },
      data: { knowledgeEnabled: false },
    });
    expect(await searchPaletteKnowledge(actor, QUESTION)).toEqual([]);
  });

  it('never shows an incident the reader cannot open', async () => {
    await switches(true);
    const mine = await createTestTeam('Mine');
    const theirs = await createTestTeam('Theirs');
    const responder = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { teamId: mine.id, userId: responder.id, role: 'MEMBER' } });
    const visible = await note(
      'Checkout errors',
      'Payment timeouts fixed by raising the pool',
      (await createTestService('Ours', mine.id)).id,
      mine.id
    );
    await note(
      'Checkout errors elsewhere',
      'Payment timeouts fixed by a secret workaround',
      (await createTestService('Hidden', theirs.id)).id,
      theirs.id
    );

    const hits = await searchPaletteKnowledge(await actorFor(responder.id), QUESTION);
    expect(hits.map(hit => hit.href)).toEqual([`/incidents/${visible.id}`]);
  });
});
