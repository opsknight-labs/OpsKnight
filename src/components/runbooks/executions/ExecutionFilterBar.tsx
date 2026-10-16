'use client';

import React, { useState, type ReactNode } from 'react';
import { RUNBOOK_EXECUTION_STATUSES, TRIGGER_LABELS } from '@/lib/runbooks/presentation/contracts';
import { SearchableRunbookSelect } from '../SearchableRunbookSelect';
import { SearchField } from '../ui/primitives';
import { useRouter, usePathname } from 'next/navigation';
import { Calendar, ChevronDown, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/shadcn/collapsible';
import { Label } from '@/components/ui/shadcn/label';
import { cn } from '@/lib/utils';

export type ExecutionFilterBarProps = {
  query: Record<string, string>;
  /** Rendered beneath the search row, e.g. status chips. */
  children?: ReactNode;
};

export const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  ...RUNBOOK_EXECUTION_STATUSES.map(value => ({ value, label: value.replaceAll('_', ' ') })),
];
const TRIGGER_OPTIONS = [
  { value: 'all', label: 'All triggers' },
  ...Object.entries(TRIGGER_LABELS).map(([value, label]) => ({ value, label })),
];

const TIME_RANGE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '1h', label: 'Last 1 hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'custom', label: 'Custom date range' },
];

