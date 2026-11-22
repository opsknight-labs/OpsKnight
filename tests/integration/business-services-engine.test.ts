import { beforeEach, describe, expect, it } from 'vitest';
import { GET as listRoute } from '@/app/api/v2/business-services/route';
import { GET as getRoute } from '@/app/api/v2/business-services/[id]/route';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  getBusinessServiceHealth,
  getBusinessServiceStats,
  getImpactTimeline,
  listBusinessServices,
} from '@/lib/business-services/contract';
import {
  impactedBusinessServicesForIncident,
  updateBusinessService,
} from '@/lib/business-services/commands';
import { resetBusinessServiceHealthCacheForTests } from '@/lib/business-services/health';
import {
  backfillDirectImpacts,
  enqueueBusinessServiceImpactReconcile,
  reconcileBusinessServiceImpacts,
  setIncidentImpactCommand,
  syncIncidentImpacts,
} from '@/lib/business-services/impacts';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import { saveStatusPageSection } from '@/lib/status-pages/settings-command';
import { GET as incidentsRoute } from '@/app/api/v2/business-services/[id]/incidents/route';
import { invokeV2 } from '../helpers/api-v2';
import { principal, setupMcpReadDatabase } from '../helpers/mcp-read-scenarios';
import {
  createTestIncident,
  createTestService,
  createTestStatusPage,
  createTestTeam,
  createTestUser,
  linkServiceToStatusPage,
  testPrisma as db,
} from '../helpers/test-db';

type V2Handler = Parameters<typeof invokeV2>[0];

setupMcpReadDatabase();

beforeEach(() => resetBusinessServiceHealthCacheForTests());

const actorFor = (
  user: { id: string },
  role: AuthorizationActor['role'],
  teamIds: string[] = []
): AuthorizationActor => ({ id: user.id, role, status: 'ACTIVE', teamIds });

async function businessService(
  name: string,
  ownerTeamId: string | null,
  members: Array<string | [string, boolean]>,
  extra: Record<string, unknown> = {}
) {
  return db.businessService.create({
    data: {
      name: `${name}-${Math.random().toString(36).slice(2, 8)}`,
      ownerTeamId,
      ...extra,
      members: {
        create: members.map(member =>
          Array.isArray(member)
            ? { serviceId: member[0], critical: member[1] }
            : { serviceId: member }
        ),
      },
    },
  });
}

