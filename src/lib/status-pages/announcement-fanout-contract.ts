import 'server-only';

export const STATUS_PAGE_ANNOUNCEMENT_FANOUT_V1 = 'STATUS_PAGE_ANNOUNCEMENT_FANOUT' as const;
export const STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2 = 'STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2' as const;

export const STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PENDING = 'PENDING_V2' as const;
export const STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PROCESSING = 'PROCESSING_V2' as const;

export type AnnouncementFanoutDeliveryMode = 'ALL_ELIGIBLE' | 'UNDELIVERED_ONLY';

export function isAnnouncementFanoutDeliveryMode(
  value: unknown
): value is AnnouncementFanoutDeliveryMode {
  return value === 'ALL_ELIGIBLE' || value === 'UNDELIVERED_ONLY';
}
