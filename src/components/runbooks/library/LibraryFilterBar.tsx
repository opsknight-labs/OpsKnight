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

export type LibraryFilterBarProps = {
  query: Record<string, string>;
};

export function LibraryFilterBar({ query }: LibraryFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [searchTerm, setSearchTerm] = useState(query.q ?? '');
  const [status, setStatus] = useState(query.status ?? 'all');
  const [selectedService, setSelectedService] = useState(query.service ?? 'all');
  const [ownerId, setOwnerId] = useState(query.owner ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const activeFiltersCount = [
    status !== 'all',
    selectedService !== 'all',
    Boolean(ownerId),
    Boolean(searchTerm),
  ].filter(Boolean).length;

  const applyFilters = (overrides: Partial<Record<string, string>> = {}) => {
    const params = new URLSearchParams();
    const merged = {
      q: searchTerm,
      status,
      service: selectedService,
      owner: ownerId,
      ...overrides,
    };

    if (merged.q?.trim()) params.set('q', merged.q.trim());
    if (merged.status && merged.status !== 'all') params.set('status', merged.status);
    if (merged.service && merged.service !== 'all') params.set('service', merged.service);
    if (merged.owner?.trim()) params.set('owner', merged.owner.trim());

    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
  };

  const resetFilters = () => {
    setSearchTerm('');
    setStatus('all');
    setSelectedService('all');
    setOwnerId('');
    router.push(pathname);
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
            placeholder="Search runbooks by name, slug, or purpose…"
            aria-label="Search runbooks"
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
              <SelectItem value="all" className="text-xs">All Active</SelectItem>
              <SelectItem value="published" className="text-xs">Published</SelectItem>
              <SelectItem value="draft" className="text-xs">Draft</SelectItem>
              <SelectItem value="archived" className="text-xs">Archived</SelectItem>
            </SelectContent>
          </Select>

          {/* Searchable Service selector */}
          <div className="w-[180px] sm:w-[220px]">
            <SearchableRunbookSelect
              kind="service"
              label=""
              ariaLabel="Filter by service"
              placeholder="All services"
              value={selectedService}
              onChange={val => {
                setSelectedService(val);
                applyFilters({ service: val });
              }}
            />
          </div>

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
                {Boolean(ownerId) && (
                  <Badge variant="default" className="ml-1 px-1 py-0 text-[10px] h-4">
                    1
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
              <Label htmlFor="advanced-owner-id" className="text-xs text-muted-foreground">
                Author / Owner ID
              </Label>
              <Input
                id="advanced-owner-id"
                value={ownerId}
                onChange={e => setOwnerId(e.target.value)}
                placeholder="User ID of runbook creator"
                className="h-8 text-xs bg-background font-mono"
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
