import Link from 'next/link';
import { ArrowRight, ChevronRight, Inbox } from 'lucide-react';
import {
  ATTENTION_KIND_LABELS,
  rankAttention,
  type AttentionItem,
  type AttentionKind,
  type RankedAttention,
} from '@/lib/intelligence/overview/attention-contract';
import {
  InsightRow,
  type InsightsPanelItem,
} from '@/components/intelligence/insights/InsightsPanel';
import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';

/**
 * The overview's one "Needs attention" inbox: decisions waiting for a person (probe rows, each a link to
 * where it is made) and open operations insights (with their accept / dismiss controls), ranked together by
 * severity then age. It renders nothing at all when there is nothing to do, so an idle workspace never
 * shows an empty card. `resolveHref` lets the mobile page point rows at their mobile routes.
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
    <section
      aria-labelledby="overview-attention-title"
      data-overview-section="overview-attention"
      className={cn(
        'min-w-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm',
        className
      )}
    >
      {/* Every block below opens with its own hairline, so the header needs none. */}
      <header className="flex items-start gap-3 px-4 py-3 sm:px-5">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ring-1 ring-inset ring-border"
        >
          <Inbox className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="overview-attention-title"
              className="font-display text-base font-semibold tracking-tight text-foreground"
            >
              Needs attention
            </h2>
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
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Decisions waiting for a person and open insights, most severe first.
          </p>
        </div>
      </header>
      {blocks.map(block =>
        block.type === 'insights' ? (
          <ul
            key={`insights:${block.rows[0].id}`}
            className="divide-y divide-border border-t border-border"
          >
            {block.rows.map(row => (
              <InsightRow
                key={`insight:${row.id}`}
                insight={{
                  ...row.insight,
                  scopeHref: row.insight.scopeHref && resolveHref(row.insight.scopeHref),
                  draftHref: row.insight.draftHref && resolveHref(row.insight.draftHref),
                }}
                canDecide={canDecide}
                squireName={squireName}
                compact
                className="px-4 py-3 transition-colors duration-150 hover:bg-muted/50 sm:px-5"
              />
            ))}
          </ul>
        ) : (
          <ProbeGroup key={`group:${block.kind}`} block={block} resolveHref={resolveHref} />
        )
      )}
      {moreInsights && (
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
          Showing the most severe insights. Accept or dismiss some to see more.
        </p>
      )}
    </section>
  );
}

type Ranked = RankedAttention<InsightsPanelItem>;
type ProbeRow = Extract<Ranked, { type: 'probe' }>;
type Block =
  | { type: 'insights'; rows: Extract<Ranked, { type: 'insight' }>[] }
  | { type: 'group'; kind: AttentionKind; rows: ProbeRow[] };

const GROUP_TITLES: Partial<Record<AttentionKind, string>> = { triage: 'Triage suggestions' };

/**
 * Keeps the ranked order but gathers probe rows of one kind under a single sub-heading, placed where the
 * kind's first (highest-ranked) row falls; consecutive insights share one list.
 */
export function groupRows(rows: readonly Ranked[]): Block[] {
  const blocks: Block[] = [];
  const groups = new Map<AttentionKind, Extract<Block, { type: 'group' }>>();
  for (const row of rows) {
    if (row.type === 'insight') {
      const last = blocks.at(-1);
      if (last?.type === 'insights') last.rows.push(row);
      else blocks.push({ type: 'insights', rows: [row] });
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
    <div className="border-t border-border">
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
                className="flex min-h-11 items-center gap-3 px-4 py-2 transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-x-3 sm:flex-row sm:items-baseline">
                  <span className="min-w-0 break-words text-sm font-medium text-foreground">
                    {row.item.title}
                  </span>
                  <span className="min-w-0 break-words text-xs text-muted-foreground">
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
          className="flex min-h-11 items-center gap-1 px-4 pb-2 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-9 sm:px-5"
        >
          {more.item.title}
          <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
