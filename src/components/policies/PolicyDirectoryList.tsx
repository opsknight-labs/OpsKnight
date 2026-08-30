'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Search, X, ShieldAlert, Layers } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import PolicyDirectoryCard, { type PolicyDirectoryItem } from './PolicyDirectoryCard';

type FilterType = 'all' | 'in-use' | 'unassigned';

type PolicyDirectoryListProps = {
  policies: PolicyDirectoryItem[];
  canManage?: boolean;
};

export default function PolicyDirectoryList({
  policies,
  canManage = false,
}: PolicyDirectoryListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  const filteredPolicies = useMemo(() => {
    return policies.filter(policy => {
      const matchesSearch =
        searchQuery === '' ||
        policy.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (policy.description &&
          policy.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
        policy.services.some(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;

      if (activeFilter === 'in-use') {
        return policy.serviceCount > 0;
      }
      if (activeFilter === 'unassigned') {
        return policy.serviceCount === 0;
      }

      return true;
    });
  }, [policies, searchQuery, activeFilter]);

  const inUseCount = useMemo(() => policies.filter(p => p.serviceCount > 0).length, [policies]);
  const unassignedCount = useMemo(
    () => policies.filter(p => p.serviceCount === 0).length,
    [policies]
  );

  if (policies.length === 0) {
    return (
      <Card className="border-dashed border-2 bg-gradient-to-br from-slate-50/50 via-white to-slate-50/30">
        <CardContent className="p-8 md:p-12 text-center space-y-6">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-xs">
            <ShieldAlert className="h-7 w-7" />
          </div>

          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-lg font-bold text-foreground">No Escalation Policies Configured</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Escalation policies ensure incident alerts are routed to the right engineers or teams
              and automatically escalated if unacknowledged.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl mx-auto text-left pt-2">
            <div className="p-3.5 rounded-xl border border-slate-200/80 bg-white shadow-2xs space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <span className="h-4 w-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center font-bold">
                  1
                </span>
                <span>Create Policy</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Define the policy name and repeat cadence.
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200/80 bg-white shadow-2xs space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <span className="h-4 w-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center font-bold">
                  2
                </span>
                <span>Add Steps</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Target users, teams, or on-call schedules with minute delays.
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200/80 bg-white shadow-2xs space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <span className="h-4 w-4 rounded-full bg-primary/10 text-primary text-[10px] flex items-center justify-center font-bold">
                  3
                </span>
                <span>Attach Services</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Link critical services to trigger routing on alert creation.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3.5">
      {/* Search & Filter Toolbar */}
      {policies.length > 0 && (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search policies by name, description, or service..."
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
              onClick={() => setActiveFilter('all')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                activeFilter === 'all'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              All ({policies.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('in-use')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                activeFilter === 'in-use'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              In Use ({inUseCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('unassigned')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                activeFilter === 'unassigned'
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              Unassigned ({unassignedCount})
            </button>
          </div>
        </div>
      )}

      {/* Policy Card Grid */}
      {filteredPolicies.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredPolicies.map(policy => (
            <PolicyDirectoryCard key={policy.id} policy={policy} canManage={canManage} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Layers className="h-6 w-6 text-muted-foreground/60" />}
          title="No matching escalation policies"
          description="Try adjusting your search query or switching active filter tabs."
          action={
            searchQuery || activeFilter !== 'all' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setActiveFilter('all');
                }}
                className="text-xs h-8"
              >
                Reset Filters
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
