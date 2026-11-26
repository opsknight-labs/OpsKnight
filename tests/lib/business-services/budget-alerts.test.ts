import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  budget: vi.fn(),
  enabled: vi.fn(),
  inApp: vi.fn(),
  intent: vi.fn(),
  targets: vi.fn(),
  chat: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({
  default: { businessService: { findMany: mocks.findMany, updateMany: mocks.updateMany } },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://ops.example' }));
vi.mock('@/lib/in-app-notifications', () => ({ createInAppNotifications: mocks.inApp }));
vi.mock('@/lib/notification-control-plane', () => ({
  createCentralNotificationIntent: mocks.intent,
}));
vi.mock('@/lib/business-services/reviews/config', () => ({
  isErrorBudgetAlertsEnabled: mocks.enabled,
}));
vi.mock('@/lib/business-services/reviews/freeze-service', () => ({
  errorBudgetFor: mocks.budget,
}));
vi.mock('@/lib/business-services/chat-channels', () => ({
  businessServiceChatTargets: mocks.targets,
  enqueueBusinessServiceChat: mocks.chat,
}));
vi.mock('@/emails/render', () => ({ renderEmail: async () => ({ html: '<p>x</p>' }) }));
vi.mock('@/emails/templates/stakeholder-update', () => ({ StakeholderUpdateEmail: () => null }));

import {
  BUDGET_ALERT_DEBOUNCE_MS,
  budgetAlertDecision,
  budgetAlertText,
  runErrorBudgetAlerts,
  runErrorBudgetAlertsIfDue,
} from '@/lib/business-services/budget-alerts';

const now = new Date('2026-12-02T10:00:00Z');
const budget = (burnState: string, remainingPercent = 10) => ({
  allowedMinutes: 43.2,
  consumedMinutes: 40,
  remainingPercent,
  burnState,
});
const row = (lastBudgetState: string | null, lastBudgetStateAt: Date | null = null) => ({
  id: 'bs1',
  name: 'Checkout',
  sloTarget: 99.9,
  sloWindowDays: 30,
  contactChannel: '#checkout',
  ownerTeamId: 't1',
  lastBudgetState,
  lastBudgetStateAt,
  ownerUser: { id: 'owner', email: 'owner@example.com', status: 'ACTIVE' },
  ownerTeam: { members: [{ user: { id: 'member', email: 'member@example.com' } }] },
  followers: [
    { user: { id: 'owner', email: 'owner@example.com' } },
    { user: { id: 'f1', email: null } },
  ],
});

describe('budgetAlertDecision', () => {
  it('baselines, alerts on worsening at once and debounces recovery', () => {
    expect(budgetAlertDecision(null, null, 'AT_RISK', now)).toBe('BASELINE');
    expect(budgetAlertDecision('OK', now, 'OK', now)).toBe('NONE');
    expect(budgetAlertDecision('AT_RISK', now, 'BREACHED', now)).toBe('NOTIFY');
    expect(budgetAlertDecision('BREACHED', new Date(now.getTime() - 60_000), 'OK', now)).toBe(
      'DEBOUNCED'
    );
    expect(
      budgetAlertDecision(
        'BREACHED',
        new Date(now.getTime() - BUDGET_ALERT_DEBOUNCE_MS),
        'AT_RISK',
        now
      )
    ).toBe('NOTIFY');
  });

  it('words each state', () => {
    const slo = { target: 99.9, windowDays: 30 };
    expect(
      budgetAlertText('Checkout', 'AT_RISK', budget('AT_RISK', 12.4) as never, slo).message
    ).toBe('12% of the 30-day error budget for the 99.9% SLO is left.');
    expect(
      budgetAlertText('Checkout', 'BREACHED', budget('BREACHED', -5) as never, slo).title
    ).toBe('Checkout: error budget exhausted');
  });
});

describe('runErrorBudgetAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.targets.mockResolvedValue([{ provider: 'SLACK', channel: '#checkout' }]);
    mocks.intent.mockResolvedValue({ id: 'n', created: true });
  });

  it('records a baseline without telling anyone', async () => {
    mocks.findMany.mockResolvedValueOnce([row(null)]);
    mocks.budget.mockResolvedValue(budget('AT_RISK'));
    expect(await runErrorBudgetAlerts(now)).toEqual({ alerted: 0 });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'bs1', lastBudgetState: null },
      data: { lastBudgetState: 'AT_RISK', lastBudgetStateAt: now },
    });
    expect(mocks.inApp).not.toHaveBeenCalled();
  });

  it('tells owner, owner team and followers once, in-app, email and chat, then records the state', async () => {
    mocks.findMany.mockResolvedValueOnce([row('OK', new Date('2026-11-01T00:00:00Z'))]);
    mocks.budget.mockResolvedValue(budget('BREACHED', -2));
    expect(await runErrorBudgetAlerts(now)).toEqual({ alerted: 1 });
    expect(mocks.inApp.mock.calls[0][0]).toMatchObject({
      userIds: ['owner', 'member', 'f1'],
      title: 'Checkout: error budget exhausted',
      entityType: 'BUSINESS_SERVICE',
    });
    // Users without an email get in-app only.
    expect(mocks.intent.mock.calls.map(call => call[0].recipientAddress)).toEqual([
      'owner@example.com',
      'member@example.com',
    ]);
    const eventKey = mocks.intent.mock.calls[0][0].eventKey;
    expect(mocks.chat).toHaveBeenCalledWith(expect.objectContaining({ eventKey }));
    expect(mocks.inApp.mock.calls[0][0].dedupeKey).toBe(`business-service-budget:${eventKey}`);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });

  it('leaves the state unrecorded when a delivery step fails, so the next sweep retries', async () => {
    mocks.findMany.mockResolvedValueOnce([row('OK', null)]);
    mocks.budget.mockResolvedValue(budget('AT_RISK'));
    mocks.chat.mockRejectedValueOnce(new Error('queue down'));
    expect(await runErrorBudgetAlerts(now)).toEqual({ alerted: 0 });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing while the admin switch is off', async () => {
    mocks.enabled.mockResolvedValue(false);
    expect(await runErrorBudgetAlertsIfDue(now)).toBeNull();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
