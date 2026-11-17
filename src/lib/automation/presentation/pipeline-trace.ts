/**
 * "Why did this route here?" — one trace across the two decisions an alert passes through: the noise-control
 * decision (pre-paging) and the automation route. Pure: built from stored rows, never from live state.
 */
export interface StoredNoiseDecision {
  control: string;
  action: string;
  mode: string;
  applied: boolean;
  reason: string;
  sourceName: string | null;
  reversedAt: Date | null;
  evidence: unknown;
}

export interface RouteTraceStep {
  stage: 'NOISE' | 'PIPELINE' | 'AUTOMATION';
  text: string;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function describeOutcome(value: unknown): string | null {
  const outcome = record(value);
  if (!outcome) return null;
  const route =
    outcome.route === 'NO_ESCALATION'
      ? 'no escalation'
      : outcome.route === 'ESCALATION_POLICY'
        ? 'a selected policy'
        : 'the service default';
  return `${route}, priority ${typeof outcome.priority === 'string' ? outcome.priority : 'unset'}`;
}

/** The pipeline part of a noise decision's evidence (J1.5), as plain sentences. */
export function describePipeline(evidence: unknown): RouteTraceStep[] {
  const pipeline = record(record(evidence)?.pipeline);
  if (!pipeline) return [];
  const steps: RouteTraceStep[] = [];
  const shadow = pipeline.order === 'SHADOW';
  const automation = pipeline.automation;
  if (automation === 'SKIPPED')
    steps.push({
      stage: 'PIPELINE',
      text: shadow
        ? 'With noise controls first, automation would not have run for this alert.'
        : 'Noise controls ran first; automation did no work for this alert.',
    });
  const compared = record(automation);
  if (shadow && compared && 'actual' in compared) {
    const before = describeOutcome(compared.actual);
    const after = describeOutcome(compared.noiseFirst);
    steps.push({
      stage: 'PIPELINE',
      text: !after
        ? 'Noise-first comparison was not available for this alert.'
        : compared.different
          ? `With noise controls first, automation would have chosen ${after} instead of ${before}.`
          : 'With noise controls first, automation would have decided the same.',
    });
  } else if (!shadow && compared) {
    steps.push({
      stage: 'PIPELINE',
      text: `Noise controls ran first; automation then chose ${describeOutcome(compared)}.`,
    });
  }
  const reroute = record(pipeline.reroute);
  if (reroute) {
    const target =
      typeof reroute.serviceName === 'string'
        ? `“${reroute.serviceName}”`
        : typeof reroute.serviceId === 'string'
          ? reroute.serviceId
          : 'another service';
    steps.push({
      stage: 'PIPELINE',
      text: shadow
        ? reroute.wouldApply
          ? `An orchestration rule would have routed responders to service ${target}'s policy.`
          : `An orchestration rule asked to route to service ${target}; a service route rule or non-live automation would have kept the route.`
        : reroute.applied
          ? `An orchestration rule routed responders to service ${target}'s escalation policy.`
          : `An orchestration rule asked to route to service ${target}; not applied (${String(reroute.reason).toLowerCase().replace(/_/g, ' ')}).`,
    });
  }
  if (Array.isArray(pipeline.attachRunbookIds) && pipeline.attachRunbookIds.length)
    steps.push({
      stage: 'PIPELINE',
      text: shadow
        ? `An orchestration rule would have suggested ${pipeline.attachRunbookIds.length} runbook(s) bound to this service.`
        : `An orchestration rule suggested ${pipeline.attachRunbookIds.length} runbook(s) through this service's bindings.`,
    });
  return steps;
}

/** Noise decisions first (they happen before the incident exists), then the pipeline notes. */
export function describeNoiseDecisions(decisions: StoredNoiseDecision[]): RouteTraceStep[] {
  return decisions.flatMap(decision => [
    {
      stage: 'NOISE' as const,
      text: `${decision.applied ? 'Noise controls' : 'Noise controls (shadow, not applied)'}: ${decision.reason}.${decision.reversedAt ? ' Later reversed by an operator.' : ''}`,
    },
    ...describePipeline(decision.evidence),
  ]);
}
