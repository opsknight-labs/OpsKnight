import { beforeEach, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { ensureAnnIndex, searchIncidentVector } from '@/lib/intelligence/semantic/search';
import {
  detectCapabilities,
  resetCapabilityCacheForTests,
} from '@/lib/intelligence/similarity/capabilities';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  createTestTeam,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  resetCapabilityCacheForTests();
});
const vector = (dims: number, axis = 0) =>
  Array.from({ length: dims }, (_, index) => (index === axis ? 1 : 0));
async function embedding(id: string, serviceId: string, dims: number, axis = 0, at = new Date()) {
  await db.incidentEmbedding.create({
    data: {
      incidentId: id,
      serviceId,
      model: 'query-model',
      dims,
      vector: vector(dims, axis),
      sourceHash: 'fixture',
      incidentCreatedAt: at,
    },
  });
}

it('applies current visibility before top K in the bounded exact fallback', async () => {
  const user = await createTestUser({ role: 'USER' });
  const team = await createTestTeam('Search visible team');
  await db.teamMember.create({ data: { userId: user.id, teamId: team.id } });
  const service = await createTestService('Readable search service', team.id);
  const hiddenService = await createTestService('Hidden search service');
  const visible = await createTestIncident('Visible match', service.id, { teamId: team.id });
  const hidden = await createTestIncident('Hidden search canary', hiddenService.id);
  const privateIncident = await createTestIncident('Private search canary', service.id, {
    visibility: 'PRIVATE',
  });
  await embedding(visible.id, service.id, 24, 0, new Date(Date.now() - 10_000));
  await embedding(hidden.id, hiddenService.id, 24);
  await embedding(privateIncident.id, service.id, 24);
  const actor = (await resolveUserActor(user.id))!;
  const result = await searchIncidentVector(actor, vector(24), {
    model: 'query-model',
    lowerBound: new Date(0),
    limit: 1,
    scanLimit: 1,
  });
  expect(result.coverage).toEqual({
    mode: 'BOUNDED_EXACT',
    approximate: false,
    recentScanLimit: 1,
  });
  expect(result.items.map(item => item.id)).toEqual([visible.id]);
  expect(JSON.stringify(result)).not.toContain('canary');
  await db.teamMember.deleteMany({ where: { userId: user.id } });
  expect(
    (
      await searchIncidentVector((await resolveUserActor(user.id))!, vector(24), {
        model: 'query-model',
        lowerBound: new Date(0),
      })
    ).items
  ).toEqual([]);
});

it('finds a match beyond the newest 500 vectors and reports bounded recovery when ANN misses', async ({
  skip,
}) => {
  // pgvector-enabled CI exercises ANN; all PostgreSQL variants exercise the bounded fallback above.
  if (!(await detectCapabilities()).vectorAvailable) skip();
  const user = await createTestUser({ role: 'ADMIN' });
  const service = await createTestService('Long semantic history');
  const older = await createTestIncident('Older exact semantic match', service.id);
  await embedding(older.id, service.id, 16, 0, new Date(Date.now() - 86_400_000));
  const ids = Array.from({ length: 501 }, (_, index) => `query-neighbour-${index}`);
  await db.incident.createMany({
    data: ids.map(id => ({ id, title: 'Unrelated recent incident', serviceId: service.id })),
  });
  await db.incidentEmbedding.createMany({
    data: ids.map(incidentId => ({
      incidentId,
      serviceId: service.id,
      model: 'query-model',
      dims: 16,
      vector: vector(16, 1),
      sourceHash: 'fixture',
      incidentCreatedAt: new Date(),
    })),
  });
  await ensureAnnIndex(16);
  const result = await searchIncidentVector((await resolveUserActor(user.id))!, vector(16), {
    model: 'query-model',
    lowerBound: new Date(0),
    limit: 1,
    scanLimit: 1000,
  });
  expect(['ANN', 'BOUNDED_EXACT']).toContain(result.coverage.mode);
  if (result.coverage.mode === 'BOUNDED_EXACT')
    expect(result.coverage).toMatchObject({ annFallback: true, recentScanLimit: 1000 });
  expect(result.items.map(item => item.id)).toEqual([older.id]);
});

it('fails closed for inactive callers, malformed vectors and mixed model spaces', async () => {
  const user = await createTestUser({ role: 'ADMIN' });
  const actor = (await resolveUserActor(user.id))!;
  const options = { model: 'query-model', lowerBound: new Date(0) };
  expect(
    (await searchIncidentVector({ ...actor, status: 'DISABLED' }, vector(24), options)).coverage
      .mode
  ).toBe('UNAVAILABLE');
  expect((await searchIncidentVector(actor, [NaN, ...vector(24)], options)).coverage.mode).toBe(
    'UNAVAILABLE'
  );
  const service = await createTestService('Mixed models');
  const incident = await createTestIncident('Another model match', service.id);
  await embedding(incident.id, service.id, 24);
  expect(
    (await searchIncidentVector(actor, vector(24), { ...options, model: 'different-model' })).items
  ).toEqual([]);
});
