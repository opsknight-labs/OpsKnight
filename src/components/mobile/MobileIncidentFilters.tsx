'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Filter, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';

type FilterValue = 'all' | 'all_open' | 'open' | 'acknowledged' | 'muted' | 'resolved';
type SortValue = 'created_desc' | 'created_asc' | 'urgency';

type Props = {
  currentQuery: string;
  currentFilter: FilterValue;
  currentUrgency?: string;
  currentAssignee?: string;
  currentServiceId?: string;
  currentSort: SortValue;
  currentUserId: string;
  services: Array<{ id: string; name: string }>;
  totalCount: number;
};

function activeFilterCount(props: Props) {
  return [
    props.currentFilter !== 'all',
    Boolean(props.currentUrgency),
    Boolean(props.currentAssignee),
    Boolean(props.currentServiceId),
    props.currentSort !== 'created_desc',
  ].filter(Boolean).length;
}

export default function MobileIncidentFilters(props: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(props.currentQuery);
  const [draft, setDraft] = useState({
    filter: props.currentFilter,
    urgency: props.currentUrgency || 'all',
    assignee: props.currentAssignee || 'all',
    serviceId: props.currentServiceId || 'all',
    sort: props.currentSort,
  });

  const [prevPropsQuery, setPrevPropsQuery] = useState(props.currentQuery);
  if (props.currentQuery !== prevPropsQuery) {
    setPrevPropsQuery(props.currentQuery);
    setQuery(props.currentQuery);
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraft({
        filter: props.currentFilter,
        urgency: props.currentUrgency || 'all',
        assignee: props.currentAssignee || 'all',
        serviceId: props.currentServiceId || 'all',
        sort: props.currentSort,
      });
    }
    setOpen(nextOpen);
  };

  const count = activeFilterCount(props);
  const summary = useMemo(() => {
    const parts: string[] = [];
    if (props.currentFilter === 'all_open') parts.push('Active');
    else if (props.currentFilter === 'open') parts.push('Triggered');
    else if (props.currentFilter === 'acknowledged') parts.push('Acknowledged');
    else if (props.currentFilter === 'muted') parts.push('Muted');
    else if (props.currentFilter === 'resolved') parts.push('Resolved');
    if (props.currentUrgency) parts.push(`${props.currentUrgency.toLowerCase()} urgency`);
    if (props.currentAssignee === props.currentUserId) parts.push('Assigned to me');
    else if (props.currentAssignee?.toLowerCase() === 'unassigned') parts.push('Unassigned');
    const service = props.services.find(item => item.id === props.currentServiceId);
    if (service) parts.push(service.name);
    return parts;
  }, [props]);

  const navigate = (params: URLSearchParams) => {
    params.delete('page');
    const suffix = params.toString();
    router.push(suffix ? `/m/incidents?${suffix}` : '/m/incidents');
  };

  const submitSearch = (value: string) => {
    const params = new URLSearchParams(searchParams);
    const trimmed = value.trim();
    if (trimmed) params.set('q', trimmed);
    else params.delete('q');
    navigate(params);
  };

  const apply = () => {
    const params = new URLSearchParams(searchParams);
    const setOrDelete = (key: string, value: string, empty = 'all') => {
      if (!value || value === empty) params.delete(key);
      else params.set(key, value);
    };
    setOrDelete('filter', draft.filter);
    setOrDelete('urgency', draft.urgency);
    setOrDelete('assignee', draft.assignee);
    setOrDelete('serviceId', draft.serviceId);
    setOrDelete('sort', draft.sort, 'created_desc');
    navigate(params);
    setOpen(false);
  };

  const reset = () => {
    setDraft({
      filter: 'all',
      urgency: 'all',
      assignee: 'all',
      serviceId: 'all',
      sort: 'created_desc',
    });
  };

  return (
    <section aria-label="Incident filters" className="space-y-2.5">
      <div className="flex items-center gap-2">
        <form
          className="relative min-w-0 flex-1"
          onSubmit={event => {
            event.preventDefault();
            submitSearch(query);
          }}
        >
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search incidents"
            type="search"
            autoComplete="off"
            className="h-[44px] min-h-[44px] rounded-xl bg-card pl-9 pr-10 text-sm shadow-none"
          />
          {query && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                setQuery('');
                submitSearch('');
              }}
              aria-label="Clear incident search"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </form>

        <Button
          type="button"
          variant={count > 0 ? 'default' : 'outline'}
          size="icon"
          className="relative h-11 w-11 shrink-0 rounded-xl"
          onClick={() => handleOpenChange(true)}
          aria-label={count > 0 ? `Filters, ${count} active` : 'Filters'}
        >
          <Filter className="h-4 w-4" aria-hidden="true" />
          {count > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white ring-2 ring-background">
              {count}
            </span>
          )}
        </Button>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3 px-0.5 text-[11px] text-muted-foreground">
        <span>
          {props.totalCount} {props.totalCount === 1 ? 'incident' : 'incidents'}
        </span>
        <span className="min-w-0 truncate text-right">
          {summary.length > 0
            ? summary.join(' · ')
            : props.currentSort === 'created_desc'
              ? 'Newest first'
              : props.currentSort === 'created_asc'
                ? 'Oldest first'
                : 'Urgency first'}
        </span>
      </div>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filter incidents</DialogTitle>
            <DialogDescription>
              Keep the list focused on the incidents you can act on now.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1">
            <label className="grid gap-1.5 text-xs font-semibold text-foreground">
              Status
              <Select
                value={draft.filter}
                onValueChange={value =>
                  setDraft(current => ({ ...current, filter: value as FilterValue }))
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All incidents</SelectItem>
                  <SelectItem value="all_open">Active</SelectItem>
                  <SelectItem value="open">Triggered</SelectItem>
                  <SelectItem value="acknowledged">Acknowledged</SelectItem>
                  <SelectItem value="muted">Muted</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label className="grid gap-1.5 text-xs font-semibold text-foreground">
              Urgency
              <Select
                value={draft.urgency}
                onValueChange={value => setDraft(current => ({ ...current, urgency: value }))}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All urgency</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label className="grid gap-1.5 text-xs font-semibold text-foreground">
              Assignment
              <Select
                value={draft.assignee}
                onValueChange={value => setDraft(current => ({ ...current, assignee: value }))}
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Anyone</SelectItem>
                  <SelectItem value={props.currentUserId}>Assigned to me</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>
            </label>

            {props.services.length > 0 && (
              <label className="grid gap-1.5 text-xs font-semibold text-foreground">
                Service
                <Select
                  value={draft.serviceId}
                  onValueChange={value => setDraft(current => ({ ...current, serviceId: value }))}
                >
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All services</SelectItem>
                    {props.services.map(service => (
                      <SelectItem key={service.id} value={service.id}>
                        {service.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}

            <label className="grid gap-1.5 text-xs font-semibold text-foreground">
              Sort
              <Select
                value={draft.sort}
                onValueChange={value =>
                  setDraft(current => ({ ...current, sort: value as SortValue }))
                }
              >
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created_desc">Newest first</SelectItem>
                  <SelectItem value="created_asc">Oldest first</SelectItem>
                  <SelectItem value="urgency">Urgency first</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11 min-h-[44px]"
              onClick={reset}
            >
              Reset
            </Button>
            <Button type="button" size="lg" className="h-11 min-h-[44px]" onClick={apply}>
              Apply filters
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
