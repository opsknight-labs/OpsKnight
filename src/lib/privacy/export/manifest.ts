import 'server-only';

import { APP_VERSION } from '@/lib/version';

export const EXPORT_FORMAT_VERSION = 1;

export const INCLUDED_DOMAINS = [
  'profile',
  'identities',
  'memberships',
  'incidents',
  'incident-notes',
  'schedules',
  'notifications',
  'audit-events',
] as const;

/** Kept in sync with discoverSubjectData()'s documented discovery limitations. */
export const EXCLUDED_DOMAINS = [
  'status-page-subscribers (no verified user relation)',
  'external identity/delivery/ChatOps/ticketing provider data',
  'application and infrastructure logs',
  'free-text fields outside the domains above (e.g. incident descriptions)',
] as const;

export const SECURITY_EXCLUSIONS = [
  'password hashes',
  'API keys and secrets',
  'session and refresh tokens',
  'push/device notification tokens',
  'OIDC/OAuth client secrets',
  'webhook signing secrets',
  'encrypted credential and payload blobs',
  'email/SMS verification tokens',
] as const;

export interface ExportDomainSummary {
  domain: string;
  exportedCount: number;
  totalCount: number;
  truncated: boolean;
}

export interface ExportManifestInput {
  requestId: string;
  subjectType: string;
  subjectId: string;
  generatedAt: Date;
  domainSummary: ExportDomainSummary[];
}

export function buildManifest(input: ExportManifestInput) {
  const truncated = input.domainSummary.some(domain => domain.truncated);
  return {
    exportVersion: EXPORT_FORMAT_VERSION,
    generatedAt: input.generatedAt.toISOString(),
    privacyRequestId: input.requestId,
    subject: { type: input.subjectType, id: input.subjectId },
    opsknightVersion: APP_VERSION,
    includedDomains: INCLUDED_DOMAINS,
    excludedDomains: EXCLUDED_DOMAINS,
    securityExclusions: SECURITY_EXCLUSIONS,
    // Per-domain counts so a partial export can never be mistaken for a
    // complete one — each file also carries its own totalCount/truncated.
    domainSummary: input.domainSummary,
    completeness: truncated ? 'PARTIAL' : 'COMPLETE',
    limitations: [
      'This export reflects direct database relations only; it is not a guarantee of completeness.',
      'Security credentials (see securityExclusions) are intentionally excluded from every export.',
      'A missing or empty domain does not prove the absence of related data.',
      ...(truncated
        ? [
            'One or more domains exceeded the per-export safety limit and were truncated; see domainSummary for exact counts. This export is PARTIAL, not complete.',
          ]
        : []),
    ],
  };
}

export type ExportManifest = ReturnType<typeof buildManifest>;
