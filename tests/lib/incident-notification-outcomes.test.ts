import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  incidentFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  notificationFindMany: vi.fn(),
  createInAppNotifications: vi.fn(),
  sendNotification: vi.fn(),
  isChannelAvailable: vi.fn(),
  getWhatsAppConfig: vi.fn(),
  filterChannelsForQuietHours: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: { findUnique: mocks.incidentFindUnique },
    user: { findMany: mocks.userFindMany },
    notification: { findMany: mocks.notificationFindMany },
  },
}));
vi.mock('@/lib/in-app-notifications', () => ({
  createInAppNotifications: mocks.createInAppNotifications,
}));
vi.mock('@/lib/notifications', () => ({ sendNotification: mocks.sendNotification }));
vi.mock('@/lib/notification-providers', () => ({
  isChannelAvailable: mocks.isChannelAvailable,
  getWhatsAppConfig: mocks.getWhatsAppConfig,
}));
vi.mock('@/lib/quiet-hours', () => ({
  filterChannelsForQuietHours: mocks.filterChannelsForQuietHours,
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
import { sendIncidentNotifications } from '@/lib/user-notifications';
const now = new Date('2026-08-30T12:00:00.000Z');
const incident = {
  id: 'inc-1',
  title: 'Database latency',
  description: null,
  status: 'ACKNOWLEDGED',
  urgency: 'MEDIUM',
  priority: 'P2',
  serviceId: 'svc-1',
  createdAt: new Date('2026-08-30T11:55:00.000Z'),
  updatedAt: now,
  acknowledgedAt: now,
  resolvedAt: null,
  currentEscalationStep: null,
  nextEscalationAt: null,
  escalationStatus: 'COMPLETED',
  assigneeId: 'user-1',
  assignee: null,
  watchers: [],
  team: null,
  service: { id: 'svc-1', name: 'Payments', team: null },
};
const recipient = {
  id: 'user-1',
  emailNotificationsEnabled: false,
  smsNotificationsEnabled: false,
  pushNotificationsEnabled: false,
  whatsappNotificationsEnabled: false,
  phoneNumber: null,
  email: 'user@example.com',
  timeZone: 'UTC',
  quietHoursEnabled: false,
  quietHoursStartMinutes: null,
  quietHoursEndMinutes: null,
  quietHoursWeekendAllDay: false,
};
describe('incident notification fan-out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.incidentFindUnique.mockResolvedValue(incident);
    mocks.userFindMany.mockResolvedValue([recipient]);
    mocks.notificationFindMany.mockResolvedValue([]);
    mocks.createInAppNotifications.mockResolvedValue(undefined);
    mocks.isChannelAvailable.mockResolvedValue(true);
    mocks.getWhatsAppConfig.mockResolvedValue({ enabled: true, provider: 'twilio' });
    mocks.filterChannelsForQuietHours.mockImplementation(channels => ({
      channels,
      blockedChannels: new Set(),
    }));
  });
  it('treats no enabled external channels as a successful policy skip', async () => {
    await expect(sendIncidentNotifications('inc-1', 'acknowledged')).resolves.toMatchObject({
      success: true,
      outcome: 'SKIPPED',
    });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
  it('attempts every user-enabled channel independently', async () => {
    mocks.userFindMany.mockResolvedValue([
      {
        ...recipient,
        pushNotificationsEnabled: true,
        smsNotificationsEnabled: true,
        whatsappNotificationsEnabled: true,
        emailNotificationsEnabled: true,
        phoneNumber: '+15555550100',
      },
    ]);
    mocks.sendNotification.mockResolvedValue({
      success: true,
      outcome: 'DELIVERED',
      notificationId: 'intent-1',
    });
    const result = await sendIncidentNotifications('inc-1', 'acknowledged');
    expect(result).toMatchObject({ success: true, outcome: 'DELIVERED' });
    expect(mocks.sendNotification).toHaveBeenCalledTimes(4);
    expect(mocks.sendNotification.mock.calls.map(call => call[2])).toEqual(
      expect.arrayContaining(['PUSH', 'SMS', 'WHATSAPP', 'EMAIL'])
    );
  });
  it('contains a provider outage to the persisted channel intent instead of retrying the parent', async () => {
    mocks.userFindMany.mockResolvedValue([{ ...recipient, pushNotificationsEnabled: true }]);
    mocks.sendNotification.mockResolvedValue({
      success: false,
      outcome: 'RETRYABLE_FAILURE',
      notificationId:
        'ntf:acknowledged:1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      error: 'provider unavailable',
    });
    await expect(sendIncidentNotifications('inc-1', 'acknowledged')).resolves.toMatchObject({
      success: true,
      outcome: 'QUEUED',
    });
  });
  it('reports an admission-deferred persisted intent as queued, not skipped', async () => {
    mocks.userFindMany.mockResolvedValue([{ ...recipient, pushNotificationsEnabled: true }]);
    mocks.sendNotification.mockResolvedValue({
      success: true,
      outcome: 'QUEUED',
      queued: true,
      notificationId:
        'ntf:acknowledged:1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    await expect(sendIncidentNotifications('inc-1', 'acknowledged')).resolves.toMatchObject({
      success: true,
      outcome: 'QUEUED',
    });
  });
  it('includes the assigned team in resolve closure delivery', async () => {
    mocks.incidentFindUnique.mockResolvedValue({
      ...incident,
      status: 'RESOLVED',
      assigneeId: null,
      acknowledgedAt: new Date('2026-08-30T11:59:00.000Z'),
      resolvedAt: now,
      team: {
        members: [
          { userId: 'team-member', receiveTeamNotifications: true },
          { userId: 'opted-out', receiveTeamNotifications: false },
        ],
      },
    });
    mocks.userFindMany.mockResolvedValue([
      { ...recipient, id: 'team-member', pushNotificationsEnabled: true },
    ]);
    mocks.sendNotification.mockResolvedValue({
      success: true,
      outcome: 'DELIVERED',
      notificationId: 'intent-team',
    });
    await expect(sendIncidentNotifications('inc-1', 'resolved')).resolves.toMatchObject({
      success: true,
      outcome: 'DELIVERED',
    });
    expect(mocks.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['team-member'] }, status: 'ACTIVE' } })
    );
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      'inc-1',
      'team-member',
      'PUSH',
      '[Payments] Database latency',
      expect.anything(),
      'resolved'
    );
  });
  it('materializes the committed lifecycle generation instead of the later current timestamp', async () => {
    const committedAt = new Date('2026-08-30T11:59:00.000Z');
    mocks.incidentFindUnique.mockResolvedValue({
      ...incident,
      status: 'RESOLVED',
      resolvedAt: now,
    });
    mocks.userFindMany.mockResolvedValue([{ ...recipient, pushNotificationsEnabled: true }]);
    mocks.sendNotification.mockResolvedValue({
      success: true,
      outcome: 'DELIVERED',
      notificationId: 'intent-resolve',
    });

    await sendIncidentNotifications('inc-1', 'resolved', [], undefined, {
      eventAt: committedAt,
      status: 'RESOLVED',
    });

    expect(mocks.sendNotification).toHaveBeenCalledWith(
      'inc-1',
      'user-1',
      'PUSH',
      '[Payments] Database latency',
      expect.objectContaining({
        status: 'RESOLVED',
        updatedAt: committedAt,
        resolvedAt: committedAt,
      }),
      'resolved'
    );
  });
  it('keeps quiet-hours suppression terminal without consuming retry budget', async () => {
    mocks.userFindMany.mockResolvedValue([{ ...recipient, pushNotificationsEnabled: true }]);
    mocks.filterChannelsForQuietHours.mockReturnValue({
      channels: [],
      blockedChannels: new Set(['PUSH']),
    });
    await expect(sendIncidentNotifications('inc-1', 'acknowledged')).resolves.toMatchObject({
      success: true,
      outcome: 'SKIPPED',
    });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
});
