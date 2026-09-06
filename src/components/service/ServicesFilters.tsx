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
  Search,
  Activity,
  Users,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

type ServicesFiltersProps = {
  currentSearch?: string;
  currentStatus?: string;
  currentTeam?: string;
  currentSort?: string;
  teams: Array<{ id: string; name: string }>;
};

export default function ServicesFilters({
  currentSearch = '',
  currentStatus = 'all',
  currentTeam = 'all',
  currentSort = 'name_asc',
  teams,
}: ServicesFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const currentQuery = searchParams.toString();
      const params = new URLSearchParams(currentQuery);

      Object.entries(updates).forEach(([key, value]) => {
        if (value === 'all' || value === '' || value === 'name_asc') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });

      const nextQuery = params.toString();
      if (nextQuery === currentQuery) return;

      startTransition(() => {
        const nextUrl = nextQuery ? `/services?${nextQuery}` : '/services';
        router.push(nextUrl);
      });
    },
    [router, searchParams]
  );

  const clearFilters = () => {
    startTransition(() => {
      router.push('/services');
    });
  };

  const hasActiveFilters =
    currentSearch !== '' ||
    currentStatus !== 'all' ||
    currentTeam !== 'all' ||
    currentSort !== 'name_asc';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-4 w-4" /> Filter Services
            </CardTitle>
            <CardDescription>Find services by name, team, status, or tier</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
                onClick={clearFilters}
                disabled={isPending}
              >
                <X className="mr-1 h-3 w-3" /> Clear All
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick Filters */}
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={currentStatus === 'all' ? 'default' : 'outline'}
            size="sm"
            className="cursor-pointer hover:bg-primary/90 hover:text-primary-foreground transition-colors"
            onClick={() => updateParams({ status: 'all' })}
          >
            All services
          </Badge>
          <Badge
            variant={currentStatus === 'OPERATIONAL' ? 'success' : 'outline'}
            size="sm"
            className="cursor-pointer hover:bg-emerald-100 hover:text-emerald-800 transition-colors"
            onClick={() =>
              updateParams({ status: currentStatus === 'OPERATIONAL' ? 'all' : 'OPERATIONAL' })
            }
          >
            <CheckCircle2 className="mr-1 h-3 w-3" /> Operational
          </Badge>
          <Badge
            variant={currentStatus === 'DEGRADED' ? 'warning' : 'outline'}
            size="sm"
            className="cursor-pointer hover:bg-yellow-100 hover:text-yellow-800 transition-colors"
            onClick={() =>
              updateParams({ status: currentStatus === 'DEGRADED' ? 'all' : 'DEGRADED' })
            }
          >
            <AlertTriangle className="mr-1 h-3 w-3" /> Degraded
          </Badge>
          <Badge
            variant={currentStatus === 'CRITICAL' ? 'danger' : 'outline'}
            size="sm"
            className="cursor-pointer hover:bg-red-100 hover:text-red-800 transition-colors"
            onClick={() =>
              updateParams({ status: currentStatus === 'CRITICAL' ? 'all' : 'CRITICAL' })
            }
          >
            <XCircle className="mr-1 h-3 w-3" /> Critical
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Search */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name..."
                value={currentSearch}
                onChange={e => updateParams({ search: e.target.value })}
                className="pl-8"
              />
            </div>
          </div>

          {/* Team Filter */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">
              <Users className="h-3 w-3" /> Team
            </Label>
            <Select value={currentTeam} onValueChange={value => updateParams({ team: value })}>
              <SelectTrigger>
                <SelectValue placeholder="All Teams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Teams</SelectItem>
                {teams.map(team => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status Filter (Dropdown backup) */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">
              <Activity className="h-3 w-3" /> Status
            </Label>
            <Select value={currentStatus} onValueChange={value => updateParams({ status: value })}>
              <SelectTrigger>
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="OPERATIONAL">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500" />
                    Operational
                  </div>
                </SelectItem>
                <SelectItem value="DEGRADED">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-yellow-500" />
                    Degraded
                  </div>
                </SelectItem>
                <SelectItem value="CRITICAL">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-red-500" />
                    Critical
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Sort */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase">Sort By</Label>
            <Select value={currentSort} onValueChange={value => updateParams({ sort: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Sort order" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name_asc">Name (A-Z)</SelectItem>
                <SelectItem value="name_desc">Name (Z-A)</SelectItem>
                <SelectItem value="status">Status Health</SelectItem>
                <SelectItem value="incidents_desc">Most Incidents</SelectItem>
                <SelectItem value="incidents_asc">Least Incidents</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
