'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
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
import { Activity, Download } from 'lucide-react';

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
};

export default function EventsListTable({ initialEvents, userTimeZone }: EventsListTableProps) {
  const [search, setSearch] = useState('');
  const [selectedService, setSelectedService] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const services = useMemo(() => {
    const set = new Set<string>();
    initialEvents.forEach(e => {
      if (e.incident?.service?.name) {
        set.add(e.incident.service.name);
      }
    });
    return Array.from(set).sort();
  }, [initialEvents]);

  const filteredEvents = useMemo(() => {
    let result = initialEvents;

    if (selectedService !== 'ALL') {
      result = result.filter(e => e.incident?.service?.name === selectedService);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        e =>
          e.message.toLowerCase().includes(q) ||
          e.incident?.title.toLowerCase().includes(q) ||
          e.incident?.service?.name.toLowerCase().includes(q) ||
          e.incident?.id.toLowerCase().includes(q)
      );
    }

    return result;
  }, [initialEvents, selectedService, search]);

  const paginatedEvents = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredEvents.slice(start, start + pageSize);
  }, [filteredEvents, page, pageSize]);

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
      filteredEvents
    );
  };

  const hasActiveFilters = Boolean(search) || selectedService !== 'ALL';

  const handleResetFilters = () => {
    setSearch('');
    setSelectedService('ALL');
    setPage(1);
  };

  return (
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <SearchFilterBar
        searchValue={search}
        onSearchChange={val => {
          setSearch(val);
          setPage(1);
        }}
        searchPlaceholder="Search event messages, incidents, services..."
        hasActiveFilters={hasActiveFilters}
        onResetFilters={handleResetFilters}
        filters={
          services.length > 0 ? (
            <Select
              value={selectedService}
              onValueChange={val => {
                setSelectedService(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 w-[160px] bg-slate-50/60 text-xs">
                <SelectValue placeholder="All Services" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Services</SelectItem>
                {services.map(svc => (
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
              disabled={filteredEvents.length === 0}
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
        {filteredEvents.length === 0 ? (
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
              <Table className="min-w-[700px]">
                <TableHeader className="bg-slate-50 border-b border-border">
                  <TableRow>
                    <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                      Timestamp
                    </TableHead>
                    <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                      Incident
                    </TableHead>
                    <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                      Service
                    </TableHead>
                    <TableHead className="text-left p-4 font-semibold text-muted-foreground">
                      Event Message
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedEvents.map(event => (
                    <TableRow
                      key={event.id}
                      className="border-b border-slate-100 hover:bg-slate-50/70 transition-colors"
                    >
                      <TableCell className="p-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(event.createdAt, userTimeZone, { format: 'datetime' })}
                      </TableCell>
                      <TableCell className="p-4">
                        <Link
                          href={`/incidents/${event.incident.id}`}
                          className="text-primary font-semibold hover:underline"
                        >
                          #{event.incident.id.slice(-5).toUpperCase()}
                        </Link>
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {event.incident.title}
                        </div>
                      </TableCell>
                      <TableCell className="p-4 text-sm font-medium">
                        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          {event.incident.service.name}
                        </span>
                      </TableCell>
                      <TableCell className="p-4">
                        <div className="flex items-start gap-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                          <span className="text-sm text-foreground leading-relaxed">
                            {event.message}
                          </span>
                        </div>
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
              totalCount={filteredEvents.length}
              onPageChange={newPage => setPage(newPage)}
            />
          </>
        )}
      </Card>
    </div>
  );
}
