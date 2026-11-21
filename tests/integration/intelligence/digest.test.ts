import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { isoWeekKey } from '@/lib/intelligence/digest/contract';
import {
  DIGEST_CHUNK_SIZE,
  getDigestSettings,
  getLatestDigestRun,
  scheduleDigestIfDue,
  sendDigestPass,
  sendTestDigest,
  updateDigestSettings,
} from '@/lib/intelligence/digest/service';
import { purgeExpiredIntelligenceData } from '@/lib/intelligence/jobs/retention';
import { DEFAULT_HANDLERS } from '@/lib/intelligence/jobs/runner';
import { WORK_KINDS } from '@/lib/intelligence/jobs/work-queue';
import { updateOpsInsightSwitches } from '@/lib/intelligence/ops-insights/settings';
import { upsertInsights } from '@/lib/intelligence/ops-insights/store';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import { createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

const enqueue = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('@/lib/notification-control-plane', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/notification-control-plane')>();
  enqueue.fn.mockImplementation(actual.enqueueCentralNotification);
  return { ...actual, enqueueCentralNotification: enqueue.fn };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// Wednesday 2026-06-17 10:00 UTC; the schedule below is Wednesday 09:00 UTC.
const NOW = new Date('2026-06-17T10:00:00Z');
const WEEK = isoWeekKey(NOW);

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  enqueue.fn.mockClear();
});

async function enable(
  actorId: string,
  overrides: Partial<{ enabled: boolean; dayOfWeek: number; hourUtc: number }> = {}
) {
  const current = await getDigestSettings();
  return updateDigestSettings(
    { enabled: true, dayOfWeek: 3, hourUtc: 9, expectedRevision: current.revision, ...overrides },
    { actorId, source: 'UI' }
  );
}

const digestMail = () =>
  db.notification.findMany({
    where: { templateKey: 'intelligence-weekly-digest' },
    orderBy: { createdAt: 'asc' },
  });
const recipientsOf = async () => {
  const rows = await digestMail();
  const users = await db.user.findMany({
    where: { id: { in: rows.map(row => row.userId!).filter(Boolean) } },
  });
  return users.map(user => user.email).sort();
};

