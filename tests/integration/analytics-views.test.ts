import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { formatMetric } from '@/components/analytics/format';
import { createAnalyticsContext, getAnalyticsSection } from '@/lib/analytics';
import {
  createAnalyticsView,
  deleteAnalyticsView,
  getDefaultAnalyticsViewQuery,
  listAnalyticsViews,
  MAX_ANALYTICS_VIEWS_PER_USER,
  renameAnalyticsView,
  setAnalyticsViewWeeklyEmail,
  setDefaultAnalyticsView,
} from '@/lib/analytics/views';
import {
  analyticsReportWeekStart,
  sendWeeklyAnalyticsReports,
  weeklyReportParams,
} from '@/lib/analytics/weekly-report';
import { decrypt } from '@/lib/encryption';
import { createTestTeam, createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const DAY = 86_400_000;

async function actorFor(userId: string): Promise<AuthorizationActor> {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('no actor');
  return actor;
}

describeIfRealDB('analytics saved views', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  }, 60_000);

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('stores the canonical query and re-validates it on load', async () => {
    const owner = await actorFor((await createTestUser()).id);
    const created = await createAnalyticsView(owner, {
      name: '  Payments  ',
      query: 'urgency=high&service=b,a&range=30d&junk=<x>&service=bad id!',
    });
    expect(created.query).toBe('service=a&service=b&urgency=HIGH');

    // A row written before a filter changed (or tampered with) is cleaned on read.
    await testPrisma.analyticsView.update({
      where: { id: created.id },
      data: { query: 'range=7d&status=NOPE&assignee=%3Cscript%3E', isDefault: true },
    });
    const [view] = await listAnalyticsViews(owner);
    expect(view).toMatchObject({ name: 'Payments', query: 'range=7d', isOwner: true });
    expect(await getDefaultAnalyticsViewQuery(owner.id)).toBe('range=7d');
  });

  it('validates names and enforces the per-user limit', async () => {
    const owner = await actorFor((await createTestUser()).id);
    await expect(createAnalyticsView(owner, { name: '', query: '' })).rejects.toThrow();
    await expect(createAnalyticsView(owner, { name: 'x'.repeat(81), query: '' })).rejects.toThrow();
    await testPrisma.analyticsView.createMany({
      data: Array.from({ length: MAX_ANALYTICS_VIEWS_PER_USER }, (_, i) => ({
        name: `v${i}`,
        query: '',
        userId: owner.id,
      })),
    });
    await expect(createAnalyticsView(owner, { name: 'one more', query: '' })).rejects.toThrow(
      /up to 50 views/
    );
  });

  it('shares TEAM views with members only; only the owner can change them', async () => {
    const team = await createTestTeam('ops');
    const [ownerUser, mateUser, outsiderUser] = await Promise.all([
      createTestUser(),
      createTestUser(),
      createTestUser(),
    ]);
    await testPrisma.teamMember.createMany({
      data: [
        { teamId: team.id, userId: ownerUser.id },
        { teamId: team.id, userId: mateUser.id },
      ],
    });
    const [owner, mate, outsider] = await Promise.all([
      actorFor(ownerUser.id),
      actorFor(mateUser.id),
      actorFor(outsiderUser.id),
    ]);

    // Cannot share with a team you are not in.
    await expect(
      createAnalyticsView(outsider, { name: 'x', query: '', visibility: 'TEAM', teamId: team.id })
    ).rejects.toThrow(/your teams/);

    const shared = await createAnalyticsView(owner, {
      name: 'Team view',
      query: 'range=7d',
      visibility: 'TEAM',
      teamId: team.id,
    });
    const priv = await createAnalyticsView(owner, { name: 'Mine', query: '' });

    expect((await listAnalyticsViews(mate)).map(v => [v.name, v.isOwner])).toEqual([
      ['Team view', false],
    ]);
    expect(await listAnalyticsViews(outsider)).toEqual([]);

    for (const attempt of [
      () => deleteAnalyticsView(mate, shared.id),
      () => renameAnalyticsView(mate, shared.id, 'hijack'),
      () => setDefaultAnalyticsView(mate, shared.id),
      () => setAnalyticsViewWeeklyEmail(mate, shared.id, true),
      () => deleteAnalyticsView(outsider, priv.id),
    ]) {
      await expect(attempt()).rejects.toThrow(/not found/i);
    }
    expect(await testPrisma.analyticsView.count()).toBe(2);

    await renameAnalyticsView(owner, shared.id, 'Renamed');
    await setDefaultAnalyticsView(owner, shared.id);
    await setDefaultAnalyticsView(owner, priv.id);
    const defaults = await testPrisma.analyticsView.findMany({ where: { isDefault: true } });
    expect(defaults.map(v => v.id)).toEqual([priv.id]);
    await deleteAnalyticsView(owner, shared.id);
    expect(await listAnalyticsViews(mate)).toEqual([]);
  });

  it('denies inactive actors', async () => {
    const owner = await actorFor((await createTestUser()).id);
    const disabled = { ...owner, status: 'DISABLED' as const };
    await expect(listAnalyticsViews(disabled)).rejects.toThrow(/permission/);
    await expect(createAnalyticsView(disabled, { name: 'x', query: '' })).rejects.toThrow(
      /permission/
    );
  });
});

