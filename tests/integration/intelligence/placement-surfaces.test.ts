import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only the session is replaced; rbac, the action, the service functions and the database are real.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('next-auth', async original => ({
  ...(await original<typeof import('next-auth')>()),
  getServerSession: vi.fn(async () => (session.userId ? { user: { id: session.userId } } : null)),
}));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import type { PrismaClient } from '@prisma/client';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  getServiceAlertQuality,
  getServiceAutoGate,
  getServiceDependencyNeighbourhood,
  getServiceLearnedFactCount,
  getServiceNoiseStatus,
  getServiceRecentChanges,
  getServiceRecurringProblems,
  getServiceSloBurn,
  resolveServiceIntelligenceAccess,
  SERVICE_INTELLIGENCE_LIMITS,
} from '@/lib/intelligence/surfaces/service-intelligence';
import { getServiceListBadges } from '@/lib/intelligence/surfaces/service-list-badges';
import { getTeamIntelligenceTiles } from '@/lib/intelligence/surfaces/team-tiles';
import {
  getAiopsPulse,
  getWallboardLargestGroup,
} from '@/lib/intelligence/surfaces/dashboard-pulse';
import { utcDay } from '@/lib/intelligence/ai/budget';
import { resetWorkBacklogCacheForTests } from '@/lib/intelligence/jobs/work-queue';
import { reviewServiceDependencyAction } from '@/app/(app)/services/[id]/intelligence/actions';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  // The pulse reads the backlog through a 10 s process cache; a previous test's count must not leak in.
  resetWorkBacklogCacheForTests();
  session.userId = null;
});

const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

/** A client that records every database operation issued through it. */
function countingClient() {
  const ops: string[] = [];
  const client = db.$extends({
    query: {
      async $allOperations({ operation, model, args, query }) {
        ops.push(model ? `${model}.${operation}` : operation);
        return query(args);
      },
    },
  });
  return { client: client as unknown as PrismaClient, ops };
}

/** Two teams; an admin, a responder and a scoped USER who belongs to team A only. */
async function seed() {
  const teamA = await createTestTeam('A');
  const teamB = await createTestTeam('B');
  const admin = await createTestUser({ role: 'ADMIN', name: 'Ada' });
  const responder = await createTestUser({ role: 'RESPONDER', name: 'Rae' });
  const scoped = await createTestUser({ role: 'USER', name: 'Sam' });
  await db.teamMember.create({ data: { userId: scoped.id, teamId: teamA.id } });
  const svcA = await createTestService('svc-a', teamA.id);
  const svcB = await createTestService('svc-b', teamB.id);
  return { teamA, teamB, admin, responder, scoped, svcA, svcB };
}

const objective = (serviceId: string, lineageId = `lineage-${serviceId}`) =>
  db.serviceObjective.create({
    data: {
      lineageId,
      serviceId,
      name: 'Availability',
      metricType: 'AVAILABILITY',
      target: 99.9,
      comparator: 'GREATER_THAN_OR_EQUAL',
      windowType: 'THIRTY_DAYS',
    },
  });

const noisePolicy = (serviceId: string | null, mode: 'OFF' | 'SHADOW' | 'ON') =>
  db.noiseControlPolicy.create({
    data: {
      scopeKey: serviceId ? `service:${serviceId}` : 'global',
      serviceId,
      mode,
      definition: {},
    },
  });

const dependency = (
  upstreamServiceId: string,
  downstreamServiceId: string,
  status: 'ACTIVE' | 'SUGGESTED' = 'ACTIVE'
) =>
  db.serviceDependency.create({
    data: {
      upstreamServiceId,
      downstreamServiceId,
      origin: status === 'ACTIVE' ? 'DECLARED' : 'OBSERVED',
      status,
      confidence: status === 'ACTIVE' ? 1 : 0.72,
      evidence: {},
    },
  });

const parentChild = (childId: string, parentId: string) =>
  db.incidentRelationship.create({
    data: {
      sourceIncidentId: childId,
      targetIncidentId: parentId,
      type: 'PARENT_CHILD',
      origin: 'RULE',
      decision: 'ACCEPTED',
      evidence: { automatic: true },
      engineVersion: 'test',
    },
  });