describe('weekly digest', () => {
  it('is off by default and sends nothing', async () => {
    await createTestUser({ role: 'ADMIN' });
    expect(await getDigestSettings()).toMatchObject({ enabled: false, revision: 0 });
    expect(await scheduleDigestIfDue(NOW)).toBe(false);
    expect(await sendDigestPass(WEEK, NOW)).toBe('skipped');
    expect(await digestMail()).toEqual([]);
  });

  it('sends once per week to active people who manage intelligence, and never twice', async () => {
    const admin = await createTestUser({ role: 'ADMIN', email: 'a@example.com' });
    await createTestUser({ role: 'ADMIN', email: 'b@example.com' });
    await createTestUser({ role: 'ADMIN', email: 'disabled@example.com', status: 'DISABLED' });
    await createTestUser({ role: 'RESPONDER', email: 'responder@example.com' });
    await createTestUser({ role: 'USER', email: 'user@example.com' });
    await enable(admin.id);

    expect(await scheduleDigestIfDue(new Date('2026-06-17T08:00:00Z'))).toBe(false);
    expect(await scheduleDigestIfDue(NOW)).toBe(true);
    const queued = await db.intelligenceWorkItem.findMany({
      where: { kind: WORK_KINDS.SEND_DIGEST },
    });
    expect(queued.map(item => item.subjectKey)).toEqual([WEEK]);

    expect(await sendDigestPass(WEEK, NOW)).toBe('done');
    expect(await recipientsOf()).toEqual(['a@example.com', 'b@example.com']);
    const rows = await digestMail();
    // Durable, low-priority intents: delivery, retries and history belong to the control plane.
    expect(
      rows.every(
        row => row.channel === 'EMAIL' && row.category === 'SYSTEM' && row.trafficClass === 'BULK'
      )
    ).toBe(true);
    expect(rows[0].message).toContain(WEEK);

    // Another worker, a second replica or a re-queued item: nothing more is sent.
    expect(await sendDigestPass(WEEK, NOW)).toBe('done');
    expect(await scheduleDigestIfDue(NOW)).toBe(false);
    expect(await digestMail()).toHaveLength(2);
    expect(await getLatestDigestRun()).toMatchObject({
      weekKey: WEEK,
      status: 'COMPLETED',
      sent: 2,
      failed: 0,
      recipients: 2,
    });

    // Even if the run record were lost after queueing, the control plane would not queue a duplicate.
    await db.intelligenceDigestRun.deleteMany();
    expect(await sendDigestPass(WEEK, NOW)).toBe('done');
    expect(await digestMail()).toHaveLength(2);
  });

  it('sends in bounded chunks and resumes where it stopped', async () => {
    const admins = [];
    for (let i = 0; i < DIGEST_CHUNK_SIZE + 2; i += 1)
      admins.push(await createTestUser({ role: 'ADMIN' }));
    await enable(admins[0].id);

    const handler = DEFAULT_HANDLERS[WORK_KINDS.SEND_DIGEST]!;
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      await handler(
        {
          id: 'w',
          kind: WORK_KINDS.SEND_DIGEST,
          subjectKey: WEEK,
          generation: 1,
          claimToken: 't',
          attempts: 1,
        },
        {
          settings: { ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1 } as never,
          signal: new AbortController().signal,
        }
      );
    } finally {
      vi.useRealTimers();
    }
    expect(await digestMail()).toHaveLength(DIGEST_CHUNK_SIZE);
    // The handler queued its own continuation.
    expect(
      await db.intelligenceWorkItem.count({
        where: { kind: WORK_KINDS.SEND_DIGEST, subjectKey: WEEK },
      })
    ).toBe(1);

    expect(await sendDigestPass(WEEK, NOW)).toBe('done');
    expect(new Set(await recipientsOf()).size).toBe(DIGEST_CHUNK_SIZE + 2);
  });

  it('records recipients that could not be queued without retrying them all week', async () => {
    const admin = await createTestUser({ role: 'ADMIN', email: 'ok@example.com' });
    await createTestUser({ role: 'ADMIN', email: 'broken@example.com' });
    await enable(admin.id);
    const real = enqueue.fn.getMockImplementation()!;
    enqueue.fn.mockImplementation(async (input: { recipientAddress: string }) => {
      if (input.recipientAddress.startsWith('broken')) throw new Error('queue unavailable');
      return real(input as never);
    });
    try {
      expect(await sendDigestPass(WEEK, NOW)).toBe('done');
      expect(await getLatestDigestRun()).toMatchObject({ sent: 1, failed: 1, status: 'COMPLETED' });
      expect(await sendDigestPass(WEEK, NOW)).toBe('done');
      expect(enqueue.fn).toHaveBeenCalledTimes(2);
    } finally {
      enqueue.fn.mockImplementation(real);
    }
  });

  it('ignores items for another week and stops when the digest is switched off', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await enable(admin.id);
    expect(await sendDigestPass('2026-W01', NOW)).toBe('skipped');
    await enable(admin.id, { enabled: false });
    expect(await sendDigestPass(WEEK, NOW)).toBe('skipped');
    expect(await digestMail()).toEqual([]);
  });

  it('is revision-locked, validated and audited', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await enable(admin.id);
    await expect(
      updateDigestSettings(
        { enabled: true, dayOfWeek: 1, hourUtc: 8, expectedRevision: 0 },
        { actorId: admin.id, source: 'UI' }
      )
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(
      updateDigestSettings(
        { enabled: true, dayOfWeek: 7, hourUtc: 24, expectedRevision: 1 },
        { actorId: admin.id, source: 'UI' }
      )
    ).rejects.toThrow();
    const audit = await db.auditLog.findFirst({
      where: { action: 'intelligence.digest.settings.updated' },
    });
    expect(audit).not.toBeNull();
  });

  it('sends a test digest to the requester only', async () => {
    const admin = await createTestUser({ role: 'ADMIN', email: 'me@example.com' });
    await createTestUser({ role: 'ADMIN', email: 'other@example.com' });
    expect(await sendTestDigest(admin.id, NOW)).toBe(true);
    expect(await recipientsOf()).toEqual(['me@example.com']);
    expect(await getLatestDigestRun()).toBeNull();
    const responder = await createTestUser({ role: 'RESPONDER' });
    expect(await sendTestDigest(responder.id, NOW)).toBe(false);
  });

  it('lists open operations insights only when they are on, with the scope name and a link', async () => {
    const admin = await createTestUser({ role: 'ADMIN', email: 'me@example.com' });
    const service = await db.service.create({ data: { name: 'Payments <api>' } });
    await upsertInsights(
      { type: 'SERVICE', id: service.id },
      'integration.silent',
      [
        {
          key: 'silent',
          severity: 'WARNING',
          title: 'No alerts for 3 days',
          summary: 'Quiet.',
          evidence: { facts: [] },
        },
      ],
      { area: 'automation' }
    );
    const mail = () => enqueue.fn.mock.calls.at(-1)?.[0].payload as { html: string; text: string };

    // Off (the default): the stored insight is not mentioned.
    expect(await sendTestDigest(admin.id, NOW)).toBe(true);
    expect(mail().text).not.toContain('Needs attention');

    const current = await getIntelligenceSettings();
    await updateOpsInsightSwitches(
      {
        opsInsightsEnabled: true,
        opsInsightsAutomationEnabled: true,
        opsInsightsEscalationEnabled: false,
        opsInsightsOnCallEnabled: false,
        opsInsightsPostmortemsEnabled: false,
        opsInsightsRunbooksEnabled: false,
        opsInsightsNotificationsEnabled: false,
        expectedRevision: current.revision,
      },
      { actorId: admin.id, source: 'UI' }
    );
    await db.notification.deleteMany();
    expect(await sendTestDigest(admin.id, NOW)).toBe(true);
    expect(mail().text).toContain(`- Payments <api>: No alerts for 3 days [warning] http`);
    expect(mail().text).toContain(`/services/${service.id}`);
    expect(mail().html).toContain('Payments &lt;api&gt;</a>: No alerts for 3 days');
  });

  it('ages delivery records out with finding retention', async () => {
    await db.intelligenceDigestRun.create({
      data: {
        weekKey: '2025-W01',
        scheduledFor: new Date('2025-01-01'),
        startedAt: new Date('2025-01-01'),
        sentTo: ['x'],
      },
    });
    const result = await purgeExpiredIntelligenceData(
      { ...INTELLIGENCE_SETTINGS_DEFAULTS, findingRetentionDays: 30 },
      { batchSize: 100 }
    );
    expect(result.digestRuns).toBe(1);
  });
});
