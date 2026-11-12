import Link from 'next/link';
import { Badge } from '@/components/ui/shadcn/badge';
import type { OpsInsightView } from '@/lib/intelligence/ops-insights/contract';
import { INSIGHT_SEVERITY } from './InsightBadge';
import InsightActions from './InsightActions';

export type InsightsPanelItem = OpsInsightView & { scopeName?: string; scopeHref?: string };

const SCOPE_NOUN: Record<OpsInsightView['scopeType'], string> = {
  SERVICE: 'service',
  POLICY: 'escalation policy',
  SCHEDULE: 'schedule',
  RUNBOOK: 'runbook',
  USER: 'person',
  TEAM: 'team',
};

/**
 * The list of insights for a tab, a section or the inbox. A server component: only the action buttons are a
 * client island. Renders nothing when there is nothing to say, so callers can place it unconditionally.
 *
 * Feed it from `listInsightsForScope` (one scope) or `listInsightsInbox` (rows then name their scope).
 * `canDecide` is whether the viewer holds the feedback capability; the server action checks it again.
 */
export default function InsightsPanel({
  insights,
  canDecide,
  squireName,
  draftLabel,
  label = 'Insights',
}: {
  insights: readonly InsightsPanelItem[];
  canDecide: boolean;
  /** The assistant's display name; omit to hide the "Ask" hand-off (for example when Squire is off). */
  squireName?: string | null;
  draftLabel?: string;
  /** Accessible name of the list. */
  label?: string;
}) {
  if (insights.length === 0) return null;
  return (
    <ul aria-label={label} data-insights-panel className="divide-y divide-border">
      {insights.map(insight => (
        <li
          key={insight.id}
          className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={INSIGHT_SEVERITY[insight.severity].variant} size="xs">
                {INSIGHT_SEVERITY[insight.severity].label}
              </Badge>
              {insight.status === 'ACCEPTED' && (
                <Badge variant="outline" size="xs">
                  Accepted
                </Badge>
              )}
              {insight.status === 'DISMISSED' && (
                <Badge variant="outline" size="xs">
                  Dismissed
                </Badge>
              )}
              <p className="min-w-0 break-words text-sm font-medium">{insight.title}</p>
            </div>
            <p className="break-words text-sm text-muted-foreground">{insight.summary}</p>
            {insight.scopeName && insight.scopeHref && (
              <p className="text-xs text-muted-foreground">
                On {SCOPE_NOUN[insight.scopeType]}{' '}
                <Link
                  href={insight.scopeHref}
                  className="inline-flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0"
                >
                  {insight.scopeName}
                </Link>
              </p>
            )}
          </div>
          <InsightActions
            id={insight.id}
            title={insight.title}
            summary={insight.summary}
            subject={
              insight.scopeName
                ? `${SCOPE_NOUN[insight.scopeType]} ${insight.scopeName}`
                : undefined
            }
            status={insight.status}
            evidence={insight.evidence}
            draftHref={insight.draftHref}
            draftLabel={draftLabel}
            canDecide={canDecide}
            squireName={squireName}
          />
        </li>
      ))}
    </ul>
  );
}