describe('service Intelligence tab access', () => {
  it('is closed to a scoped user, even for a service of their own team', async () => {
    const s = await seed();
    const scoped = await actorOf(s.scoped.id);
    expect(await resolveServiceIntelligenceAccess(scoped, s.svcA.id)).toBeNull();
    expect(await resolveServiceIntelligenceAccess(scoped, s.svcB.id)).toBeNull();
  });

  it('returns nothing for an unknown service or an inactive account', async () => {
    const s = await seed();
    const admin = await actorOf(s.admin.id);
    expect(await resolveServiceIntelligenceAccess(admin, 'missing')).toBeNull();
    expect(
      await resolveServiceIntelligenceAccess({ ...admin, status: 'DISABLED' }, s.svcA.id)
    ).toBeNull();
  });

  it('hides the tab from a responder while both engines are off, and shows it to a manager', async () => {
    const s = await seed();
    const responder = await resolveServiceIntelligenceAccess(
      await actorOf(s.responder.id),
      s.svcA.id
    );
    expect(responder).toMatchObject({ mode: 'OFF', noiseMode: 'OFF', canManage: false });
    expect(responder!.visible).toBe(false);
    const admin = await resolveServiceIntelligenceAccess(await actorOf(s.admin.id), s.svcA.id);
    expect(admin).toMatchObject({ canManage: true, visible: true });
  });

  it('shows the tab to a responder once noise controls run for the service', async () => {
    const s = await seed();
    await noisePolicy(null, 'SHADOW');
    const responder = await actorOf(s.responder.id);
    expect(await resolveServiceIntelligenceAccess(responder, s.svcA.id)).toMatchObject({
      noiseMode: 'SHADOW',
      visible: true,
    });
    // The service's own OFF row overrides the global policy.
    await noisePolicy(s.svcA.id, 'OFF');
    expect(await resolveServiceIntelligenceAccess(responder, s.svcA.id)).toMatchObject({
      noiseMode: 'OFF',
      visible: false,
    });
  });
});