describe('business-service scope', () => {
  it('never shows a team-scoped reader business services outside their scope', async () => {
    const [teamA, teamB] = [await createTestTeam('A'), await createTestTeam('B')];
    const svcA = await createTestService('alpha-api', teamA.id);
    const svcB = await createTestService('beta-api', teamB.id);
    const shared = await createTestService('shared-db');
    const alpha = await businessService('Alpha', teamA.id, [svcA.id, shared.id]);
    const beta = await businessService('Beta', teamB.id, [svcB.id, shared.id]);
    const incident = await createTestIncident('Shared database down', shared.id);

    const reader = await principal('USER', ['services:read']);
    await db.teamMember.create({ data: { teamId: teamA.id, userId: reader.user.id } });
    const readerActor = actorFor(reader.user, 'USER', [teamA.id]);
    const admin = actorFor(await createTestUser({ role: 'ADMIN' }), 'ADMIN');

    // Incident chips
    const chips = await impactedBusinessServicesForIncident(readerActor, incident.id);
    expect(chips.map(chip => chip.id)).toEqual([alpha.id]);
    expect(chips[0]).toMatchObject({ source: 'DIRECT', excluded: false, active: true });
    expect(
      (await impactedBusinessServicesForIncident(admin, incident.id)).map(c => c.id).sort()
    ).toEqual([alpha.id, beta.id].sort());

    // Engine list and health
    const page = await listBusinessServices({ limit: 100 }, readerActor);
    expect(page.items.map(item => item.id)).toEqual([alpha.id]);
    expect(page.items[0].health).toMatchObject({ status: 'MAJOR_OUTAGE', openIncidentCount: 1 });
    expect([...(await getBusinessServiceHealth([alpha.id, beta.id], readerActor)).keys()]).toEqual([
      alpha.id,
    ]);

    // REST
    const list = await invokeV2(
      listRoute as unknown as V2Handler,
      reader.restToken,
      'GET',
      '/business-services',
      {}
    );
    expect(list.status).toBe(200);
    const listed = (await list.json()).data as Array<{ id: string; health: { status: string } }>;
    expect(listed.map(item => item.id)).toEqual([alpha.id]);
    expect(listed[0].health.status).toBe('MAJOR_OUTAGE');
    const hidden = await invokeV2(
      getRoute as unknown as V2Handler,
      reader.restToken,
      'GET',
      `/business-services/${beta.id}`,
      { id: beta.id }
    );
    expect(hidden.status).toBe(404);

    // MCP goes through the same routes
    const mcpList = await callMcpOperation(reader.ctx(), 'listBusinessServices', {});
    expect(JSON.stringify(mcpList.data)).toContain(alpha.id);
    expect(JSON.stringify(mcpList.data)).not.toContain(beta.id);
    await expect(
      callMcpOperation(reader.ctx(), 'getBusinessService', { path: { id: beta.id } })
    ).rejects.toThrow();

    // Impact history: the shared incident is outside the reader's incident scope, and a
    // stakeholder cannot read incidents at all. Both see intervals and counts, never incident data.
    await syncIncidentImpacts([incident.id]);
    const window = { from: new Date(Date.now() - 3_600_000), to: new Date(Date.now() + 60_000) };
    const stakeholder = actorFor(await createTestUser({ role: 'STAKEHOLDER' }), 'STAKEHOLDER', [
      teamA.id,
    ]);
    for (const who of [readerActor, stakeholder]) {
      const [entry] = await getImpactTimeline(alpha.id, window, who);
      expect(entry).toMatchObject({ incidentId: null, incidentTitle: null, urgency: null });
      expect((await getBusinessServiceStats(alpha.id, window, who)).incidentCount).toBe(1);
    }
    expect((await getImpactTimeline(alpha.id, window, admin))[0]).toMatchObject({
      incidentId: incident.id,
      incidentTitle: 'Shared database down',
    });
    const incidentsList = await invokeV2(
      incidentsRoute as unknown as V2Handler,
      reader.restToken,
      'GET',
      `/business-services/${alpha.id}/incidents`,
      { id: alpha.id }
    );
    expect(incidentsList.status).toBe(200);
    expect((await incidentsList.json()).data).toEqual([]);
    // Health reasons drop incident ids the reader cannot see.
    expect(JSON.stringify(listed)).not.toContain(incident.id);
  });

  it('filters the catalog by status and tier and pages by name', async () => {
    const team = await createTestTeam('Filters');
    const down = await createTestService('down', team.id);
    const ok = await createTestService('ok', team.id);
    const a = await businessService('A-down', team.id, [down.id], { criticality: 'TIER_0' });
    await businessService('B-ok', team.id, [ok.id], { criticality: 'TIER_0' });
    await businessService('C-ok', team.id, [ok.id], { criticality: 'TIER_3' });
    await createTestIncident('Down', down.id, { urgency: 'HIGH' });
    const actor = actorFor(await createTestUser({ role: 'USER' }), 'USER', [team.id]);

    const impacted = await listBusinessServices(
      { filter: { status: ['MAJOR_OUTAGE'] }, limit: 10 },
      actor
    );
    expect(impacted.items.map(item => item.id)).toEqual([a.id]);
    const tier0 = await listBusinessServices(
      { filter: { criticality: ['TIER_0'] }, limit: 1 },
      actor
    );
    expect(tier0.items).toHaveLength(1);
    const next = await listBusinessServices(
      { filter: { criticality: ['TIER_0'] }, limit: 1, cursor: tier0.nextCursor },
      actor
    );
    expect(next.items).toHaveLength(1);
    expect(next.items[0].id).not.toBe(tier0.items[0].id);
    expect(next.nextCursor).toBeNull();
  });
});

