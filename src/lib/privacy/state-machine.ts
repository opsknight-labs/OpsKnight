import type { PrivacyRequestStatus } from '@prisma/client';

/** Shared client/server transition graph for privacy requests. */
export const PRIVACY_REQUEST_TRANSITIONS: Record<
  PrivacyRequestStatus,
  readonly PrivacyRequestStatus[]
> = {
  RECEIVED: ['IDENTITY_VERIFICATION', 'REJECTED'],
  IDENTITY_VERIFICATION: ['IN_REVIEW', 'BLOCKED', 'REJECTED'],
  IN_REVIEW: ['IDENTITY_VERIFICATION', 'PROCESSING', 'BLOCKED', 'REJECTED'],
  PROCESSING: ['IDENTITY_VERIFICATION', 'COMPLETED', 'BLOCKED', 'REJECTED'],
  BLOCKED: ['IDENTITY_VERIFICATION', 'IN_REVIEW', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
};
