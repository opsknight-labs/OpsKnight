import { describe, expect, it } from 'vitest';
import {
  EscalationPolicyCreateV2Schema,
  EscalationPolicyUpdateV2Schema,
  EscalationStepSchema,
} from '@/lib/api-v2/validation';
import { MAX_ESCALATION_DELAY_MINUTES } from '@/lib/escalation/policy-validation';

const step = { delayMinutes: 0, targetType: 'USER' as const, targetId: 'user-1' };

describe('API v2 escalation step delay', () => {
  it('accepts every delay the UI and the database accept, so a UI policy round-trips', () => {
    // Two days: valid in the UI and the DB CHECK, but above the old API limit of 1440.
    expect(EscalationStepSchema.safeParse({ ...step, delayMinutes: 2 * 24 * 60 }).success).toBe(
      true
    );
    expect(
      EscalationStepSchema.safeParse({ ...step, delayMinutes: MAX_ESCALATION_DELAY_MINUTES })
        .success
    ).toBe(true);
  });

  it('still rejects a delay above the shared limit', () => {
    expect(
      EscalationStepSchema.safeParse({
        ...step,
        delayMinutes: MAX_ESCALATION_DELAY_MINUTES + 1,
      }).success
    ).toBe(false);
  });

  it('keeps the policy schemas on the same step schema', () => {
    const body = { steps: [{ ...step, delayMinutes: 7200 }] };
    expect(EscalationPolicyUpdateV2Schema.safeParse(body).success).toBe(true);
    expect(EscalationPolicyCreateV2Schema.safeParse({ name: 'Core', ...body }).success).toBe(true);
  });
});