describe('status page member sync', () => {
  it('drops a member published only through business services, never a direct selection', async () => {
    const page = await createTestStatusPage({ enabled: true, serviceLayout: 'BUSINESS' });
    const [direct, one, two] = [
      await createTestService('direct'),
      await createTestService('one'),
      await createTestService('two'),
    ];
    await linkServiceToStatusPage(page.id, direct.id);
    const alpha = await businessService('Alpha', null, []);
    const gamma = await businessService('Gamma', null, [two.id]);
    await db.statusPageBusinessService.createMany({
      data: [
        { statusPageId: page.id, businessServiceId: alpha.id },
        { statusPageId: page.id, businessServiceId: gamma.id },
      ],
    });
    const admin = actorFor(await createTestUser({ role: 'ADMIN' }), 'ADMIN');
    const rows = async () =>
      Object.fromEntries(
        (
          await db.statusPageService.findMany({
            where: { statusPageId: page.id },
            select: { serviceId: true, viaBusinessService: true },
          })
        ).map(row => [row.serviceId, row.viaBusinessService])
      );
    await updateBusinessService(
      alpha.id,
      { memberServiceIds: [direct.id, one.id, two.id] },
      { actor: admin }
    );
    expect(await rows()).toEqual({ [direct.id]: false, [one.id]: true, [two.id]: true });

    const extra = await createTestService('three');
    await updateBusinessService(alpha.id, { memberServiceIds: [extra.id] }, { actor: admin });
    // one goes; two stays through Gamma; the admin's direct selection stays.
    expect(await rows()).toEqual({ [direct.id]: false, [two.id]: true, [extra.id]: true });

    // Taking Gamma off the page drops two; a save that lists extra directly keeps it as direct.
    const current = await db.statusPage.findUniqueOrThrow({ where: { id: page.id } });
    await saveStatusPageSection(
      page.id,
      { businessServiceIds: [], serviceIds: [direct.id, extra.id] },
      { id: admin.id },
      current.revision,
      'services'
    );
    expect(await rows()).toEqual({ [direct.id]: false, [extra.id]: false });
  });
});

