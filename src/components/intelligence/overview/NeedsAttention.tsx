import Link from 'next/link';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { SectionCard } from '@/components/analytics/SectionCard';
import {
  ATTENTION_KIND_LABELS,
  rankAttention,
  type AttentionItem,
  type AttentionKind,
  type RankedAttention,
} from '@/lib/intelligence/overview/attention-contract';
import { INSIGHT_SEVERITY } from '@/components/intelligence/insights/InsightBadge';
import {
  InsightRow,
  type InsightsPanelItem,
} from '@/components/intelligence/insights/InsightsPanel';
import { toneClasses } from '@/components/patterns/status-tone';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import AttentionGroup from './AttentionGroup';

/**
 * The overview's one "Needs attention" inbox: decisions waiting for a person (probe rows, each a link to
 * where it is made) and open operations insights (with their accept / dismiss controls), ranked together by
 * severity then age. Insights of one kind (same producer and rule) fold into one disclosure row, so six
 * schedules with the same problem read as one line. It renders nothing at all when there is nothing to do,
 * so an idle workspace never shows an empty card. `resolveHref` lets the mobile page point rows at their mobile routes.
 */
export default function NeedsAttention({
  items,
  insights = [],
  moreInsights = false,
  canDecide = false,
  squireName,
  resolveHref = href => href,
  className,
}: {
  items: readonly AttentionItem[];
  insights?: readonly InsightsPanelItem[];
  /** The insight read stopped at its limit: say so instead of implying the list is complete. */
  moreInsights?: boolean;
  canDecide?: boolean;
  squireName?: string | null;
  resolveHref?: (href: string) => string;
  className?: string;
}) {
  const rows = rankAttention(items, insights);
  if (rows.length === 0) return null;
  const blocks = groupRows(rows);
  return (
    <SectionCard
      id="overview-attention"
      title="Needs attention"
      description="Decisions waiting for a person and open insights, most severe first."
      info={
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums',
            toneClasses('elevated').soft
          )}
        >
          {rows.length}
          {moreInsights && '+'}
          <span className="sr-only"> {rows.length === 1 ? 'item' : 'items'}</span>
        </span>
      }
      className={cn('overflow-hidden', className)}
      flush
    >
      {blocks.map(block =>
        block.type === 'insights' ? (
          <ul key={`insights:${block.entries[0][0].id}`} className="divide-y divide-border">
            {block.entries.map(entry => {
              const row = (item: InsightRanked, className: string) => (
                <InsightRow
                  key={`insight:${item.id}`}
                  insight={{
                    ...item.insight,
                    scopeHref: item.insight.scopeHref && resolveHref(item.insight.scopeHref),
                    draftHref: item.insight.draftHref && resolveHref(item.insight.draftHref),
                  }}
                  canDecide={canDecide}
                  squireName={squireName}
                  compact
                  className={className}
                />
              );
              if (entry.length === 1)
                return row(
                  entry[0],
                  'px-4 py-3 transition-colors duration-150 hover:bg-muted/50 sm:px-5'
                );
              const first = entry[0].insight;
              return (
                <AttentionGroup
                  key={`insight-group:${entry[0].id}`}
                  badge={
                    <Badge variant={INSIGHT_SEVERITY[first.severity].variant} size="xs">
                      {INSIGHT_SEVERITY[first.severity].label}
                    </Badge>
                  }
                  title={insightGroupTitle(entry.map(item => item.insight))}
                  description={first.summary}
                >
                  {entry.map(item => row(item, 'py-3 pl-8 pr-4 sm:pl-10 sm:pr-5'))}
                </AttentionGroup>
              );
            })}
          </ul>
        ) : (
          <ProbeGroup key={`group:${block.kind}`} block={block} resolveHref={resolveHref} />
        )
      )}
      {moreInsights && (
        <p className="px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
          Showing the most severe insights. Accept or dismiss some to see more.
        </p>
      )}
    </SectionCard>
  );
}

type Ranked = RankedAttention<InsightsPanelItem>;
type ProbeRow = Extract<Ranked, { type: 'probe' }>;
type InsightRanked = Extract<Ranked, { type: 'insight' }>;
type Block =
  /** Each entry is one insight, or several of one kind shown as a group (ranked order inside). */
  | { type: 'insights'; entries: InsightRanked[][] }
  | { type: 'group'; kind: AttentionKind; rows: ProbeRow[] };

/**
 * Insights that say the same thing about different scopes: same producer `kind` and the rule part of `key`
 * (keys look like `same-person` or `never-acked:2`; the suffix only tells apart several on one scope).
 */
export function insightGroupKey(insight: { kind: string; key: string }): string {
  return `${insight.kind}|${insight.key.split(':')[0]}`;
}

