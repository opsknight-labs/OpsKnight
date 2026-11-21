import Link from 'next/link';
import { ChevronRight, Inbox } from 'lucide-react';
import {
  ATTENTION_KIND_LABELS,
  rankAttention,
  type AttentionItem,
} from '@/lib/intelligence/overview/attention-contract';
import {
  InsightRow,
  type InsightsPanelItem,
} from '@/components/intelligence/insights/InsightsPanel';
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
  return (
    <section
      aria-labelledby="overview-attention-title"
      data-overview-section="overview-attention"
      className={cn('min-w-0 rounded-xl border border-border bg-card', className)}
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
        <Inbox className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 id="overview-attention-title" className="text-base font-semibold tracking-tight">
          Needs attention
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {rows.length}
          {moreInsights && '+'}
          <span className="sr-only"> {rows.length === 1 ? 'item' : 'items'}</span>
        </span>
      </header>
      <ul className="divide-y divide-border">
        {rows.map(row =>
          row.type === 'insight' ? (
            <InsightRow
              key={`insight:${row.id}`}
              insight={{
                ...row.insight,
                scopeHref: row.insight.scopeHref && resolveHref(row.insight.scopeHref),
                draftHref: row.insight.draftHref && resolveHref(row.insight.draftHref),
              }}
              canDecide={canDecide}
              squireName={squireName}
              className="px-4 py-3 sm:px-5"
            />
          ) : (
            <li key={row.id}>
              <Link
                href={resolveHref(row.item.href)}
                data-attention-item={row.item.kind}
                className="flex min-h-11 items-center gap-3 px-4 py-2.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
              >
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block text-xs font-medium text-muted-foreground">
                    {ATTENTION_KIND_LABELS[row.item.kind]}
                  </span>
                  <span className="block break-words text-sm font-medium text-foreground">
                    {row.item.title}
                  </span>
                  <span className="block break-words text-xs text-muted-foreground">
                    {row.item.detail}
                  </span>
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          )
        )}
      </ul>
      {moreInsights && (
        <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
          Showing the most severe insights. Accept or dismiss some to see more.
        </p>
      )}
    </section>
  );
}
