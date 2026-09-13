export type AnnouncementNotificationTiming = 'ON_PUBLISH' | 'AT_START' | 'NONE';

export interface AnnouncementNotificationPlanInput {
  isActive: boolean;
  notificationTiming: AnnouncementNotificationTiming;
  publishAt: Date;
  startDate: Date;
}

export interface AnnouncementNotificationPlan {
  shouldNotify: boolean;
  scheduledAt: Date | null;
}

/**
 * Canonical scheduling contract for status-page announcement subscriber fan-out.
 * Mutation routes and execution fences must derive behavior from this helper.
 *
 * AT_START means "when the event starts, once the announcement is published".
 * A future publishAt therefore pushes the notification forward rather than
 * allowing subscriber delivery before the announcement is publicly eligible.
 */
export function deriveAnnouncementNotificationPlan(
  input: AnnouncementNotificationPlanInput
): AnnouncementNotificationPlan {
  if (!input.isActive || input.notificationTiming === 'NONE') {
    return { shouldNotify: false, scheduledAt: null };
  }

  return {
    shouldNotify: true,
    scheduledAt:
      input.notificationTiming === 'AT_START'
        ? new Date(Math.max(input.startDate.getTime(), input.publishAt.getTime()))
        : input.publishAt,
  };
}
