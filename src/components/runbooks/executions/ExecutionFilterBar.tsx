'use client';

import React, { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Calendar,
  ChevronDown,
  Filter,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/shadcn/popover';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/shadcn/collapsible';
import { Label } from '@/components/ui/shadcn/label';

export type ExecutionFilterBarProps = {
  query: Record<string, string>;
  services: Array<{ id: string; name: string }>;
  runbooks: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'WAITING_APPROVAL', label: 'Waiting Approval' },
  { value: 'WAITING_AGENT', label: 'Waiting Agent' },
  { value: 'SUCCEEDED', label: 'Succeeded' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'QUEUED', label: 'Queued' },
  { value: 'CLAIMED', label: 'Claimed' },
  { value: 'UNKNOWN', label: 'Unknown Outcome' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'TIMED_OUT', label: 'Timed Out' },
];

const TRIGGER_OPTIONS = [
  { value: 'all', label: 'All triggers' },
  { value: 'automatic', label: 'Automatic (Trigger)' },
  { value: 'responder', label: 'Responder (Manual)' },
];

const TIME_RANGE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '1h', label: 'Last 1 hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'custom', label: 'Custom date range' },
];

export function ExecutionFilterBar({
  query,
  services,
  runbooks,
  agents,
}: ExecutionFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();

  // Local state for immediate form responsiveness
  const [searchTerm, setSearchTerm] = useState(query.q ?? '');
  const [status, setStatus] = useState(query.status ?? 'all');
  const [trigger, setTrigger] = useState(query.trigger ?? 'all');
  const [timeRange, setTimeRange] = useState(
    query.timeRange || (query.from || query.to ? 'custom' : 'all')
  );
  const [selectedRunbook, setSelectedRunbook] = useState(query.runbook ?? 'all');
  const [selectedService, setSelectedService] = useState(query.service ?? 'all');
  const [selectedAgent, setSelectedAgent] = useState(query.agent ?? 'all');
  const [fromDate, setFromDate] = useState(query.from ?? '');
  const [toDate, setToDate] = useState(query.to ?? '');

  // Advanced raw ID filters
  const [incidentId, setIncidentId] = useState(query.incident ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Active filter count calculation
  const activeFiltersCount = [
    status !== 'all',
    trigger !== 'all',
    selectedRunbook !== 'all',
    selectedService !== 'all',
    selectedAgent !== 'all',
    timeRange !== 'all',
    Boolean(fromDate),
    Boolean(toDate),
    Boolean(incidentId),
    Boolean(searchTerm),
  ].filter(Boolean).length;

  const applyFilters = (overrides: Partial<Record<string, string>> = {}) => {
    const params = new URLSearchParams();

    const merged = {
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
    setStatus('all');
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
    <div className="space-y-3 rounded-xl border bg-card/70 p-3.5 shadow-2xs">
      {/* Primary Row: Search + Quick Selectors */}
      <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[200px] flex-1 sm:min-w-[260px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search executions by runbook or ID..."
            className="pl-8 h-9 text-sm"
            aria-label="Search executions"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                applyFilters({ q: '' });
              }}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Status Dropdown */}
        <Select
          value={status}
          onValueChange={val => {
            setStatus(val);
            applyFilters({ status: val });
          }}
        >
          <SelectTrigger className="h-9 w-[150px] text-xs font-medium">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Trigger Dropdown */}
        <Select
          value={trigger}
          onValueChange={val => {
            setTrigger(val);
            applyFilters({ trigger: val });
          }}
        >
          <SelectTrigger className="h-9 w-[140px] text-xs font-medium">
            <SelectValue placeholder="Trigger" />
          </SelectTrigger>
          <SelectContent>
            {TRIGGER_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
          <SelectTrigger className="h-9 w-[140px] text-xs font-medium">
            <Calendar className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
            <SelectValue placeholder="Time range" />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGE_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Filters Popover Drawer (Runbook, Service, Agent) */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs font-medium">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Entity Filters</span>
              {activeFiltersCount > 0 && (
                <Badge variant="secondary" className="h-4.5 px-1.5 text-[10px]">
                  {activeFiltersCount}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-4 p-4 text-xs" align="end">
            <div className="font-semibold text-sm">Entity Filters</div>

            {/* Runbook Selector */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Runbook</Label>
              <Select
                value={selectedRunbook}
                onValueChange={val => {
                  setSelectedRunbook(val);
                  applyFilters({ runbook: val });
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select runbook" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="all">All Runbooks</SelectItem>
                  {runbooks.map(rb => (
                    <SelectItem key={rb.id} value={rb.id} className="text-xs">
                      {rb.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Service Selector */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Service</Label>
              <Select
                value={selectedService}
                onValueChange={val => {
                  setSelectedService(val);
                  applyFilters({ service: val });
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select service" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="all">All Services</SelectItem>
                  {services.map(svc => (
                    <SelectItem key={svc.id} value={svc.id} className="text-xs">
                      {svc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Agent Selector */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Agent Target</Label>
              <Select
                value={selectedAgent}
                onValueChange={val => {
                  setSelectedAgent(val);
                  applyFilters({ agent: val });
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select target agent" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="all">All Agents</SelectItem>
                  {agents.map(ag => (
                    <SelectItem key={ag.id} value={ag.id} className="text-xs">
                      {ag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </PopoverContent>
        </Popover>

        <Button type="submit" size="sm" className="h-9 text-xs">
          Apply
        </Button>

        {activeFiltersCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="h-9 gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </Button>
        )}
      </form>

      {/* Custom Date Range Row when selected */}
      {timeRange === 'custom' && (
        <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-border/60">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="h-8 w-36 text-xs"
              aria-label="From date"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="h-8 w-36 text-xs"
              aria-label="To date"
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => applyFilters()}
            className="h-8 text-xs"
          >
            Filter dates
          </Button>
        </div>
      )}

      {/* Advanced Raw IDs (Collapsible) */}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <SlidersHorizontal className="h-3 w-3" />
            <span>Advanced raw ID filters</span>
            <ChevronDown
              className={`h-3 w-3 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
            <div>
              <Label className="text-[11px] text-muted-foreground">Incident ID</Label>
              <Input
                value={incidentId}
                onChange={e => setIncidentId(e.target.value)}
                placeholder="cuid..."
                className="h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Runbook ID</Label>
              <Input
                value={selectedRunbook !== 'all' ? selectedRunbook : ''}
                onChange={e => setSelectedRunbook(e.target.value || 'all')}
                placeholder="cuid..."
                className="h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Service ID</Label>
              <Input
                value={selectedService !== 'all' ? selectedService : ''}
                onChange={e => setSelectedService(e.target.value || 'all')}
                placeholder="cuid..."
                className="h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Agent ID</Label>
              <Input
                value={selectedAgent !== 'all' ? selectedAgent : ''}
                onChange={e => setSelectedAgent(e.target.value || 'all')}
                placeholder="cuid..."
                className="h-8 text-xs"
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