describe('service Intelligence tab loaders', () => {
  async function accessFor(userId: string, serviceId: string) {
    const access = await resolveServiceIntelligenceAccess(await actorOf(userId), serviceId);
    if (!access) throw new Error('no access');
    return access;
  }

  it('draws the neighbourhood with suggested edges and the open-incident overlay', async () => {
    const s = await seed();
    const upstream = await createTestService('payments', s.teamB.id);
    const observed = await createTestService('ledger', s.teamB.id);
    const unrelated = await createTestService('unrelated', s.teamB.id);
    await dependency(upstream.id, s.svcA.id);
    await dependency(s.svcA.id, s.svcB.id);
    const suggestion = await dependency(observed.id, s.svcA.id, 'SUGGESTED');
    await dependency(unrelated.id, s.svcB.id);
    await db.serviceDependency.create({
      data: {
        upstreamServiceId: unrelated.id,
        downstreamServiceId: s.svcA.id,
        origin: 'OBSERVED',
        status: 'REJECTED',
        confidence: 0.4,
        evidence: {},
      },
    });
    await createTestIncident('Payments down', upstream.id, { urgency: 'HIGH' });
    await createTestIncident('Payments slow', upstream.id, { urgency: 'LOW' });
    await createTestIncident('Resolved', upstream.id, { status: 'RESOLVED' });

    const view = await getServiceDependencyNeighbourhood(await accessFor(s.admin.id, s.svcA.id));
    expect(view.focus).toMatchObject({ id: s.svcA.id, openIncidents: 0 });
    expect(view.truncated).toBe(false);
    expect(view.neighbours.map(node => node.id).sort()).toEqual(
      [upstream.id, s.svcB.id, observed.id].sort()
    );
    expect(view.neighbours.find(node => node.id === upstream.id)).toMatchObject({
      openIncidents: 2,
      highestOpenUrgency: 'HIGH',
    });
    expect(view.edges).toHaveLength(3);
    expect(view.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          neighbourId: upstream.id,
          direction: 'UPSTREAM',
          status: 'ACTIVE',
          origin: 'DECLARED',
        }),
        expect.objectContaining({
          neighbourId: s.svcB.id,
          direction: 'DOWNSTREAM',
          status: 'ACTIVE',
        }),
        expect.objectContaining({
          id: suggestion.id,
          neighbourId: observed.id,
          direction: 'UPSTREAM',
          status: 'SUGGESTED',
          origin: 'OBSERVED',
        }),
      ])
    );
  });

  it('bounds the neighbourhood and says when it was cut', async () => {
    const s = await seed();
    const limit = SERVICE_INTELLIGENCE_LIMITS.maxEdges;
    for (let index = 0; index < limit + 2; index += 1) {
      const other = await createTestService(`dep-${index}`, s.teamB.id);
      await dependency(other.id, s.svcA.id);
    }
    const { client, ops } = countingClient();
    const view = await getServiceDependencyNeighbourhood(
      await accessFor(s.admin.id, s.svcA.id),
      client
    );
    expect(view.truncated).toBe(true);
    expect(view.edges).toHaveLength(limit);
    // Two edge reads, one name read, one incident aggregate: independent of the number of edges.
    expect(ops).toHaveLength(4);
  });

  it('reports SLO burn, and null without an availability objective', async () => {
    const s = await seed();
    const access = await accessFor(s.admin.id, s.svcA.id);
    expect(await getServiceSloBurn(access)).toBeNull();
    await objective(s.svcA.id);
    const now = new Date();
    await createTestIncident('Down', s.svcA.id, { createdAt: new Date(now.getTime() - 20 * MIN) });
    expect(await getServiceSloBurn(access, now)).toMatchObject({
      burning: true,
      severity: 'critical',
    });
  });

  it('scores alert quality for the service only, and stays silent below the minimum sample', async () => {
    const s = await seed();
    const access = await accessFor(s.admin.id, s.svcA.id);
    const now = new Date();
    for (let index = 0; index < 4; index += 1)
      await createTestIncident(`quick ${index}`, s.svcA.id, {
        status: 'RESOLVED',
        createdAt: new Date(now.getTime() - HOUR),
        resolvedAt: new Date(now.getTime() - HOUR + MIN),
      });
    // Another service's noise must not leak in.
    for (let index = 0; index < 6; index += 1)
      await createTestIncident(`other ${index}`, s.svcB.id, { status: 'SUPPRESSED' });
    expect(await getServiceAlertQuality(access, now)).toBeNull();
    await createTestIncident('quick 5', s.svcA.id, {
      status: 'RESOLVED',
      createdAt: new Date(now.getTime() - HOUR),
      resolvedAt: new Date(now.getTime() - HOUR + MIN),
    });
    expect(await getServiceAlertQuality(access, now)).toMatchObject({
      incidents: 5,
      quickResolvedRatio: 1,
      neverAcknowledgedRatio: 1,
      flappingRatio: 0,
      flagged: true,
    });
  });

  it('lists recent changes of the service with their risk, newest first and bounded', async () => {
    const s = await seed();
    const access = await accessFor(s.admin.id, s.svcA.id);
    const now = new Date();
    for (let index = 0; index < SERVICE_INTELLIGENCE_LIMITS.maxChanges + 2; index += 1)
      await db.changeEvent.create({
        data: {
          serviceId: s.svcA.id,
          source: 'github',
          kind: 'DEPLOY',
          summary: `deploy ${index}`,
          occurredAt: new Date(now.getTime() - (index + 1) * HOUR),
          riskScore: index === 0 ? 0.81 : null,
        },
      });
    await db.changeEvent.create({
      data: {
        serviceId: s.svcB.id,
        source: 'github',
        kind: 'DEPLOY',
        summary: 'other service',
        occurredAt: new Date(now.getTime() - MIN),
      },
    });
    await db.changeEvent.create({
      data: {
        serviceId: s.svcA.id,
        source: 'github',
        kind: 'CONFIG',
        summary: 'too old',
        occurredAt: new Date(
          now.getTime() - (SERVICE_INTELLIGENCE_LIMITS.changeWindowDays + 1) * DAY
        ),
      },
    });
    const changes = await getServiceRecentChanges(access, now);
    expect(changes).toHaveLength(SERVICE_INTELLIGENCE_LIMITS.maxChanges);
    expect(changes[0]).toMatchObject({ summary: 'deploy 0', riskScore: 0.81 });
    expect(changes.every(change => change.summary.startsWith('deploy '))).toBe(true);
  });

  it('reports noise mode, windows active now and heartbeat health', async () => {
    const s = await seed();
    const now = new Date();
    await noisePolicy(null, 'ON');
    await noisePolicy(s.svcA.id, 'SHADOW');
    const window = (data: Record<string, unknown>) =>
      db.noiseMaintenanceWindow.create({
        data: {
          name: 'window',
          scope: 'SERVICE',
          startsAt: new Date(now.getTime() - HOUR),
          endsAt: new Date(now.getTime() + HOUR),
          ...data,
        } as never,
      });
    await window({ name: 'Service upgrade', serviceId: s.svcA.id });
    await window({ name: 'Team freeze', scope: 'TEAM', teamId: s.teamA.id, effect: 'DOWNGRADE' });
    await window({ name: 'Other team', scope: 'TEAM', teamId: s.teamB.id });
    await window({ name: 'Other service', serviceId: s.svcB.id });
    await window({ name: 'Disabled', serviceId: s.svcA.id, enabled: false });
    await window({
      name: 'Ended early',
      serviceId: s.svcA.id,
      endedAt: new Date(now.getTime() - MIN),
    });
    await window({
      name: 'Later',
      serviceId: s.svcA.id,
      startsAt: new Date(now.getTime() + HOUR),
      endsAt: new Date(now.getTime() + 2 * HOUR),
    });
    await window({
      name: 'Past',
      serviceId: s.svcA.id,
      startsAt: new Date(now.getTime() - 3 * HOUR),
      endsAt: new Date(now.getTime() - 2 * HOUR),
    });
    const monitor = (name: string, state: 'HEALTHY' | 'MISSING', serviceId = s.svcA.id) =>
      db.heartbeatMonitor.create({
        data: {
          name,
          serviceId,
          tokenHash: `hash-${name}`,
          tokenPrefix: 'hb_test',
          intervalSeconds: 60,
          state,
          missingSince: state === 'MISSING' ? new Date(now.getTime() - 5 * MIN) : null,
        },
      });
    await monitor('cron', 'MISSING');
    await monitor('batch', 'HEALTHY');
    await monitor('elsewhere', 'MISSING', s.svcB.id);
    await db.prePagingDecision.create({
      data: {
        serviceId: s.svcA.id,
        control: 'SUPPRESSION',
        action: 'SUPPRESS',
        mode: 'SHADOW',
        applied: false,
        reason: 'test',
        evidence: {},
      },
    });

    const status = await getServiceNoiseStatus(await accessFor(s.admin.id, s.svcA.id), now);
    expect(status).toMatchObject({
      mode: 'SHADOW',
      source: 'service',
      pagesAvoided: 0,
      shadowWouldAvoid: 1,
    });
    expect(status.activeWindows.map(row => row.name).sort()).toEqual([
      'Service upgrade',
      'Team freeze',
    ]);
    expect(status.activeWindows.find(row => row.name === 'Team freeze')).toMatchObject({
      scope: 'TEAM',
      effect: 'DOWNGRADE',
    });
    expect(status.heartbeats.monitors).toBe(2);
    expect(status.heartbeats.missing.map(row => row.name)).toEqual(['cron']);

    // Without its own row, the service follows the global policy.
    expect(await getServiceNoiseStatus(await accessFor(s.admin.id, s.svcB.id), now)).toMatchObject({
      mode: 'ON',
      source: 'global',
    });
  });

  it('reports the grouping gate, no recurring problems and no facts on an unconfigured service', async () => {
    const s = await seed();
    const access = await accessFor(s.admin.id, s.svcA.id);
    expect(await getServiceAutoGate(access)).toMatchObject({
      mode: 'OFF',
      source: 'default',
      allowed: false,
      certified: false,
    });
    expect(await getServiceRecurringProblems(access)).toEqual([]);
    expect(await getServiceLearnedFactCount(access)).toBe(0);
  });
});

