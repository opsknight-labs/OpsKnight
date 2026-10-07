'use client';

import React, { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { SearchableRunbookSelect } from '../SearchableRunbookSelect';
import { Input } from '@/components/ui/shadcn/input';
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
import { Filter, RotateCcw, SlidersHorizontal } from 'lucide-react';
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
      tab: query.tab || 'agents',
      ...(isAttention ? { attention: '1' } : {}),
      ...overrides,
    };

    if (merged.tab && merged.tab !== 'agents') params.set('tab', merged.tab);
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
    const baseParams = query.tab && query.tab !== 'agents' ? `?tab=${query.tab}` : '';
    router.push(`${pathname}${baseParams}`);
  };

  return (
    <div className="space-y-3 rounded-xl border bg-card/60 p-3.5 shadow-2xs backdrop-blur-xs">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <form
          onSubmit={e => {
            e.preventDefault();
            applyFilters();
          }}
          className="relative flex-1"
        >
          <Input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search agents by name or hostname…"
            aria-label="Search agents"
            className="h-9 w-full bg-background text-xs pl-3 pr-8"
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
            <SelectTrigger className="h-9 w-[130px] text-xs bg-background" aria-label="Filter by status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All active</SelectItem>
              <SelectItem value="ONLINE" className="text-xs">Online</SelectItem>
              <SelectItem value="DEGRADED" className="text-xs">Degraded</SelectItem>
              <SelectItem value="OFFLINE" className="text-xs">Offline</SelectItem>
              <SelectItem value="ENROLLING" className="text-xs">Enrolling</SelectItem>
              <SelectItem value="REVOKED" className="text-xs">Revoked</SelectItem>
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
            <SelectTrigger className="h-9 w-[130px] text-xs bg-background" aria-label="Filter by platform">
              <SelectValue placeholder="Platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All platforms</SelectItem>
              <SelectItem value="linux" className="text-xs">Linux</SelectItem>
              <SelectItem value="darwin" className="text-xs">macOS (Darwin)</SelectItem>
              <SelectItem value="win32" className="text-xs">Windows</SelectItem>
            </SelectContent>
          </Select>

          {/* Advanced toggle */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant={advancedOpen ? 'secondary' : 'outline'}
                size="sm"
                className="h-9 text-xs gap-1.5"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
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
              className="h-9 text-xs gap-1 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset</span>
            </Button>
          )}

          <Button
            size="sm"
            aria-label="Apply filters"
            onClick={() => applyFilters()}
            className="h-9 text-xs gap-1.5"
          >
            <Filter className="h-3.5 w-3.5" />
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
