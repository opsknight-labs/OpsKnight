import 'server-only';

/**
 * Erasure strategy per data domain. This is the authoritative classification
 * for what happens to a domain's rows when a subject is erased — separate
 * from (but informed by) src/lib/users/reference-policy.ts, which documents
 * ordinary account deletion/deactivation, not GDPR-style erasure.
 *
 * - DELETE:    the row itself is removed.
 * - ANONYMIZE: the row survives, but is stripped of anything identifying the
 *              subject (the row keeps its operational value — e.g. an
 *              incident's timestamps/SLA — the subject reference does not).
 * - DETACH:    the row survives unmodified except the subject reference is
 *              cleared (content itself isn't "about" the subject).
 * - PRESERVE:  untouched. Reserved for records whose integrity/history value
 *              always outweighs the subject reference (SLA math, metrics).
 * - REVIEW:    not automated; a human must resolve this before erasure can run.
 */
export const ERASURE_STRATEGIES = ['DELETE', 'ANONYMIZE', 'DETACH', 'PRESERVE', 'REVIEW'] as const;
export type ErasureStrategy = (typeof ERASURE_STRATEGIES)[number];

export interface ErasureDomain {
  /** Stable id, also used as the domainSummary key in plans/executions. */
  id: string;
  label: string;
  strategy: ErasureStrategy;
  /** True if this domain, if non-empty, blocks automated erasure until an admin resolves it. */
  blocking: boolean;
  notes: string;
}

/**
 * Every domain here is either DELETE/ANONYMIZE/DETACH-executed by
 * execute.ts, or (blocking: true) surfaced as a blocking condition that must
 * be resolved elsewhere before erasure can run. Historical incident data
 * (SLA timestamps, MTTA/MTTR, event types, postmortems) is PRESERVE — never
 * touched — matching the Phase 3 requirement that erasure must not corrupt
 * operational history.
 *
 * NOTE on schema reality vs documentation: src/lib/users/reference-policy.ts
 * (USER_REFERENCE_POLICY) documents *intended* FK dispositions, but several
 * FKs are still ON DELETE RESTRICT in the applied migrations even though
 * schema.prisma's `@relation` annotation now reads `onDelete: SetNull`
 * (verified against prisma/migrations/*.sql, not just schema.prisma) —
 * OidcConfig.updatedBy and SlackIntegration.installedBy are the known cases.
 * execute.ts therefore never *relies* on the DB cascading/nulling a FK it
 * hasn't explicitly handled; every DELETE/ANONYMIZE/DETACH domain below is
 * processed explicitly before the User row itself is deleted.
 */
