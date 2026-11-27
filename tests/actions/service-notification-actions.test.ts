import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanModifyService: vi.fn(),
  serviceUpdate: vi.fn(),
  serviceFindUnique: vi.fn(),
  storeSlackWebhookUrl: vi.fn(),
  slackDestinationUpdateMany: vi.fn(),
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
      findUnique: mocks.serviceFindUnique,
    },
    slackDestination: {
      updateMany: mocks.slackDestinationUpdateMany,
    },
  },
}));

vi.mock('@/lib/slack-webhook-secret', () => ({
  storeSlackWebhookUrl: mocks.storeSlackWebhookUrl,
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
    mocks.serviceFindUnique.mockResolvedValue({ serviceNotificationChannels: [] });
    mocks.storeSlackWebhookUrl.mockImplementation(async (url: string) => `v3:k1:${url.length}`);
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
  it('rejects a Slack webhook URL that delivery would refuse', async () => {
    const formData = new FormData();
    formData.set('serviceNotificationChannelsJson', JSON.stringify(['SLACK']));
    formData.set('slackWebhookUrl', 'https://hooks.slak.com/services/T/B/X');

    await updateServiceNotificationSettings('svc-1', formData);

    expect(mocks.redirect).toHaveBeenCalledWith(
      '/services/svc-1?tab=notifications&error=invalid-slack-webhook'
    );
    expect(mocks.serviceUpdate).not.toHaveBeenCalled();
  });

  it('refuses a newly added channel the dispatcher never sends to', async () => {
    const formData = new FormData();
    formData.set('serviceNotificationChannelsJson', JSON.stringify(['WEBHOOK', 'EMAIL']));

    await updateServiceNotificationSettings('svc-1', formData);

    expect(mocks.redirect).toHaveBeenCalledWith(
      '/services/svc-1?tab=notifications&error=unsupported-channel'
    );
    expect(mocks.serviceUpdate).not.toHaveBeenCalled();
  });

  it('drops a legacy stored EMAIL or SMS value on save instead of failing the form', async () => {
    mocks.serviceFindUnique.mockResolvedValue({ serviceNotificationChannels: ['WEBHOOK', 'SMS'] });
    const formData = new FormData();
    formData.set('serviceNotificationChannelsJson', JSON.stringify(['WEBHOOK', 'SMS']));

    await updateServiceNotificationSettings('svc-1', formData);

    expect(mocks.serviceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ serviceNotificationChannels: ['WEBHOOK'] }),
      })
    );
  });

  describe('Slack webhook secret', () => {
    const webhook = 'https://hooks.slack.com/services/T000/B000/topsecretvalue';
    const slackForm = (extra: Record<string, string> = {}) => {
      const formData = new FormData();
      formData.set('serviceNotificationChannelsJson', JSON.stringify(['SLACK']));
      formData.set('slackChannel', 'incident-alerts');
      for (const [key, value] of Object.entries(extra)) formData.set(key, value);
      return formData;
    };
    const savedData = () =>
      (mocks.serviceUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data;

    it('encrypts a new webhook before it is stored and never audits the value', async () => {
      await updateServiceNotificationSettings('svc-1', slackForm({ slackWebhookUrl: webhook }));

      expect(mocks.storeSlackWebhookUrl).toHaveBeenCalledWith(webhook);
      expect(savedData().slackWebhookUrl).toBe(`v3:k1:${webhook.length}`);
      expect(JSON.stringify(mocks.logAudit.mock.calls)).not.toContain('topsecretvalue');
    });

    it('keeps the stored webhook when the field is left empty, because the form never shows it', async () => {
      await updateServiceNotificationSettings('svc-1', slackForm({ slackWebhookUrl: '' }));

      expect('slackWebhookUrl' in savedData()).toBe(false);
      expect(mocks.storeSlackWebhookUrl).not.toHaveBeenCalled();
    });

    it('removes the stored webhook only when the remove box is ticked', async () => {
      await updateServiceNotificationSettings(
        'svc-1',
        slackForm({ slackWebhookUrl: '', clearSlackWebhookUrl: 'true' })
      );

      expect(savedData().slackWebhookUrl).toBeNull();
    });

    it('saves nothing when the webhook cannot be encrypted', async () => {
      mocks.storeSlackWebhookUrl.mockRejectedValue(new Error('ENCRYPTION_KEY not configured'));

      await updateServiceNotificationSettings('svc-1', slackForm({ slackWebhookUrl: webhook }));

      expect(mocks.redirect).toHaveBeenCalledWith(
        '/services/svc-1?tab=notifications&error=slack-webhook-encryption'
      );
      expect(mocks.serviceUpdate).not.toHaveBeenCalled();
    });
  });
});
