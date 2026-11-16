import { Activity } from 'lucide-react';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import { getAiPublicStatus } from '@/lib/intelligence/ai/settings';
import {
  getRunbookHealthView,
  type RunbookHealthView,
} from '@/lib/intelligence/runbook-health/view';
import InsightsPanel from '@/components/intelligence/insights/InsightsPanel';
import { formatDurationSeconds } from '@/components/runbooks/executions/format';
import { KeyValueGrid, SectionCard } from '@/components/runbooks/ui/primitives';

const percent = (value: number) => `${Math.round(value * 100)}%`;

function rateLabel(part: number, whole: number, lowerBound: number | null, noun: string) {
  if (whole === 0 || lowerBound === null) return 'No finished runs yet';
  return `${percent(part / whole)} (${part} of ${whole} ${noun}), at least ${percent(lowerBound)} with this many runs`;
}

/** Presentation only; renders nothing when there is nothing to say. */
export function RunbookHealthPanel({
  view,
  formatTimestamp,
  canDecide,
  squireName,
}: {
  view: RunbookHealthView;
  formatTimestamp: (value: Date) => string;
  canDecide: boolean;
  squireName?: string | null;
}) {
  const { effectiveness: e, insights, suggestedSteps } = view;
  const suggestions = insights.filter(insight => suggestedSteps[insight.id]);
  if (e.eligible === 0 && insights.length === 0) return null;
  const step = e.mostFailingStep;
  return (
    <SectionCard
      id="runbook-health"
      title="Health"
      description={`How this runbook performed over the last ${e.windowDays} days, up to yesterday.`}
      icon={Activity}
    >
      <KeyValueGrid
        className="tabular-nums"
        items={[
          {
            label: 'Success rate',
            value: rateLabel(e.succeeded, e.eligible, e.successLowerBound, 'runs'),
          },
          {
            label: 'Fixed the incident',
            value:
              e.incidentRuns === 0
                ? 'No runs on incidents yet'
                : `${rateLabel(e.fixed, e.incidentRuns, e.fixedLowerBound, 'incident runs')}; resolved within ${e.fixWindowMinutes} min`,
          },
          {
            label: 'Median duration',
            value:
              e.medianDurationMs === null
                ? 'Not measured'
                : `About ${formatDurationSeconds(Math.round(e.medianDurationMs / 1000))}`,
          },
          {
            label: 'Most-failing step',
            value: step
              ? `${step.name}: failed ${step.failed} of ${step.runs}${step.topErrorCode ? `, mostly ${step.topErrorCode}` : ''}`
              : 'No step failures',
          },
          { label: 'Last run', value: e.lastRunAt ? formatTimestamp(e.lastRunAt) : 'Never' },
          {
            label: 'Last edited',
            value: e.lastEditedAt ? formatTimestamp(e.lastEditedAt) : 'Unknown',
          },
        ]}
      />
      {insights.length > 0 && (
        <div className="mt-5 border-t border-border/60 pt-4">
          <InsightsPanel
            insights={insights}
            canDecide={canDecide}
            squireName={squireName}
            draftLabel="Open in editor"
            label="Runbook health insights"
          />
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="mt-4 space-y-1">
          <h3 className="text-xs font-medium text-muted-foreground">
            Steps responders add by hand
          </h3>
          <ul className="space-y-1 text-sm text-foreground" aria-label="Suggested steps">
            {suggestions.map(insight => (
              <li key={insight.id} className="break-words">
                {suggestedSteps[insight.id]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

/** Streams in after the page; a failed or slow health read hides the section and never the page. */
export async function RunbookHealthSection({
  runbookId,
  actor,
  formatTimestamp,
}: {
  runbookId: string;
  actor: AuthorizationActor;
  formatTimestamp: (value: Date) => string;
}) {
  let view: RunbookHealthView | null = null;
  try {
    view = await getRunbookHealthView(runbookId, actor);
  } catch (error) {
    logger.warn('[Runbook] Health section unavailable', {
      runbookId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  if (!view) return null;
  // The assistant hand-off only shows while Squire is on; a failed status read just hides it.
  const squire = view.insights.length ? await getAiPublicStatus().catch(() => null) : null;
  return (
    <RunbookHealthPanel
      view={view}
      formatTimestamp={formatTimestamp}
      canDecide={hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK)}
      squireName={squire?.squireEnabled ? squire.squireName : null}
    />
  );
}
