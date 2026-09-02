import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanModifyService: vi.fn(),
  serviceUpdate: vi.fn(),
  logAudit: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  assertCanModifyService: mocks.assertCanModifyService,
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    service: {
      update: mocks.serviceUpdate,
    },
  },
}));

vi.mock('@/lib/audit', () => ({
  logAudit: mocks.logAudit,
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

import { updateServiceNotificationSettings } from '@/app/(app)/services/actions';

describe('updateServiceNotificationSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanModifyService.mockResolvedValue({ id: 'user-1' });
    mocks.serviceUpdate.mockResolvedValue({});
  });

  it('explicitly nullifies slackChannel and slackWebhookUrl when SLACK is unchecked', async () => {
    const formData = new FormData();
    // Only WEBHOOK is selected; SLACK is unchecked
    formData.set('serviceNotificationChannelsJson', JSON.stringify(['WEBHOOK']));
    formData.set('serviceNotifyOnTriggered', 'true');
    formData.set('serviceNotifyOnAck', 'true');
    formData.set('serviceNotifyOnResolved', 'true');
    formData.set('serviceNotifyOnSlaBreach', 'false');

    await updateServiceNotificationSettings('svc-1', formData);

    expect(mocks.serviceUpdate).toHaveBeenCalledWith({
      where: { id: 'svc-1' },
      data: {
        serviceNotificationChannels: ['WEBHOOK'],
        serviceNotifyOnTriggered: true,
        serviceNotifyOnAck: true,
        serviceNotifyOnResolved: true,
        serviceNotifyOnSlaBreach: false,
        slackChannel: null,
        slackWebhookUrl: null,
      },
    });
  });

  it('saves slackChannel when SLACK is checked', async () => {
    const formData = new FormData();
    formData.set('serviceNotificationChannelsJson', JSON.stringify(['SLACK', 'WEBHOOK']));
    formData.set('slackChannel', 'incident-alerts');
    formData.set('serviceNotifyOnTriggered', 'true');
    formData.set('serviceNotifyOnAck', 'true');
    formData.set('serviceNotifyOnResolved', 'true');
    formData.set('serviceNotifyOnSlaBreach', 'false');

    await updateServiceNotificationSettings('svc-1', formData);

    expect(mocks.serviceUpdate).toHaveBeenCalledWith({
      where: { id: 'svc-1' },
      data: {
        serviceNotificationChannels: ['SLACK', 'WEBHOOK'],
        serviceNotifyOnTriggered: true,
        serviceNotifyOnAck: true,
        serviceNotifyOnResolved: true,
        serviceNotifyOnSlaBreach: false,
        slackChannel: 'incident-alerts',
        slackWebhookUrl: undefined,
      },
    });
  });
});
