import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeErrorBudget } from '@/lib/business-services/slo';

const claimed = new Set<string>();
const enqueued: Array<{ recipientId: string; html: string }> = [];
const prismaMock = vi.hoisted(() => ({
  businessService: { findMany: vi.fn() },
  teamMember: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  businessServiceReviewRun: { createMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn() }));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://app.example' }));
vi.mock('@/lib/notification-providers', () => ({
  getAllConfiguredEmailProviders: async () => [{}],
}));
vi.mock('@/lib/notification-control-plane', () => ({
  enqueueCentralNotification: async (i: { recipientId: string; payload: { html: string } }) => {
    enqueued.push({ recipientId: i.recipientId, html: i.payload.html });
  },
}));
vi.mock('@/lib/authorization-actors', () => ({
  resolveUserActor: async (id: string) => ({
    id,
    role: id === 'viewer' ? 'USER' : 'RESPONDER',
    status: 'ACTIVE',
    teamIds: id === 'resp' ? ['t1'] : [],
  }),
}));
vi.mock('@/lib/business-services/reviews/config', () => ({
  getReviewConfig: async () => ({
    enabled: true,
    freezeWarningEnabled: false,
    dayOfMonth: 1,
    hour: 9,
    timeZone: 'UTC',
    summaryUserIds: [],
  }),
}));
vi.mock('@/lib/business-services/reviews/data', () => ({
  collectServiceReviews: async () =>
    new Map(
      ['mine', 'other'].map(id => [
        id,
        {
          id,
          name: `Svc-${id}`,
          criticality: null,
          sloTarget: 99.9,
          attainmentPercent: 99,
          budget: computeErrorBudget({ targetPercent: 99.9, windowDays: 30, downtimeMinutes: 90 }),
          priorRemainingPercent: null,
          downtimeMinutes: 90,
          incidentCount: 2,
          mttaMinutes: 1,
          mttrMinutes: 10,
          estimatedCostCents: null,
          currency: null,
          topCauses: [],
        },
      ])
    ),
}));

import { runServiceReviews } from '@/lib/business-services/reviews/run';

beforeEach(() => {
  claimed.clear();
  enqueued.length = 0;
  prismaMock.businessService.findMany.mockImplementation(
    async (args: { select: Record<string, boolean> }) =>
      args.select.includeInReview
        ? [
            { id: 'mine', includeInReview: true, ownerUserId: 'resp', ownerTeamId: 't1' },
            { id: 'other', includeInReview: true, ownerUserId: 'resp', ownerTeamId: 't2' },
            { id: 'mine', includeInReview: true, ownerUserId: 'viewer', ownerTeamId: 't1' },
          ]
        : [{ id: 'mine' }] // the recipient's read scope: only their team's service
  );
  prismaMock.teamMember.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([
    { id: 'resp', name: 'Resp', email: 'r@example.com' },
    { id: 'viewer', name: 'View', email: 'v@example.com' },
  ]);
  prismaMock.businessServiceReviewRun.createMany.mockImplementation(
    async ({
      data: [row],
    }: {
      data: Array<{ period: string; kind: string; recipientKey: string }>;
    }) => {
      const key = `${row.period}:${row.kind}:${row.recipientKey}`;
      if (claimed.has(key)) return { count: 0 };
      claimed.add(key);
      return { count: 1 };
    }
  );
  prismaMock.businessServiceReviewRun.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.businessServiceReviewRun.update.mockResolvedValue({});
});

const NOW = new Date('2026-12-01T10:00:00Z');

describe('runServiceReviews', () => {
  it('sends one digest per recipient with only services they can read, and never twice', async () => {
    const first = await runServiceReviews({ now: NOW });
    expect(first).toMatchObject({ period: '2026-11', sent: 1, skipped: 1 });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.recipientId).toBe('resp');
    expect(enqueued[0]!.html).toContain('Svc-mine');
    expect(enqueued[0]!.html).not.toContain('Svc-other');

    const rerun = await runServiceReviews({ now: NOW });
    expect(rerun.sent).toBe(0);
    expect(rerun.alreadySent).toBe(2);
    expect(enqueued).toHaveLength(1);
  });

  it('M5: the recipient cap continues past already-claimed recipients on the next run', async () => {
    const first = await runServiceReviews({ now: NOW, maxRecipients: 1 });
    expect(first).toMatchObject({ sent: 1, skipped: 0 });
    const second = await runServiceReviews({ now: NOW, maxRecipients: 1 });
    expect(second).toMatchObject({ sent: 0, skipped: 1, alreadySent: 1 });
  });

  it('does nothing outside the schedule unless run manually', async () => {
    const early = await runServiceReviews({ now: new Date('2026-12-10T10:00:00Z') });
    expect(early.notDue).toBe(true);
    expect(enqueued).toHaveLength(0);
    const manual = await runServiceReviews({ now: new Date('2026-12-10T10:00:00Z'), manual: true });
    expect(manual.sent).toBe(1);
  });
});
