import Link from 'next/link';
import { Activity } from 'lucide-react';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import {
  getRunbookHealthView,
  type RunbookHealthView,
} from '@/lib/intelligence/runbook-health/loader';
import type { InsightSeverity } from '@/lib/intelligence/runbook-health/types';
import { formatDurationSeconds } from '@/components/runbooks/executions/format';
import { KeyValueGrid, Pill, SectionCard, type Tone } from '@/components/runbooks/ui/primitives';

const SEVERITY: Record<InsightSeverity, { tone: Tone; label: string }> = {
  critical: { tone: 'danger', label: 'Needs attention' },
  warning: { tone: 'warning', label: 'Worth a look' },
  info: { tone: 'info', label: 'Suggestion' },
};

const percent = (value: number) => `${Math.round(value * 100)}%`;

function rateLabel(part: number, whole: number, lowerBound: number | null, noun: string) {
  if (whole === 0 || lowerBound === null) return 'No finished runs yet';
  return `${percent(part / whole)} (${part} of ${whole} ${noun}), at least ${percent(lowerBound)} with this many runs`;
}

/** Presentation only; renders nothing when there is nothing to say. */
export function RunbookHealthPanel({
  runbookId,
  view,
  formatTimestamp,
  canEdit,
}: {
  runbookId: string;
  view: RunbookHealthView;
  formatTimestamp: (value: Date) => string;
  canEdit: boolean;
}) {
  const { effectiveness: e, insights } = view;
  if (e.eligible === 0 && insights.length === 0) return null;
  const step = e.mostFailingStep;
  return (
    <SectionCard
      id="runbook-health"
      title="Health"
      description={`How this runbook performed over the last ${e.windowDays} days.`}
      icon={Activity}
    >
      <KeyValueGrid
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
                : rateLabel(e.fixed, e.incidentRuns, e.fixedLowerBound, 'incident runs'),
          },
          {
            label: 'Median duration',
            value:
              e.medianDurationMs === null
                ? 'Not measured'
                : formatDurationSeconds(Math.round(e.medianDurationMs / 1000)),
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
        <ul className="mt-5 space-y-2 border-t border-border/60 pt-4" aria-label="Health findings">
          {insights.map(insight => (
            <li
              key={`${insight.kind}:${insight.key}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground"
            >
              <Pill tone={SEVERITY[insight.severity].tone}>{SEVERITY[insight.severity].label}</Pill>
              <span className="min-w-0 break-words">{insight.title}</span>
              {canEdit && insight.kind === 'RUNBOOK_MISSING_STEP' && (
                <Link
                  href={`/runbooks/${runbookId}?tab=builder`}
                  className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Add it in the editor
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/** Streams in after the page; a failed or slow health read hides the section and never the page. */
export async function RunbookHealthSection({
  runbookId,
  actor,
  formatTimestamp,
  canEdit,
}: {
  runbookId: string;
  actor: AuthorizationActor;
  formatTimestamp: (value: Date) => string;
  canEdit: boolean;
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
  return (
    <RunbookHealthPanel
      runbookId={runbookId}
      view={view}
      formatTimestamp={formatTimestamp}
      canEdit={canEdit}
    />
  );
}
