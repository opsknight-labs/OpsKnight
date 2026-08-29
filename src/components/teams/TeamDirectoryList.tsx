'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Search, X, Filter, Users, Sparkles, Plus } from 'lucide-react';
import TeamDirectoryCard from './TeamDirectoryCard';

type TeamItem = {
  id: string;
  name: string;
  description?: string | null;
  teamLead?: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
  members: Array<{
    userId: string;
    role: string;
    user: {
      id?: string;
      name: string;
      avatarUrl?: string | null;
      gender?: string | null;
    };
  }>;
  services: Array<{
    id: string;
    name: string;
  }>;
  _count: {
    members: number;
    services: number;
  };
};

type TeamDirectoryListProps = {
  teams: TeamItem[];
};

export default function TeamDirectoryList({ teams }: TeamDirectoryListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'configured' | 'needs-lead' | 'needs-services'
  >('all');

  const filteredTeams = useMemo(() => {
    return teams.filter(team => {
      const hasMembers = team._count.members > 0;
      const hasLead = Boolean(team.teamLead);
      const hasServices = team._count.services > 0;

      // Status filters
      if (statusFilter === 'configured' && (!hasMembers || !hasLead)) return false;
      if (statusFilter === 'needs-lead' && hasLead) return false;
      if (statusFilter === 'needs-services' && hasServices) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = team.name.toLowerCase().includes(q);
        const matchesDesc = (team.description || '').toLowerCase().includes(q);
        const matchesLead = (team.teamLead?.name || '').toLowerCase().includes(q);
        const matchesMember = team.members.some(m => m.user.name.toLowerCase().includes(q));
        const matchesService = team.services.some(s => s.name.toLowerCase().includes(q));
        return matchesName || matchesDesc || matchesLead || matchesMember || matchesService;
      }

      return true;
    });
  }, [teams, searchQuery, statusFilter]);

  const configuredCount = useMemo(
    () => teams.filter(t => t._count.members > 0 && t.teamLead).length,
    [teams]
  );
  const needsLeadCount = useMemo(() => teams.filter(t => !t.teamLead).length, [teams]);

  // Zero-teams total onboarding empty state
  if (teams.length === 0) {
    return (
      <Card className="border-dashed py-12 text-center shadow-xs">
        <CardContent className="flex flex-col items-center justify-center p-0 space-y-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Welcome to Teams</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto leading-relaxed">
              Teams group engineers, define incident escalation hierarchies, and attach service
              ownership. Create your first team above to get started.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3.5">
      {/* Search & Filter Toolbar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search teams by name, member, or service..."
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

        {/* Status Filter Chips */}
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
            All ({teams.length})
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
          {needsLeadCount > 0 && (
            <button
              type="button"
              onClick={() => setStatusFilter('needs-lead')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                statusFilter === 'needs-lead'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20'
              }`}
            >
              Needs lead ({needsLeadCount})
            </button>
          )}
        </div>
      </div>

      {/* Grid or Filtered Empty State */}
      {filteredTeams.length === 0 ? (
        <Card className="border-dashed py-10 text-center">
          <CardContent className="flex flex-col items-center justify-center p-0">
            <Filter className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm font-semibold text-foreground">No matching teams</p>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-sm">
              {searchQuery
                ? `No teams matched "${searchQuery}". Try searching with a different term.`
                : 'No teams match the selected filter.'}
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
        <div className="grid gap-3.5 sm:grid-cols-2">
          {filteredTeams.map(team => (
            <TeamDirectoryCard key={team.id} team={team} />
          ))}
        </div>
      )}
    </div>
  );
}
