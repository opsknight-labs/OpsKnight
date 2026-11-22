import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resetBusinessServiceHealthCacheForTests } from '@/lib/business-services/health';
import { getServiceGraphForActor } from '@/lib/intelligence/dependencies/graph-view';
import { setupMcpReadDatabase } from '../helpers/mcp-read-scenarios';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  testPrisma as db,
} from '../helpers/test-db';

setupMcpReadDatabase();
beforeEach(() => resetBusinessServiceHealthCacheForTests());

const actorFor = (
  user: { id: string },
  role: AuthorizationActor['role'],
  teamIds: string[] = []
): AuthorizationActor => ({ id: user.id, role, status: 'ACTIVE', teamIds });

const depend = (downstreamServiceId: string, upstreamServiceId: string, status = 'ACTIVE') =>
  db.serviceDependency.create({
    data: {
      upstreamServiceId,
      downstreamServiceId,
      origin: status === 'ACTIVE' ? 'DECLARED' : 'OBSERVED',
      status: status as 'ACTIVE' | 'SUGGESTED',
      confidence: status === 'ACTIVE' ? 1 : 0.6,
      evidence: {},
    },
  });

/** web → api → db → disk (a chain), with `hidden` (another team) between api and cache. */
async function scenario() {
  const [mine, other] = [await createTestTeam('Mine'), await createTestTeam('Other')];
  const web = await createTestService('web', mine.id);
  const api = await createTestService('api', mine.id);
  const store = await createTestService('db', mine.id);
  const disk = await createTestService('disk', mine.id);
  const hidden = await createTestService('hidden', other.id);
  const cache = await createTestService('cache', mine.id);
  await depend(web.id, api.id);
  await depend(api.id, store.id);
  await depend(store.id, disk.id);
  await depend(api.id, hidden.id);
  await depend(hidden.id, cache.id);
  const checkout = await db.businessService.create({
    data: {
      name: `Checkout-${Math.random().toString(36).slice(2, 8)}`,
      ownerTeamId: mine.id,
      criticality: 'TIER_0',
      members: {
        create: [
          { serviceId: web.id, critical: true },
          { serviceId: api.id, critical: false },
        ],
      },
    },
  });
  const payments = await db.businessService.create({
    data: {
      name: `Payments-${Math.random().toString(36).slice(2, 8)}`,
      ownerTeamId: mine.id,
      members: { create: [{ serviceId: store.id }] },
    },
  });
  const secret = await db.businessService.create({
    data: {
      name: `Secret-${Math.random().toString(36).slice(2, 8)}`,
      ownerTeamId: other.id,
      members: { create: [{ serviceId: hidden.id }] },
    },
  });
  await db.businessServiceSupport.create({
    data: { parentId: checkout.id, childId: payments.id },
  });
  return { mine, other, web, api, store, disk, hidden, cache, checkout, payments, secret };
}

