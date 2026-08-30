'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatDateTime } from '@/lib/timezone';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/shadcn/table';
import { Card } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import SearchFilterBar from '@/components/ui/SearchFilterBar';
import LivePulseBadge from '@/components/ui/LivePulseBadge';
import TablePaginationFooter from '@/components/ui/TablePaginationFooter';
import EmptyState from '@/components/ui/EmptyState';
import { exportToCsv } from '@/lib/export-csv';
import { Activity, Download, Copy, Check } from 'lucide-react';
import EventLifecycleBadge from './EventLifecycleBadge';

export type EventItem = {
  id: string;
  createdAt: Date | string;
  message: string;
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
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  const handleCopyId = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
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
      {/* Search & Filter Toolbar */}
      <SearchFilterBar
        searchValue={currentSearch}
        onSearchChange={val => updateParam('search', val)}
        searchPlaceholder="Search event messages, incidents, services..."
        searchDebounceMs={300}
        hasActiveFilters={hasActiveFilters}
        onResetFilters={handleResetFilters}
        filters={
          serviceNames.length > 0 ? (
            <Select
              value={currentService || 'ALL'}
              onValueChange={val => updateParam('service', val)}
            >
              <SelectTrigger className="h-9 w-[160px] bg-slate-50/60 text-xs">
                <SelectValue placeholder="All Services" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Services</SelectItem>
                {serviceNames.map(svc => (
                  <SelectItem key={svc} value={svc}>
                    {svc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <LivePulseBadge isLive={true} label="Live Stream" />
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={initialEvents.length === 0}
              className="h-9 gap-1.5 text-xs shadow-sm hover:bg-slate-100"
            >
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Export CSV</span>
            </Button>
          </div>
        }
      />

      {/* Events Card & Table */}
      <Card className="bg-white overflow-hidden shadow-sm">
        {initialEvents.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Activity className="h-6 w-6 text-muted-foreground/60" />}
              title={hasActiveFilters ? 'No matching events found' : 'No events logged yet'}
              description={
                hasActiveFilters
                  ? 'Try adjusting or clearing your search filters.'
                  : 'Events will appear here in real-time when incidents are triggered, acknowledged, or resolved.'
              }
              action={
                hasActiveFilters ? (
                  <Button variant="outline" size="sm" onClick={handleResetFilters}>
                    Clear Filters
                  </Button>
                ) : (
                  <Button asChild variant="outline" size="sm">
                    <Link href="/events/test">Trigger test event</Link>
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
              <Table className="min-w-[750px]">
                <TableHeader className="bg-slate-50 border-b border-border">
                  <TableRow>
                    <TableHead className="text-left p-4 font-semibold text-muted-foreground w-[170px]">
                      Timestamp
                    </TableHead>
                    <TableHead className="text-left p-4 font-semibold text-muted-foreground w-[130px]">
                      Type
                    </TableHead>
                    <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                      Incident & Service
                    </TableHead>
                    <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                      Event Message
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {initialEvents.map(event => (
                    <TableRow
                      key={event.id}
                      className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors group"
                    >
                      <TableCell className="p-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        <div>
                          {formatDateTime(event.createdAt, userTimeZone, { format: 'datetime' })}
                        </div>
                        <button
                          type="button"
                          onClick={e => handleCopyId(event.id, e)}
                          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-foreground mt-0.5"
                          title="Copy Event ID"
                        >
                          {copiedId === event.id ? (
                            <>
                              <Check className="h-2.5 w-2.5 text-emerald-600" />
                              <span className="text-emerald-600">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-2.5 w-2.5" />
                              <span>{event.id.slice(0, 8)}...</span>
                            </>
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="p-4">
                        <EventLifecycleBadge message={event.message} />
                      </TableCell>
                      <TableCell className="p-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link
                            href={`/incidents/${event.incident.id}`}
                            className="text-primary font-semibold text-xs hover:underline font-mono"
                          >
                            #{event.incident.id.slice(-5).toUpperCase()}
                          </Link>
                          <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
                            {event.incident.service.name}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          {event.incident.title}
                        </div>
                      </TableCell>
                      <TableCell className="p-4">
                        <span className="text-xs text-foreground leading-relaxed">
                          {event.message}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Footer */}
            <TablePaginationFooter
              page={page}
              pageSize={pageSize}
              totalCount={totalCount}
              prevHref={page > 1 ? pageHref(page - 1) : undefined}
              nextHref={page < totalPages ? pageHref(page + 1) : undefined}
            />
          </>
        )}
      </Card>
    </div>
  );
}
