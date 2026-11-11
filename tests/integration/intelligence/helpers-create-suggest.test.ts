import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { suggestForIncidentDraft } from '@/lib/intelligence/helpers/create-suggest-loader';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
import { resetCapabilityCacheForTests } from '@/lib/intelligence/similarity/capabilities';
import { resetTermFrequencyCacheForTests } from '@/lib/intelligence/similarity/term-stats';
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
  resetCapabilityCacheForTests();
  resetTermFrequencyCacheForTests();
});

async function actorFor(userId: string) {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
}

async function indexed(
  title: string,
  serviceId: string,
  data: Record<string, unknown> = { status: 'RESOLVED', resolvedAt: new Date() }
) {
  const incident = await createTestIncident(title, serviceId, {
    createdAt: new Date(Date.now() - 3_600_000),
    ...data,
  });
  await db.$transaction(tx => indexIncident(incident.id, tx));
  return incident;
}

const switches = (opsHelpersEnabled: boolean, enabled = true) =>
  db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled, opsHelpersEnabled },
  });

const DRAFT = { title: 'Database connection errors on db-primary-9', urgency: 'HIGH' };

describe('suggestions for an incident being typed', () => {
  it('suggests the service, urgency and an open duplicate from indexed look-alikes', async () => {
    await switches(true);
    const admin = await createTestUser({ role: 'ADMIN' });
    const checkout = await createTestService('Checkout');
    const search = await createTestService('Search');
    await indexed('Database connection errors on db-primary-1', checkout.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      urgency: 'LOW',
    });
    await indexed('Database connection errors on db-primary-2', checkout.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(),
      urgency: 'LOW',
    });
    const open = await indexed('Database connection errors on db-primary-7', checkout.id, {
      urgency: 'LOW',
    });
    await indexed('Search results page renders blank', search.id);

    const result = await suggestForIncidentDraft(await actorFor(admin.id), DRAFT);
    expect(result.service).toEqual({ id: checkout.id, name: checkout.name, matches: 3 });
    expect(result.urgency).toEqual({ value: 'LOW', matches: 3 });
    expect(result.duplicate).toMatchObject({ incidentId: open.id, serviceName: checkout.name });
  });

  it('is silent while either switch is off, and for a title too short to compare', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const service = await createTestService('Checkout');
    await indexed('Database connection errors on db-primary-1', service.id);
    await indexed('Database connection errors on db-primary-2', service.id);
    const nothing = { service: null, urgency: null, duplicate: null };
    const actor = await actorFor(admin.id);

    expect(await suggestForIncidentDraft(actor, DRAFT)).toEqual(nothing);
    await switches(false);
    expect(await suggestForIncidentDraft(actor, DRAFT)).toEqual(nothing);
    await db.intelligenceSettings.update({
      where: { id: 'default' },
      data: { opsHelpersEnabled: true, enabled: false },
    });
    expect(await suggestForIncidentDraft(actor, DRAFT)).toEqual(nothing);
    await db.intelligenceSettings.update({ where: { id: 'default' }, data: { enabled: true } });
    expect(await suggestForIncidentDraft(actor, { title: 'Databas' })).toEqual(nothing);
    expect((await suggestForIncidentDraft(actor, DRAFT)).service?.id).toBe(service.id);
  });

  it('never draws on incidents the reader cannot see', async () => {
    await switches(true);
    const mine = await createTestTeam('Mine');
    const theirs = await createTestTeam('Theirs');
    const responder = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { teamId: mine.id, userId: responder.id, role: 'MEMBER' } });
    const hidden = await createTestService('Hidden', theirs.id);
    const data = { teamId: theirs.id };
    await indexed('Database connection errors on db-primary-1', hidden.id, data);
    await indexed('Database connection errors on db-primary-2', hidden.id, data);

    expect(await suggestForIncidentDraft(await actorFor(responder.id), DRAFT)).toEqual({
      service: null,
      urgency: null,
      duplicate: null,
    });
  });
});