export const ERASURE_DOMAIN_POLICY: readonly ErasureDomain[] = [
  // --- Account / identity: DELETE ---
  {
    id: 'userProfile',
    label: 'User profile',
    strategy: 'DELETE',
    blocking: false,
    notes: 'The User row itself.',
  },
  {
    id: 'userAvatar',
    label: 'Avatar image',
    strategy: 'DELETE',
    blocking: false,
    notes: 'Cascades with the user row.',
  },
  {
    id: 'oidcIdentities',
    label: 'OIDC identities',
    strategy: 'DELETE',
    blocking: false,
    notes: 'Cascades with the user row.',
  },
  {
    id: 'oidcLinkingApproval',
    label: 'OIDC linking approval',
    strategy: 'DELETE',
    blocking: false,
    notes: 'Cascades with the user row.',
  },
  {
    id: 'apiKeys',
    label: 'API keys',
    strategy: 'DELETE',
    blocking: false,
    notes: 'Cascades with the user row.',
  },
  {
    id: 'userDevices',
    label: 'Push notification devices',
    strategy: 'DELETE',
    blocking: false,
    notes: 'Cascades with the user row.',
  },
  {
    id: 'userTokens',
    label: 'Security tokens (invite/reset/admin-reset)',
    strategy: 'DELETE',
    blocking: false,
    notes: 'Deleted explicitly by userId and by email identifier.',
  },
  {
    id: 'dashboards',
    label: 'Personal dashboards',
    strategy: 'DELETE',
    blocking: false,
    notes: 'Cascades with the user row.',
  },
  {
    id: 'teamMemberships',
    label: 'Team memberships',
    strategy: 'DELETE',
    blocking: false,
    notes: 'ON DELETE RESTRICT in practice — deleted explicitly before the user row.',
  },
  {
    id: 'incidentWatchers',
    label: 'Incident watch subscriptions',
    strategy: 'DELETE',
    blocking: false,
    notes: 'ON DELETE RESTRICT in practice — deleted explicitly before the user row.',
  },

  // --- Scheduling: DELETE (no anonymous-coverage placeholder exists yet) ---
  {
    id: 'onCallShifts',
    label: 'Historical on-call shifts',
    strategy: 'DELETE',
    blocking: false,
    notes:
      'ON DELETE RESTRICT. No anonymous-actor placeholder exists for schedule rows in this schema version, so erasure removes them outright rather than leaving an orphaned coverage record.',
  },
  {
    id: 'onCallLayerAssignments',
    label: 'Recurring rotation layer membership',
    strategy: 'DELETE',
    blocking: true,
    notes:
      'ON DELETE RESTRICT. Non-empty means the subject is still on an active rotation — blocking.',
  },
  {
    id: 'onCallOverrides',
    label: 'On-call overrides (recipient or replaced)',
    strategy: 'DELETE',
    blocking: true,
    notes: 'ON DELETE RESTRICT. Future/active overrides referencing the subject are blocking.',
  },

  // --- Attribution on shared/global config: DETACH ---
  {
    id: 'oidcConfigAttribution',
    label: 'OIDC config "last updated by"',
    strategy: 'DETACH',
    blocking: false,
    notes:
      'Nulled explicitly — the constraint is RESTRICT in applied migrations regardless of schema.prisma text.',
  },
  {
    id: 'slackIntegrationAttribution',
    label: 'Slack integration "installed by"',
    strategy: 'DETACH',
    blocking: false,
    notes:
      'Nulled explicitly — the constraint is RESTRICT in applied migrations regardless of schema.prisma text.',
  },
  {
    id: 'slackOAuthConfigAttribution',
    label: 'Slack OAuth config "last updated by"',
    strategy: 'DETACH',
    blocking: false,
    notes: 'DB-level SetNull; included for completeness.',
  },
  {
    id: 'notificationProviderAttribution',
    label: 'Notification provider "last updated by"',
    strategy: 'DETACH',
    blocking: false,
    notes: 'DB-level SetNull.',
  },
  {
    id: 'microsoftTeamsAttribution',
    label: 'Microsoft Teams config/installation/destination attribution',
    strategy: 'DETACH',
    blocking: false,
    notes: 'DB-level SetNull.',
  },
  {
    id: 'teamLead',
    label: 'Team lead assignment',
    strategy: 'DETACH',
    blocking: false,
    notes: 'DB-level SetNull.',
  },

  // --- Incident-adjacent content authored by the subject: DETACH/ANONYMIZE ---
  {
    id: 'incidentNotes',
    label: 'Incident notes authored',
    strategy: 'DETACH',
    blocking: false,
    notes: 'Note content preserved; author reference nulled (DB-level SetNull).',
  },
  {
    id: 'postmortemsAuthored',
    label: 'Postmortems authored',
    strategy: 'DETACH',
    blocking: false,
    notes: 'DB-level SetNull.',
  },
  {
    id: 'incidentTemplatesAuthored',
    label: 'Incident templates authored',
    strategy: 'DETACH',
    blocking: false,
    notes: 'DB-level SetNull.',
  },
  {
    id: 'actionItemsOwned',
    label: 'Postmortem action items owned',
    strategy: 'DETACH',
    blocking: true,
    notes:
      'DB-level SetNull, but an OPEN action item with no other owner blocks erasure until reassigned.',
  },
  {
    id: 'assignedIncidents',
    label: 'Incident participation (assignee)',
    strategy: 'ANONYMIZE',
    blocking: true,
    notes:
      'DB-level SetNull preserves the incident + SLA math; an active (non-terminal) assigned incident blocks erasure until reassigned.',
  },
  {
    id: 'escalationOwnership',
    label: 'Escalation policy step ownership',
    strategy: 'REVIEW',
    blocking: true,
    notes:
      'Not automated — an escalation step must be reassigned by an admin; blocking until then.',
  },

  // --- Notifications: DELETE ---
  {
    id: 'notifications',
    label: 'Delivery attempt records',
    strategy: 'DETACH',
    blocking: false,
    notes:
      'DB-level SetNull; delivery history is operational, not personal once the recipient reference is gone.',
  },
  {
    id: 'inAppNotifications',
    label: 'In-app notifications',
    strategy: 'DELETE',
    blocking: false,
    notes: 'Cascades with the user row.',
  },

  // --- Preserved historical/operational data ---
  {
    id: 'slaTimestamps',
    label: 'SLA timestamps and calculations',
    strategy: 'PRESERVE',
    blocking: false,
    notes: 'Never touched. Lives on the Incident row, not on any User-referencing row.',
  },
  {
    id: 'metricsRollups',
    label: 'Metrics / rollups',
    strategy: 'PRESERVE',
    blocking: false,
    notes: 'Aggregate data; no direct subject reference.',
  },

  // --- Audit trail: ANONYMIZE in place (never deleted — audit history is immutable) ---
  {
    id: 'auditLogSnapshots',
    label: 'Audit log actor/target snapshots',
    strategy: 'ANONYMIZE',
    blocking: false,
    notes:
      'actorEmail/actorName/targetEmail are denormalized PII snapshots that outlive actorId (which is already DB-level SetNull). Erasure scrubs these three columns in place; the audit row, action, and timestamps are preserved.',
  },

  // --- Privacy request record itself ---
  {
    id: 'privacyRequestRecord',
    label: 'The privacy request record',
    strategy: 'PRESERVE',
    blocking: false,
    notes:
      'The PrivacyRequest row for this erasure is kept as the record that the request was fulfilled.',
  },
] as const;

export function getErasureDomain(id: string): ErasureDomain | undefined {
  return ERASURE_DOMAIN_POLICY.find(domain => domain.id === id);
}

export const BLOCKING_DOMAIN_IDS: readonly string[] = ERASURE_DOMAIN_POLICY.filter(
  domain => domain.blocking
).map(domain => domain.id);
