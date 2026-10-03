import { describe, expect, it } from 'vitest';
import { agentSupportsStep, retryDelayMs, stepRequiresApproval } from '@/lib/runbooks/safety';

describe('runbook safety policy', () => {
  it('always requires approval for non-idempotent work', () => {
    expect(
      stepRequiresApproval({
        type: 'HTTP',
        riskClass: 'NON_IDEMPOTENT',
        requiresApproval: false,
      })
    ).toBe(true);
  });

  it('does not allow an Agent without the step capability to claim work', () => {
    expect(agentSupportsStep(['RUNBOOK_DOCKER'], 'KUBERNETES')).toBe(false);
    expect(agentSupportsStep(['RUNBOOK_KUBERNETES'], 'KUBERNETES')).toBe(true);
    expect(agentSupportsStep(['*'], 'BASH')).toBe(true);
  });

  it('uses bounded exponential retry backoff', () => {
    expect(retryDelayMs(1)).toBe(1_000);
    expect(retryDelayMs(4)).toBe(8_000);
    expect(retryDelayMs(20)).toBe(60_000);
  });
});
