'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { X, ShieldAlert, Layers, Loader2 } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import PolicyDirectoryCard, { type PolicyDirectoryItem } from './PolicyDirectoryCard';
import Pagination from '@/components/service/Pagination';

type FilterType = 'all' | 'in-use' | 'unassigned';

type PolicyDirectoryListProps = {
  policies: PolicyDirectoryItem[];
  canManage?: boolean;
  pagination?: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
    itemsPerPage: number;
  };
  filterCounts?: {
    total: number;
    inUse: number;
    unassigned: number;
  };
  currentSearch?: string;
  currentStatus?: string;
};

export default function PolicyDirectoryList({
  policies,
  canManage = false,
  pagination,
  filterCounts,
  currentSearch = '',
  currentStatus = 'all',
}: PolicyDirectoryListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(currentSearch);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setSearchQuery(currentSearch);
  }, [currentSearch]);

  const updateFilters = (newParams: { q?: string; status?: string }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newParams.q !== undefined) {
      const trimmed = newParams.q.trim();
      if (trimmed) params.set('q', trimmed);
      else params.delete('q');
      params.delete('search');
    }
    if (newParams.status !== undefined) {
      if (newParams.status && newParams.status !== 'all') params.set('status', newParams.status);
      else params.delete('status');
    }
    params.delete('page');
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/policies?${qs}` : '/policies');
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateFilters({ q: searchQuery });
  };

  const totalCount = filterCounts?.total ?? pagination?.totalItems ?? policies.length;
  const inUseCount = filterCounts?.inUse ?? 0;
  const unassignedCount = filterCounts?.unassigned ?? 0;
  const hasActiveFilter = Boolean(currentSearch || (currentStatus && currentStatus !== 'all'));

  if (totalCount === 0 && !hasActiveFilter) {
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
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        {/* Search bar */}
        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
          <Input
            value={searchQuery}
            onChange={e => {
              const val = e.target.value;
              setSearchQuery(val);
              if (val === '') {
                updateFilters({ q: '' });
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                updateFilters({ q: searchQuery });
              }
            }}
            placeholder="Search policies by name, description, or service..."
            className="pr-8 h-8.5 text-xs placeholder:text-muted-foreground/60"
            style={{ paddingRight: '2rem' }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                updateFilters({ q: '' });
              }}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </form>

        {/* Status filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => updateFilters({ status: 'all' })}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              currentStatus === 'all'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            All ({totalCount})
          </button>
          <button
            type="button"
            onClick={() => updateFilters({ status: 'in-use' })}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              currentStatus === 'in-use'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            In Use ({inUseCount})
          </button>
          <button
            type="button"
            onClick={() => updateFilters({ status: 'unassigned' })}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              currentStatus === 'unassigned'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            Unassigned ({unassignedCount})
          </button>
          {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-1" />}
        </div>
      </div>

      {policies.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {policies.map(policy => (
            <PolicyDirectoryCard key={policy.id} policy={policy} canManage={canManage} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Layers className="h-6 w-6 text-muted-foreground/60" />}
          title="No matching escalation policies"
          description={
            currentSearch
              ? `No escalation policies matched "${currentSearch}". Try a different search term.`
              : 'No escalation policies match the selected filter.'
          }
          action={
            currentSearch || currentStatus !== 'all' ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  updateFilters({ q: '', status: 'all' });
                }}
                className="text-xs h-8"
              >
                Reset Filters
              </Button>
            ) : undefined
          }
        />
      )}

      {pagination && (
        <Pagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          itemsPerPage={pagination.itemsPerPage}
          itemLabel="policy"
        />
      )}
    </div>
  );
}
