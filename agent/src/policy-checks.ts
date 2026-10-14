import { verifyExecutionEnvelope } from './envelope';
import { assertPolicyAllows } from './policy';
import type { AgentPolicy, ClaimedAttempt } from './types';
export type PolicyCheckEnvelope = {
  kind: 'POLICY_CHECK';
  id: string;
  signingAgentId: string;
  signature: string;
  signingKeyId?: string;
  executionDeadlineAt: string;
  leaseExpiresAt: string;
  steps: ClaimedAttempt['step'][];
};
/** This path never calls an executor, starts a job or grants operating-system permission. */
export function evaluatePolicyCheck(
  check: PolicyCheckEnvelope,
  policy: AgentPolicy,
  publicKey: string | Record<string, string>,
  agentId: string
) {
  verifyExecutionEnvelope(check, publicKey, agentId);
  if (check.kind !== 'POLICY_CHECK' || !Array.isArray(check.steps) || check.steps.length > 200)
    throw new Error('Invalid policy-check envelope.');
  return check.steps.map(step => {
    try {
      assertPolicyAllows(
        { step, inputValues: {}, secretInputKeys: [] } as unknown as ClaimedAttempt,
        policy
      );
      return { key: step.key, allowed: true };
    } catch {
      return { key: step.key, allowed: false };
    }
  });
}
