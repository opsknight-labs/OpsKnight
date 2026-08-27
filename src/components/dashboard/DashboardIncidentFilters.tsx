'use client';

import { useCallback, useMemo, useTransition } from 'react';
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
  MinusCircle,
  Search,
  ArrowUpDown,
  Activity,
  X,
  ChevronRight,
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
  users,
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
    <div className="group relative rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-white to-primary/5 shadow-sm hover:shadow-md transition-all duration-300 overflow-hidden">
      {/* Accent bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary to-primary/60" />

      {/* Header */}
      <div className="p-4 pb-3 border-b border-slate-200/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Filter className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Filter Incidents</h3>
              <p className="text-[10px] text-slate-500 font-medium">Refine your incident feed</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
              className="cursor-pointer transition-colors"
              onClick={() => updateParams({ status: 'all', assignee: 'all' })}
            >
              All
            </Badge>
            <Badge
              variant={userId && currentAssignee === userId ? 'info' : 'outline'}
              size="xs"
              className="cursor-pointer transition-colors"
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
              className="cursor-pointer transition-colors"
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
            <div className="h-5 w-px bg-slate-200 mx-0.5" />
            <Badge
              variant={currentUrgency === 'HIGH' ? 'danger' : 'outline'}
              size="xs"
              className="cursor-pointer transition-colors"
              onClick={() => updateParams({ urgency: currentUrgency === 'HIGH' ? 'all' : 'HIGH' })}
            >
              <Flame className="mr-0.5 h-3 w-3" /> High
            </Badge>
            <Badge
              variant={currentUrgency === 'MEDIUM' ? 'warning' : 'outline'}
              size="xs"
              className="cursor-pointer transition-colors"
              onClick={() =>
                updateParams({ urgency: currentUrgency === 'MEDIUM' ? 'all' : 'MEDIUM' })
              }
            >
              <AlertCircle className="mr-0.5 h-3 w-3" /> Medium
            </Badge>
            <Badge
              variant={currentUrgency === 'LOW' ? 'success' : 'outline'}
              size="xs"
              className="cursor-pointer transition-colors"
              onClick={() => updateParams({ urgency: currentUrgency === 'LOW' ? 'all' : 'LOW' })}
            >
              <MinusCircle className="mr-0.5 h-3 w-3" /> Low
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
                className="h-9 pl-8 text-xs bg-white border-slate-200 focus:border-blue-300 rounded-lg"
                value={currentSearch}
                onChange={e => updateParams({ search: e.target.value })}
              />
            </div>

            {/* Service */}
            <Select
              value={currentService}
              onValueChange={val => updateParams({ service: val === 'all' ? 'all' : val })}
            >
              <SelectTrigger className="h-9 text-xs bg-white border-slate-200 focus:border-blue-300 rounded-lg">
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
              <SelectTrigger className="h-9 text-xs bg-white border-slate-200 focus:border-blue-300 rounded-lg">
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
              <SelectTrigger className="h-9 text-xs bg-white border-slate-200 focus:border-blue-300 rounded-lg">
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

        {isPending && <div className="text-[10px] text-slate-400 animate-pulse">Updating...</div>}
      </div>
    </div>
  );
}
