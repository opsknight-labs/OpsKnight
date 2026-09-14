/**
 * Centralized Announcement Lifecycle Contract
 *
 * Provides a single, authoritative lifecycle function across admin views,
 * metrics counters, filter tabs, announcement cards, public display feeds,
 * previews, and subscriber notification eligibility.
 */

export type AnnouncementLifecycleStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'CONCLUDED';

export interface AnnouncementLifecycleInput {
  isActive?: boolean | null;
  startDate: string | Date;
  endDate?: string | Date | null;
  publishAt?: string | Date | null;
  now?: Date;
}

export interface AnnouncementLifecycleResult {
  status: AnnouncementLifecycleStatus;
  isDraft: boolean;
  isScheduled: boolean;
  isActive: boolean;
  isConcluded: boolean;
  isPublished: boolean;
  isPubliclyVisible: boolean;
  /** True when publishAt > now (held back from publication entirely) */
  isScheduledForPublication: boolean;
  /** True when publishAt <= now but startDate > now (published notice for an upcoming event window) */
  isPublishedUpcoming: boolean;
}

/**
 * Derives the canonical announcement lifecycle status.
 *
 * Rules:
 * 1. If isActive === false -> DRAFT.
 * 2. If publishAt > now -> SCHEDULED (scheduled for future publication).
 * 3. If startDate > now -> SCHEDULED (published or scheduled for upcoming window).
 * 4. If endDate && endDate <= now -> CONCLUDED.
 * 5. Otherwise -> ACTIVE.
 */
export function deriveAnnouncementLifecycle(
  input: AnnouncementLifecycleInput
): AnnouncementLifecycleResult {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();

  const isExplicitlyActive = input.isActive !== false;
  if (!isExplicitlyActive) {
    return {
      status: 'DRAFT',
      isDraft: true,
      isScheduled: false,
      isActive: false,
      isConcluded: false,
      isPublished: false,
      isPubliclyVisible: false,
      isScheduledForPublication: false,
      isPublishedUpcoming: false,
    };
  }

  const startDate = input.startDate instanceof Date ? input.startDate : new Date(input.startDate);
  const startMs = startDate.getTime();

  const endDate = input.endDate
    ? input.endDate instanceof Date
      ? input.endDate
      : new Date(input.endDate)
    : null;
  const endMs = endDate ? endDate.getTime() : null;

  const publishAt = input.publishAt
    ? input.publishAt instanceof Date
      ? input.publishAt
      : new Date(input.publishAt)
    : null;
  const publishMs = publishAt ? publishAt.getTime() : null;

  const isPublishInFuture = publishMs !== null && publishMs > nowMs;
  const isStartInFuture = !Number.isNaN(startMs) && startMs > nowMs;

  if (isPublishInFuture || isStartInFuture) {
    const isPublished = publishMs !== null ? publishMs <= nowMs : true;
    return {
      status: 'SCHEDULED',
      isDraft: false,
      isScheduled: true,
      isActive: false,
      isConcluded: false,
      isPublished,
      isPubliclyVisible: !isPublishInFuture,
      isScheduledForPublication: isPublishInFuture,
      isPublishedUpcoming: !isPublishInFuture && isStartInFuture,
    };
  }

  if (endMs !== null && !Number.isNaN(endMs) && endMs <= nowMs) {
    return {
      status: 'CONCLUDED',
      isDraft: false,
      isScheduled: false,
      isActive: false,
      isConcluded: true,
      isPublished: true,
      isPubliclyVisible: true,
      isScheduledForPublication: false,
      isPublishedUpcoming: false,
    };
  }

  return {
    status: 'ACTIVE',
    isDraft: false,
    isScheduled: false,
    isActive: true,
    isConcluded: false,
    isPublished: true,
    isPubliclyVisible: true,
    isScheduledForPublication: false,
    isPublishedUpcoming: false,
  };
}
