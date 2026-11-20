'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { Button } from '@/components/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { EmptyState, FilterBar, FilterField } from '@/components/patterns';
import {
  LogPagination,
  LogTableCard,
  LogTableScroll,
  LogTimestamp,
  MonoId,
  logCellClass,
  logHeadClass,
  logRowClass,
} from '@/components/audit/LogTable';
import { exportToCsv } from '@/lib/export-csv';
import { Activity, Download } from 'lucide-react';
import EventLifecycleBadge from './EventLifecycleBadge';

export type EventItem = {
  id: string;
  createdAt: Date | string;
  message: string;
  type?: string | null;
  incident: {
    id: string;
    title: string;
    service: {
      name: string;
    };
  };
};

export type EventsListTableProps = {
  initialEvents: EventItem[];
  userTimeZone: string;
  currentSearch?: string;
  currentService?: string;
  serviceNames: string[];
  page: number;
  pageSize: number;
  totalCount: number;
};

export default function EventsListTable({
  initialEvents,
  userTimeZone,
  currentSearch = '',
  currentService = '',
  serviceNames,
  page,
  pageSize,
  totalCount,
}: EventsListTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === 'ALL') params.delete(key);
    else params.set(key, value);
    params.delete('page');
    startTransition(() => router.push(`/events?${params.toString()}`));
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(targetPage));
    return `/events?${params.toString()}`;
  };

  const handleExportCsv = () => {
    exportToCsv(
      `incident-events-${new Date().toISOString().slice(0, 10)}`,
      [
        { header: 'Event ID', accessor: 'id' },
        { header: 'Timestamp', accessor: row => new Date(row.createdAt).toISOString() },
        { header: 'Incident ID', accessor: row => row.incident?.id ?? '' },
        { header: 'Incident Title', accessor: row => row.incident?.title ?? '' },
        { header: 'Service', accessor: row => row.incident?.service?.name ?? '' },
        { header: 'Message', accessor: 'message' },
      ],
      initialEvents
    );
  };

  const hasActiveFilters = Boolean(currentSearch) || Boolean(currentService);

  const handleResetFilters = () => {
    startTransition(() => router.push('/events'));
  };

  return (
    <div className="space-y-4">
      <FilterBar
        search={{
          value: currentSearch,
          onChange: val => updateParam('search', val),
          placeholder: 'Search messages, incidents or services…',
          label: 'Search event logs',
          debounceMs: 300,
        }}
        hasActiveFilters={hasActiveFilters}
        onClearAll={handleResetFilters}
        filters={
          serviceNames.length > 0 ? (
            <FilterField label="Service" htmlFor="events-filter-service">
              <Select
                value={currentService || 'ALL'}
                onValueChange={val => updateParam('service', val)}
              >
                <SelectTrigger id="events-filter-service" className="h-9 w-[200px] text-sm">
                  <SelectValue placeholder="All services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All services</SelectItem>
                  {serviceNames.map(svc => (
                    <SelectItem key={svc} value={svc}>
                      {svc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          ) : undefined
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={initialEvents.length === 0}
            className="h-9 gap-1.5"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export page as CSV
          </Button>
        }
      />

      <LogTableCard
        footer={
          initialEvents.length > 0 ? (
            <LogPagination
              label="Event log pages"
              page={page}
              pageSize={pageSize}
              totalCount={totalCount}
              prevHref={page > 1 ? pageHref(page - 1) : undefined}
              nextHref={page < totalPages ? pageHref(page + 1) : undefined}
            />
          ) : undefined
        }
      >
        {initialEvents.length === 0 ? (
          <EmptyState
            variant="simple"
            icon={<Activity />}
            title={hasActiveFilters ? 'No events match these filters' : 'No events yet'}
            description={
              hasActiveFilters
                ? 'Change the search or service, or clear the filters to see every event.'
                : 'Events appear here when incidents are triggered, acknowledged, escalated or resolved.'
            }
            action={
              hasActiveFilters ? (
                <Button variant="outline" size="sm" onClick={handleResetFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href="/events/test">Send a test event</Link>
                </Button>
              )
            }
          />
        ) : (
          <LogTableScroll label="Event log entries">
            <Table className="min-w-[860px]">
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className={cn(logHeadClass, 'w-[180px]')}>Time</TableHead>
                  <TableHead className={cn(logHeadClass, 'w-[140px]')}>Type</TableHead>
                  <TableHead className={logHeadClass}>Incident</TableHead>
                  <TableHead className={logHeadClass}>Message</TableHead>
                  <TableHead className={cn(logHeadClass, 'w-[150px]')}>Event ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {initialEvents.map(event => (
                  <TableRow key={event.id} className={logRowClass}>
                    <TableCell className={logCellClass}>
                      <LogTimestamp date={event.createdAt} timeZone={userTimeZone} />
                    </TableCell>
                    <TableCell className={logCellClass}>
                      <EventLifecycleBadge message={event.message} type={event.type} />
                    </TableCell>
                    <TableCell className={cn(logCellClass, 'max-w-[320px]')}>
                      <Link
                        href={`/incidents/${event.incident.id}`}
                        className="block truncate rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {event.incident.title}
                      </Link>
                      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <code className="font-mono">
                          #{event.incident.id.slice(-5).toUpperCase()}
                        </code>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{event.incident.service.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className={cn(logCellClass, 'max-w-md')}>
                      <span className="line-clamp-2 text-foreground">{event.message}</span>
                    </TableCell>
                    <TableCell className={logCellClass}>
                      <MonoId
                        value={event.id}
                        display={`${event.id.slice(0, 10)}…`}
                        label="event ID"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </LogTableScroll>
        )}
      </LogTableCard>
    </div>
  );
}
