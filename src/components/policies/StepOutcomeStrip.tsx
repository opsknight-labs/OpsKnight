import type { PolicyStepStat } from '@/lib/intelligence/ops-insights/policy-intelligence';

function medianText(minutes: number | null): string | null {
  if (minutes === null) return null;
  return minutes > 120 ? 'median ack over 2 h' : `median ack ${minutes} min`;
}

/**
 * One quiet line under a step: how it did over the last 30 days. Renders nothing without data, so the
 * Steps tab looks exactly as before while escalation insights are off.
 */
export default function StepOutcomeStrip({ stat }: { stat?: PolicyStepStat }) {
  if (!stat || stat.paged === 0) return null;
  const parts = [
    `${stat.paged} ${stat.paged === 1 ? 'page' : 'pages'}`,
    `${Math.round(stat.ackRate * 100)}% acknowledged here`,
    medianText(stat.medianAckMinutes),
  ].filter(Boolean);
  return (
    <p data-step-outcome className="mt-1 text-xs tabular-nums text-muted-foreground">
      <span className="sr-only">Last 30 days: </span>
      {parts.join(' · ')}
    </p>
  );
}
