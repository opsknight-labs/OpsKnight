import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { getListedAlert, listAlertsForActor } from '@/lib/intelligence/lists/alerts';
import { listChangesForActor } from '@/lib/intelligence/lists/changes';
import {
  decodeListCursor,
  parseAlertListFilters,
  parseChangeListFilters,
} from '@/lib/intelligence/lists/contract';
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

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = new Date('2026-11-10T12:00:00Z');

const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

/**
 * Two teams with one service each. The admin and the responder read everything; the team-scoped reader
 * (role USER: scoped service and incident read) belongs to the first team only. Responders currently
 * hold global read, so "only their teams" is exercised with the scoped role, as the overview tests do.
 */
async function seedTeams() {
  const admin = await createTestUser({ role: 'ADMIN' });
  const responder = await createTestUser({ role: 'RESPONDER' });
  const scoped = await createTestUser({ role: 'USER' });
  const outsider = await createTestUser({ role: 'USER' });
  const mine = await createTestTeam('Payments');
  const theirs = await createTestTeam('Search');
  await db.teamMember.create({ data: { userId: scoped.id, teamId: mine.id } });
  const myService = await createTestService('Checkout', mine.id);
  const otherService = await createTestService('Indexer', theirs.id);
  return {
    admin: await actorOf(admin.id),
    responder: await actorOf(responder.id),
    scoped: await actorOf(scoped.id),
    outsider: await actorOf(outsider.id),
    myService,
    otherService,
  };
}

const alertAt = (serviceId: string, minutesAgo: number, data: Record<string, unknown> = {}) =>
  db.alert.create({
    data: {
      serviceId,
      payload: { summary: `alert ${minutesAgo}` },
      createdAt: new Date(NOW.getTime() - minutesAgo * MIN),
      ...data,
    },
  });

const decisionFor = (
  alert: { id: string; serviceId: string; createdAt: Date },
  data: Record<string, unknown> = {}
) =>
  db.prePagingDecision.create({
    data: {
      serviceId: alert.serviceId,
      alertId: alert.id,
      control: 'SUPPRESSION',
      action: 'SUPPRESS',
      mode: 'ON',
      applied: true,
      sourceName: 'Known disk alarm',
      reason: 'Matched suppression rule',
      evidence: {},
      createdAt: alert.createdAt,
      ...data,
    },
  });

