'use client';

import React, { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { SearchableRunbookSelect } from '../SearchableRunbookSelect';
import { Input } from '@/components/ui/shadcn/input';
import { SearchField } from '../ui/primitives';
import { Button } from '@/components/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/shadcn/collapsible';
import { Activity, Filter, Monitor, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Label } from '@/components/ui/shadcn/label';

export type AgentFilterBarProps = {
  query: Record<string, string>;
};

export function AgentFilterBar({ query }: AgentFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [searchTerm, setSearchTerm] = useState(query.q ?? '');
  const [status, setStatus] = useState(query.status ?? 'all');
  const [selectedPool, setSelectedPool] = useState(query.pool ?? 'all');
  const [platform, setPlatform] = useState(query.platform ?? 'all');
  const [capability, setCapability] = useState(query.capability ?? '');
  const [label, setLabel] = useState(query.label ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const isAttention = query.attention === '1';

  const activeFiltersCount = [
    status !== 'all',
    selectedPool !== 'all',
    platform !== 'all',
    Boolean(capability),
    Boolean(label),
    Boolean(searchTerm),
    isAttention,
  ].filter(Boolean).length;

  const applyFilters = (overrides: Partial<Record<string, string>> = {}) => {
    const params = new URLSearchParams();
    const merged = {
      q: searchTerm,
      status,
      pool: selectedPool,
      platform,
      capability,
      label,
      ...(isAttention ? { attention: '1' } : {}),
      ...overrides,
    };

    if (merged.q?.trim()) params.set('q', merged.q.trim());
    if (merged.status && merged.status !== 'all') params.set('status', merged.status);
    if (merged.pool && merged.pool !== 'all') params.set('pool', merged.pool);
    if (merged.platform && merged.platform !== 'all') params.set('platform', merged.platform);
    if (merged.capability?.trim()) params.set('capability', merged.capability.trim());
    if (merged.label?.trim()) params.set('label', merged.label.trim());
    if (merged.attention) params.set('attention', merged.attention);

    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
  };

  const resetFilters = () => {
    setSearchTerm('');
    setStatus('all');
    setSelectedPool('all');
    setPlatform('all');
    setCapability('');
    setLabel('');
    router.push(pathname);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs p-4 shadow-xs">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form
          onSubmit={e => {
            e.preventDefault();
            applyFilters();
          }}
          className="min-w-0 flex-1"
        >
          <SearchField
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search agents by name or hostname…"
            aria-label="Search agents"
            className="w-full rounded-xl"
          />
        </form>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status filter */}
          <Select
            value={status}
            onValueChange={val => {
              setStatus(val);
              applyFilters({ status: val });
            }}
          >
            <SelectTrigger
              className="h-9 w-[135px] rounded-xl border border-input/80 dark:border-border/70 bg-background/80 hover:bg-accent/40 shadow-2xs text-xs font-medium focus:ring-2 focus:ring-primary/40 transition-colors"
              aria-label="Filter by status"
            >
              <div className="flex items-center gap-1.5 min-w-0 truncate">
                <Activity
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <SelectValue placeholder="Status" />
              </div>
            </SelectTrigger>
            <SelectContent className="rounded-2xl border border-border/80 dark:border-border/60 bg-popover/95 dark:bg-popover/90 backdrop-blur-md shadow-xl p-1.5">
              <SelectItem
                value="all"
                className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer focus:bg-primary/10 focus:text-primary transition-colors"
              >
                All active
              </SelectItem>
              <SelectItem
                value="ONLINE"
                className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer focus:bg-primary/10 focus:text-primary transition-colors"
              >
                Online
              </SelectItem>
              <SelectItem
                value="DEGRADED"
                className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer focus:bg-primary/10 focus:text-primary transition-colors"
              >
                Degraded
              </SelectItem>
              <SelectItem
                value="OFFLINE"
                className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer focus:bg-primary/10 focus:text-primary transition-colors"
              >
                Offline
              </SelectItem>
              <SelectItem
                value="ENROLLING"
                className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer focus:bg-primary/10 focus:text-primary transition-colors"
              >
                Enrolling
              </SelectItem>
              <SelectItem
                value="REVOKED"
                className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer focus:bg-primary/10 focus:text-primary transition-colors"
              >
                Revoked
              </SelectItem>
            </SelectContent>
          </Select>

          {/* Searchable Pool selector */}
          <div className="w-[180px] sm:w-[200px]">
            <SearchableRunbookSelect
              kind="pool"
              label=""
              ariaLabel="Filter by pool"
              placeholder="All pools"
              value={selectedPool}
              onChange={val => {
                setSelectedPool(val);
                applyFilters({ pool: val });
              }}
            />
          </div>

          {/* Platform selector */}
          <Select
            value={platform}
            onValueChange={val => {
              setPlatform(val);
              applyFilters({ platform: val });
            }}
          >
            <SelectTrigger
              className="h-9 w-[140px] rounded-xl border border-input/80 dark:border-border/70 bg-background/80 hover:bg-accent/40 shadow-2xs text-xs font-medium focus:ring-2 focus:ring-primary/40 transition-colors"
              aria-label="Filter by platform"
            >
              <div className="flex items-center gap-1.5 min-w-0 truncate">
                <Monitor
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <SelectValue placeholder="Platform" />
              </div>
            </SelectTrigger>
            <SelectContent className="rounded-2xl border border-border/80 dark:border-border/60 bg-popover/95 dark:bg-popover/90 backdrop-blur-md shadow-xl p-1.5">
              <SelectItem
                value="all"
                className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer focus:bg-primary/10 focus:text-primary transition-colors"
              >
                All platforms
              </SelectItem>
              <SelectItem
                value="linux"
                className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer focus:bg-primary/10 focus:text-primary transition-colors"
              >
                Linux
              </SelectItem>
              <SelectItem
                value="darwin"
                className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer focus:bg-primary/10 focus:text-primary transition-colors"
              >
                macOS (Darwin)
              </SelectItem>
              <SelectItem
                value="win32"
                className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer focus:bg-primary/10 focus:text-primary transition-colors"
              >
                Windows
              </SelectItem>
            </SelectContent>
          </Select>

          {/* Advanced toggle */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant={advancedOpen ? 'secondary' : 'outline'}
                size="sm"
                className="h-9 text-xs gap-1.5 rounded-xl border-input/80 shadow-2xs"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Advanced</span>
                {(Boolean(capability) || Boolean(label)) && (
                  <Badge variant="default" className="ml-1 px-1 py-0 text-[10px] h-4">
                    {[Boolean(capability), Boolean(label)].filter(Boolean).length}
                  </Badge>
                )}
              </Button>
            </CollapsibleTrigger>
          </Collapsible>

          {activeFiltersCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-9 text-xs gap-1 rounded-xl text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset</span>
            </Button>
          )}

          <Button
            size="sm"
            aria-label="Apply filters"
            onClick={() => applyFilters()}
            className="h-9 text-xs gap-1.5"
          >
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Apply filters</span>
          </Button>
        </div>
      </div>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleContent className="pt-3 border-t space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 max-w-xl">
            <div className="space-y-1">
              <Label htmlFor="advanced-capability" className="text-xs text-muted-foreground">
                Required Capability
              </Label>
              <Input
                id="advanced-capability"
                value={capability}
                onChange={e => setCapability(e.target.value)}
                placeholder="e.g. RUNBOOK_EXECUTE_BASH"
                className="h-8 text-xs bg-background font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="advanced-label" className="text-xs text-muted-foreground">
                Scheduling Label Filter
              </Label>
              <Input
                id="advanced-label"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="key=value (e.g. env=prod)"
                className="h-8 text-xs bg-background font-mono"
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