describe('reviewing a suggested dependency from the service page', () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  };

  it('lets a manager approve and reject, with an audit entry', async () => {
    const s = await seed();
    const first = await dependency(s.svcB.id, s.svcA.id, 'SUGGESTED');
    const other = await createTestService('other', s.teamB.id);
    const second = await dependency(other.id, s.svcA.id, 'SUGGESTED');
    session.userId = s.admin.id;
    expect(
      await reviewServiceDependencyAction(
        null,
        form({ serviceId: s.svcA.id, dependencyId: first.id, decision: 'APPROVE' })
      )
    ).toEqual({ message: 'Dependency approved.', ok: true });
    expect(
      await reviewServiceDependencyAction(
        null,
        form({ serviceId: s.svcA.id, dependencyId: second.id, decision: 'REJECT' })
      )
    ).toEqual({ message: 'Suggestion rejected.', ok: true });
    expect(await db.serviceDependency.findUnique({ where: { id: first.id } })).toMatchObject({
      status: 'ACTIVE',
    });
    expect(await db.serviceDependency.findUnique({ where: { id: second.id } })).toMatchObject({
      status: 'REJECTED',
    });
    expect(
      await db.auditLog.count({
        where: {
          action: { in: ['intelligence.dependency.approved', 'intelligence.dependency.rejected'] },
        },
      })
    ).toBe(2);
    // Already reviewed: nothing left to act on.
    expect(
      await reviewServiceDependencyAction(
        null,
        form({ serviceId: s.svcA.id, dependencyId: first.id, decision: 'REJECT' })
      )
    ).toMatchObject({ ok: false });
  });

  it('refuses a responder, a suggestion of another service and a malformed decision', async () => {
    const s = await seed();
    const edge = await dependency(s.svcB.id, s.svcA.id, 'SUGGESTED');
    const elsewhere = await createTestService('elsewhere', s.teamB.id);
    session.userId = s.responder.id;
    expect(
      await reviewServiceDependencyAction(
        null,
        form({ serviceId: s.svcA.id, dependencyId: edge.id, decision: 'APPROVE' })
      )
    ).toMatchObject({ ok: false });
    session.userId = s.admin.id;
    expect(
      await reviewServiceDependencyAction(
        null,
        form({ serviceId: elsewhere.id, dependencyId: edge.id, decision: 'APPROVE' })
      )
    ).toMatchObject({ ok: false });
    expect(
      await reviewServiceDependencyAction(
        null,
        form({ serviceId: s.svcA.id, dependencyId: edge.id, decision: 'MAYBE' })
      )
    ).toMatchObject({ ok: false });
    expect(await db.serviceDependency.findUnique({ where: { id: edge.id } })).toMatchObject({
      status: 'SUGGESTED',
    });
  });
});

