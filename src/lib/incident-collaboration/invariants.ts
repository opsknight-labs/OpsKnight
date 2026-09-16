/**
 * Collaboration Platform Invariants Contract
 *
 * Formal specification of the architectural invariants governing incident
 * war rooms, native meeting bridges, and ChatOps projections.
 *
 * Architecture and integration test suites explicitly verify the system against
 * these invariants (I1 through I15).
 */

export const COLLABORATION_INVARIANTS = {
  I1: 'An incident generation can have at most one effective meeting provisioning owner.',
  I2: 'A provider/generation can never produce duplicate war-room resources because of retries or concurrent callers.',
  I3: 'A stale job may never mutate a newer generation.',
  I4: 'CLOSED/CLOSING always wins over an in-flight provision.',
  I5: 'A provider failure never rolls back a successful resource from another provider.',
  I6: 'The incident read path performs no synchronous external provider calls.',
  I7: 'Manual creation and automatic creation use the exact same effective provider policy.',
  I8: 'Explicitly unavailable providers never silently fall back to another provider.',
  I9: 'There is one canonical meeting per incident generation.',
  I10: 'Every active room projects the same canonical meeting.',
  I11: 'Lifecycle side effects are retry-safe and idempotent.',
  I12: 'External cleanup failures remain observable and repairable.',
  I13: 'Provider #N cannot bypass RBAC or policy through a legacy endpoint.',
  I14: 'No operational metric uses high-cardinality identifiers.',
  I15: 'Existing/history rooms remain observable after provider configuration changes.',
} as const;

export type CollaborationInvariantKey = keyof typeof COLLABORATION_INVARIANTS;

export interface InvariantEvaluation {
  invariant: CollaborationInvariantKey;
  description: string;
  satisfied: boolean;
  violationReason?: string;
  evidence?: Record<string, unknown>;
}

/**
 * Predicates for programmatic verification of invariant compliance.
 */
export const InvariantPredicates = {
  /**
   * I1: Incident generation has at most one effective meeting provisioning owner.
   */
  hasSingleMeetingOwner(tokens: Array<string | null | undefined>): boolean {
    const definedTokens = tokens.filter((t): t is string => Boolean(t));
    const uniqueTokens = new Set(definedTokens);
    return uniqueTokens.size <= 1;
  },

  /**
   * I3: Check that job generation matches active generation.
   */
  isJobGenerationFresh(jobGeneration: number, activeGeneration: number): boolean {
    return jobGeneration === activeGeneration;
  },

  /**
   * I4: Closed or closing state takes precedence over provisioned state.
   */
  doesClosedTakePrecedence(targetState: string, existingState: string): boolean {
    if (existingState === 'CLOSED' || existingState === 'CLOSING') {
      return targetState === 'CLOSED' || targetState === 'CLOSING';
    }
    return true;
  },

  /**
   * I9: Single canonical meeting per generation.
   */
  isSingleMeetingPerGeneration(meetingsCount: number): boolean {
    return meetingsCount <= 1;
  },

  /**
   * I10: All active rooms reference identical canonical meeting URL.
   */
  doAllRoomsProjectCanonicalMeeting(
    roomMeetingUrls: string[],
    canonicalMeetingUrl: string | null
  ): boolean {
    if (!canonicalMeetingUrl) {
      return roomMeetingUrls.length === 0 || roomMeetingUrls.every(u => !u);
    }
    return roomMeetingUrls.every(u => u === canonicalMeetingUrl);
  },

  /**
   * I14: Guard that metric labels do not contain forbidden high-cardinality keys.
   */
  isMetricLabelSetAllowed(labels: readonly string[]): boolean {
    const FORBIDDEN_HIGH_CARDINALITY_LABELS = new Set([
      'incidentid',
      'meetingid',
      'warroomid',
      'userid',
      'user_id',
      'channelid',
      'channel_id',
      'tenantid',
      'tenant_id',
      'email',
      'providermeetingid',
      'provider_meeting_id',
      'token',
      'provisioningtoken',
    ]);
    return !labels.some(l => FORBIDDEN_HIGH_CARDINALITY_LABELS.has(l.toLowerCase()));
  },
};
