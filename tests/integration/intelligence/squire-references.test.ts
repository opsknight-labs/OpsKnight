import { beforeEach, expect, it } from 'vitest';
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
});