describe('service list badges', () => {
  async function seedBadges() {
    const s = await seed();
    const now = new Date();
    await noisePolicy(null, 'SHADOW');
    await noisePolicy(s.svcB.id, 'ON');
    for (const service of [s.svcA, s.svcB]) {
      await objective(service.id);
      await createTestIncident('Down', service.id, {
        createdAt: new Date(now.getTime() - 20 * MIN),
      });
      await db.noiseMaintenanceWindow.create({
        data: {
          name: `Upgrade ${service.id}`,
          scope: 'SERVICE',
          serviceId: service.id,
          startsAt: new Date(now.getTime() - HOUR),
          endsAt: new Date(now.getTime() + HOUR),
        },
      });
    }
    const quiet = await createTestService('quiet', s.teamA.id);
    await noisePolicy(quiet.id, 'OFF');
    // Read "now" after seeding: rows default their timestamps to the database clock.
    return { ...s, quiet, now: new Date() };
  }

  it('gives a scoped user badges only for the services they may read', async () => {
    const s = await seedBadges();
    const ids = [s.svcA.id, s.svcB.id, s.quiet.id];
    const scoped = await getServiceListBadges(ids, await actorOf(s.scoped.id), { now: s.now });
    expect(Object.keys(scoped)).toEqual([s.svcA.id]);
    expect(scoped[s.svcA.id]).toMatchObject({
      noiseMode: 'SHADOW',
      sloBurning: 'critical',
      maintenance: { name: `Upgrade ${s.svcA.id}` },
    });

    const admin = await getServiceListBadges(ids, await actorOf(s.admin.id), { now: s.now });
    expect(Object.keys(admin).sort()).toEqual([s.svcA.id, s.svcB.id].sort());
    expect(admin[s.svcB.id]).toMatchObject({ noiseMode: 'ON', sloBurning: 'critical' });
    // Own OFF row, no objective, no window: no entry at all, so the list renders no empty badge.
    expect(admin[s.quiet.id]).toBeUndefined();
  });

  it('badges a team-wide maintenance window on that team’s services only', async () => {
    const s = await seed();
    const now = new Date();
    await db.noiseMaintenanceWindow.create({
      data: {
        name: 'Team A freeze',
        scope: 'TEAM',
        teamId: s.teamA.id,
        startsAt: new Date(now.getTime() - HOUR),
        endsAt: new Date(now.getTime() + HOUR),
      },
    });
    const badges = await getServiceListBadges([s.svcA.id, s.svcB.id], await actorOf(s.admin.id), {
      now,
    });
    expect(badges).toEqual({
      [s.svcA.id]: { maintenance: expect.objectContaining({ name: 'Team A freeze' }) },
    });
  });

  it('costs a fixed number of queries however many services are on the page', async () => {
    const s = await seedBadges();
    const extra: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const service = await createTestService(`extra-${index}`, s.teamA.id);
      await objective(service.id);
      extra.push(service.id);
    }
    const admin = await actorOf(s.admin.id);
    const small = countingClient();
    await getServiceListBadges([s.svcA.id], admin, { now: s.now }, small.client);
    const large = countingClient();
    await getServiceListBadges(
      [s.svcA.id, s.svcB.id, ...extra],
      admin,
      { now: s.now },
      large.client
    );
    // Readable services, then one query per badge kind (SLO needs objectives and incidents).
    expect(small.ops).toHaveLength(5);
    expect(large.ops).toEqual(small.ops);
  });

  it('returns nothing for an inactive account or an empty page', async () => {
    const s = await seedBadges();
    const admin = await actorOf(s.admin.id);
    expect(await getServiceListBadges([], admin)).toEqual({});
    expect(await getServiceListBadges([s.svcA.id], { ...admin, status: 'DISABLED' })).toEqual({});
  });
});

