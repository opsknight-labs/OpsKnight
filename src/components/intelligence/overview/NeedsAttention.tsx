import Link from 'next/link';
import { ChevronRight, Inbox } from 'lucide-react';
import {
  ATTENTION_KIND_LABELS,
  type AttentionItem,
} from '@/lib/intelligence/overview/attention-contract';
import { cn } from '@/lib/utils';

/**
 * The overview's "Needs attention" inbox: decisions waiting for a person, each row a link to the place
 * where it is made. It renders nothing at all when there is nothing to do, so an idle workspace never
 * shows an empty card. `resolveHref` lets the mobile page point rows at their mobile routes.
 */
export default function NeedsAttention({
  items,
  resolveHref = href => href,
  className,
}: {
  items: readonly AttentionItem[];
  resolveHref?: (href: string) => string;
  className?: string;
}) {
  if (items.length === 0) return null;
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
          {items.length}
          <span className="sr-only"> {items.length === 1 ? 'item' : 'items'}</span>
        </span>
      </header>
      <ul className="divide-y divide-border">
        {items.map(item => (
          <li key={item.id}>
            <Link
              href={resolveHref(item.href)}
              data-attention-item={item.kind}
              className="flex min-h-11 items-center gap-3 px-4 py-2.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
            >
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block text-xs font-medium text-muted-foreground">
                  {ATTENTION_KIND_LABELS[item.kind]}
                </span>
                <span className="block break-words text-sm font-medium text-foreground">
                  {item.title}
                </span>
                <span className="block break-words text-xs text-muted-foreground">
                  {item.detail}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
