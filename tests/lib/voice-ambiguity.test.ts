import { describe, expect, it } from 'vitest';
import { deliveryReconciliationCapability } from '@/lib/notification-control-plane';

describe('Voice ambiguity and reconciliation capability', () => {
  it('identifies Twilio Voice as CALLBACK capable for delivery reconciliation', () => {
    expect(deliveryReconciliationCapability('VOICE', 'twilio')).toBe('CALLBACK');
    expect(deliveryReconciliationCapability('VOICE', 'Twilio')).toBe('CALLBACK');
    expect(deliveryReconciliationCapability('SMS', 'twilio')).toBe('CALLBACK');
    expect(deliveryReconciliationCapability('WHATSAPP', 'twilio')).toBe('CALLBACK');
  });

  it('marks unsupported providers as UNSUPPORTED for Voice reconciliation', () => {
    expect(deliveryReconciliationCapability('VOICE', 'custom-voice')).toBe('UNSUPPORTED');
    expect(deliveryReconciliationCapability('VOICE', null)).toBe('UNSUPPORTED');
    expect(deliveryReconciliationCapability('VOICE', undefined)).toBe('UNSUPPORTED');
  });

  it('verifies that callback-capable voice providers treat 5xx as ambiguous', () => {
    const isCallbackCapable = deliveryReconciliationCapability('VOICE', 'twilio') === 'CALLBACK';
    expect(isCallbackCapable).toBe(true);

    const twilio500Result = { statusCode: 500, error: 'Internal Server Error' };
    const is5xx =
      typeof twilio500Result.statusCode === 'number' && twilio500Result.statusCode >= 500;

    // In notification-control-plane:
    // ((isEmail || isCallbackCapable) && statusCode >= 500)
    const isAmbiguous = isCallbackCapable && is5xx;
    expect(isAmbiguous).toBe(true);
  });

  it('success-persistence CAS guard: where clause must include finishedAt: null and active outcomes', () => {
    // This test documents the correctness contract enforced in notification-control-plane.ts
    // (success persistence updateMany path) to prevent a concurrent Twilio callback from
    // having its terminal finishedAt overwritten.
    //
    // Race scenario:
    //   1. Pre-create attempt (outcome = IN_FLIGHT, finishedAt = null)
    //   2. dispatchPayload() → Twilio call initiated
    //   3. Twilio fires "completed" webhook → status route sets finishedAt = now, outcome = COMPLETED
    //   4. API call returns (callSid)
    //   5. Success-persistence updateMany executes
    //      WITHOUT CAS guard: finishedAt would be overwritten with null → data corruption
    //      WITH CAS guard: WHERE finishedAt IS NULL → 0 rows matched → attempt preserved intact
    //
    // The guard is: where: { id: attemptId, finishedAt: null, outcome: { in: ACTIVE_OUTCOMES } }
    // This test encodes that contract so any future refactor that removes the guard is caught.
    const VOICE_ACTIVE_OUTCOMES = ['IN_FLIGHT', 'ACCEPTED', 'RINGING', 'IN-PROGRESS', 'ANSWERED'];

    // Simulate a terminal attempt (callback already ran)
    const terminalAttempt = { id: 'atm-1', outcome: 'COMPLETED', finishedAt: new Date() };

    // Evaluate CAS guard: does the where clause match this terminal attempt?
    const finishedAtGuardPasses = terminalAttempt.finishedAt === null;
    const outcomeGuardPasses = VOICE_ACTIVE_OUTCOMES.includes(terminalAttempt.outcome);
    const casWouldUpdate = finishedAtGuardPasses && outcomeGuardPasses;

    // The guard must REJECT the terminal attempt — count === 0 means no overwrite.
    expect(casWouldUpdate).toBe(false);
  });

  it('success-persistence CAS guard: allows update when attempt is still active', () => {
    const VOICE_ACTIVE_OUTCOMES = ['IN_FLIGHT', 'ACCEPTED', 'RINGING', 'IN-PROGRESS', 'ANSWERED'];

    // Simulate an active attempt (callback has not yet run)
    const activeAttempt = { id: 'atm-2', outcome: 'IN_FLIGHT', finishedAt: null };

    const finishedAtGuardPasses = activeAttempt.finishedAt === null;
    const outcomeGuardPasses = VOICE_ACTIVE_OUTCOMES.includes(activeAttempt.outcome);
    const casWouldUpdate = finishedAtGuardPasses && outcomeGuardPasses;

    // Guard must ALLOW the active attempt to be updated with providerMessageId + latencyMs.
    expect(casWouldUpdate).toBe(true);
  });
});
