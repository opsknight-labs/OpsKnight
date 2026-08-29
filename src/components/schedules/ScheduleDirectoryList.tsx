'use client';

import { useState, useMemo } from 'react';
import ScheduleCard from '@/components/ScheduleCard';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Search, X, Filter, CalendarClock } from 'lucide-react';

type ScheduleItem = {
  id: string;
  name: string;
  timeZone: string;
  layers: Array<{
    users: Array<{
      userId: string;
      user?: {
        name: string;
        avatarUrl?: string | null;
        gender?: string | null;
      } | null;
    }>;
  }>;
};

type ScheduleDirectoryListProps = {
  schedules: ScheduleItem[];
  canManageSchedules: boolean;
};

export default function ScheduleDirectoryList({
  schedules,
  canManageSchedules,
}: ScheduleDirectoryListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'configured' | 'needs-setup'>('all');

  const filteredSchedules = useMemo(() => {
    return schedules.filter(schedule => {
      const uniqueUsers = new Set<string>();
      schedule.layers.forEach(layer => {
        layer.users.forEach(u => uniqueUsers.add(u.userId));
      });
      const hasLayers = schedule.layers.length > 0;
      const isConfigured = hasLayers && uniqueUsers.size > 0;

      // Status filter
      if (statusFilter === 'configured' && !isConfigured) return false;
      if (statusFilter === 'needs-setup' && isConfigured) return false;

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = schedule.name.toLowerCase().includes(query);
        const matchesTz = schedule.timeZone.toLowerCase().includes(query);
        const matchesUser = schedule.layers.some(l =>
          l.users.some(u => u.user?.name?.toLowerCase().includes(query))
        );
        return matchesName || matchesTz || matchesUser;
      }

      return true;
    });
  }, [schedules, searchQuery, statusFilter]);

  const configuredCount = useMemo(
    () =>
      schedules.filter(s => s.layers.length > 0 && s.layers.some(l => l.users.length > 0)).length,
    [schedules]
  );
  const needsSetupCount = schedules.length - configuredCount;

  return (
    <div className="space-y-3.5">
      {/* Search & Filter Toolbar */}
      {schedules.length > 0 && (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search schedules by name, responder, or timezone..."
              className="pl-8 pr-8 h-8.5 text-xs placeholder:text-muted-foreground/60"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Status filter chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === 'all'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              All ({schedules.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('configured')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === 'configured'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              Configured ({configuredCount})
            </button>
            {needsSetupCount > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter('needs-setup')}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  statusFilter === 'needs-setup'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20'
                }`}
              >
                Needs setup ({needsSetupCount})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Grid or Empty Search State */}
      {filteredSchedules.length === 0 ? (
        <Card className="border-dashed py-10 text-center">
          <CardContent className="flex flex-col items-center justify-center p-0">
            <Filter className="h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-sm font-semibold text-foreground">No matching schedules</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {searchQuery
                ? `No schedules matched "${searchQuery}". Try a different search term.`
                : 'No schedules match the selected filter.'}
            </p>
            {(searchQuery || statusFilter !== 'all') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                }}
                className="mt-3 text-xs"
              >
                Reset filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredSchedules.map((schedule, index) => (
            <ScheduleCard key={schedule.id} schedule={schedule} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}