const SCOPE_PLURAL: Record<InsightsPanelItem['scopeType'], string> = {
  SERVICE: 'services',
  POLICY: 'escalation policies',
  SCHEDULE: 'schedules',
  RUNBOOK: 'runbooks',
  USER: 'people',
  TEAM: 'teams',
};
// Words a shared title prefix should not end on ("… primary and backup for" → "… primary and backup").
const TRAILING_FILLER =
  /^(a|an|and|at|by|for|from|in|is|of|on|or|over|than|the|to|with|within|[\d.,%x×]+)$/i;
const LOWERCASE_START = /^(The|A|An|No|Nobody|Some|This|These|Every|Each|One)$/;

/**
 * "6 schedules: the same person is primary and backup": the count, the plural scope noun and the words every
 * title in the group shares (their numbers differ per scope, so they are dropped).
 */
export function insightGroupTitle(
  insights: readonly Pick<InsightsPanelItem, 'title' | 'scopeType'>[]
): string {
  const split = insights.map(insight => insight.title.split(/\s+/));
  const shared: string[] = [];
  for (const [index, word] of split[0].entries()) {
    if (split.some(words => words.at(index) !== word)) break;
    shared.push(word);
  }
  const bare = (word: string) => word.replace(/[:;,.]$/, '');
  while (shared.length > 0 && TRAILING_FILLER.test(bare(shared.at(-1)!))) shared.pop();
  const scopes = SCOPE_PLURAL[insights[0].scopeType];
  if (shared.length < 2) return `${insights.length} similar insights on ${scopes}`;
  shared.push(bare(shared.pop()!));
  if (LOWERCASE_START.test(shared[0])) shared[0] = shared[0].toLowerCase();
  return `${insights.length} ${scopes}: ${shared.join(' ')}`;
}

const GROUP_TITLES: Partial<Record<AttentionKind, string>> = { triage: 'Triage suggestions' };

/**
 * Keeps the ranked order but gathers probe rows of one kind under a single sub-heading, and insights of one
 * kind into one entry, each placed where its first (highest-ranked) row falls; consecutive insights share
 * one list.
 */
export function groupRows(rows: readonly Ranked[]): Block[] {
  const blocks: Block[] = [];
  const groups = new Map<AttentionKind, Extract<Block, { type: 'group' }>>();
  const insightGroups = new Map<string, InsightRanked[]>();
  for (const row of rows) {
    if (row.type === 'insight') {
      const key = insightGroupKey(row.insight);
      const entry = insightGroups.get(key);
      if (entry) {
        entry.push(row);
        continue;
      }
      const fresh = [row];
      insightGroups.set(key, fresh);
      const last = blocks.at(-1);
      if (last?.type === 'insights') last.entries.push(fresh);
      else blocks.push({ type: 'insights', entries: [fresh] });
      continue;
    }
    let group = groups.get(row.item.kind);
    if (!group) {
      group = { type: 'group', kind: row.item.kind, rows: [] };
      groups.set(row.item.kind, group);
      blocks.push(group);
    }
    group.rows.push(row);
  }
  return blocks;
}

function ProbeGroup({
  block,
  resolveHref,
}: {
  block: Extract<Block, { type: 'group' }>;
  resolveHref: (href: string) => string;
}) {
  const shown = block.rows.filter(row => !row.item.more);
  const more = block.rows.find(row => row.item.more);
  const headingId = `overview-attention-${block.kind}`;
  return (
    <div>
      <h3
        id={headingId}
        className="flex items-center gap-2 px-4 pb-1 pt-3 text-xs font-semibold text-muted-foreground sm:px-5"
      >
        {GROUP_TITLES[block.kind] ?? ATTENTION_KIND_LABELS[block.kind]}
        <span className="rounded-full border border-border px-1.5 text-2xs font-semibold tabular-nums text-foreground">
          {shown.length}
          {more && '+'}
        </span>
      </h3>
      {shown.length > 0 && (
        <ul aria-labelledby={headingId}>
          {shown.map(row => (
            <li key={row.id}>
              <Link
                href={resolveHref(row.item.href)}
                data-attention-item={row.item.kind}
                className="flex min-h-11 items-center gap-3 px-4 py-2 transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-x-3 sm:flex-row sm:items-baseline">
                  <span className="min-w-0 wrap-break-word text-sm font-medium text-foreground">
                    {row.item.title}
                  </span>
                  <span className="min-w-0 wrap-break-word text-xs text-muted-foreground">
                    {row.item.detail}
                  </span>
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {more && (
        <Link
          href={resolveHref(more.item.href)}
          data-attention-item={more.item.kind}
          className="flex min-h-11 items-center gap-1 px-4 pb-2 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-9 sm:px-5"
        >
          {more.item.title}
          <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
