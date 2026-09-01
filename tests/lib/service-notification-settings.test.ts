import { describe, expect, it } from 'vitest';
import { parseServiceNotificationChannels } from '@/lib/service-notification-settings';

describe('parseServiceNotificationChannels', () => {
  it('treats an explicitly empty channel snapshot as disabling every channel', () => {
    const formData = new FormData();
    formData.set('serviceNotificationChannelsJson', '[]');
    formData.append('serviceNotificationChannels', 'SLACK');

    expect(parseServiceNotificationChannels(formData)).toEqual([]);
  });

  it('uses the explicit snapshot and rejects unknown or duplicate channels', () => {
    const formData = new FormData();
    formData.set(
      'serviceNotificationChannelsJson',
      JSON.stringify(['WEBHOOK', 'SLACK', 'SLACK', 'UNKNOWN'])
    );

    expect(parseServiceNotificationChannels(formData)).toEqual(['WEBHOOK', 'SLACK']);
  });

  it('accepts the legacy checkbox fields during a rolling deployment', () => {
    const formData = new FormData();
    formData.append('serviceNotificationChannels', 'SLACK');
    formData.append('serviceNotificationChannels', 'WEBHOOK');

    expect(parseServiceNotificationChannels(formData)).toEqual(['SLACK', 'WEBHOOK']);
  });

  it('fails closed when the explicit snapshot is malformed', () => {
    const formData = new FormData();
    formData.set('serviceNotificationChannelsJson', '{bad json');
    formData.append('serviceNotificationChannels', 'SLACK');

    expect(parseServiceNotificationChannels(formData)).toEqual([]);
  });
});
