'use client';

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Button } from '@/components/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import {
  Filter,
  X,
  Flame,
  AlertCircle,
  MinusCircle,
  Search,
  Briefcase,
  Activity,
  ShieldAlert,
  ArrowUpDown,
} from 'lucide-react';

type IncidentsFiltersProps = {
  currentFilter: string;
  currentSort?: string;
  currentPriority?: string;
  currentUrgency?: string;
  currentSearch?: string;
  currentTeamId?: string;
  teams?: Array<{ id: string; name: string }>;
  canCreateIncident?: boolean;
};

export default function IncidentsFilters({
  currentFilter,
  currentSort = 'newest',
  currentPriority = 'all',
  currentUrgency = 'all',
  currentSearch = '',
  currentTeamId = 'all',
  teams = [],
  canCreateIncident = false,
}: IncidentsFiltersProps) {
  const router = useRouter();
  const { openCreateIncident } = useCreateIncidentModal();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const currentQuery = searchParams.toString();
      const params = new URLSearchParams(currentQuery);
      params.delete('page');
      Object.entries(updates).forEach(([key, value]) => {
        if (key === 'filter') {
          if (value === '' || value === 'all') {
            params.delete(key);
          } else {
            params.set(key, value);
          }
          return;
        }
        if (value === 'all' || value === '' || value === 'newest') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });
      const nextQuery = params.toString();
      if (nextQuery === currentQuery) return;
      startTransition(() => {
        const nextUrl = nextQuery ? `/incidents?${nextQuery}` : '/incidents';
        router.push(nextUrl);
      });
    },
    [router, searchParams, startTransition]
  );

  const clearFilters = () => {
    startTransition(() => {
      router.push('/incidents');
    });
  };

  const hasActiveFilters =
    currentSearch !== '' ||
    currentPriority !== 'all' ||
    currentUrgency !== 'all' ||
    currentSort !== 'newest' ||
    currentFilter !== 'all' ||
    currentTeamId !== 'all';

  return (
    <Card>
      <CardHeader className="pb-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-bold">
              <Filter className="h-4 w-4 text-primary" /> Filter Incidents
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Quick filters and sorting for real-time incident triage
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-pointer"
                onClick={clearFilters}
                disabled={isPending}
              >
                <X className="mr-1 h-3.5 w-3.5" /> Clear filters
              </Button>
            )}
            {canCreateIncident && (
              <Button
                variant="default"
                size="sm"
                className="h-8 px-3.5 text-xs font-semibold shadow-xs cursor-pointer"
                onClick={() => {
                  openCreateIncident();
                }}
              >
                Create incident
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => updateParams({ filter: 'all', teamId: 'all' })}
            className={cn(
              'h-7 px-3 text-xs font-medium rounded-full border transition-all cursor-pointer shadow-2xs',
              currentFilter === 'all' && currentTeamId === 'all'
                ? 'bg-primary text-primary-foreground border-primary font-semibold shadow-xs'
                : 'bg-card border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border'
            )}
          >
            All incidents
          </button>
          <button
            type="button"
            onClick={() =>
              updateParams({ filter: currentFilter === 'mine' ? 'all' : 'mine', teamId: 'all' })
            }
            className={cn(
              'h-7 px-3 text-xs font-medium rounded-full border transition-all cursor-pointer shadow-2xs',
              currentFilter === 'mine'
                ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-300/80 dark:border-blue-700/60 font-semibold shadow-xs'
                : 'bg-card border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border'
            )}
          >
            Mine
          </button>
          <button
            type="button"
            onClick={() =>
              updateParams({
                filter: currentFilter === 'acknowledged' ? 'all' : 'acknowledged',
                teamId: 'all',
              })
            }
            className={cn(
              'h-7 px-3 text-xs font-medium rounded-full border transition-all cursor-pointer shadow-2xs',
              currentFilter === 'acknowledged'
                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-300/80 dark:border-amber-700/60 font-semibold shadow-xs'
                : 'bg-card border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border'
            )}
          >
            Acknowledged
          </button>
          {teams.length > 0 && (
            <button
              type="button"
              onClick={() => updateParams({ teamId: currentTeamId === 'mine' ? 'all' : 'mine' })}
              className={cn(
                'h-7 px-3 text-xs font-medium rounded-full border transition-all cursor-pointer shadow-2xs',
                currentTeamId === 'mine'
                  ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-300/80 dark:border-indigo-700/60 font-semibold shadow-xs'
                  : 'bg-card border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border'
              )}
            >
              My teams
            </button>
          )}

          <div className="h-4 w-px bg-border/60 mx-1 hidden sm:block" />

          <button
            type="button"
            onClick={() => updateParams({ urgency: 'all' })}
            className={cn(
              'h-7 px-3 text-xs font-medium rounded-full border transition-all cursor-pointer shadow-2xs',
              currentUrgency === 'all'
                ? 'bg-primary text-primary-foreground border-primary font-semibold shadow-xs'
                : 'bg-card border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border'
            )}
          >
            All urgency
          </button>
          <button
            type="button"
            onClick={() => updateParams({ urgency: currentUrgency === 'HIGH' ? 'all' : 'HIGH' })}
            className={cn(
              'h-7 px-3 text-xs font-medium rounded-full border transition-all cursor-pointer shadow-2xs inline-flex items-center gap-1',
              currentUrgency === 'HIGH'
                ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-300/80 dark:border-rose-700/60 font-semibold shadow-xs'
                : 'bg-card border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border'
            )}
          >
            <Flame className="h-3 w-3" /> High urgency
          </button>
          <button
            type="button"
            onClick={() =>
              updateParams({ urgency: currentUrgency === 'MEDIUM' ? 'all' : 'MEDIUM' })
            }
            className={cn(
              'h-7 px-3 text-xs font-medium rounded-full border transition-all cursor-pointer shadow-2xs inline-flex items-center gap-1',
              currentUrgency === 'MEDIUM'
                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-300/80 dark:border-amber-700/60 font-semibold shadow-xs'
                : 'bg-card border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border'
            )}
          >
            <AlertCircle className="h-3 w-3" /> Medium urgency
          </button>
          <button
            type="button"
            onClick={() => updateParams({ urgency: currentUrgency === 'LOW' ? 'all' : 'LOW' })}
            className={cn(
              'h-7 px-3 text-xs font-medium rounded-full border transition-all cursor-pointer shadow-2xs inline-flex items-center gap-1',
              currentUrgency === 'LOW'
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300/80 dark:border-emerald-700/60 font-semibold shadow-xs'
                : 'bg-card border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:border-border'
            )}
          >
            <MinusCircle className="h-3 w-3" /> Low urgency
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="space-y-1.5">
            <Label
              htmlFor="incident-search"
              className="text-[11px] font-semibold uppercase text-muted-foreground"
            >
              Search
            </Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="incident-search"
                placeholder="Title, description, or ID"
                className="h-9 pl-10 text-sm bg-muted/30 focus:bg-background transition-colors"
                style={{ paddingLeft: '2.5rem' }}
                value={currentSearch}
                onChange={e => updateParams({ search: e.target.value.trim() })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase text-muted-foreground">
              Priority
            </Label>
            <Select
              value={currentPriority}
              onValueChange={val => updateParams({ priority: val === 'all' ? 'all' : val })}
            >
              <SelectTrigger className="h-9 bg-muted/30 focus:bg-background transition-colors text-sm">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="All priorities" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                <SelectItem value="P1">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-red-600 animate-pulse" />
                    <span>P1 - Critical</span>
                  </div>
                </SelectItem>
                <SelectItem value="P2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                    <span>P2 - High</span>
                  </div>
                </SelectItem>
                <SelectItem value="P3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                    <span>P3 - Medium</span>
                  </div>
                </SelectItem>
                <SelectItem value="P4">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    <span>P4 - Low</span>
                  </div>
                </SelectItem>
                <SelectItem value="P5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                    <span>P5 - Info</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase text-muted-foreground">
              Status
            </Label>
            <Select value={currentFilter} onValueChange={val => updateParams({ filter: val })}>
              <SelectTrigger className="h-9 bg-muted/30 focus:bg-background transition-colors text-sm">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="All statuses" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="all_open">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    <span>Active</span>
                  </div>
                </SelectItem>
                <SelectItem value="open">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    <span>Triggered</span>
                  </div>
                </SelectItem>
                <SelectItem value="acknowledged">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    <span>Acknowledged</span>
                  </div>
                </SelectItem>
                <SelectItem value="mine">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                    <span>My incidents</span>
                  </div>
                </SelectItem>
                <SelectItem value="resolved">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                    <span>Resolved</span>
                  </div>
                </SelectItem>
                <SelectItem value="muted">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                    <span>Muted (Snoozed + Suppressed)</span>
                  </div>
                </SelectItem>
                <SelectItem value="snoozed">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                    <span>Snoozed</span>
                  </div>
                </SelectItem>
                <SelectItem value="suppressed">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                    <span>Suppressed</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase text-muted-foreground">
              Team
            </Label>
            <Select value={currentTeamId} onValueChange={val => updateParams({ teamId: val })}>
              <SelectTrigger className="h-9 bg-muted/30 focus:bg-background transition-colors text-sm">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="All teams" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {teams.length > 0 && <SelectItem value="mine">My teams</SelectItem>}
                {teams.map(team => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase text-muted-foreground">
              Urgency
            </Label>
            <Select
              value={currentUrgency}
              onValueChange={val => updateParams({ urgency: val === 'all' ? 'all' : val })}
            >
              <SelectTrigger className="h-9 bg-muted/30 focus:bg-background transition-colors text-sm">
                <div className="flex items-center gap-2">
                  <Flame className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="All urgency" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All urgency</SelectItem>
                <SelectItem value="HIGH">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    <span>High</span>
                  </div>
                </SelectItem>
                <SelectItem value="MEDIUM">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    <span>Medium</span>
                  </div>
                </SelectItem>
                <SelectItem value="LOW">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <span>Low</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase text-muted-foreground">
              Sort
            </Label>
            <Select
              value={currentSort}
              onValueChange={val => updateParams({ sort: val === 'newest' ? 'newest' : val })}
            >
              <SelectTrigger className="h-9 bg-muted/30 focus:bg-background transition-colors text-sm">
                <div className="flex items-center gap-2">
                  <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
                  <SelectValue placeholder="Sort" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="priority">Priority (P1-P5)</SelectItem>
                <SelectItem value="status">Status</SelectItem>
                <SelectItem value="updated">Recently updated</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isPending && (
          <div className="text-[11px] text-muted-foreground animate-pulse">Loading...</div>
        )}
      </CardContent>
    </Card>
  );
}
