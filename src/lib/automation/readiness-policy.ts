import { z } from 'zod/v3';

export const automationReadinessPolicySchema = z
  .object({
    minimumEvaluations: z.number().int().min(1).max(1_000_000),
    maximumEvidenceAgeHours: z.number().int().min(24).max(168),
    maximumPendingObservations: z.number().int().min(0).max(1000),
    maximumErrorRate: z.number().min(0).max(1),
  })
  .strict();
export type AutomationReadinessPolicy = z.infer<typeof automationReadinessPolicySchema>;
export const READINESS_BACKLOG_SETTING =
  'Settings → System → Automation → Shadow readiness → Maximum pending observations';

/** Why the backlog check blocks: how many are waiting (the count stops once past the limit), the limit, and where to change it. */
export function describeObservationBacklog(pending: number, limit: number): string {
  return `Candidate observation backlog exceeds the readiness policy: at least ${pending} ${pending === 1 ? 'observation is' : 'observations are'} pending or running and the policy allows ${limit}. Wait for the worker to finish, or raise the limit under ${READINESS_BACKLOG_SETTING}.`;
}

/** Conservative review floor, not a claim of workload representativeness. */
export const DEFAULT_AUTOMATION_READINESS_POLICY: AutomationReadinessPolicy = {
  minimumEvaluations: 100,
  maximumEvidenceAgeHours: 48,
  maximumPendingObservations: 0,
  maximumErrorRate: 0,
};
