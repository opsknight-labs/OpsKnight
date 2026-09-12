import type { NotificationChannel } from '@prisma/client';

export const DEFAULT_BULK_SHARE = 0.8; // 80%
export const DEFAULT_BULK_QUEUE_LOW_WATERMARK = 5_000;
export const DEFAULT_BULK_QUEUE_HIGH_WATERMARK = 25_000;
export const DEFAULT_QUOTA_BLOCK_SIZE = 100;
export const DEFAULT_ADAPTIVE_BACKPRESSURE = true;

export function defaultRate(channel: NotificationChannel): number {
  switch (channel) {
    case 'EMAIL':
      return 8;
    case 'SMS':
      return 20;
    case 'WHATSAPP':
      return 50;
    case 'PUSH':
      return 100;
    case 'SLACK':
      return 1;
    case 'WEBHOOK':
      return 20;
    default:
      return 10;
  }
}

export function defaultInFlight(channel: NotificationChannel): number {
  switch (channel) {
    case 'EMAIL':
      return 5;
    case 'SMS':
      return 10;
    case 'WHATSAPP':
      return 10;
    case 'PUSH':
      return 20;
    case 'SLACK':
      return 2;
    case 'WEBHOOK':
      return 10;
    default:
      return 5;
  }
}