describeIfRealDB('weekly analytics email', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  }, 60_000);

  async function seed() {
    const now = new Date();
    const team = await createTestTeam('payments');
    const service = await testPrisma.service.create({
      data: { name: 'payments-api', teamId: team.id },
    });
    const other = await testPrisma.service.create({ data: { name: 'ledger', teamId: team.id } });
    // Outside the recipient's teams: must not leak into their report.
    const hidden = await testPrisma.service.create({ data: { name: 'hidden-svc' } });
    // The report covers last calendar week (Mon–Sun, recipient timezone = UTC here).
    const lastMonday = analyticsReportWeekStart(now).getTime() - 7 * DAY;
    const incident = (serviceId: string, dayOfWeek: number, urgency: 'HIGH' | 'LOW') => {
      const createdAt = lastMonday + dayOfWeek * DAY + 12 * 3_600_000;
      return {
        title: 'x',
        serviceId,
        urgency,
        status: 'RESOLVED' as const,
        createdAt: new Date(createdAt),
        acknowledgedAt: new Date(createdAt + 120_000),
        resolvedAt: new Date(createdAt + 3_600_000),
      };
    };
    await testPrisma.incident.createMany({
      data: [
        incident(service.id, 1, 'HIGH'),
        incident(service.id, 2, 'HIGH'),
        incident(other.id, 3, 'HIGH'),
        incident(service.id, 3, 'LOW'), // filtered out by the view
        incident(service.id, -3, 'HIGH'), // the week before
        incident(hidden.id, 1, 'HIGH'),
      ],
    });
    const user = await createTestUser({ name: 'Sam', emailNotificationsEnabled: true });
    await testPrisma.teamMember.create({ data: { teamId: team.id, userId: user.id } });
    const view = await testPrisma.analyticsView.create({
      data: {
        name: 'High urgency',
        query: 'urgency=HIGH&range=90d',
        userId: user.id,
        emailWeekly: true,
      },
    });
    return { now, user, view, service };
  }

  async function sentPayloads() {
    const rows = await testPrisma.notification.findMany({
      where: { templateKey: 'analytics-weekly-report' },
    });
    return Promise.all(
      rows.map(async row => ({
        row,
        payload: JSON.parse(await decrypt(row.payloadEncrypted!)) as { html: string; to: string },
      }))
    );
  }

  it('sends numbers that match getAnalyticsSection, once per week', async () => {
    const { now, user, view } = await seed();
    const result = await sendWeeklyAnalyticsReports(now);
    expect(result).toEqual({ sent: 1, skipped: 0, failed: 0 });

    const context = await createAnalyticsContext(
      await actorFor(user.id),
      weeklyReportParams(view.query, now, user.timeZone),
      user.timeZone
    );
    const kpis = await getAnalyticsSection(context, 'kpis');
    const services = await getAnalyticsSection(context, 'services');
    const trend = await getAnalyticsSection(context, 'trend');
    expect(kpis.current.incidents).toBe(3);
    expect(kpis.previous.incidents).toBe(1);

    const [{ row, payload }] = await sentPayloads();
    expect(row.userId).toBe(user.id);
    expect(payload.to).toBe(user.email);
    // 3 incidents vs 1: +200%, worse (fewer incidents is better).
    expect(payload.html).toContain('▲ 200% worse');
    expect(payload.html).toContain(formatMetric(kpis.current.mttaP50, 'duration'));
    expect(payload.html).toContain(services[0].name);
    expect(trend).toHaveLength(7);
    expect(payload.html).toContain('Incidents rose to 3 from 1');
    expect(payload.html).toMatch(
      /from=\d{4}-\d{2}-\d{2}&amp;to=\d{4}-\d{2}-\d{2}&amp;urgency=HIGH/
    );
    expect(payload.html).not.toContain('hidden-svc');

    // Restart in the same week: nothing new, even if lastSentAt was lost.
    expect(await sendWeeklyAnalyticsReports(now)).toEqual({ sent: 0, skipped: 0, failed: 0 });
    await testPrisma.analyticsView.update({ where: { id: view.id }, data: { lastSentAt: null } });
    await sendWeeklyAnalyticsReports(now);
    expect(await sentPayloads()).toHaveLength(1);

    // Next week sends again.
    const nextWeek = new Date(analyticsReportWeekStart(now).getTime() + 7 * DAY + 3_600_000);
    expect((await sendWeeklyAnalyticsReports(nextWeek)).sent).toBe(1);
    expect(await sentPayloads()).toHaveLength(2);
  });

  it('skips disabled users and users with email notifications off', async () => {
    const { now, user, view } = await seed();
    const quiet = await createTestUser({ emailNotificationsEnabled: false });
    await testPrisma.analyticsView.create({
      data: { name: 'Quiet', query: '', userId: quiet.id, emailWeekly: true },
    });
    await testPrisma.user.update({ where: { id: user.id }, data: { status: 'DISABLED' } });

    expect(await sendWeeklyAnalyticsReports(now)).toEqual({ sent: 0, skipped: 2, failed: 0 });
    expect(await sentPayloads()).toHaveLength(0);
    const marked = await testPrisma.analyticsView.findUnique({ where: { id: view.id } });
    expect(marked?.lastSentAt).not.toBeNull();
  });

  it('subscribing mid-week waits for the next week', async () => {
    const { now, user, view } = await seed();
    await testPrisma.analyticsView.update({ where: { id: view.id }, data: { emailWeekly: false } });
    await setAnalyticsViewWeeklyEmail(await actorFor(user.id), view.id, true);
    expect((await sendWeeklyAnalyticsReports(now)).sent).toBe(0);
  });
});
