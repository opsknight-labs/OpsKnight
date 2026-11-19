import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  draft: vi.fn(async () => 'Checkout is down and unassigned; take it first.'),
  enqueue: vi.fn(async () => ({ skipped: false })),
  inApp: vi.fn(async () => undefined),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://ops.example' }));
vi.mock('@/lib/in-app-notifications', () => ({ createInAppNotifications: mocks.inApp }));
vi.mock('@/lib/notification-control-plane', () => ({
  enqueueCentralNotification: mocks.enqueue,
}));
vi.mock('@/lib/intelligence/settings/service', () => ({
  getIntelligenceSettings: async () => ({ handoffSummaryEnabled: true }),
}));
vi.mock('@/lib/intelligence/ops-insights/contract', () => ({ enabledOpsInsightAreas: () => [] }));
vi.mock('@/lib/intelligence/handoff/summary', () => ({
  buildHandoffSummary: async () => ({ scheduleName: 'Primary' }),
  draftHandoffNarrative: mocks.draft,
  renderHandoffSummary: (summary: { narrative: string | null }) => ({
    subject: 'Shift handoff',
    html: `<p>${summary.narrative}</p>`,
    text: String(summary.narrative),
  }),
}));

import { sendHandoffSummaries } from '@/lib/intelligence/handoff/dispatch';

describe('shift handoff dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('drafts one narrative per handoff and sends it to each recipient under their own key', async () => {
    const shiftStart = new Date('2026-11-20T08:00:00Z');
    const recipients = ['u1', 'u2', 'u3'].map(userId => ({
      userId,
      email: `${userId}@example.com`,
      shiftStart,
    }));
    const sent = await sendHandoffSummaries({
      scheduleId: 'sch1',
      scheduleName: 'Primary',
      serviceIds: ['svc1'],
      recipients,
    });
    expect(sent).toBe(3);
    expect(mocks.draft).toHaveBeenCalledTimes(1);
    expect(mocks.draft).toHaveBeenCalledWith({ scheduleName: 'Primary' }, 'sch1', 'u1');
    const emails = mocks.enqueue.mock.calls.map(call => (call as unknown[])[0]) as Array<{
      recipientId: string;
      eventKey: string;
      payload: { to: string; text: string };
    }>;
    expect(emails.map(email => email.recipientId)).toEqual(['u1', 'u2', 'u3']);
    expect(emails.map(email => email.payload.to)).toEqual([
      'u1@example.com',
      'u2@example.com',
      'u3@example.com',
    ]);
    expect(new Set(emails.map(email => email.eventKey)).size).toBe(3);
    for (const email of emails) expect(email.payload.text).toContain('take it first');
    expect(mocks.inApp.mock.calls.map(call => (call as unknown[])[0])).toEqual(
      recipients.map(r => expect.objectContaining({ userIds: [r.userId] }))
    );
  });
});
