import { buildSquireTools } from '@/lib/intelligence/squire/tools';
import { beforeEach, expect, it, vi } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { citationsFor } from '@/lib/intelligence/squire/chat';
import { readAlertReference, readChangeReference } from '@/lib/intelligence/squire/references';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
it('renders change and alert sources only when the actor can open their scoped detail pages', async () => {
  const team = await createTestTeam('Mine');
  const hiddenTeam = await createTestTeam('Hidden');
  const user = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: user.id, teamId: team.id } });
  const service = await createTestService('Mine', team.id);
  const hiddenService = await createTestService('Hidden', hiddenTeam.id);
  const incident = await createTestIncident('Mine', service.id, { teamId: team.id });
  const hidden = await createTestIncident('Private', hiddenService.id, {
    teamId: hiddenTeam.id,
    visibility: 'PRIVATE',
  });
  const change = await db.changeEvent.create({
    data: {
      serviceId: service.id,
      source: 'ci',
      kind: 'DEPLOY',
      summary: 'Checkout rollout',
      occurredAt: new Date(),
    },
  });
  const hiddenChange = await db.changeEvent.create({
    data: {
      serviceId: hiddenService.id,
      source: 'ci',
      kind: 'DEPLOY',
      summary: 'Hidden rollout',
      occurredAt: new Date(),
    },
  });
  const alert = await db.alert.create({
    data: {
      incidentId: incident.id,
      serviceId: service.id,
      payload: { summary: 'Latency high password=secret123456' },
    },
  });
  const hiddenAlert = await db.alert.create({
    data: {
      incidentId: hidden.id,
      serviceId: hiddenService.id,
      payload: { summary: 'Hidden alert' },
    },
  });
  const actor = (await resolveUserActor(user.id))!;
  expect(await readChangeReference(actor, hiddenChange.id)).toBeNull();
  expect(await readAlertReference(actor, hiddenAlert.id)).toBeNull();
  const citations = await citationsFor(
    actor,
    `/changes/${change.id} /changes/${hiddenChange.id} /alerts/${alert.id} /alerts/${hiddenAlert.id} /alerts/hallucinated`
  );
  expect(citations.map(c => c.id).sort()).toEqual([change.id, alert.id].sort());
  expect(citations.map(c => c.kind).sort()).toEqual(['alert', 'change']);
  expect(JSON.stringify(citations)).not.toContain('secret123456');
  const admin = (await resolveUserActor((await createTestUser({ role: 'ADMIN' })).id))!;
  expect(await readChangeReference(admin, change.id)).not.toBeNull();
  expect(await readAlertReference(admin, alert.id)).not.toBeNull();
  const changesTool = buildSquireTools(admin, { personal: false }).find(
    tool => tool.name === 'get_recent_changes'
  )!;
  expect(JSON.stringify(await changesTool.execute!({}))).toContain('Checkout rollout');
});

it('does not reveal a hidden service through the dependencies of a readable service', async () => {
  const mine = await createTestTeam('Readable topology');
  const hidden = await createTestTeam('Hidden topology');
  const user = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: user.id, teamId: mine.id } });
  const visible = await createTestService('Readable service', mine.id);
  const secret = await createTestService('hidden-dependency-canary-47', hidden.id);
  await db.serviceDependency.create({
    data: {
      upstreamServiceId: secret.id,
      downstreamServiceId: visible.id,
      status: 'ACTIVE',
      origin: 'DECLARED',
      evidence: { type: 'manual' },
    },
  });
  const permitted = await createTestService('Permitted upstream', mine.id);
  await db.serviceDependency.create({
    data: {
      upstreamServiceId: permitted.id,
      downstreamServiceId: visible.id,
      status: 'ACTIVE',
      origin: 'DECLARED',
      evidence: { type: 'manual' },
    },
  });
  const actor = (await resolveUserActor(user.id))!;
  const tool = buildSquireTools(actor, { personal: true }).find(
    tool => tool.name === 'get_service'
  )!;
  const result = JSON.stringify(await tool.execute!({ id: visible.id }));
  expect(result).not.toContain('hidden-dependency-canary-47');
  expect(result).not.toContain(secret.id);
  expect(result).toContain(permitted.name);
});

it.each(['PERSONAL', 'SENSITIVE'] as const)(
  'keeps free-text semantic queries at their declared %s boundary',
  async dataClass => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const actor = (await resolveUserActor(admin.id))!;
    const port = await import('@/lib/intelligence/ai/port');
    const resolve = vi.spyOn(port, 'resolveEmbeddingModel').mockResolvedValueOnce(null);
    try {
      const tool = buildSquireTools(actor, { personal: true, dataClass }).find(
        tool => tool.name === 'semantic_search_incidents'
      )!;
      await tool.execute!({ query: 'Alice operational query canary' });
      expect(resolve).toHaveBeenCalledWith(dataClass);
      expect(tool.dataClass).toBe(dataClass);
    } finally {
      resolve.mockRestore();
    }
  }
);

it('does not start a semantic embedding request after cancellation', async () => {
  const admin = await createTestUser({ role: 'ADMIN' });
  const actor = (await resolveUserActor(admin.id))!;
  const controller = new AbortController();
  controller.abort();
  const port = await import('@/lib/intelligence/ai/port');
  const resolve = vi.spyOn(port, 'resolveEmbeddingModel');
  try {
    const tool = buildSquireTools(actor, { personal: true, signal: controller.signal }).find(
      tool => tool.name === 'semantic_search_incidents'
    )!;
    expect(await tool.execute!({ query: 'cancelled query' })).toMatchObject({
      items: [],
      coverage: { mode: 'UNAVAILABLE' },
    });
    expect(resolve).not.toHaveBeenCalled();
  } finally {
    resolve.mockRestore();
  }
});
