import { beforeEach, describe, expect, it, vi } from 'vitest';

const ai = vi.hoisted(() => ({ enabled: true, squireEnabled: true, squireChatOpsEnabled: true }));
vi.mock('@/lib/intelligence/ai/settings', () => ({ getAiSettings: vi.fn(async () => ai) }));
const slack = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/slack', () => ({ getSlackBotToken: vi.fn(async () => 'xoxb-test') }));
vi.mock('@/lib/war-room/providers/slack/client', () => ({
  slackApiCall: vi.fn(async (_method: string, _token: string, body: Record<string, unknown>) => {
    slack.calls.push(body);
    return { ok: true };
  }),
}));

import { sendSquireHeadsUps } from '@/lib/intelligence/squire/heads-up';
import {
  createTestEscalationPolicy,
  createTestIncident,
  createTestOnCallSchedule,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

const MINUTE = 60_000;
// Whole minutes keep the rotation math exact.
const now = new Date(Math.floor(Date.now() / MINUTE) * MINUTE);
const shiftStart = new Date(now.getTime() + 30 * MINUTE);

/** A person in Payments whose shift on "Primary" starts in 30 minutes; the schedule pages two teams' services. */
async function setup() {
  const payments = await createTestTeam('Payments');
  const search = await createTestTeam('Search');
  const user = await createTestUser({
    role: 'USER',
    teamMemberships: { create: { teamId: payments.id } },
  });
  const schedule = await createTestOnCallSchedule('Primary', [
    { start: shiftStart, rotationLengthHours: 168, userIds: [user.id] },
  ]);
  const policy = await createTestEscalationPolicy('Primary policy', [
    { stepOrder: 0, delayMinutes: 0, targetType: 'SCHEDULE', targetScheduleId: schedule.id },
  ]);
  const checkout = await createTestService('Checkout', payments.id, {
    escalationPolicyId: policy.id,
  });
  const indexer = await createTestService('Indexer', search.id, { escalationPolicyId: policy.id });
  await createTestIncident('Checkout errors', checkout.id);
  await createTestIncident('Old outage', checkout.id, { status: 'RESOLVED', resolvedAt: now });
  await createTestIncident('Search team private incident', indexer.id);
  await db.changeEvent.create({
    data: {
      serviceId: checkout.id,
      source: 'github',
      kind: 'DEPLOY',
      summary: 'Deploy checkout v42',
      occurredAt: new Date(now.getTime() - 60 * MINUTE),
    },
  });
  return { user, schedule };
}

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  Object.assign(ai, { enabled: true, squireEnabled: true, squireChatOpsEnabled: true });
  slack.calls.length = 0;
});

describe('Squire on-call heads-up', () => {
  it('sends once within the lead time, scoped to what the person may read', async () => {
    const { user, schedule } = await setup();
    await db.chatIdentityLink.create({
      data: {
        provider: 'SLACK',
        providerTenantId: 'T1',
        providerUserId: 'U123',
        userId: user.id,
        verificationMethod: 'ACCOUNT_LINK',
      },
    });

    // 90 minutes before the shift is outside the default 60-minute lead.
    expect(await sendSquireHeadsUps(new Date(now.getTime() - 60 * MINUTE))).toBe(0);
    expect(await sendSquireHeadsUps(now)).toBe(1);
    expect(await sendSquireHeadsUps(new Date(now.getTime() + 5 * MINUTE))).toBe(0);

    const [notification] = await db.inAppNotification.findMany({ where: { userId: user.id } });
    expect(notification.title).toMatch(/^Squire heads-up: on call for Primary-\S+ in 30 min$/);
    expect(notification.message).toContain('1 open incident: [HIGH] Checkout errors');
    expect(notification.message).toContain('Recent changes: Deploy checkout v42');
    expect(notification.message).not.toContain('Search team private incident');
    expect(notification.message).not.toContain('Old outage');
    expect(slack.calls).toEqual([
      expect.objectContaining({
        channel: 'U123',
        text: expect.stringContaining('• 1 open incident: [HIGH] Checkout errors'),
      }),
    ]);
    expect(await db.squireHeadsUp.findMany()).toEqual([
      expect.objectContaining({
        userId: user.id,
        shiftKey: `${schedule.id}:${shiftStart.toISOString()}`,
        channels: ['IN_APP', 'SLACK'],
      }),
    ]);
  });

  it('follows the person’s lead time and opt-out', async () => {
    const { user } = await setup();
    await db.squireUserSettings.create({ data: { userId: user.id, headsUpLeadMinutes: 15 } });
    expect(await sendSquireHeadsUps(now)).toBe(0);
    await db.squireUserSettings.update({
      where: { userId: user.id },
      data: { headsUpEnabled: false },
    });
    expect(await sendSquireHeadsUps(new Date(shiftStart.getTime() - 10 * MINUTE))).toBe(0);
    await db.squireUserSettings.update({
      where: { userId: user.id },
      data: { headsUpEnabled: true, headsUpLeadMinutes: 120 },
    });
    expect(await sendSquireHeadsUps(new Date(now.getTime() - 60 * MINUTE))).toBe(1);
    expect(slack.calls).toEqual([]);
  });

  it('stays silent while Squire is off', async () => {
    await setup();
    ai.squireEnabled = false;
    expect(await sendSquireHeadsUps(now)).toBe(0);
    expect(await db.squireHeadsUp.count()).toBe(0);
  });
});
