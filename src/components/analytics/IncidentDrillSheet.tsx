'use client';

import { useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  EmptyState,
  ErrorState,
  RelativeTime,
  SeverityBadge,
  StatusBadge,
  TableRowsSkeleton,
} from '@/components/patterns';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/shadcn/sheet';
import type { DrillIncident, DrillKind, DrillPage } from '@/lib/analytics/drilldown';
import { cn } from '@/lib/utils';
import { formatDuration, formatMetric } from './format';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string; reference?: string }
  | { status: 'ready'; total: number; incidents: DrillIncident[]; nextCursor: string | null };

/**
 * A number on the analytics page that opens the incidents behind it. The list
 * uses the page's current filters, so its total matches the number clicked.
 */
export default function IncidentDrillSheet({
  drill,
  serviceId,
  title,
  label,
  className,
  children,
}: {
  drill: DrillKind;
  serviceId?: string;
  /** Sheet heading, e.g. "Incidents that breached the ack SLA". */
  title: string;
  /** Accessible name of the trigger. */
  label: string;
  className?: string;
  /** Trigger content; omit for a full-card overlay trigger. */
  children?: ReactNode;
}) {
  const searchParams = useSearchParams();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [moreState, setMoreState] = useState<'idle' | 'loading' | 'error'>('idle');
  const request = useRef(0);

  const fetchPage = async (cursor?: string): Promise<DrillPage> => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('drill', drill);
    params.delete('serviceId');
    params.delete('cursor');
    if (serviceId) params.set('serviceId', serviceId);
    if (cursor) params.set('cursor', cursor);
    const response = await fetch(`/api/insights/incidents?${params.toString()}`, {
      cache: 'no-store',
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.success) {
      // Say what actually failed (status + reference), not a generic connection hint.
      throw Object.assign(
        new Error(body?.error || `The server returned HTTP ${response.status}.`),
        {
          reference: body?.requestId ?? response.headers.get('x-request-id') ?? undefined,
        }
      );
    }
    return body.data as DrillPage;
  };

  const loadFirst = () => {
    const id = ++request.current;
    setState({ status: 'loading' });
    setMoreState('idle');
    fetchPage().then(
      page => id === request.current && setState({ status: 'ready', ...page }),
      (error: Error & { reference?: string }) =>
        id === request.current &&
        setState({
          status: 'error',
          message:
            error instanceof TypeError
              ? 'Could not reach the server. Check your connection and try again.'
              : error.message,
          reference: error.reference,
        })
    );
  };

  const loadMore = () => {
    if (state.status !== 'ready' || !state.nextCursor) return;
    const id = request.current;
    setMoreState('loading');
    fetchPage(state.nextCursor).then(
      page => {
        if (id !== request.current) return;
        setMoreState('idle');
        setState(current =>
          current.status === 'ready'
            ? { ...page, status: 'ready', incidents: [...current.incidents, ...page.incidents] }
            : current
        );
      },
      () => id === request.current && setMoreState('error')
    );
  };

  return (
    <Sheet
      onOpenChange={open => {
        if (open) loadFirst();
        else request.current += 1; // drop late responses
      }}
    >
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            'rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className
          )}
        >
          {children}
        </button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-lg">
        <SheetHeader className="pr-10 text-left">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {state.status === 'ready'
              ? `${formatMetric(state.total, 'count')} incident${state.total === 1 ? '' : 's'} · same filters as the page`
              : 'Same filters as the page'}
          </SheetDescription>
        </SheetHeader>

        {state.status === 'loading' ? (
          <TableRowsSkeleton rows={6} columns={1} showHeader={false} label="Loading incidents" />
        ) : state.status === 'error' ? (
          <ErrorState
            variant="inline"
            title="Couldn't load incidents"
            message={state.message}
            errorCode={state.reference}
            onRetry={loadFirst}
          />
        ) : state.incidents.length === 0 ? (
          <EmptyState
            variant="simple"
            size="sm"
            title="No incidents"
            description="Nothing matches this number for the selected period and filters."
          />
        ) : (
          <>
            <ul className="divide-y rounded-lg border">
              {state.incidents.map(incident => (
                <li key={incident.id}>
                  <Link
                    href={`/incidents/${incident.id}`}
                    className="block px-3 py-2.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="block truncate text-sm font-medium">{incident.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <SeverityBadge urgency={incident.urgency} size="sm" />
                      <StatusBadge status={incident.status} size="sm" />
                      {incident.serviceName && (
                        <span className="max-w-40 truncate">{incident.serviceName}</span>
                      )}
                      <RelativeTime date={incident.createdAt} />
                      <span className="tabular-nums">Ack {formatDuration(incident.ackMs)}</span>
                      <span className="tabular-nums">
                        Resolve {formatDuration(incident.resolveMs)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums">
                Showing {formatMetric(state.incidents.length, 'count')} of{' '}
                {formatMetric(state.total, 'count')}
              </span>
              {moreState === 'error' && (
                <span role="alert" className="text-destructive">
                  Couldn&apos;t load more.
                </span>
              )}
              {state.nextCursor && (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={moreState === 'loading'}
                  className="inline-flex h-11 items-center rounded-md border px-3 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:h-9"
                >
                  {moreState === 'loading'
                    ? 'Loading…'
                    : moreState === 'error'
                      ? 'Retry'
                      : 'Load more'}
                </button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
