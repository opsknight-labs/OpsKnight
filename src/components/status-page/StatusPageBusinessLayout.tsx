'use client';

import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StatusPageServiceLayout = 'FLAT' | 'BUSINESS' | 'BUSINESS_EXPANDABLE';

export type BusinessServiceOption = {
  id: string;
  name: string;
  memberServiceIds: string[];
};

const LAYOUTS: Array<{ value: StatusPageServiceLayout; title: string; body: string }> = [
  {
    value: 'FLAT',
    title: 'Technical services',
    body: 'One row per service, as today.',
  },
  {
    value: 'BUSINESS',
    title: 'Business services',
    body: 'One row per business service, with its worst status and merged history.',
  },
  {
    value: 'BUSINESS_EXPANDABLE',
    title: 'Business services, expandable',
    body: 'Business service rows that open to show the technical services inside.',
  },
];

/** Layout picker and the ordered business services a status page shows. */
export default function StatusPageBusinessLayout({
  layout,
  onLayoutChange,
  businessServices,
  selectedIds,
  onSelectedIdsChange,
}: {
  layout: StatusPageServiceLayout;
  onLayoutChange: (layout: StatusPageServiceLayout) => void;
  businessServices: BusinessServiceOption[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
}) {
  const byId = new Map(businessServices.map(item => [item.id, item]));
  const selected = selectedIds.flatMap(id => (byId.has(id) ? [byId.get(id)!] : []));
  const available = businessServices.filter(item => !selectedIds.includes(item.id));
  const move = (index: number, delta: number) => {
    const next = [...selectedIds];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onSelectedIdsChange(next);
  };

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4 text-card-foreground sm:p-5">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Layout</h3>
        <p className="text-xs text-muted-foreground">
          How visitors see your services. Grouping never publishes a service that is not on this
          page.
        </p>
      </div>
      <div role="radiogroup" aria-label="Service layout" className="grid gap-2 sm:grid-cols-3">
        {LAYOUTS.map(option => {
          const active = layout === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onLayoutChange(option.value)}
              className={cn(
                'flex min-h-20 flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-foreground/30 hover:bg-muted/40'
              )}
            >
              <span className="flex w-full items-center justify-between gap-2 text-sm font-semibold">
                {option.title}
                {active && <Check className="h-4 w-4 text-primary" aria-hidden />}
              </span>
              <span className="text-xs text-muted-foreground">{option.body}</span>
            </button>
          );
        })}
      </div>

      {layout !== 'FLAT' && (
        <div className="space-y-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">
              Business services on this page{' '}
              <span className="font-normal text-muted-foreground tabular-nums">
                ({selected.length})
              </span>
            </h3>
            <Link
              href="/services/business"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Manage business services
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">
            Their technical services are added to this page automatically. Hide one in the list
            below to keep it out of the business service&apos;s status. Services in no business
            service appear under &ldquo;Other services&rdquo;.
          </p>
          {businessServices.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              No business services exist yet.{' '}
              <Link href="/services/business/new" className="font-medium text-primary underline">
                Create one
              </Link>{' '}
              to group your services.
            </p>
          ) : (
            <>
              {selected.length > 0 && (
                <ol className="divide-y divide-border rounded-lg border border-border">
                  {selected.map((item, index) => (
                    <li key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="w-5 text-xs text-muted-foreground tabular-nums">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                      <span className="hidden text-xs text-muted-foreground sm:inline tabular-nums">
                        {item.memberServiceIds.length}{' '}
                        {item.memberServiceIds.length === 1 ? 'service' : 'services'}
                      </span>
                      <button
                        type="button"
                        aria-label={`Move ${item.name} up`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${item.name} down`}
                        disabled={index === selected.length - 1}
                        onClick={() => move(index, 1)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectedIdsChange(selectedIds.filter(id => id !== item.id))}
                        className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {available.length > 0 && (
                <div className="flex flex-wrap gap-1.5" aria-label="Add a business service">
                  {available.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectedIdsChange([...selectedIds, item.id])}
                      className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      + {item.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