describe('impact history', () => {
  it('writes rows idempotently and keeps manual marks and exclusions through reconcile', async () => {
    const api = await createTestService('api');
    const other = await createTestService('other');
    const checkout = await businessService('Checkout', null, [api.id], { criticality: 'TIER_0' });
    const reporting = await businessService('Reporting', null, [other.id], {
      criticality: 'TIER_3',
    });
    const incident = await createTestIncident('Checkout errors', api.id, { urgency: 'HIGH' });
    const responder = actorFor(await createTestUser({ role: 'RESPONDER' }), 'RESPONDER');

    expect(await syncIncidentImpacts([incident.id])).toEqual({ created: 1, updated: 0 });
    expect(await syncIncidentImpacts([incident.id])).toEqual({ created: 0, updated: 0 });
    const rows = () =>
      db.incidentBusinessServiceImpact.findMany({
        where: { incidentId: incident.id },
        orderBy: { businessServiceId: 'asc' },
      });
    expect(await rows()).toMatchObject([
      { businessServiceId: checkout.id, source: 'DIRECT', excluded: false, endedAt: null },
    ]);

    // Manual mark below Reporting's threshold; unmark Checkout.
    await setIncidentImpactCommand(
      { incidentId: incident.id, businessServiceId: reporting.id, impacted: true },
      responder
    );
    await setIncidentImpactCommand(
      { incidentId: incident.id, businessServiceId: checkout.id, impacted: false },
      responder
    );
    const repeat = await setIncidentImpactCommand(
      { incidentId: incident.id, businessServiceId: checkout.id, impacted: false },
      responder
    );
    expect(repeat.changed).toBe(false);
    for (let run = 0; run < 2; run += 1) await reconcileBusinessServiceImpacts();
    const afterReconcile = await rows();
    const byId = new Map(afterReconcile.map(row => [row.businessServiceId, row]));
    expect(byId.get(checkout.id)).toMatchObject({ excluded: true });
    expect(byId.get(checkout.id)!.endedAt).not.toBeNull();
    expect(byId.get(reporting.id)).toMatchObject({
      source: 'MANUAL',
      excluded: false,
      endedAt: null,
    });

    resetBusinessServiceHealthCacheForTests();
    const health = await getBusinessServiceHealth([checkout.id, reporting.id], responder);
    expect(health.get(checkout.id)!.status).toBe('OPERATIONAL');
    expect(health.get(reporting.id)!.reasons[0]).toMatchObject({ kind: 'MANUAL' });
    expect(
      await db.auditLog.count({
        where: {
          entityType: 'BUSINESS_SERVICE',
          action: { startsWith: 'business_service.impact_' },
        },
      })
    ).toBe(2);

    // Resolution ends every open row at the resolution time.
    const resolvedAt = new Date();
    await db.incident.update({
      where: { id: incident.id },
      data: { status: 'RESOLVED', resolvedAt },
    });
    await reconcileBusinessServiceImpacts();
    await reconcileBusinessServiceImpacts();
    expect(byIdOf(await rows()).get(reporting.id)!.endedAt).toEqual(resolvedAt);

    // One reconcile job per minute bucket.
    const now = new Date();
    await enqueueBusinessServiceImpactReconcile(now);
    await enqueueBusinessServiceImpactReconcile(now);
    expect(
      await db.backgroundJob.count({
        where: { payload: { path: ['task'], equals: 'BUSINESS_SERVICE_IMPACT_RECONCILE' } },
      })
    ).toBe(1);
  });

  it('starts a new interval when a resolved incident reopens, so the healthy gap is not downtime', async () => {
    const api = await createTestService('api');
    const team = await createTestTeam('Reopen');
    const checkout = await businessService('Checkout', team.id, [api.id]);
    const hour = 3_600_000;
    const created = new Date(Date.now() - 10 * hour);
    const incident = await createTestIncident('Flaky', api.id, { createdAt: created });
    await syncIncidentImpacts([incident.id], new Date(created.getTime() + 1000));
    const resolvedAt = new Date(created.getTime() + hour);
    await db.incident.update({
      where: { id: incident.id },
      data: { status: 'RESOLVED', resolvedAt },
    });
    await syncIncidentImpacts([incident.id], new Date(created.getTime() + 2 * hour));
    await db.incident.update({
      where: { id: incident.id },
      data: { status: 'OPEN', resolvedAt: null },
    });
    const reopenedAt = new Date(created.getTime() + 5 * hour);
    resetBusinessServiceHealthCacheForTests();
    await syncIncidentImpacts([incident.id], reopenedAt);
    await syncIncidentImpacts([incident.id], reopenedAt);
    const rows = await db.incidentBusinessServiceImpact.findMany({
      where: { incidentId: incident.id },
      orderBy: { startedAt: 'asc' },
    });
    expect(rows.map(row => [row.startedAt, row.endedAt])).toEqual([
      [created, resolvedAt],
      [reopenedAt, null],
    ]);
    const actor = actorFor(await createTestUser({ role: 'USER' }), 'USER', [team.id]);
    const to = new Date(created.getTime() + 6 * hour);
    const stats = await getBusinessServiceStats(checkout.id, { from: created, to }, actor);
    // 1 h before resolution + 1 h since the reopen, not the 6 h a merged interval would give.
    expect(stats.impactMinutes).toBe(120);
    expect(stats.incidentCount).toBe(1);
  });

  it('computes stats over every interval, not the 500-row display timeline', async () => {
    const api = await createTestService('api');
    const team = await createTestTeam('Many');
    const checkout = await businessService('Checkout', team.id, [api.id]);
    const old = await createTestIncident('old', api.id, { status: 'RESOLVED' });
    const noisy = await createTestIncident('noisy', api.id, { status: 'RESOLVED' });
    const base = new Date('2026-10-01T00:00:00Z');
    const minute = 60_000;
    await db.incidentBusinessServiceImpact.createMany({
      data: [
        {
          incidentId: old.id,
          businessServiceId: checkout.id,
          source: 'DIRECT',
          startedAt: base,
          endedAt: new Date(base.getTime() + 30 * minute),
        },
        // 600 newer unmarked intervals that would fill a capped query.
        ...Array.from({ length: 600 }, (_, index) => ({
          incidentId: noisy.id,
          businessServiceId: checkout.id,
          source: 'DIRECT' as const,
          excluded: true,
          startedAt: new Date(base.getTime() + (60 + index) * minute),
          endedAt: new Date(base.getTime() + (60 + index) * minute + 1000),
        })),
      ],
    });
    const actor = actorFor(await createTestUser({ role: 'USER' }), 'USER', [team.id]);
    const window = { from: base, to: new Date(base.getTime() + 24 * 60 * minute) };
    const stats = await getBusinessServiceStats(checkout.id, window, actor);
    expect(stats).toMatchObject({ impactMinutes: 30, incidentCount: 1 });
    expect(await getImpactTimeline(checkout.id, window, actor)).toHaveLength(500);
  });

  it('backfills DIRECT history like the live engine: no snoozed incidents, no duplicates', async () => {
    const api = await createTestService('api');
    const checkout = await businessService('Checkout', null, [api.id]);
    const resolved = await createTestIncident('resolved', api.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(),
    });
    const snoozed = await createTestIncident('snoozed', api.id, { status: 'SNOOZED' });
    const since = new Date(Date.now() - 86_400_000);
    const dry = await backfillDirectImpacts({ since, limit: 100, apply: false });
    expect(dry.written).toBeGreaterThanOrEqual(1);
    expect(
      await db.incidentBusinessServiceImpact.count({ where: { businessServiceId: checkout.id } })
    ).toBe(0);
    await backfillDirectImpacts({ since, limit: 100, apply: true });
    const again = await backfillDirectImpacts({ since, limit: 100, apply: true });
    expect(again.written).toBe(0);
    const rows = await db.incidentBusinessServiceImpact.findMany({
      where: { businessServiceId: checkout.id },
    });
    expect(rows.map(row => row.incidentId)).toEqual([resolved.id]);
    expect(rows[0].endedAt).not.toBeNull();
    expect(rows.some(row => row.incidentId === snoozed.id)).toBe(false);
  });

  it('measures uptime over the union of overlapping impacts', async () => {
    const api = await createTestService('api');
    const team = await createTestTeam('Stats');
    const checkout = await businessService('Checkout', team.id, [api.id]);
    const base = new Date('2026-11-01T00:00:00Z');
    const hour = 3_600_000;
    const one = await createTestIncident('one', api.id, { status: 'RESOLVED' });
    const two = await createTestIncident('two', api.id, { status: 'RESOLVED' });
    await db.incidentBusinessServiceImpact.createMany({
      data: [
        {
          incidentId: one.id,
          businessServiceId: checkout.id,
          source: 'DIRECT',
          startedAt: base,
          endedAt: new Date(base.getTime() + 2 * hour),
        },
        {
          incidentId: two.id,
          businessServiceId: checkout.id,
          source: 'DIRECT',
          startedAt: new Date(base.getTime() + hour),
          endedAt: new Date(base.getTime() + 3 * hour),
        },
      ],
    });
    const actor = actorFor(await createTestUser({ role: 'USER' }), 'USER', [team.id]);
    const stats = await getBusinessServiceStats(
      checkout.id,
      { from: base, to: new Date(base.getTime() + 10 * hour) },
      actor
    );
    expect(stats).toMatchObject({ impactMinutes: 180, incidentCount: 2, uptimePercent: 70 });
  });
});

describe('support cycles', () => {
  it('rejects a dependency that would make a business service depend on itself', async () => {
    const admin = actorFor(await createTestUser({ role: 'ADMIN' }), 'ADMIN');
    const [x, y, z] = [
      await businessService('X', null, []),
      await businessService('Y', null, []),
      await businessService('Z', null, []),
    ];
    await updateBusinessService(x.id, { dependsOnBusinessServiceIds: [y.id] }, { actor: admin });
    await updateBusinessService(y.id, { dependsOnBusinessServiceIds: [z.id] }, { actor: admin });
    await expect(
      updateBusinessService(z.id, { dependsOnBusinessServiceIds: [x.id] }, { actor: admin })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await db.businessServiceSupport.count()).toBe(2);
  });
});

function byIdOf<T extends { businessServiceId: string }>(rows: T[]) {
  return new Map(rows.map(row => [row.businessServiceId, row]));
}
