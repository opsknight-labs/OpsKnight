'use client';

import { useCallback, useState, useRef, useEffect, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  AlertCircle,
  Briefcase,
  Filter,
  Flame,
  Loader2,
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

  // Local state for search to prevent re-rendering server components on every keystroke
  const [searchValue, setSearchValue] = useState(currentSearch);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronize local searchValue when currentSearch changes externally (e.g. clear filters or browser nav)
  useEffect(() => {
    setSearchValue(currentSearch);
  }, [currentSearch]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

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

  const handleSearchChange = (val: string) => {
    setSearchValue(val);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      updateParams({ search: val });
    }, 300);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      updateParams({ search: searchValue });
    }
  };

  const clearFilters = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setSearchValue('');
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
    <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
      {/* Header */}
      <div className="p-4 pb-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Filter className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Filter Incidents</h3>
              <p className="text-[10px] text-muted-foreground font-medium">
                Refine your incident feed
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isPending && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium mr-1">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                <span>Updating...</span>
              </div>
            )}
            {activeFilterCount > 0 && (
              <Badge variant="info" size="xs">
                {activeFilterCount} active
              </Badge>
            )}
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                disabled={isPending}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Quick Filters */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
            Quick Filters
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Badge
              variant={currentStatus === 'all' && currentAssignee === 'all' ? 'default' : 'outline'}
              size="xs"
              className={cn(
                'cursor-pointer transition-colors',
                currentStatus === 'all' && currentAssignee === 'all'
                  ? 'bg-[#09090b] text-white border-zinc-800 hover:bg-[#18181b]'
                  : 'hover:bg-slate-100 hover:border-slate-300'
              )}
              onClick={() => updateParams({ status: 'all', assignee: 'all' })}
            >
              All
            </Badge>
            <Badge
              variant={userId && currentAssignee === userId ? 'info' : 'outline'}
              size="xs"
              className={cn(
                'cursor-pointer transition-colors',
                userId && currentAssignee === userId
                  ? 'bg-sky-50 text-sky-700 border-sky-300 hover:bg-sky-100/70 font-semibold'
                  : 'hover:bg-slate-100 hover:border-slate-300'
              )}
              onClick={() => {
                if (!userId) return;
                if (currentAssignee === userId) {
                  updateParams({ assignee: 'all', status: 'all' });
                  return;
                }
                updateParams({ assignee: userId, status: 'ACTIVE' });
              }}
            >
              Mine
            </Badge>
            <Badge
              variant={currentAssignee === 'unassigned' ? 'info' : 'outline'}
              size="xs"
              className={cn(
                'cursor-pointer transition-colors',
                currentAssignee === 'unassigned'
                  ? 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100/70 font-semibold'
                  : 'hover:bg-slate-100 hover:border-slate-300'
              )}
              onClick={() => {
                if (currentAssignee === 'unassigned') {
                  updateParams({ assignee: 'all', status: 'all' });
                  return;
                }
                updateParams({ assignee: 'unassigned', status: 'ACTIVE' });
              }}
            >
              Unassigned
            </Badge>
            <div className="h-5 w-px bg-slate-300 mx-0.5" />
            <Badge
              variant={currentUrgency === 'HIGH' ? 'danger' : 'outline'}
              size="xs"
              className={cn(
                'cursor-pointer transition-colors',
                currentUrgency === 'HIGH'
                  ? 'bg-rose-50 text-rose-700 border-rose-300 hover:bg-rose-100/70 font-semibold'
                  : 'hover:bg-slate-100 hover:border-slate-300'
              )}
              onClick={() => updateParams({ urgency: currentUrgency === 'HIGH' ? 'all' : 'HIGH' })}
            >
              <Flame className="mr-0.5 h-3 w-3 text-rose-600" /> High
            </Badge>
            <Badge
              variant={currentUrgency === 'MEDIUM' ? 'warning' : 'outline'}
              size="xs"
              className={cn(
                'cursor-pointer transition-colors',
                currentUrgency === 'MEDIUM'
                  ? 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100/70 font-semibold'
                  : 'hover:bg-slate-100 hover:border-slate-300'
              )}
              onClick={() =>
                updateParams({ urgency: currentUrgency === 'MEDIUM' ? 'all' : 'MEDIUM' })
              }
            >
              <AlertCircle className="mr-0.5 h-3 w-3 text-amber-600" /> Medium
            </Badge>
            <Badge
              variant={currentUrgency === 'LOW' ? 'success' : 'outline'}
              size="xs"
              className={cn(
                'cursor-pointer transition-colors',
                currentUrgency === 'LOW'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100/70 font-semibold'
                  : 'hover:bg-slate-100 hover:border-slate-300'
              )}
              onClick={() => updateParams({ urgency: currentUrgency === 'LOW' ? 'all' : 'LOW' })}
            >
              <MinusCircle className="mr-0.5 h-3 w-3 text-emerald-600" /> Low
            </Badge>
          </div>
        </div>

        {/* Advanced Filters Grid */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Advanced</p>

          {/* Time Range - Full Width */}
          <div className="mb-3">
            <DashboardTimeRange tone="light" showLabel={false} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input
                id="dashboard-incident-search"
                placeholder="Search..."
                className="h-9 pl-8 text-xs bg-white border-border hover:border-slate-300 focus:border-zinc-400 rounded-lg shadow-2xs"
                value={searchValue}
                onChange={e => handleSearchChange(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </div>

            {/* Service */}
            <Select
              value={currentService}
              onValueChange={val => updateParams({ service: val === 'all' ? 'all' : val })}
            >
              <SelectTrigger className="h-9 text-xs bg-white border-border hover:border-slate-300 focus:border-zinc-400 rounded-lg shadow-2xs">
                <div className="flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5 text-blue-500" />
                  <SelectValue placeholder="Service" />
                </div>
              </SelectTrigger>
              <SelectContent className="rounded-lg">
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
              <SelectTrigger className="h-9 text-xs bg-white border-border hover:border-slate-300 focus:border-zinc-400 rounded-lg shadow-2xs">
                <div className="flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-emerald-500" />
                  <SelectValue placeholder="Status" />
                </div>
              </SelectTrigger>
              <SelectContent className="rounded-lg">
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
              <SelectTrigger className="h-9 text-xs bg-white border-border hover:border-slate-300 focus:border-zinc-400 rounded-lg shadow-2xs">
                <div className="flex items-center gap-1.5">
                  <ArrowUpDown className="h-3.5 w-3.5 text-violet-500" />
                  <SelectValue placeholder="Sort" />
                </div>
              </SelectTrigger>
              <SelectContent className="rounded-lg">
                {sortOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
