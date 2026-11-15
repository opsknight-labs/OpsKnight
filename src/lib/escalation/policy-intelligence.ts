import 'server-only';
import prisma from '@/lib/prisma';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import {
  enabledOpsInsightAreas,
  type OpsInsightView,
} from '@/lib/intelligence/ops-insights/contract';
import { listInsightsForScope } from '@/lib/intelligence/ops-insights/view';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import { ackMinutesQuantile, loadPolicyStepOutcomes } from './step-outcomes';

/** One line per step on the Steps tab: how often the step was acknowledged and how fast. */
export interface PolicyStepStat {
  /** Pages that reached someone at this step in the last 30 days. */
  paged: number;
  /** Share of those pages acknowledged at this step, 0..1. */
  ackRate: number;
  /** Median acknowledgement time in minutes (an upper bound from the rollup buckets); null without acks. */
  medianAckMinutes: number | null;
}

export interface PolicyIntelligence {
  insights: OpsInsightView[];
  /** Keyed by step id; steps nobody was paged at are absent. */
  stepStats: Record<string, PolicyStepStat>;
  canDecide: boolean;
}

const EMPTY: PolicyIntelligence = { insights: [], stepStats: {}, canDecide: false };

/**
 * Everything the policy page shows from operations insights: stored insights (scoped by the policy read
 * permission inside `listInsightsForScope`) and the per-step strip from the daily rollup. Empty, at the
 * cost of one settings read, while escalation insights are off. Bounded: one insight read, one rollup read.
 */
export async function loadPolicyIntelligence(
  actor: AuthorizationActor,
  policy: { id: string; steps: ReadonlyArray<{ id: string }> },
  now: Date = new Date()
): Promise<PolicyIntelligence> {
  const canRead =
    actor.status === 'ACTIVE' &&
    authorize({ actor, action: AUTHORIZATION_ACTIONS.ESCALATION_POLICY_READ }).allowed;
  if (!canRead) return EMPTY;
  if (!enabledOpsInsightAreas(await getIntelligenceSettings(prisma)).includes('escalation'))
    return EMPTY;
  const insights = await listInsightsForScope(actor, { type: 'POLICY', id: policy.id });
  const { steps } = await loadPolicyStepOutcomes(policy.id, now);
  const stepStats: Record<string, PolicyStepStat> = {};
  for (const outcome of steps) {
    const step = policy.steps.at(outcome.step);
    if (!step || outcome.paged === 0) continue;
    stepStats[step.id] = {
      paged: outcome.paged,
      ackRate: outcome.acked / outcome.paged,
      medianAckMinutes: ackMinutesQuantile(outcome, 0.5),
    };
  }
  return {
    insights,
    stepStats,
    canDecide: hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK),
  };
}