describe('service graph view', () => {
  it('adds business services, member and support edges with live health', async () => {
    const s = await scenario();
    await createTestIncident('Web down', s.web.id, { urgency: 'HIGH' });
    const admin = await createTestUser({ role: 'ADMIN' });
    const graph = await getServiceGraphForActor(actorFor(admin, 'ADMIN'), undefined, {
      focus: { kind: 'bs', id: s.checkout.id },
      access: 'service',
    });
    expect(graph!.nodes.find(node => node.id === s.web.id)).toMatchObject({
      status: 'MAJOR_OUTAGE',
      openIncidents: 1,
      teamId: s.mine.id,
    });
    expect(graph!.nodes.find(node => node.id === s.api.id)?.status).toBe('OPERATIONAL');
    const checkout = graph!.businessServices.find(bs => bs.id === s.checkout.id);
    expect(checkout).toMatchObject({ criticality: 'TIER_0', memberCount: 2 });
    expect(checkout!.status).toBe('MAJOR_OUTAGE');
    expect(checkout!.reasons.length).toBeGreaterThan(0);
    expect(graph!.memberEdges).toEqual(
      expect.arrayContaining([
        { businessServiceId: s.checkout.id, serviceId: s.web.id, critical: true },
        { businessServiceId: s.checkout.id, serviceId: s.api.id, critical: false },
      ])
    );
    expect(graph!.supportEdges).toContainEqual({ parentId: s.checkout.id, childId: s.payments.id });
    expect(graph!.edges.every(edge => typeof edge.id === 'string')).toBe(true);
  });

  it('focus keeps the members and two hops, nothing further', async () => {
    const s = await scenario();
    const admin = await createTestUser({ role: 'ADMIN' });
    const graph = await getServiceGraphForActor(actorFor(admin, 'ADMIN'), undefined, {
      focus: { kind: 'svc', id: s.web.id },
      access: 'service',
    });
    const ids = new Set(graph!.nodes.map(node => node.id));
    // web → api (1) → db, hidden (2); disk and cache are three hops away.
    expect(ids).toEqual(new Set([s.web.id, s.api.id, s.store.id, s.hidden.id]));
    expect(graph!.truncated).toBe(false);
  });

  it('never shows or walks through services a scoped reader cannot see', async () => {
    const s = await scenario();
    const user = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { teamId: s.mine.id, userId: user.id } });
    const actor = actorFor(user, 'USER', [s.mine.id]);
    // USER lacks INTELLIGENCE_READ: the topology API stays closed, the service graph opens.
    expect(await getServiceGraphForActor(actor)).toBeNull();
    const graph = await getServiceGraphForActor(actor, undefined, {
      focus: { kind: 'svc', id: s.api.id },
      hops: 3,
      access: 'service',
    });
    const ids = new Set(graph!.nodes.map(node => node.id));
    expect(ids.has(s.hidden.id)).toBe(false);
    // cache is reachable only through the hidden service.
    expect(ids.has(s.cache.id)).toBe(false);
    expect(ids.has(s.disk.id)).toBe(true);
    expect(graph!.businessServices.map(bs => bs.id)).not.toContain(s.secret.id);
    expect(
      graph!.edges.every(
        edge => ids.has(edge.upstreamServiceId) && ids.has(edge.downstreamServiceId)
      )
    ).toBe(true);

    const full = await getServiceGraphForActor(actor, undefined, { access: 'service' });
    expect(full!.nodes.map(node => node.id)).not.toContain(s.hidden.id);
    expect(full!.businessServices.map(bs => bs.id)).not.toContain(s.secret.id);
    expect(full!.memberEdges.every(edge => edge.serviceId !== s.hidden.id)).toBe(true);
  });

  it('hides suggested edges from readers without suggestion access', async () => {
    const s = await scenario();
    await depend(s.disk.id, s.web.id, 'SUGGESTED');
    const stakeholder = await createTestUser({ role: 'STAKEHOLDER' });
    await db.teamMember.create({ data: { teamId: s.mine.id, userId: stakeholder.id } });
    const graph = await getServiceGraphForActor(
      actorFor(stakeholder, 'STAKEHOLDER', [s.mine.id]),
      undefined,
      { access: 'service' }
    );
    expect(graph).not.toBeNull();
    expect(graph!.edges.some(edge => edge.status === 'SUGGESTED')).toBe(false);
    const admin = await createTestUser({ role: 'ADMIN' });
    const all = await getServiceGraphForActor(actorFor(admin, 'ADMIN'), undefined, {
      access: 'service',
    });
    expect(all!.edges.some(edge => edge.status === 'SUGGESTED')).toBe(true);
  });

  it('bounds focus mode and reports truncation', async () => {
    const team = await createTestTeam('Wide');
    const hub = await createTestService('hub', team.id);
    const spokes = await Promise.all(
      Array.from({ length: 505 }, (_, index) => createTestService(`spoke-${index}`, team.id))
    );
    await db.serviceDependency.createMany({
      data: spokes.map(spoke => ({
        upstreamServiceId: hub.id,
        downstreamServiceId: spoke.id,
        origin: 'DECLARED' as const,
        status: 'ACTIVE' as const,
        confidence: 1,
        evidence: {},
      })),
    });
    const admin = await createTestUser({ role: 'ADMIN' });
    const graph = await getServiceGraphForActor(actorFor(admin, 'ADMIN'), undefined, {
      focus: { kind: 'svc', id: hub.id },
      access: 'service',
    });
    expect(graph!.nodes.length).toBe(500);
    expect(graph!.nodes.map(node => node.id)).toContain(hub.id);
    expect(graph!.truncated).toBe(true);
  });
});
