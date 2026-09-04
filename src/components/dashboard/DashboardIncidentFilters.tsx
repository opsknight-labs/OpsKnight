'use client';

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  AlertCircle,
  Briefcase,
  Flame,
  MinusCircle,
  Search,
  ArrowUpDown,
  Activity,
  X,
} from 'lucide-react';
import DashboardTimeRange from '@/components/DashboardTimeRange';
import { cn } from '@/lib/utils';

type DashboardIncidentFiltersProps = {
  services: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string | null }>;
  currentStatus: string;
  currentUrgency: string;
  currentService: string;
  currentAssignee: string;
  currentSearch: string;
  currentSort: string;
  currentRange: string;
  currentCustomStart?: string;
  currentCustomEnd?: string;
  userId?: string | null;
};

const sortOptions = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'status', label: 'Status' },
  { value: 'urgency', label: 'Urgency' },
  { value: 'title', label: 'Title A-Z' },
];

export default function DashboardIncidentFilters({
  services,
  users: _users,
  currentStatus,
  currentUrgency,
  currentService,
  currentAssignee,
  currentSearch,
  currentSort,
  currentRange,
  currentCustomStart,
  currentCustomEnd,
  userId,
}: DashboardIncidentFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const currentQuery = searchParams.toString();
      const params = new URLSearchParams(currentQuery);
      params.delete('page');
      Object.entries(updates).forEach(([key, value]) => {
        if (value === 'all' || value === 'newest') {
          params.delete(key);
          return;
        }
        if (value === '' && key !== 'assignee') {
          params.delete(key);
          return;
        }
        if (key === 'assignee' && value === 'unassigned') {
          params.set(key, '');
          return;
        }
        params.set(key, value);
      });
      const nextQuery = params.toString();
      if (nextQuery === currentQuery) return;
      startTransition(() => {
        const nextUrl = nextQuery ? `/?${nextQuery}` : '/';
        router.push(nextUrl, { scroll: false });
      });
    },
    [router, searchParams, startTransition]
  );

  const clearFilters = () => {
    startTransition(() => {
      router.push('/', { scroll: false });
    });
  };

  const hasActiveFilters =
    currentSearch !== '' ||
    currentStatus !== 'all' ||
    currentUrgency !== 'all' ||
    currentService !== 'all' ||
    currentAssignee !== 'all' ||
    currentSort !== 'newest' ||
    currentRange !== '30' ||
    !!currentCustomStart ||
    !!currentCustomEnd;

  const activeFilterCount = [
    currentSearch !== '',
    currentStatus !== 'all',
    currentUrgency !== 'all',
    currentService !== 'all',
    currentAssignee !== 'all',
    currentRange !== '30' || !!currentCustomStart || !!currentCustomEnd,
  ].filter(Boolean).length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-xs p-3.5 space-y-2.5">
      {/* Top Bar: Search + Quick Filter Chips + Active indicator/Clear */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              id="dashboard-incident-search"
              placeholder="Search incidents..."
              className="h-8 pl-8 text-xs bg-slate-50/70 border-slate-200 hover:border-slate-300 focus:bg-white focus:border-blue-500 rounded-lg transition-colors placeholder:text-slate-400 text-slate-800"
              value={currentSearch}
              onChange={e => updateParams({ search: e.target.value })}
            />
          </div>

          {/* Quick Filter Chips */}
          <div className="flex items-center gap-1 overflow-x-auto py-0.5">
            <button
              type="button"
              onClick={() => updateParams({ status: 'all', assignee: 'all' })}
              className={cn(
                'h-7 px-2.5 text-xs font-medium rounded-md transition-all',
                currentStatus === 'all' && currentAssignee === 'all'
                  ? 'bg-slate-900 text-white shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              )}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => {
                if (!userId) return;
                if (currentAssignee === userId) {
                  updateParams({ assignee: 'all', status: 'all' });
                  return;
                }
                updateParams({ assignee: userId, status: 'ACTIVE' });
              }}
              className={cn(
                'h-7 px-2.5 text-xs font-medium rounded-md transition-all',
                userId && currentAssignee === userId
                  ? 'bg-blue-600 text-white shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              )}
            >
              Mine
            </button>
            <button
              type="button"
              onClick={() => {
                if (currentAssignee === 'unassigned') {
                  updateParams({ assignee: 'all', status: 'all' });
                  return;
                }
                updateParams({ assignee: 'unassigned', status: 'ACTIVE' });
              }}
              className={cn(
                'h-7 px-2.5 text-xs font-medium rounded-md transition-all',
                currentAssignee === 'unassigned'
                  ? 'bg-blue-600 text-white shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              )}
            >
              Unassigned
            </button>

            <div className="h-4 w-px bg-slate-200 mx-1" />

            <button
              type="button"
              onClick={() => updateParams({ urgency: currentUrgency === 'HIGH' ? 'all' : 'HIGH' })}
              className={cn(
                'h-7 px-2 text-xs font-medium rounded-md inline-flex items-center gap-1 transition-all',
                currentUrgency === 'HIGH'
                  ? 'bg-rose-100 text-rose-800 font-semibold border border-rose-200 shadow-2xs'
                  : 'text-slate-600 hover:text-rose-700 hover:bg-rose-50'
              )}
            >
              <Flame className="h-3 w-3 text-rose-500" />
              High
            </button>
            <button
              type="button"
              onClick={() =>
                updateParams({ urgency: currentUrgency === 'MEDIUM' ? 'all' : 'MEDIUM' })
              }
              className={cn(
                'h-7 px-2 text-xs font-medium rounded-md inline-flex items-center gap-1 transition-all',
                currentUrgency === 'MEDIUM'
                  ? 'bg-amber-100 text-amber-800 font-semibold border border-amber-200 shadow-2xs'
                  : 'text-slate-600 hover:text-amber-700 hover:bg-amber-50'
              )}
            >
              <AlertCircle className="h-3 w-3 text-amber-500" />
              Med
            </button>
            <button
              type="button"
              onClick={() => updateParams({ urgency: currentUrgency === 'LOW' ? 'all' : 'LOW' })}
              className={cn(
                'h-7 px-2 text-xs font-medium rounded-md inline-flex items-center gap-1 transition-all',
                currentUrgency === 'LOW'
                  ? 'bg-emerald-100 text-emerald-800 font-semibold border border-emerald-200 shadow-2xs'
                  : 'text-slate-600 hover:text-emerald-700 hover:bg-emerald-50'
              )}
            >
              <MinusCircle className="h-3 w-3 text-emerald-500" />
              Low
            </button>
          </div>
        </div>

        {/* Active Filters & Clear */}
        <div className="flex items-center gap-2">
          {activeFilterCount > 0 && (
            <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
              {activeFilterCount} active
            </span>
          )}
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              disabled={isPending}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
            >
              <X className="w-3 h-3" />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Bottom Bar: Dropdowns & Time Range */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-100">
        <div className="grid grid-cols-3 gap-2 flex-1 max-w-lg">
          {/* Service */}
          <Select
            value={currentService}
            onValueChange={val => updateParams({ service: val === 'all' ? 'all' : val })}
          >
            <SelectTrigger className="h-8 text-xs bg-slate-50/70 border-slate-200 hover:border-slate-300 focus:bg-white focus:border-blue-500 rounded-lg">
              <div className="flex items-center gap-1.5 truncate">
                <Briefcase className="h-3 w-3 text-blue-500 shrink-0" />
                <SelectValue placeholder="Service" />
              </div>
            </SelectTrigger>
            <SelectContent className="rounded-lg shadow-md border-slate-200">
              <SelectItem value="all">All services</SelectItem>
              {services.map(service => (
                <SelectItem key={service.id} value={service.id}>
                  {service.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status */}
          <Select value={currentStatus} onValueChange={val => updateParams({ status: val })}>
            <SelectTrigger className="h-8 text-xs bg-slate-50/70 border-slate-200 hover:border-slate-300 focus:bg-white focus:border-blue-500 rounded-lg">
              <div className="flex items-center gap-1.5 truncate">
                <Activity className="h-3 w-3 text-emerald-500 shrink-0" />
                <SelectValue placeholder="Status" />
              </div>
            </SelectTrigger>
            <SelectContent className="rounded-lg shadow-md border-slate-200">
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="OPEN">Triggered</SelectItem>
              <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
              <SelectItem value="RESOLVED">Resolved</SelectItem>
              <SelectItem value="SNOOZED">Snoozed</SelectItem>
              <SelectItem value="SUPPRESSED">Suppressed</SelectItem>
            </SelectContent>
          </Select>

          {/* Sort */}
          <Select
            value={currentSort}
            onValueChange={val => {
              const nextSort = sortOptions.find(option => option.value === val)?.value;
              if (!nextSort) return;
              if (nextSort === 'oldest') {
                updateParams({ sortBy: 'createdAt', sortOrder: 'asc' });
                return;
              }
              if (nextSort === 'status') {
                updateParams({ sortBy: 'status', sortOrder: 'asc' });
                return;
              }
              if (nextSort === 'urgency') {
                updateParams({ sortBy: 'urgency', sortOrder: 'desc' });
                return;
              }
              if (nextSort === 'title') {
                updateParams({ sortBy: 'title', sortOrder: 'asc' });
                return;
              }
              updateParams({ sortBy: 'all', sortOrder: 'all' });
            }}
          >
            <SelectTrigger className="h-8 text-xs bg-slate-50/70 border-slate-200 hover:border-slate-300 focus:bg-white focus:border-blue-500 rounded-lg">
              <div className="flex items-center gap-1.5 truncate">
                <ArrowUpDown className="h-3 w-3 text-violet-500 shrink-0" />
                <SelectValue placeholder="Sort" />
              </div>
            </SelectTrigger>
            <SelectContent className="rounded-lg shadow-md border-slate-200">
              {sortOptions.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Time Range */}
        <div className="shrink-0">
          <DashboardTimeRange tone="light" showLabel={false} />
        </div>
      </div>

      {isPending && (
        <div className="text-[10px] text-slate-400 animate-pulse font-medium">Updating...</div>
      )}
    </div>
  );
}
