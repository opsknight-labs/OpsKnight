import { runSerializableTransaction } from '../db-utils';

export type EscalationFallbackDisposition =
  | { kind: 'RETRY_SCHEDULED'; retryAt: Date }
  | { kind: 'RETRYABLE_FAILURE' }
  | { kind: 'TERMINAL_FAILURE'; message: string };

/**
 * Persists the state-driven fallback scanner's recovery decision through one
 * generation/step-fenced transaction. The scanner is deliberately read/orchestration
 * only: it must never become a second escalation state machine.
 */
export async function settleEscalationFallbackOutcome(input: {
  incidentId: string;
  expectedGeneration: number;
  expectedStep: number | null;
  disposition: EscalationFallbackDisposition;
}): Promise<boolean> {
  return runSerializableTransaction(async tx => {
    const current = await tx.incident.findUnique({
      where: { id: input.incidentId },
      select: {
        status: true,
        escalationGeneration: true,
        currentEscalationStep: true,
      },
    });

    if (
      !current ||
      current.status !== 'OPEN' ||
      (current.escalationGeneration ?? 0) !== input.expectedGeneration ||
      current.currentEscalationStep !== input.expectedStep
    ) {
      return false;
    }

    if (input.disposition.kind === 'TERMINAL_FAILURE') {
      const message = input.disposition.message.replace(/[\r\n\t]+/g, ' ').slice(0, 1000);
      await tx.incident.update({
        where: { id: input.incidentId },
        data: {
          escalationStatus: 'FAILED',
          nextEscalationAt: null,
          escalationProcessingAt: null,
        },
      });
      await tx.incidentEvent.create({
        data: {
          incidentId: input.incidentId,
          message: `Escalation processing failed (FATAL): ${message}`,
        },
      });
      return true;
    }

    await tx.incident.update({
      where: { id: input.incidentId },
      data:
        input.disposition.kind === 'RETRY_SCHEDULED'
          ? {
              escalationStatus: 'ESCALATING',
              nextEscalationAt: input.disposition.retryAt,
              escalationProcessingAt: null,
            }
          : { escalationProcessingAt: null },
    });
    return true;
  });
}