export function ExecutionFilterBar({ query, children }: ExecutionFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [searchTerm, setSearchTerm] = useState(query.q ?? '');
  const status = query.status ?? 'all';
  const [trigger, setTrigger] = useState(query.trigger ?? 'all');
  const [timeRange, setTimeRange] = useState(
    query.timeRange || (query.from || query.to ? 'custom' : 'all')
  );
  const [selectedRunbook, setSelectedRunbook] = useState(query.runbook ?? 'all');
  const [selectedService, setSelectedService] = useState(query.service ?? 'all');
  const [selectedAgent, setSelectedAgent] = useState(query.agent ?? 'all');
  const [fromDate, setFromDate] = useState(query.from ?? '');
  const [toDate, setToDate] = useState(query.to ?? '');

  const [incidentId, setIncidentId] = useState(query.incident ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const moreFiltersCount = [
    query.trigger,
    query.runbook,
    query.service,
    query.agent,
    query.incident,
  ].filter(Boolean).length;
  const hasAnyFilter = Object.keys(query).some(key => key !== 'page');

  const applyFilters = (overrides: Partial<Record<string, string>> = {}) => {
    const params = new URLSearchParams();

    const merged = {
      attemptStatus: query.attemptStatus,
      q: searchTerm,
      status,
      trigger,
      runbook: selectedRunbook,
      service: selectedService,
      agent: selectedAgent,
      timeRange,
      from: fromDate,
      to: toDate,
      incident: incidentId,
      ...overrides,
    };

    if (merged.attemptStatus === 'UNKNOWN') params.set('attemptStatus', 'UNKNOWN');
    if (merged.q?.trim()) params.set('q', merged.q.trim());
    if (merged.status && merged.status !== 'all') params.set('status', merged.status);
    if (merged.trigger && merged.trigger !== 'all') params.set('trigger', merged.trigger);
    if (merged.runbook && merged.runbook !== 'all') params.set('runbook', merged.runbook);
    if (merged.service && merged.service !== 'all') params.set('service', merged.service);
    if (merged.agent && merged.agent !== 'all') params.set('agent', merged.agent);
    if (merged.incident?.trim()) params.set('incident', merged.incident.trim());

    if (merged.timeRange && merged.timeRange !== 'all') {
      params.set('timeRange', merged.timeRange);
      if (merged.timeRange === 'custom') {
        if (merged.from) params.set('from', merged.from);
        if (merged.to) params.set('to', merged.to);
      }
    }

    params.set('page', '1');
    router.push(`${pathname}?${params.toString()}`);
  };

  const clearAllFilters = () => {
    setSearchTerm('');
    setTrigger('all');
    setTimeRange('all');
    setSelectedRunbook('all');
    setSelectedService('all');
    setSelectedAgent('all');
    setFromDate('');
    setToDate('');
    setIncidentId('');
    router.push(pathname);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    applyFilters();
  };

  return (
    <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs transition-colors">
      <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-2 p-3 sm:p-4">
        <SearchField
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search by runbook name or execution ID"
          aria-label="Search executions"
          className="min-w-[14rem] flex-1 rounded-xl"
        />

        {/* Time Range Dropdown */}
        <Select
          value={timeRange}
          onValueChange={val => {
            setTimeRange(val);
            if (val !== 'custom') {
              setFromDate('');
              setToDate('');
              applyFilters({ timeRange: val, from: '', to: '' });
            }
          }}
        >
          <SelectTrigger className="h-9 w-[145px] rounded-xl border border-input/80 dark:border-border/70 bg-background/80 hover:bg-accent/40 shadow-2xs text-xs font-medium focus:ring-2 focus:ring-primary/40 transition-colors">
            <Calendar className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
            <SelectValue placeholder="Time range" />
          </SelectTrigger>
          <SelectContent className="rounded-2xl border border-border/80 dark:border-border/60 bg-popover/95 dark:bg-popover/90 backdrop-blur-md shadow-xl p-1.5">
            {TIME_RANGE_OPTIONS.map(opt => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer focus:bg-primary/10 focus:text-primary transition-colors"
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {timeRange === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="h-9 w-[9.5rem] rounded-xl text-xs"
              aria-label="From date"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="h-9 w-[9.5rem] rounded-xl text-xs"
              aria-label="To date"
            />
          </div>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-xl border border-input/80 dark:border-border/70 bg-background/80 hover:bg-accent/40 shadow-2xs text-xs font-medium focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              More filters
              {moreFiltersCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground tabular-nums">
                  {moreFiltersCount}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-84 space-y-4 p-4 text-xs rounded-2xl border border-border/80 dark:border-border/60 bg-popover/95 dark:bg-popover/90 backdrop-blur-md shadow-xl"
            align="end"
          >
            <div>
              <p className="text-sm font-semibold">More filters</p>
              <p className="mt-0.5 text-muted-foreground">
                Narrow runs by source, runbook or target.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="execution-filter-trigger" className="text-xs">
                Trigger
              </Label>
              <Select
                value={trigger}
                onValueChange={val => {
                  setTrigger(val);
                  applyFilters({ trigger: val });
                }}
              >
                <SelectTrigger
                  id="execution-filter-trigger"
                  className="h-9 rounded-xl border border-input/80 dark:border-border/70 bg-background/80 shadow-2xs text-xs font-medium"
                >
                  <SelectValue placeholder="Trigger" />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border border-border/80 dark:border-border/60 bg-popover/95 dark:bg-popover/90 backdrop-blur-md shadow-xl p-1.5">
                  {TRIGGER_OPTIONS.map(opt => (
                    <SelectItem
                      key={opt.value}
                      value={opt.value}
                      className="rounded-xl px-2.5 py-1.5 text-xs font-medium cursor-pointer focus:bg-primary/10 focus:text-primary transition-colors"
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <SearchableRunbookSelect
              kind="runbook"
              label="Runbook"
              value={selectedRunbook}
              onChange={val => {
                setSelectedRunbook(val);
                applyFilters({ runbook: val });
              }}
            />
            <SearchableRunbookSelect
              kind="service"
              label="Service"
              value={selectedService}
              onChange={val => {
                setSelectedService(val);
                applyFilters({ service: val });
              }}
            />
            <SearchableRunbookSelect
              kind="agent-history"
              label="Agent target"
              value={selectedAgent}
              onChange={val => {
                setSelectedAgent(val);
                applyFilters({ agent: val });
              }}
            />

            <Collapsible
              open={advancedOpen}
              onOpenChange={setAdvancedOpen}
              className="border-t pt-3"
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Filter by exact ID
                  <ChevronDown
                    aria-hidden
                    className={cn('h-3.5 w-3.5 transition-transform', advancedOpen && 'rotate-180')}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="grid gap-2 pt-3">
                {(
                  [
                    ['Incident ID', incidentId, (value: string) => setIncidentId(value)],
                    [
                      'Runbook ID',
                      selectedRunbook,
                      (value: string) => setSelectedRunbook(value || 'all'),
                    ],
                    [
                      'Service ID',
                      selectedService,
                      (value: string) => setSelectedService(value || 'all'),
                    ],
                    [
                      'Agent ID',
                      selectedAgent,
                      (value: string) => setSelectedAgent(value || 'all'),
                    ],
                  ] as const
                ).map(([label, value, onChange]) => (
                  <Input
                    key={label}
                    aria-label={label}
                    value={value === 'all' ? '' : value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={label}
                    className="h-8 rounded-xl font-mono text-xs"
                  />
                ))}
              </CollapsibleContent>
            </Collapsible>
            <Button
              type="button"
              size="sm"
              className="w-full rounded-xl text-xs font-medium shadow-2xs"
              onClick={() => applyFilters()}
            >
              Apply filters
            </Button>
          </PopoverContent>
        </Popover>

        <Button
          type="submit"
          size="sm"
          variant="secondary"
          className="h-9 rounded-xl text-xs font-medium shadow-2xs"
        >
          Apply
        </Button>

        {hasAnyFilter && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="h-9 gap-1 rounded-xl text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            Reset
          </Button>
        )}
      </form>

      {(children || query.attemptStatus === 'UNKNOWN') && (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2.5">
          {children}
          {query.attemptStatus === 'UNKNOWN' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 rounded-full border-orange-500/40 bg-orange-500/10 px-3 text-xs text-orange-700 hover:bg-orange-500/15 dark:text-orange-300"
              aria-label="Remove unknown outcomes filter"
              onClick={() => {
                const params = new URLSearchParams(query);
                params.delete('attemptStatus');
                params.delete('page');
                router.push(`${pathname}?${params}`);
              }}
            >
              Unknown outcomes
              <X className="h-3 w-3" aria-hidden />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
