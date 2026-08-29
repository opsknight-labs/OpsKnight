'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Search, X, ShieldAlert, Layers } from 'lucide-react';
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
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search policies by name, description, or service..."
            className="pl-8.5 pr-8 h-8.5 text-xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 shrink-0 overflow-x-auto pb-1 sm:pb-0">
          <Button
            variant={activeFilter === 'all' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveFilter('all')}
            className="h-8 text-xs font-medium px-3 rounded-lg"
          >
            All Policies
            <Badge
              variant={activeFilter === 'all' ? 'outline' : 'secondary'}
              className="ml-1.5 text-[10px] px-1.5 py-0 h-4 border-transparent"
            >
              {policies.length}
            </Badge>
          </Button>

          <Button
            variant={activeFilter === 'in-use' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveFilter('in-use')}
            className="h-8 text-xs font-medium px-3 rounded-lg"
          >
            In Use
            <Badge
              variant={activeFilter === 'in-use' ? 'outline' : 'secondary'}
              className="ml-1.5 text-[10px] px-1.5 py-0 h-4 border-transparent"
            >
              {inUseCount}
            </Badge>
          </Button>

          <Button
            variant={activeFilter === 'unassigned' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveFilter('unassigned')}
            className="h-8 text-xs font-medium px-3 rounded-lg"
          >
            Unassigned
            <Badge
              variant={activeFilter === 'unassigned' ? 'outline' : 'secondary'}
              className="ml-1.5 text-[10px] px-1.5 py-0 h-4 border-transparent"
            >
              {unassignedCount}
            </Badge>
          </Button>
        </div>
      </div>

      {/* Policy Card Grid */}
      {filteredPolicies.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredPolicies.map(policy => (
            <PolicyDirectoryCard key={policy.id} policy={policy} canManage={canManage} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 space-y-3">
          <Layers className="h-8 w-8 text-muted-foreground/40 mx-auto" />
          <div className="space-y-1">
            <h4 className="font-semibold text-sm text-foreground">
              No matching escalation policies
            </h4>
            <p className="text-xs text-muted-foreground">
              Try adjusting your search query or switching active filter tabs.
            </p>
          </div>
          {(searchQuery || activeFilter !== 'all') && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setActiveFilter('all');
              }}
              className="text-xs h-8"
            >
              Clear Filters
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
