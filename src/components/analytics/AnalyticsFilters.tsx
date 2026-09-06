'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useTransition } from 'react';
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
import { Filter, X, Activity, Shield, Briefcase, Clock, Users, Zap } from 'lucide-react';

interface AnalyticsFiltersProps {
  teams: Array<{ id: string; name: string }>;
  services: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string | null; email: string | null }>;
  currentFilters: {
    team?: string;
    service?: string;
    assignee?: string;
    status?: string;
    urgency?: string;
    window?: string;
  };
}

export default function AnalyticsFilters({
  teams,
  services,
  users,
  currentFilters,
}: AnalyticsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const statusOptions = ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED', 'RESOLVED'];
  const urgencyOptions = ['HIGH', 'MEDIUM', 'LOW'];
  const windowOptions = [1, 3, 7, 14, 30, 60, 90, 180, 365];

  const getUserName = (user: { name: string | null; email: string | null }) => {
    return user.name || user.email || 'Unknown user';
  };

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== 'ALL') {
        params.set(name, value);
      } else {
        params.delete(name);
      }
      return params.toString();
    },
    [searchParams]
  );

  const handleFilterChange = (name: string, value: string) => {
    startTransition(() => {
      router.push(`/analytics?${createQueryString(name, value)}`);
    });
  };

  const clearFilters = () => {
    startTransition(() => {
      router.push('/analytics');
    });
  };

  const hasFilters =
    !!currentFilters.team ||
    !!currentFilters.service ||
    !!currentFilters.assignee ||
    !!currentFilters.status ||
    !!currentFilters.urgency ||
    (currentFilters.window && currentFilters.window !== '7');

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-4 w-4" /> Filter Analytics
            </CardTitle>
            <CardDescription>Refine your analytics view</CardDescription>
          </div>
          {hasFilters && (
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
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Team</Label>
            <Select
              value={currentFilters.team || 'ALL'}
              onValueChange={val => handleFilterChange('team', val)}
            >
              <SelectTrigger className="h-10 bg-muted/30 focus:bg-background transition-colors text-sm">
                <div className="flex items-center gap-2 truncate">
                  <Briefcase className="h-4 w-4 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="All Teams" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All teams</SelectItem>
                {teams
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(team => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Service</Label>
            <Select
              value={currentFilters.service || 'ALL'}
              onValueChange={val => handleFilterChange('service', val)}
            >
              <SelectTrigger className="h-10 bg-muted/30 focus:bg-background transition-colors text-sm">
                <div className="flex items-center gap-2 truncate">
                  <Activity className="h-4 w-4 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="All Services" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All services</SelectItem>
                {services
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(service => (
                    <SelectItem key={service.id} value={service.id}>
                      {service.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">
              Assignee
            </Label>
            <Select
              value={currentFilters.assignee || 'ALL'}
              onValueChange={val => handleFilterChange('assignee', val)}
            >
              <SelectTrigger className="h-10 bg-muted/30 focus:bg-background transition-colors text-sm">
                <div className="flex items-center gap-2 truncate">
                  <Users className="h-4 w-4 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="All Assignees" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All assignees</SelectItem>
                {users
                  .slice()
                  .sort((a, b) => getUserName(a).localeCompare(getUserName(b)))
                  .map(user => (
                    <SelectItem key={user.id} value={user.id}>
                      {getUserName(user)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Status</Label>
            <Select
              value={currentFilters.status || 'ALL'}
              onValueChange={val => handleFilterChange('status', val)}
            >
              <SelectTrigger className="h-10 bg-muted/30 focus:bg-background transition-colors text-sm">
                <div className="flex items-center gap-2 truncate">
                  <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="All Statuses" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {statusOptions.map(status => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Urgency</Label>
            <Select
              value={currentFilters.urgency || 'ALL'}
              onValueChange={val => handleFilterChange('urgency', val)}
            >
              <SelectTrigger className="h-10 bg-muted/30 focus:bg-background transition-colors text-sm">
                <div className="flex items-center gap-2 truncate">
                  <Zap className="h-4 w-4 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="All Urgencies" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All urgencies</SelectItem>
                {urgencyOptions.map(urgency => (
                  <SelectItem key={urgency} value={urgency}>
                    {urgency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">
              Time Window
            </Label>
            <Select
              value={currentFilters.window || '7'}
              onValueChange={val => handleFilterChange('window', val)}
            >
              <SelectTrigger className="h-10 bg-muted/30 focus:bg-background transition-colors text-sm">
                <div className="flex items-center gap-2 truncate">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Last 7 days" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {windowOptions.map(days => (
                  <SelectItem key={days} value={`${days}`}>
                    Last {days} {days === 1 ? 'day' : 'days'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
