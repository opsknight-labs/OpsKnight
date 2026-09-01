import type { NotificationChannel } from '@prisma/client';

const SERVICE_NOTIFICATION_CHANNELS = new Set<NotificationChannel>([
  'SLACK',
  'WEBHOOK',
  'EMAIL',
  'SMS',
  'PUSH',
  'WHATSAPP',
]);

export function parseServiceNotificationChannels(formData: FormData): NotificationChannel[] {
  const serializedChannels = formData.get('serviceNotificationChannelsJson');
  let submittedChannels: unknown[];

  if (typeof serializedChannels === 'string') {
    try {
      const parsed: unknown = JSON.parse(serializedChannels);
      submittedChannels = Array.isArray(parsed) ? parsed : [];
    } catch {
      submittedChannels = [];
    }
  } else {
    // Compatibility with forms submitted by an older frontend during a rolling deployment.
    submittedChannels = formData.getAll('serviceNotificationChannels');
  }

  return [...new Set(submittedChannels.map(String))].filter((value): value is NotificationChannel =>
    SERVICE_NOTIFICATION_CHANNELS.has(value as NotificationChannel)
  );
}
