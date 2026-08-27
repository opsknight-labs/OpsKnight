'use client';

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { Badge } from '@/components/ui/shadcn/badge';
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
      <CardHeader className="pb-2 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Filter className="h-4 w-4" /> Filter Incidents
            </CardTitle>
            <CardDescription className="text-xs">
              Quick filters and sorting for the incident list
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={clearFilters}
                disabled={isPending}
              >
                <X className="mr-1 h-3 w-3" /> Clear All
              </Button>
            )}
            {canCreateIncident && (
              <Button
                variant="default"
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={() => {
                  router.push('/incidents/create');
                }}
              >
                Create incident
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant={currentFilter === 'all' && currentTeamId === 'all' ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2 text-[11px] cursor-pointer rounded-md hover:bg-primary/90 hover:text-primary-foreground transition-colors"
            onClick={() => updateParams({ filter: 'all', teamId: 'all' })}
          >
            All incidents
          </Badge>
          <Badge
            variant={currentFilter === 'mine' ? 'info' : 'outline'}
            size="sm"
            className="h-7 px-2 text-[11px] cursor-pointer rounded-md hover:bg-blue-100 hover:text-blue-800 transition-colors"
            onClick={() =>
              updateParams({ filter: currentFilter === 'mine' ? 'all' : 'mine', teamId: 'all' })
            }
          >
            Mine
          </Badge>
          <Badge
            variant={currentFilter === 'acknowledged' ? 'warning' : 'outline'}
            size="sm"
            className="h-7 px-2 text-[11px] cursor-pointer rounded-md hover:bg-amber-100 hover:text-amber-800 transition-colors"
            onClick={() =>
              updateParams({
                filter: currentFilter === 'acknowledged' ? 'all' : 'acknowledged',
                teamId: 'all',
              })
            }
          >
            Acknowledged
          </Badge>
          {teams.length > 0 && (
            <Badge
              variant={currentTeamId === 'mine' ? 'info' : 'outline'}
              size="sm"
              className="h-7 px-2 text-[11px] cursor-pointer rounded-md hover:bg-indigo-100 hover:text-indigo-800 transition-colors"
              onClick={() => updateParams({ teamId: currentTeamId === 'mine' ? 'all' : 'mine' })}
            >
              My teams
            </Badge>
          )}
          <Badge
            variant={currentUrgency === 'all' ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2 text-[11px] cursor-pointer rounded-md hover:bg-primary/90 hover:text-primary-foreground transition-colors"
            onClick={() => updateParams({ urgency: 'all' })}
          >
            All urgency
          </Badge>
          <Badge
            variant={currentUrgency === 'HIGH' ? 'danger' : 'outline'}
            size="sm"
            className="h-7 px-2 text-[11px] cursor-pointer rounded-md hover:bg-red-100 hover:text-red-800 transition-colors"
            onClick={() => updateParams({ urgency: currentUrgency === 'HIGH' ? 'all' : 'HIGH' })}
          >
            <Flame className="mr-1 h-3 w-3" /> High urgency
          </Badge>
          <Badge
            variant={currentUrgency === 'MEDIUM' ? 'warning' : 'outline'}
            size="sm"
            className="h-7 px-2 text-[11px] cursor-pointer rounded-md hover:bg-amber-100 hover:text-amber-800 transition-colors"
            onClick={() =>
              updateParams({ urgency: currentUrgency === 'MEDIUM' ? 'all' : 'MEDIUM' })
            }
          >
            <AlertCircle className="mr-1 h-3 w-3" /> Medium urgency
          </Badge>
          <Badge
            variant={currentUrgency === 'LOW' ? 'success' : 'outline'}
            size="sm"
            className="h-7 px-2 text-[11px] cursor-pointer rounded-md hover:bg-emerald-100 hover:text-emerald-800 transition-colors"
            onClick={() => updateParams({ urgency: currentUrgency === 'LOW' ? 'all' : 'LOW' })}
          >
            <MinusCircle className="mr-1 h-3 w-3" /> Low urgency
          </Badge>
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
                className="h-9 pl-8 text-sm bg-muted/30 focus:bg-background transition-colors"
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
