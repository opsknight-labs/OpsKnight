import type { NotificationChannel } from '@prisma/client';

export const SERVICE_NOTIFICATION_CHANNEL_VALUES = [
  'SLACK',
  'WEBHOOK',
  'EMAIL',
  'SMS',
  'PUSH',
  'WHATSAPP',
  'MICROSOFT_TEAMS',
] as const satisfies readonly NotificationChannel[];

const SERVICE_NOTIFICATION_CHANNELS = new Set<NotificationChannel>(SERVICE_NOTIFICATION_CHANNEL_VALUES);

/** The only service-level channels the dispatcher sends to. The others can still be stored (legacy rows) but never deliver. */
export const SERVICE_DISPATCHABLE_CHANNEL_VALUES = [
  'SLACK',
  'WEBHOOK',
  'MICROSOFT_TEAMS',
] as const satisfies readonly NotificationChannel[];

export const SERVICE_CHANNEL_UNSUPPORTED_MESSAGE =
  'Service-level channels support Slack, Teams and webhooks only; use escalation policies or user preferences for email, SMS, push and WhatsApp.';

const DISPATCHABLE = new Set<string>(SERVICE_DISPATCHABLE_CHANNEL_VALUES);

export function isDispatchableServiceChannel(channel: string): boolean {
  return DISPATCHABLE.has(channel);
}

/** Channels in `channels` that a service never sends to (EMAIL, SMS, PUSH, WHATSAPP). */
export function unsupportedServiceChannels(channels: readonly string[]): string[] {
  return channels.filter(channel => !DISPATCHABLE.has(channel));
}

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
