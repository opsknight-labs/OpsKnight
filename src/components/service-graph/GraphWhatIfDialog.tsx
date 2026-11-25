'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { simulateFailureAction } from '@/app/(app)/services/graph/actions';
import GraphHealthBadge from './GraphHealthBadge';
import type { FailureProjection } from './insights';

const MAX_SHOWN = 25;

function Distances({ title, rows }: { title: string; rows: FailureProjection['affectedServices'] }) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-1.5">
      <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} <span className="tabular-nums">({rows.length})</span>
      </h3>
      <ul className="space-y-1 text-sm">
        {rows.slice(0, MAX_SHOWN).map(row => (
          <li key={row.id} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{row.name}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {row.distance} {row.distance === 1 ? 'hop' : 'hops'}
            </span>
          </li>
        ))}
      </ul>
      {rows.length > MAX_SHOWN && (
        <p className="text-xs text-muted-foreground">and {rows.length - MAX_SHOWN} more</p>
      )}
    </section>
  );
}

const money = (cents: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    cents / 100
  );

/** "What if this goes down?": the projected blast radius of one service failing outright. */
export default function GraphWhatIfDialog({
  service,
  onClose,
}: {
  service: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'error'; message: string } | { status: 'done'; data: FailureProjection }
  >({ status: 'loading' });
  const serviceId = service?.id;
  useEffect(() => {
    if (!serviceId) return;
    let stale = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state with the prop/open transition; cannot be derived during render
    setState({ status: 'loading' });
    simulateFailureAction({ serviceIds: [serviceId] })
      .then(result => {
        if (stale) return;
        setState(result.ok ? { status: 'done', data: result.data } : { status: 'error', message: result.message });
      })
      .catch(() => !stale && setState({ status: 'error', message: 'Unable to run the simulation.' }));
    return () => {
      stale = true;
    };
  }, [serviceId]);

  const data = state.status === 'done' ? state.data : null;
  const truncatedTotal = data
    ? Math.max(data.affectedServices.length, data.possiblyDegradedServices.length) > MAX_SHOWN
    : false;
  return (
    <Dialog open={!!service} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What if {service?.name} goes down?</DialogTitle>
          <DialogDescription>
            A projection from the current dependencies, not a prediction. Hard dependencies fail with it;
            soft ones only degrade.
          </DialogDescription>
        </DialogHeader>
        {state.status === 'loading' && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Simulating…
          </p>
        )}
        {state.status === 'error' && <InlineNotice tone="warning">{state.message}</InlineNotice>}
        {data && (
          <div className="space-y-4">
            {(data.truncated || truncatedTotal) && (
              <InlineNotice tone="info">
                The result is partial: the graph is large or the lists are cut at {MAX_SHOWN}.
              </InlineNotice>
            )}
            {data.affectedBusinessServices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No business service is projected to be affected.</p>
            ) : (
              <section className="space-y-1.5">
                <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Business services ({data.affectedBusinessServices.length})
                </h3>
                <ul className="space-y-1.5">
                  {data.affectedBusinessServices.map(bs => (
                    <li key={bs.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate font-medium">{bs.name}</span>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <GraphHealthBadge status={bs.currentStatus} />
                        <span aria-hidden="true">→</span>
                        <span className="sr-only">projected</span>
                        <GraphHealthBadge status={bs.projectedStatus} />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {(data.exposure.customers !== null || data.exposure.revenuePerHourCents !== null) && (
              <dl className="grid grid-cols-2 gap-3 rounded-md border bg-muted/40 p-3 text-sm">
                {data.exposure.customers !== null && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Customers exposed</dt>
                    <dd className="font-semibold tabular-nums">{data.exposure.customers.toLocaleString()}</dd>
                  </div>
                )}
                {data.exposure.revenuePerHourCents !== null && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Revenue at risk</dt>
                    <dd className="font-semibold tabular-nums">{money(data.exposure.revenuePerHourCents)}/h</dd>
                  </div>
                )}
                <p className="col-span-2 text-2xs text-muted-foreground">{data.exposure.note}</p>
              </dl>
            )}
            <Distances title="Services that fail with it" rows={data.affectedServices} />
            <Distances title="Services that may degrade" rows={data.possiblyDegradedServices} />
            {data.affectedServices.length === 0 && data.possiblyDegradedServices.length === 0 && (
              <p className="text-sm text-muted-foreground">No other service depends on it.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
