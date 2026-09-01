import { describe, expect, it } from 'vitest';
import { escalationNotificationRoute } from '@/lib/events';
import { ESCALATION_OUTCOMES, type EscalationOutcome } from '@/lib/escalation/types';

/**
 * The router must switch on the engine's typed outcome, never on a
 * human-readable reason string. Every outcome is listed explicitly so adding a
 * new one to the union forces a deliberate routing decision here.
 */
const EXPECTED_ROUTE: Record<EscalationOutcome, 'service' | 'fallback'> = {
  STEP_EXECUTED: 'service',
  STEP_SCHEDULED: 'service',
  COMPLETED: 'service',
  PAUSED: 'service',
  SUPERSEDED: 'service',
  ALREADY_CLAIMED: 'service',
  NO_INCIDENT: 'fallback',
  NO_POLICY: 'fallback',
  STEP_MISSING: 'fallback',
  INVALID_TARGET: 'fallback',
  NO_ELIGIBLE_RESPONDERS: 'fallback',
  RETRYABLE_FAILURE: 'fallback',
  TERMINAL_FAILURE: 'fallback',
};

describe('event escalation notification routing', () => {
  it('covers every outcome in the union', () => {
    expect(Object.keys(EXPECTED_ROUTE).sort()).toEqual([...ESCALATION_OUTCOMES].sort());
  });

  it.each(Object.entries(EXPECTED_ROUTE))(
    'routes outcome %s to %s notifications',
    (outcome, expected) => {
      expect(escalationNotificationRoute({ outcome: outcome as EscalationOutcome })).toBe(expected);
    }
  );

  it('falls back when no outcome is reported', () => {
    expect(escalationNotificationRoute({})).toBe('fallback');
  });

  it('ignores reason text entirely', () => {
    // A reason mentioning "scheduled" must not promote a fallback outcome.
    expect(
      escalationNotificationRoute({
        outcome: 'NO_POLICY',
        reason: 'Escalation scheduled and completed',
      } as Parameters<typeof escalationNotificationRoute>[0])
    ).toBe('fallback');
  });
});