describe('team tiles', () => {
  it('reports AI usage against the team budget and the noise load of its services', async () => {
    const s = await seed();
    const now = new Date();
    await db.aiBudget.create({
      data: { key: `team:${s.teamA.id}`, scope: 'TEAM', teamId: s.teamA.id, dailyTokenLimit: 1000 },
    });
    const usage = (teamId: string, day: string, tokens: number) =>
      db.aiUsageBreakdownDay.create({
        data: {
          day,
          teamId,
          capability: 'SQUIRE',
          providerKind: 'openai',
          model: 'test',
          requests: 1,
          inputTokens: tokens,
          outputTokens: 0,
          costMicros: BigInt(tokens * 10),
        },
      });
    await usage(s.teamA.id, utcDay(now), 250);
    await usage(s.teamA.id, utcDay(new Date(now.getTime() - 2 * DAY)), 100);
    await usage(s.teamA.id, utcDay(new Date(now.getTime() - 20 * DAY)), 9999);
    await usage(s.teamB.id, utcDay(now), 7000);
    await createTestIncident('one', s.svcA.id);
    await createTestIncident('two', s.svcA.id);
    await createTestIncident('other team', s.svcB.id);
    await db.prePagingDecision.create({
      data: {
        serviceId: s.svcA.id,
        control: 'SUPPRESSION',
        action: 'SUPPRESS',
        mode: 'ON',
        applied: true,
        reason: 'test',
        evidence: {},
      },
    });

    const tiles = await getTeamIntelligenceTiles(await actorOf(s.admin.id), s.teamA.id, { now });
    expect(tiles!.aiUsage).toMatchObject({
      todayTokens: 250,
      todayCostMicros: 2500,
      dailyTokenLimit: 1000,
      utilization: 0.25,
      hasBudget: true,
      periodTokens: 350,
      periodCostMicros: 3500,
    });
    expect(tiles!.noiseLoad).toMatchObject({
      services: 1,
      incidents: 2,
      alerts: 0,
      pagesAvoided: 1,
    });

    // No budget: usage is still shown, without a limit.
    const other = await getTeamIntelligenceTiles(await actorOf(s.admin.id), s.teamB.id, { now });
    expect(other!.aiUsage).toMatchObject({
      todayTokens: 7000,
      hasBudget: false,
      dailyTokenLimit: null,
      utilization: 0,
    });
  });

  it('is null for a silent team, a scoped user and an unknown team', async () => {
    const s = await seed();
    const admin = await actorOf(s.admin.id);
    expect(await getTeamIntelligenceTiles(admin, s.teamA.id)).toBeNull();
    expect(await getTeamIntelligenceTiles(admin, 'missing')).toBeNull();
    await createTestIncident('one', s.svcA.id);
    expect(await getTeamIntelligenceTiles(admin, s.teamA.id)).not.toBeNull();
    expect(await getTeamIntelligenceTiles(await actorOf(s.scoped.id), s.teamA.id)).toBeNull();
  });
});

