import Link from 'next/link';
import { Badge } from '@/components/ui/shadcn/badge';
import type { OpsInsightScope, OpsInsightView } from '@/lib/intelligence/ops-insights/contract';
import { INSIGHT_SEVERITY } from './InsightBadge';
import InsightActions from './InsightActions';
import InsightPhrasing from './InsightPhrasing';
import { cn } from '@/lib/utils';

export type InsightsPanelItem = OpsInsightView & { scopeName?: string; scopeHref?: string };

/** One insight row: severity, what was seen, where, and the decide / ask / draft controls. */
export function InsightRow({
  insight,
  canDecide,
  squireName,
  draftLabel,
  className,
}: {
  insight: InsightsPanelItem;
  canDecide: boolean;
  squireName?: string | null;
  draftLabel?: string;
  /** Replaces the default list padding when the row sits in another list. */
  className?: string;
}) {
  return (
    <li
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between',
        className ?? 'py-3 first:pt-0 last:pb-0'
      )}
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
          insight.scopeName ? `${SCOPE_NOUN[insight.scopeType]} ${insight.scopeName}` : undefined
        }
        status={insight.status}
        evidence={insight.evidence}
        draftHref={insight.draftHref}
        draftLabel={draftLabel}
        canDecide={canDecide}
        squireName={squireName}
      />
    </li>
  );
}

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
 * `phraseScope` (one scope's list, AI available) adds an "Explain in plain words" disclosure: the only AI on
 * this panel, and it runs only when a person expands it.
 */
export default function InsightsPanel({
  insights,
  canDecide,
  squireName,
  draftLabel,
  label = 'Insights',
  phraseScope,
}: {
  insights: readonly InsightsPanelItem[];
  canDecide: boolean;
  /** The assistant's display name; omit to hide the "Ask" hand-off (for example when Squire is off). */
  squireName?: string | null;
  draftLabel?: string;
  /** Accessible name of the list. */
  label?: string;
  phraseScope?: OpsInsightScope;
}) {
  if (insights.length === 0) return null;
  const list = (
    <ul aria-label={label} data-insights-panel className="divide-y divide-border">
      {insights.map(insight => (
        <InsightRow
          key={insight.id}
          insight={insight}
          canDecide={canDecide}
          squireName={squireName}
          draftLabel={draftLabel}
        />
      ))}
    </ul>
  );
  if (!phraseScope) return list;
  return (
    <div>
      {list}
      <InsightPhrasing
        scope={phraseScope}
        titles={insights.map(insight => [insight.id, insight.title] as const)}
      />
    </div>
  );
}
