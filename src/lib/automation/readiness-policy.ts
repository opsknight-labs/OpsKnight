import { z } from 'zod';

export const automationReadinessPolicySchema = z
  .object({
    minimumEvaluations: z.number().int().min(1).max(1_000_000),
    maximumEvidenceAgeHours: z.number().int().min(24).max(168),
    maximumPendingObservations: z.number().int().min(0).max(1000),
    maximumErrorRate: z.number().min(0).max(1),
  })
  .strict();
export type AutomationReadinessPolicy = z.infer<typeof automationReadinessPolicySchema>;
/** Conservative review floor, not a claim of workload representativeness. */
export const DEFAULT_AUTOMATION_READINESS_POLICY: AutomationReadinessPolicy = {
  minimumEvaluations: 100,
  maximumEvidenceAgeHours: 48,
  maximumPendingObservations: 0,
  maximumErrorRate: 0,
};
