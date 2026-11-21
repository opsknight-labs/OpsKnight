import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import {
  isWeeklyDigestOptedIn,
  sendWeeklyDigests,
  setWeeklyDigestEnabled,
  setWeeklyDigestOptOut,
} from '@/lib/analytics/digest';
import { analyticsReportWeekStart } from '@/lib/analytics/weekly-report';
import { decrypt } from '@/lib/encryption';
import { POST as oneClickUnsubscribe } from '@/app/api/insights/digest/unsubscribe/[token]/route';
import {
  createTestNotificationProvider,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const configureEmail = () =>
  createTestNotificationProvider('smtp', {
    host: '127.0.0.1',
    port: 2525,
    user: 'digest-local',
    password: 'digest-local-only',
    fromEmail: 'digest@example.com',
  });

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const DAY = 86_400_000;

describeIfRealDB('default weekly analytics digest', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  }, 60_000);

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  /** Payments team with incidents last calendar week; users with different access. */
  async function seed({ email = true }: { email?: boolean } = {}) {
    if (email) await configureEmail();
    const now = new Date();
    const lastMonday = analyticsReportWeekStart(now).getTime() - 7 * DAY;
    const team = await createTestTeam('payments');
    const service = await testPrisma.service.create({
      data: { name: 'payments-api', teamId: team.id },
    });
    const hidden = await testPrisma.service.create({ data: { name: 'hidden-svc' } });
    const at = (day: number) => new Date(lastMonday + day * DAY + 12 * 3_600_000);
    await testPrisma.incident.createMany({
      data: [
        {
          title: 'a',
          serviceId: service.id,
          status: 'RESOLVED',
          createdAt: at(1),
          resolvedAt: at(1.1),
        },
        {
          title: 'b',
          serviceId: service.id,
          status: 'RESOLVED',
          createdAt: at(2),
          resolvedAt: at(2.1),
        },
        {
          title: 'c',
          serviceId: hidden.id,
          status: 'RESOLVED',
          createdAt: at(3),
          resolvedAt: at(3.1),
        },
      ],
    });
    const member = await createTestUser({ name: 'Member', role: 'USER' });
    await testPrisma.teamMember.create({ data: { teamId: team.id, userId: member.id } });
    // No team and nothing assigned: nothing to report, so no email.
    const outsider = await createTestUser({ name: 'Outsider', role: 'USER' });
    const optedOut = await createTestUser({ name: 'Opted out', role: 'USER' });
    await testPrisma.teamMember.create({ data: { teamId: team.id, userId: optedOut.id } });
    await setWeeklyDigestOptOut(optedOut.id, true);
    const disabled = await createTestUser({ name: 'Disabled', role: 'USER', status: 'DISABLED' });
    return { now, member, outsider, optedOut, disabled };
  }

  async function sent() {
    const rows = await testPrisma.notification.findMany({
      where: { templateKey: 'analytics-weekly-digest' },
    });
    return Promise.all(
      rows.map(async row => ({
        userId: row.userId,
        payload: JSON.parse(await decrypt(row.payloadEncrypted!)) as {
          html: string;
          subject: string;
          listUnsubscribeUrl?: string;
        },
      }))
    );
  }

  it('emails everyone with analytics access their own scope, once per week, with no subscription', async () => {
    const { now, member, outsider, optedOut, disabled } = await seed();
    const result = await sendWeeklyDigests(now);
    expect(result).toMatchObject({ sent: 1, failed: 0, disabled: false });

    const emails = await sent();
    expect(emails.map(email => email.userId)).toEqual([member.id]);
    const [{ payload }] = emails;
    expect(payload.subject).toBe('Your weekly summary · 2 incidents last week');
    expect(payload.html).toContain('Weekly summary');
    // The email says it is on by default and how to opt out.
    expect(payload.html).toContain('on by default for everyone with analytics');
    expect(payload.html).toContain('Weekly analytics summary');
    expect(payload.html).toContain('/settings/profile');
    expect(payload.html).toContain('payments-api');
    expect(payload.html).not.toContain('hidden-svc');
    expect(payload.listUnsubscribeUrl).toMatch(
      /\/api\/insights\/digest\/unsubscribe\/[A-Za-z0-9_-]{16,}$/
    );

    // Outsider had nothing to report; opted-out and disabled users are never emailed.
    const ids = [outsider.id, optedOut.id, disabled.id];
    expect(emails.some(email => ids.includes(email.userId!))).toBe(false);

    // Same week again: nothing new.
    expect(await sendWeeklyDigests(now)).toMatchObject({ sent: 0 });
    expect(await sent()).toHaveLength(1);
  });

  it('waits for an email provider, then sends without anyone having enabled alert emails', async () => {
    const { now, member } = await seed({ email: false });
    expect(await sendWeeklyDigests(now)).toMatchObject({ sent: 0, noEmailProvider: true });
    expect(
      await testPrisma.analyticsDigestSubscription.count({ where: { lastSentAt: { not: null } } })
    ).toBe(0);

    await configureEmail();
    expect(await sendWeeklyDigests(now)).toMatchObject({ sent: 1 });
    const user = await testPrisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(user.emailNotificationsEnabled).toBe(false);
  });

  it('sends nothing when an admin turns it off for the workspace', async () => {
    const { now } = await seed();
    await setWeeklyDigestEnabled(false, 'admin');
    expect(await sendWeeklyDigests(now)).toMatchObject({ sent: 0, disabled: true });
    expect(await sent()).toHaveLength(0);
  });

  it('one-click unsubscribe opts the user out; malformed requests are rejected', async () => {
    const { now, member } = await seed();
    await sendWeeklyDigests(now);
    const [{ payload }] = await sent();
    const token = payload.listUnsubscribeUrl!.split('/').pop()!;
    const request = (body: string) =>
      new NextRequest(`http://localhost/api/insights/digest/unsubscribe/${token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });

    const bad = await oneClickUnsubscribe(request('foo=bar'), {
      params: Promise.resolve({ token }),
    });
    expect(bad.status).toBe(400);
    expect(await isWeeklyDigestOptedIn(member.id)).toBe(true);

    const ok = await oneClickUnsubscribe(request('List-Unsubscribe=One-Click'), {
      params: Promise.resolve({ token }),
    });
    expect(ok.status).toBe(200);
    expect(await isWeeklyDigestOptedIn(member.id)).toBe(false);

    // Next week: opted out, so no email.
    const nextWeek = new Date(analyticsReportWeekStart(now).getTime() + 7 * DAY + 3_600_000);
    await sendWeeklyDigests(nextWeek);
    expect(await sent()).toHaveLength(1);
  });
});