describe('alerts list', () => {
  it('shows a scoped reader only their teams’ alerts, and a global reader all of them', async () => {
    const { admin, responder, scoped, outsider, myService, otherService } = await seedTeams();
    await alertAt(myService.id, 10);
    await alertAt(otherService.id, 20);
    const filters = parseAlertListFilters();

    const all = await listAlertsForActor(admin, filters, { now: NOW });
    expect(all.rows.map(row => row.serviceId).sort()).toEqual(
      [myService.id, otherService.id].sort()
    );
    expect((await listAlertsForActor(responder, filters, { now: NOW })).rows).toHaveLength(2);

    const mine = await listAlertsForActor(scoped, filters, { now: NOW });
    expect(mine.rows.map(row => row.serviceId)).toEqual([myService.id]);
    expect(mine.services.map(service => service.id)).toEqual([myService.id]);

    const none = await listAlertsForActor(outsider, filters, { now: NOW });
    expect(none.rows).toEqual([]);
    expect(none.services).toEqual([]);

    // Asking for another team's service by id returns nothing rather than leaking it.
    const probe = await listAlertsForActor(
      scoped,
      parseAlertListFilters({ service: otherService.id }),
      { now: NOW }
    );
    expect(probe.rows).toEqual([]);
  });

  it('hides an alert whose incident the scoped reader may not read', async () => {
    const { scoped, admin, myService } = await seedTeams();
    const hidden = await createTestIncident('private', myService.id, { visibility: 'PRIVATE' });
    await alertAt(myService.id, 5, { incidentId: hidden.id });
    const open = await alertAt(myService.id, 6);
    const rows = (await listAlertsForActor(scoped, parseAlertListFilters(), { now: NOW })).rows;
    expect(rows.map(row => row.id)).toEqual([open.id]);
    expect(
      (await listAlertsForActor(admin, parseAlertListFilters(), { now: NOW })).rows
    ).toHaveLength(2);
  });

  it('pages by keyset without gaps or repeats, including rows sharing a timestamp', async () => {
    const { admin, myService } = await seedTeams();
    const created: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      // Three alerts share one instant, so the id tiebreaker is exercised across a page boundary.
      const minutesAgo = i < 3 ? 30 : 30 + i;
      created.push((await alertAt(myService.id, minutesAgo)).id);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listAlertsForActor(admin, parseAlertListFilters({ cursor }), {
        now: NOW,
        pageSize: 3,
      });
      expect(page.rows.length).toBeLessThanOrEqual(3);
      seen.push(...page.rows.map(row => row.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);
    expect([...seen].sort()).toEqual([...created].sort());
  });

  it('has no next page when the last page is exactly full, and none for an empty list', async () => {
    const { admin, myService } = await seedTeams();
    expect(
      (await listAlertsForActor(admin, parseAlertListFilters(), { now: NOW })).nextCursor
    ).toBeNull();
    for (let i = 0; i < 4; i += 1) await alertAt(myService.id, 10 + i);
    const first = await listAlertsForActor(admin, parseAlertListFilters(), {
      now: NOW,
      pageSize: 2,
    });
    expect(first.rows).toHaveLength(2);
    expect(decodeListCursor(first.nextCursor ?? undefined)).not.toBeNull();
    const second = await listAlertsForActor(
      admin,
      parseAlertListFilters({ cursor: first.nextCursor ?? undefined }),
      { now: NOW, pageSize: 2 }
    );
    expect(second.rows).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
  });

  it('never exceeds the page-size bound whatever the caller asks for', async () => {
    const { admin, myService } = await seedTeams();
    await db.alert.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        serviceId: myService.id,
        payload: {},
        createdAt: new Date(NOW.getTime() - (i + 1) * MIN),
      })),
    });
    const page = await listAlertsForActor(admin, parseAlertListFilters(), {
      now: NOW,
      pageSize: 5000,
    });
    expect(page.rows).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
  });

  it('limits rows to the selected time range', async () => {
    const { admin, myService } = await seedTeams();
    await alertAt(myService.id, 60);
    await alertAt(myService.id, 3 * 24 * 60);
    expect(
      (await listAlertsForActor(admin, parseAlertListFilters(), { now: NOW })).rows
    ).toHaveLength(1);
    expect(
      (await listAlertsForActor(admin, parseAlertListFilters({ window: '7d' }), { now: NOW })).rows
    ).toHaveLength(2);
  });

  it('filters by service and severity, and redacts secrets in the summary and labels', async () => {
    const { admin, myService, otherService } = await seedTeams();
    const critical = await alertAt(myService.id, 5, {
      severity: 'critical',
      payload: { summary: 'db down password=hunter2hunter2' },
      labels: {
        env: 'prod',
        token: 'Bearer abcdefghijklmnopqrstuvwxyz0123456789',
        nested: { a: 1 },
      },
    });
    await alertAt(myService.id, 6, { severity: 'warning' });
    await alertAt(otherService.id, 7, { severity: 'critical' });
    const rows = (
      await listAlertsForActor(
        admin,
        parseAlertListFilters({ service: myService.id, severity: 'critical' }),
        { now: NOW }
      )
    ).rows;
    expect(rows.map(row => row.id)).toEqual([critical.id]);
    expect(rows[0].summary).not.toContain('hunter2hunter2');
    expect(rows[0].labels.map(label => label.key)).toEqual(['env', 'token']);
    expect(JSON.stringify(rows[0].labels)).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('attaches the noise decision, preferring what was applied over a shadow decision', async () => {
    const { admin, myService } = await seedTeams();
    const suppressed = await alertAt(myService.id, 5);
    const shadowOnly = await alertAt(myService.id, 6);
    const reversed = await alertAt(myService.id, 7);
    const plain = await alertAt(myService.id, 8);
    await decisionFor(suppressed, {
      control: 'MAINTENANCE',
      mode: 'SHADOW',
      applied: false,
      sourceName: 'Sunday patching',
    });
    await decisionFor(suppressed);
    await decisionFor(shadowOnly, {
      control: 'CONTENT_DEDUP',
      action: 'APPEND',
      mode: 'SHADOW',
      applied: false,
      sourceName: null,
    });
    await decisionFor(reversed, { reversedAt: NOW });
    const rows = (await listAlertsForActor(admin, parseAlertListFilters(), { now: NOW })).rows;
    const byId = new Map(rows.map(row => [row.id, row.decision]));
    expect(byId.get(suppressed.id)).toMatchObject({
      kind: 'suppressed',
      applied: true,
      sourceName: 'Known disk alarm',
    });
    expect(byId.get(shadowOnly.id)).toMatchObject({ kind: 'deduped', applied: false });
    expect(byId.get(reversed.id)).toBeNull();
    expect(byId.get(plain.id)).toBeNull();
  });

  it('filters by noise decision, scoped and paged over the decisions', async () => {
    const { admin, scoped, myService, otherService } = await seedTeams();
    const mine: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const alert = await alertAt(myService.id, 10 + i);
      await decisionFor(alert);
      mine.push(alert.id);
    }
    const maintenance = await alertAt(myService.id, 20);
    await decisionFor(maintenance, { control: 'MAINTENANCE' });
    const grouped = await alertAt(myService.id, 21);
    await decisionFor(grouped, { control: 'STORM', action: 'GROUP_CHILD' });
    const foreign = await alertAt(otherService.id, 12);
    await decisionFor(foreign);
    await alertAt(myService.id, 9);

    const suppressed = parseAlertListFilters({ decision: 'suppressed' });
    const adminRows = (await listAlertsForActor(admin, suppressed, { now: NOW })).rows;
    expect(adminRows.map(row => row.id).sort()).toEqual([...mine, foreign.id].sort());
    expect(adminRows.every(row => row.decision?.kind === 'suppressed')).toBe(true);

    const scopedRows = (await listAlertsForActor(scoped, suppressed, { now: NOW })).rows;
    expect(scopedRows.map(row => row.id).sort()).toEqual([...mine].sort());

    const first = await listAlertsForActor(scoped, suppressed, { now: NOW, pageSize: 2 });
    expect(first.rows).toHaveLength(2);
    const second = await listAlertsForActor(
      scoped,
      parseAlertListFilters({ decision: 'suppressed', cursor: first.nextCursor ?? undefined }),
      { now: NOW, pageSize: 2 }
    );
    expect(second.rows).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(3);

    for (const [decision, id] of [
      ['maintenance', maintenance.id],
      ['grouped', grouped.id],
    ] as const) {
      const rows = (
        await listAlertsForActor(admin, parseAlertListFilters({ decision }), { now: NOW })
      ).rows;
      expect(rows.map(row => row.id)).toEqual([id]);
    }
    expect(
      (
        await listAlertsForActor(admin, parseAlertListFilters({ decision: 'deduped' }), {
          now: NOW,
        })
      ).rows
    ).toEqual([]);
  });

  it('reads one listed alert for the detail page under the same scope', async () => {
    const { admin, scoped, responder, otherService } = await seedTeams();
    const alert = await alertAt(otherService.id, 5);
    await decisionFor(alert);
    expect((await getListedAlert(admin, alert.id))?.decision?.kind).toBe('suppressed');
    expect((await getListedAlert(responder, alert.id))?.id).toBe(alert.id);
    // The scoped role lacks INTELLIGENCE_READ and the service: nothing either way.
    expect(await getListedAlert(scoped, alert.id)).toBeNull();
    expect(await getListedAlert(admin, 'missing')).toBeNull();
  });
});

