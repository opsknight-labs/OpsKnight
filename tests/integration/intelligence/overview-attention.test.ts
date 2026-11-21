import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  ATTENTION_ITEMS_PER_KIND,
  getOverviewAttention,
} from '@/lib/intelligence/overview/attention';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
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

const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

async function setMode(
  adminId: string,
  mode: 'OFF' | 'SHADOW' | 'SUGGEST',
  serviceId: string | null = null,
  triage = true
) {
  await db.intelligenceSettings.upsert({
    where: { id: 'default' },
    update: { enabled: true },
    create: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  const current = await db.intelligencePolicy.findFirst({
    where: serviceId ? { serviceId } : { serviceId: null },
    select: { headVersion: true },
  });
  await publishPolicyVersion(
    { serviceId },
    {
      mode,
      definition: {
        ...DEFAULT_POLICY_DEFINITION,
        triage: { ...DEFAULT_POLICY_DEFINITION.triage, enabled: triage },
      },
      expectedHeadVersion: current?.headVersion ?? 0,
    },
    { actorId: adminId, source: 'UI' }
  );
}

async function seed() {
  const admin = await createTestUser({ role: 'ADMIN' });
  const responder = await createTestUser({ role: 'RESPONDER' });
  const scoped = await createTestUser({ role: 'USER' });
  const mine = await createTestTeam('Payments');
  const theirs = await createTestTeam('Search');
  await db.teamMember.create({ data: { userId: scoped.id, teamId: mine.id } });
  const myService = await createTestService('Checkout', mine.id);
  const otherService = await createTestService('Indexer', theirs.id);
  return {
    adminUser: admin,
    admin: await actorOf(admin.id),
    responder: await actorOf(responder.id),
    scoped: await actorOf(scoped.id),
    myService,
    otherService,
  };
}

const triageFinding = (incidentId: string, kind = 'TRIAGE_URGENCY') =>
  db.intelligenceFinding.create({
    data: {
      incidentId,
      kind: kind as 'TRIAGE_URGENCY',
      subjectRef: 'HIGH',
      evidence: {},
      generation: 1,
      engineVersion: 't',
    },
  });

const suggestRelated = (sourceIncidentId: string, targetIncidentId: string) =>
  db.incidentRelationship.create({
    data: {
      sourceIncidentId,
      targetIncidentId,
      type: 'RELATED',
      origin: 'RULE',
      decision: 'SUGGESTED',
      evidence: {},
      engineVersion: 't',
    },
  });

describe('overview needs-attention inbox', () => {
  it('is empty when nothing is waiting', async () => {
    const { admin, adminUser, responder } = await seed();
    await setMode(adminUser.id, 'SUGGEST');
    expect((await getOverviewAttention(admin)).items).toEqual([]);
    expect((await getOverviewAttention(responder)).items).toEqual([]);
  });

  it('lists pending triage and related suggestions on open incidents, linked to the incident', async () => {
    const { admin, adminUser, responder, myService } = await seed();
    await setMode(adminUser.id, 'SUGGEST');
    const open = await createTestIncident('checkout latency', myService.id);
    const peer = await createTestIncident('checkout errors', myService.id);
    const resolved = await createTestIncident('done', myService.id, { status: 'RESOLVED' });
    await triageFinding(open.id);
    await triageFinding(open.id, 'TRIAGE_ASSIGNMENT');
    await triageFinding(resolved.id);
    await suggestRelated(open.id, peer.id);
    await suggestRelated(resolved.id, peer.id);

    const items = (await getOverviewAttention(responder)).items;
    expect(items).toEqual([
      {
        id: `triage:${open.id}`,
        kind: 'triage',
        title: 'checkout latency',
        detail: '2 triage suggestions awaiting a decision',
        href: `/incidents/${open.id}?insights=triage`,
        at: expect.any(Date),
      },
      {
        id: `related:${open.id}`,
        kind: 'related',
        title: 'checkout latency',
        detail: '1 related-incident suggestion awaiting review',
        href: `/incidents/${open.id}?insights=related`,
        at: expect.any(Date),
      },
    ]);
    expect((await getOverviewAttention(admin)).items.map(item => item.id)).toEqual(
      items.map(item => item.id)
    );
  });

  it('drops a triage suggestion once anyone has given a verdict, and decided relationships', async () => {
    const { adminUser, responder, myService } = await seed();
    await setMode(adminUser.id, 'SUGGEST');
    const open = await createTestIncident('checkout latency', myService.id);
    const peer = await createTestIncident('checkout errors', myService.id);
    const finding = await triageFinding(open.id);
    const relationship = await suggestRelated(open.id, peer.id);
    await db.intelligenceFeedback.create({
      data: {
        subjectType: 'FINDING',
        subjectId: finding.id,
        verdict: 'HELPFUL',
        actorId: adminUser.id,
      },
    });
    await db.incidentRelationship.update({
      where: { id: relationship.id },
      data: { decision: 'ACCEPTED' },
    });
    expect((await getOverviewAttention(responder)).items).toEqual([]);
  });

  it('respects the service mode: OFF and SHADOW services contribute nothing', async () => {
    const { adminUser, responder, myService, otherService } = await seed();
    await setMode(adminUser.id, 'SUGGEST');
    await setMode(adminUser.id, 'OFF', myService.id);
    await setMode(adminUser.id, 'SHADOW', otherService.id);
    for (const service of [myService, otherService]) {
      const open = await createTestIncident(`open ${service.id}`, service.id);
      const peer = await createTestIncident(`peer ${service.id}`, service.id);
      await triageFinding(open.id);
      await suggestRelated(open.id, peer.id);
    }
    expect((await getOverviewAttention(responder)).items).toEqual([]);
  });

  it('omits triage where the policy has triage turned off but keeps related suggestions', async () => {
    const { adminUser, responder, myService } = await seed();
    await setMode(adminUser.id, 'SUGGEST', null, false);
    const open = await createTestIncident('checkout latency', myService.id);
    const peer = await createTestIncident('checkout errors', myService.id);
    await triageFinding(open.id);
    await suggestRelated(open.id, peer.id);
    expect((await getOverviewAttention(responder)).items.map(item => item.kind)).toEqual([
      'related',
    ]);
  });

  it('scopes suggestions to the incidents the viewer may read', async () => {
    const { adminUser, scoped, myService, otherService } = await seed();
    await setMode(adminUser.id, 'SUGGEST');
    const mine = await createTestIncident('mine', myService.id);
    const theirs = await createTestIncident('theirs', otherService.id);
    await triageFinding(mine.id);
    await triageFinding(theirs.id);
    await suggestRelated(mine.id, theirs.id);
    const items = (await getOverviewAttention(scoped)).items;
    // The related suggestion points at an incident the viewer cannot read, so it is not offered.
    expect(items.map(item => item.id)).toEqual([`triage:${mine.id}`]);
  });

  it('folds incidents beyond the per-kind limit into one "more" row', async () => {
    const { adminUser, responder, myService } = await seed();
    await setMode(adminUser.id, 'SUGGEST');
    for (let i = 0; i < ATTENTION_ITEMS_PER_KIND + 2; i += 1) {
      const incident = await createTestIncident(`incident ${i}`, myService.id);
      await triageFinding(incident.id);
    }
    const items = (await getOverviewAttention(responder)).items;
    expect(items).toHaveLength(ATTENTION_ITEMS_PER_KIND + 1);
    expect(items[items.length - 1]).toMatchObject({
      id: 'triage:more',
      title: '2 more incidents with triage suggestions to review',
      href: '/incidents',
    });
  });

  it('shows observed dependencies and quarantined work to administrators only', async () => {
    const { admin, responder, myService, otherService } = await seed();
    await db.serviceDependency.create({
      data: {
        upstreamServiceId: myService.id,
        downstreamServiceId: otherService.id,
        origin: 'OBSERVED',
        status: 'SUGGESTED',
        confidence: 0.7,
        evidence: {},
      },
    });
    await db.intelligenceWorkItem.create({
      data: {
        kind: 'ANALYZE_INCIDENT',
        subjectKey: 'attention-test',
        attempts: 5,
        failedAt: new Date(),
        quarantinedAt: new Date(),
      },
    });
    const items = (await getOverviewAttention(admin)).items;
    expect(items.find(item => item.kind === 'dependencies')).toMatchObject({
      title: '1 observed dependency to review',
      href: '/settings/intelligence/services#dependencies',
    });
    expect(items.find(item => item.kind === 'quarantine')).toMatchObject({
      title: '1 quarantined work item',
      href: '/settings/intelligence#failed-work',
    });
    expect((await getOverviewAttention(responder)).items).toEqual([]);
  });
});
