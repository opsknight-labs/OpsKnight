import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  incidentFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  createInAppNotifications: vi.fn(),
  sendNotification: vi.fn(),
  sendServiceNotifications: vi.fn(),
  isChannelAvailable: vi.fn(),
  getWhatsAppConfig: vi.fn(),
  filterChannelsForQuietHours: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: { findUnique: mocks.incidentFindUnique },
    user: { findMany: mocks.userFindMany },
  },
}));
vi.mock('@/lib/in-app-notifications', () => ({
  createInAppNotifications: mocks.createInAppNotifications,
}));
vi.mock('@/lib/notifications', () => ({ sendNotification: mocks.sendNotification }));
vi.mock('@/lib/service-notifications', () => ({
  sendServiceNotifications: mocks.sendServiceNotifications,
}));
vi.mock('@/lib/notification-providers', () => ({
  isChannelAvailable: mocks.isChannelAvailable,
  getWhatsAppConfig: mocks.getWhatsAppConfig,
}));
vi.mock('@/lib/quiet-hours', () => ({
  filterChannelsForQuietHours: mocks.filterChannelsForQuietHours,
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import { sendIncidentNotifications } from '@/lib/user-notifications';

const incident = {
  id: 'inc-1',
  title: 'Database latency',
  urgency: 'MEDIUM',
  serviceId: 'svc-1',
  assigneeId: 'user-1',
  assignee: null,
  watchers: [],
  team: null,
  service: {
    id: 'svc-1',
    name: 'Payments',
    team: null,
  },
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

describe('incident notification outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.incidentFindUnique.mockResolvedValue(incident);
    mocks.userFindMany.mockResolvedValue([recipient]);
    mocks.createInAppNotifications.mockResolvedValue(undefined);
    mocks.sendServiceNotifications.mockResolvedValue({ success: true });
    mocks.isChannelAvailable.mockResolvedValue(true);
    mocks.getWhatsAppConfig.mockResolvedValue({ enabled: false, provider: null });
    mocks.filterChannelsForQuietHours.mockImplementation(channels => ({
      channels,
      blockedChannels: new Set(),
    }));
  });

  it('treats no enabled external channels as a successful policy skip', async () => {
    const result = await sendIncidentNotifications('inc-1', 'updated');

    expect(result).toEqual({ success: true, outcome: 'SKIPPED' });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('treats quiet-hours suppression as a successful policy skip', async () => {
    mocks.userFindMany.mockResolvedValue([{ ...recipient, pushNotificationsEnabled: true }]);
    mocks.filterChannelsForQuietHours.mockReturnValue({
      channels: [],
      blockedChannels: new Set(['PUSH']),
    });

    const result = await sendIncidentNotifications('inc-1', 'updated');

    expect(result).toEqual({ success: true, outcome: 'SKIPPED' });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('keeps a provider outage retryable and reports a successful external delivery', async () => {
    mocks.userFindMany.mockResolvedValue([{ ...recipient, pushNotificationsEnabled: true }]);
    mocks.sendNotification.mockResolvedValueOnce({
      success: false,
      outcome: 'RETRYABLE_FAILURE',
      error: 'provider unavailable',
    });

    await expect(sendIncidentNotifications('inc-1', 'updated')).resolves.toEqual(
      expect.objectContaining({ success: false, outcome: 'RETRYABLE_FAILURE' })
    );

    mocks.sendNotification.mockResolvedValueOnce({ success: true, outcome: 'DELIVERED' });
    await expect(sendIncidentNotifications('inc-1', 'updated')).resolves.toEqual({
      success: true,
      outcome: 'DELIVERED',
    });
  });

  it('notifies only the newly assigned team with assignment-specific wording', async () => {
    const assignedTeamRecipient = {
      ...recipient,
      id: 'team-member',
      pushNotificationsEnabled: true,
    };
    mocks.incidentFindUnique.mockResolvedValue({
      ...incident,
      assigneeId: 'unrelated-assignee',
      team: { members: [{ userId: 'team-member' }] },
      service: {
        ...incident.service,
        team: { members: [{ userId: 'off-duty-service-member' }] },
      },
    });
    mocks.userFindMany.mockResolvedValue([assignedTeamRecipient]);
    mocks.sendNotification.mockResolvedValue({ success: true, outcome: 'DELIVERED' });

    await expect(
      sendIncidentNotifications('inc-1', 'updated', [], undefined, {
        intent: 'ASSIGNED_TO_TEAM',
      })
    ).resolves.toEqual({ success: true, outcome: 'DELIVERED' });

    expect(mocks.createInAppNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['team-member'],
        title: 'Incident Assigned to Your Team',
        message: '[Payments] Database latency has been assigned to your team',
      })
    );
    expect(mocks.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['team-member'] }, status: 'ACTIVE' } })
    );
    expect(mocks.sendNotification).toHaveBeenCalledWith(
      'inc-1',
      'team-member',
      'PUSH',
      '[Payments] Database latency has been assigned to your team',
      expect.anything(),
      'updated'
    );
  });
});