describe('changes list', () => {
  const changeAt = (
    serviceId: string | null,
    minutesAgo: number,
    data: Record<string, unknown> = {}
  ) =>
    db.changeEvent.create({
      data: {
        serviceId,
        source: 'ci',
        kind: 'DEPLOY',
        summary: `change ${minutesAgo}`,
        occurredAt: new Date(NOW.getTime() - minutesAgo * MIN),
        ...data,
      },
    });

  it('shows a scoped reader only their teams’ changes; global readers also see unowned ones', async () => {
    const { admin, responder, scoped, outsider, myService, otherService } = await seedTeams();
    const mine = await changeAt(myService.id, 10);
    const theirs = await changeAt(otherService.id, 11);
    const unowned = await changeAt(null, 12);
    const filters = parseChangeListFilters();

    const all = (await listChangesForActor(admin, filters, { now: NOW })).rows;
    expect(all.map(row => row.id)).toEqual([mine.id, theirs.id, unowned.id]);
    expect((await listChangesForActor(responder, filters, { now: NOW })).rows).toHaveLength(3);

    const scopedPage = await listChangesForActor(scoped, filters, { now: NOW });
    expect(scopedPage.rows.map(row => row.id)).toEqual([mine.id]);
    expect(scopedPage.services.map(service => service.id)).toEqual([myService.id]);
    expect((await listChangesForActor(outsider, filters, { now: NOW })).rows).toEqual([]);
    expect(
      (
        await listChangesForActor(scoped, parseChangeListFilters({ service: otherService.id }), {
          now: NOW,
        })
      ).rows
    ).toEqual([]);
  });

  it('pages by keyset without gaps or repeats and stops on the exact boundary', async () => {
    const { admin, myService } = await seedTeams();
    const created: string[] = [];
    for (let i = 0; i < 6; i += 1)
      created.push((await changeAt(myService.id, i < 2 ? 15 : 15 + i)).id);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listChangesForActor(admin, parseChangeListFilters({ cursor }), {
        now: NOW,
        pageSize: 3,
      });
      seen.push(...page.rows.map(row => row.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(2);
    expect(new Set(seen).size).toBe(6);
    expect([...seen].sort()).toEqual([...created].sort());
  });

  it('filters by service, source and risk band, and offers the sources it saw', async () => {
    const { admin, myService, otherService } = await seedTeams();
    const high = await changeAt(myService.id, 5, { riskScore: 0.8, source: 'github' });
    const medium = await changeAt(myService.id, 6, { riskScore: 0.4, source: 'argo' });
    const low = await changeAt(otherService.id, 7, { riskScore: 0.1, source: 'argo' });
    const unscored = await changeAt(otherService.id, 8);
    const list = async (params: Record<string, string>) =>
      (await listChangesForActor(admin, parseChangeListFilters(params), { now: NOW })).rows.map(
        row => row.id
      );
    expect(await list({ risk: 'high' })).toEqual([high.id]);
    expect(await list({ risk: 'medium' })).toEqual([medium.id]);
    expect(await list({ risk: 'low' })).toEqual([low.id]);
    expect(await list({ risk: 'unscored' })).toEqual([unscored.id]);
    expect(await list({ source: 'argo' })).toEqual([medium.id, low.id]);
    expect(await list({ service: myService.id, source: 'argo' })).toEqual([medium.id]);
    const page = await listChangesForActor(admin, parseChangeListFilters(), { now: NOW });
    expect(page.sources).toEqual(['argo', 'ci', 'github']);
    expect(page.rows.find(row => row.id === unscored.id)?.riskScore).toBeNull();
  });

  it('links readable incidents whose analysis points at the change', async () => {
    const { admin, scoped, myService, otherService } = await seedTeams();
    const change = await changeAt(myService.id, 3 * 60);
    const other = await changeAt(myService.id, 4 * 60);
    const finding = (incidentId: string, subjectRef: string, status = 'ACTIVE') =>
      db.intelligenceFinding.create({
        data: {
          incidentId,
          kind: 'CHANGE_CORRELATION',
          status: status as 'ACTIVE',
          subjectRef,
          evidence: {},
          generation: 1,
          engineVersion: 't',
        },
      });
    const visible = await createTestIncident('checkout errors', myService.id, {
      createdAt: new Date(NOW.getTime() - 2 * HOUR),
    });
    const foreign = await createTestIncident('indexer lag', otherService.id, {
      createdAt: new Date(NOW.getTime() - 2 * HOUR),
    });
    const stale = await createTestIncident('old link', myService.id, {
      createdAt: new Date(NOW.getTime() - HOUR),
    });
    await finding(visible.id, change.id);
    await finding(foreign.id, change.id);
    await finding(stale.id, change.id, 'SUPERSEDED');

    const adminRow = (
      await listChangesForActor(admin, parseChangeListFilters(), { now: NOW })
    ).rows.find(row => row.id === change.id);
    expect(adminRow?.linkedIncidentCount).toBe(2);
    expect(adminRow?.linkedIncidents.map(incident => incident.title).sort()).toEqual([
      'checkout errors',
      'indexer lag',
    ]);

    const scopedRows = (await listChangesForActor(scoped, parseChangeListFilters(), { now: NOW }))
      .rows;
    expect(scopedRows.find(row => row.id === change.id)?.linkedIncidents).toEqual([
      { id: visible.id, title: 'checkout errors' },
    ]);
    expect(scopedRows.find(row => row.id === other.id)?.linkedIncidentCount).toBe(0);
  });
});