describe('AIOps pulse and the wallboard largest group', () => {
  async function seedPulse() {
    const s = await seed();
    const now = new Date();
    const parent = await createTestIncident('Checkout storm', s.svcA.id);
    for (let index = 0; index < 3; index += 1)
      await parentChild((await createTestIncident(`child ${index}`, s.svcA.id)).id, parent.id);
    const smaller = await createTestIncident('Smaller group', s.svcB.id);
    await parentChild((await createTestIncident('lone child', s.svcB.id)).id, smaller.id);
    // A bigger group whose parent is resolved does not count as open.
    const closed = await createTestIncident('Closed storm', s.svcA.id, { status: 'RESOLVED' });
    for (let index = 0; index < 5; index += 1)
      await parentChild((await createTestIncident(`old ${index}`, s.svcA.id)).id, closed.id);

    const decision = (data: Record<string, unknown>) =>
      db.prePagingDecision.create({
        data: {
          serviceId: s.svcA.id,
          control: 'SUPPRESSION',
          action: 'SUPPRESS',
          mode: 'ON',
          applied: true,
          reason: 'test',
          evidence: {},
          ...data,
        } as never,
      });
    await decision({});
    await decision({ action: 'DROP' });
    await decision({ mode: 'SHADOW', applied: false });
    await decision({ reversedAt: now });
    await decision({ action: 'DOWNGRADE' });
    await decision({ createdAt: new Date(now.getTime() - 2 * DAY) });

    const finding = (incidentId: string, kind: string, data: Record<string, unknown> = {}) =>
      db.intelligenceFinding.create({
        data: {
          incidentId,
          kind,
          evidence: {},
          generation: 1,
          engineVersion: 'test',
          subjectRef: 'HIGH',
          ...data,
        } as never,
      });
    await finding(parent.id, 'TRIAGE_URGENCY');
    const reviewed = await finding(parent.id, 'TRIAGE_ASSIGNMENT');
    await db.intelligenceFeedback.create({
      data: {
        subjectType: 'FINDING',
        subjectId: reviewed.id,
        verdict: 'HELPFUL',
        actorId: s.admin.id,
      },
    });
    await finding(parent.id, 'TRIAGE_RESOLUTION_TIME');
    await finding(parent.id, 'TRIAGE_DUPLICATE', { status: 'SUPERSEDED' });
    await finding(closed.id, 'TRIAGE_URGENCY');
    await finding(smaller.id, 'TRIAGE_URGENCY', {
      createdAt: new Date(now.getTime() - 30 * DAY),
    });
    // Read "now" after seeding: rows default their timestamps to the database clock.
    return { ...s, now: new Date(), parent };
  }

  it('counts what happened for a reader and adds quarantined work for a manager', async () => {
    const s = await seedPulse();
    await db.intelligenceWorkItem.create({
      data: { kind: 'test', subjectKey: 'poisoned', quarantinedAt: s.now, failedAt: s.now },
    });
    const responder = await getAiopsPulse(await actorOf(s.responder.id), { now: s.now });
    expect(responder).toEqual({
      windowHours: 24,
      pagesAvoided: 2,
      openGroups: 2,
      triageAwaitingReview: 1,
      quarantinedWork: null,
    });
    const admin = await getAiopsPulse(await actorOf(s.admin.id), { now: s.now });
    expect(admin).toMatchObject({ pagesAvoided: 2, openGroups: 2, quarantinedWork: 1 });
  });

  it('is null when every number is zero and for a user who cannot read intelligence', async () => {
    const empty = await seed();
    expect(await getAiopsPulse(await actorOf(empty.admin.id))).toBeNull();
    await resetDatabase();
    const s = await seedPulse();
    expect(await getAiopsPulse(await actorOf(s.scoped.id), { now: s.now })).toBeNull();
    expect(await getWallboardLargestGroup(await actorOf(s.scoped.id))).toBeNull();
  });

  it('names the open parent with the most grouped incidents', async () => {
    const s = await seedPulse();
    const { client, ops } = countingClient();
    expect(await getWallboardLargestGroup(await actorOf(s.responder.id), client)).toMatchObject({
      parentId: s.parent.id,
      parentTitle: 'Checkout storm',
      childCount: 3,
    });
    expect(ops).toHaveLength(2);
    await db.incident.update({ where: { id: s.parent.id }, data: { status: 'RESOLVED' } });
    expect(await getWallboardLargestGroup(await actorOf(s.responder.id))).toMatchObject({
      parentTitle: 'Smaller group',
      childCount: 1,
    });
  });

  it('shows no group when none is open', async () => {
    const s = await seed();
    expect(await getWallboardLargestGroup(await actorOf(s.admin.id))).toBeNull();
  });
});
