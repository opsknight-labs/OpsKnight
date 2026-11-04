'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  X,
  Radio,
  Send,
  Layers,
  Calendar,
  Users,
  ShieldAlert,
  Terminal,
  Code2,
  Bell,
  FileText,
  Shield,
  Bot,
  Key,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';

export interface ScopeItem {
  value: string;
  title: string;
  detail: string;
  icon: LucideIcon;
  category: string;
  write: boolean;
}

export interface ScopeSelectorGroupedProps {
  availableScopes: ScopeItem[];
  selectedScopes: Set<string>;
  onChange: (next: Set<string>) => void;
  isAdmin?: boolean;
  name?: string;
  className?: string;
}

interface CategoryMeta {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
}

const CATEGORY_METADATA: Record<string, CategoryMeta> = {
  Events: {
    id: 'events',
    title: 'Events Ingestion',
    description: 'Ingest monitoring telemetry, alerts, and system signals into the pipeline.',
    icon: Send,
  },
  Incidents: {
    id: 'incidents',
    title: 'Incidents & Triage',
    description: 'Read, acknowledge, resolve, assign, and annotate operational incidents.',
    icon: Radio,
  },
  Services: {
    id: 'services',
    title: 'Services & Catalogs',
    description: 'Manage operational services, dependencies, and health state.',
    icon: Layers,
  },
  Schedules: {
    id: 'schedules',
    title: 'Schedules & On-Call',
    description: 'Inspect on-call rotations, active responders, and schedule overrides.',
    icon: Calendar,
  },
  Teams: {
    id: 'teams',
    title: 'Teams Management',
    description: 'Manage response teams, memberships, and team routing.',
    icon: Users,
  },
  Users: {
    id: 'users',
    title: 'User Directory',
    description: 'Directory access for team responders and organization members.',
    icon: Users,
  },
  Escalations: {
    id: 'escalations',
    title: 'Escalation Policies',
    description: 'Multi-step notification tiers, timeout rules, and escalation paths.',
    icon: ShieldAlert,
  },
  Runbooks: {
    id: 'runbooks',
    title: 'Runbooks & Automation',
    description: 'Automated diagnostic steps, mitigation workflows, and runbook execution.',
    icon: Terminal,
  },
  Integrations: {
    id: 'integrations',
    title: 'Integrations & Connectors',
    description: 'Manage external connectors, webhook endpoints, and API feeds.',
    icon: Code2,
  },
  Notifications: {
    id: 'notifications',
    title: 'Notifications & Dispatch',
    description: 'Delivery logs, alert routing history, and failed delivery retries.',
    icon: Bell,
  },
  'Status pages': {
    id: 'status-pages',
    title: 'Status Pages & Comms',
    description: 'Public and internal status pages, maintenance notices, and uptime feeds.',
    icon: FileText,
  },
  Governance: {
    id: 'governance',
    title: 'Governance & Auditing',
    description: 'Audit trails, postmortem retrospectives, and SLA reporting.',
    icon: Shield,
  },
  Administration: {
    id: 'administration',
    title: 'Administration & Security',
    description: 'Service accounts, response policies, and tenant-wide administrative rights.',
    icon: Bot,
  },
};

const CATEGORY_ORDER: string[] = [
  'Events',
  'Incidents',
  'Services',
  'Schedules',
  'Teams',
  'Users',
  'Escalations',
  'Runbooks',
  'Integrations',
  'Notifications',
  'Status pages',
  'Governance',
  'Administration',
];

type ScopeFilterType = 'ALL' | 'SELECTED' | 'READ' | 'WRITE';

export default function ScopeSelectorGrouped({
  availableScopes,
  selectedScopes,
  onChange,
  isAdmin = false,
  name = 'scopes',
  className = '',
}: ScopeSelectorGroupedProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<ScopeFilterType>('ALL');

  // Toggle single scope
  const handleToggleScope = (scopeValue: string) => {
    const next = new Set(selectedScopes);
    if (next.has(scopeValue)) {
      next.delete(scopeValue);
    } else {
      next.add(scopeValue);
    }
    onChange(next);
  };

  // Toggle all scopes in a specific category
  const handleToggleCategory = (categoryScopes: ScopeItem[]) => {
    const allSelected = categoryScopes.every(s => selectedScopes.has(s.value));
    const next = new Set(selectedScopes);
    if (allSelected) {
      categoryScopes.forEach(s => next.delete(s.value));
    } else {
      categoryScopes.forEach(s => next.add(s.value));
    }
    onChange(next);
  };

  // Preset Handlers
  const handleApplyPreset = (type: 'ADMIN' | 'RESPONDER' | 'READ_ONLY' | 'INGEST_ONLY' | 'CLEAR') => {
    if (type === 'CLEAR') {
      onChange(new Set());
    } else if (type === 'ADMIN') {
      onChange(new Set(availableScopes.map(s => s.value)));
    } else if (type === 'READ_ONLY') {
      onChange(new Set(availableScopes.filter(s => !s.write).map(s => s.value)));
    } else if (type === 'INGEST_ONLY') {
      const ingest = ['events:write', 'incidents:read'].filter(s =>
        availableScopes.some(v => v.value === s)
      );
      onChange(new Set(ingest));
    } else if (type === 'RESPONDER') {
      const responder = [
        'events:write',
        'incidents:read',
        'incidents:write',
        'services:read',
        'schedules:read',
        'runbooks:read',
        'runbooks:execute',
        'notifications:read',
        'teams:read',
        'users:read',
      ].filter(s => availableScopes.some(v => v.value === s));
      onChange(new Set(responder));
    }
  };

  // Active preset check
  const activePreset = useMemo<'ADMIN' | 'RESPONDER' | 'READ_ONLY' | 'INGEST_ONLY' | 'CLEAR' | null>(() => {
    if (selectedScopes.size === 0) return 'CLEAR';
    if (availableScopes.length > 0 && selectedScopes.size === availableScopes.length) return 'ADMIN';

    const ingest = ['events:write', 'incidents:read'].filter(s =>
      availableScopes.some(v => v.value === s)
    );
    if (ingest.length === selectedScopes.size && ingest.every(s => selectedScopes.has(s))) {
      return 'INGEST_ONLY';
    }

    const readScopes = availableScopes.filter(s => !s.write).map(s => s.value);
    if (readScopes.length === selectedScopes.size && readScopes.every(s => selectedScopes.has(s))) {
      return 'READ_ONLY';
    }

    const responder = [
      'events:write',
      'incidents:read',
      'incidents:write',
      'services:read',
      'schedules:read',
      'runbooks:read',
      'runbooks:execute',
      'notifications:read',
      'teams:read',
      'users:read',
    ].filter(s => availableScopes.some(v => v.value === s));
    if (responder.length === selectedScopes.size && responder.every(s => selectedScopes.has(s))) {
      return 'RESPONDER';
    }

    return null;
  }, [selectedScopes, availableScopes]);

  // Overall posture
  const securityPosture = useMemo(() => {
    if (selectedScopes.size === 0) {
      return {
        label: 'No Access',
        variant: 'outline' as const,
        description: 'Credentials cannot perform any operations.',
        badgeClass: 'text-muted-foreground border-border/80',
      };
    }
    if (selectedScopes.has('admin:manage')) {
      return {
        label: 'Administrator Access',
        variant: 'destructive' as const,
        description: 'Broad administrative rights across all API resources.',
        badgeClass: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
      };
    }
    const hasWrite = Array.from(selectedScopes).some(sc => {
      const match = availableScopes.find(s => s.value === sc);
      return match?.write;
    });
    if (hasWrite) {
      return {
        label: 'Read & Write Access',
        variant: 'default' as const,
        description: 'Can read and mutate operational resources.',
        badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
      };
    }
    return {
      label: 'Read-Only Access',
      variant: 'secondary' as const,
      description: 'Audit and monitoring queries only. Cannot mutate state.',
      badgeClass: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
    };
  }, [selectedScopes, availableScopes]);

  // Filter scopes by search query and filter pills
  const filteredScopes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return availableScopes.filter(scope => {
      // Filter tab
      if (filterType === 'SELECTED' && !selectedScopes.has(scope.value)) return false;
      if (filterType === 'READ' && scope.write) return false;
      if (filterType === 'WRITE' && !scope.write) return false;

      // Text query
      if (!q) return true;
      return (
        scope.title.toLowerCase().includes(q) ||
        scope.detail.toLowerCase().includes(q) ||
        scope.value.toLowerCase().includes(q) ||
        scope.category.toLowerCase().includes(q)
      );
    });
  }, [availableScopes, searchQuery, filterType, selectedScopes]);

  // Group filtered scopes by category
  const groupedCategories = useMemo(() => {
    const map = new Map<string, ScopeItem[]>();
    for (const scope of filteredScopes) {
      const list = map.get(scope.category) || [];
      list.push(scope);
      map.set(scope.category, list);
    }

    // Sort categories according to canonical order
    const orderedKeys = Array.from(map.keys()).sort((a, b) => {
      const idxA = CATEGORY_ORDER.indexOf(a);
      const idxB = CATEGORY_ORDER.indexOf(b);
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });

    return orderedKeys.map(cat => ({
      category: cat,
      // eslint-disable-next-line security/detect-object-injection -- lookup key is a fixed literal, a typed enum value or a gated internal name, never a raw request-controlled name
      meta: CATEGORY_METADATA[cat] ?? {
        id: cat.toLowerCase().replace(/\s+/g, '-'),
        title: cat,
        description: `${cat} permissions.`,
        icon: Key,
      },
      scopes: map.get(cat) || [],
      // Total available in this category regardless of search/filter
      totalCategoryScopes: availableScopes.filter(s => s.category === cat),
    }));
  }, [filteredScopes, availableScopes]);

  const readCount = useMemo(() => availableScopes.filter(s => !s.write).length, [availableScopes]);
  const writeCount = useMemo(() => availableScopes.filter(s => s.write).length, [availableScopes]);

  return (
    <div className={`space-y-4 rounded-xl border border-border/80 bg-muted/20 p-4 ${className}`}>
      {/* Hidden inputs to guarantee all selected scopes submit with parent form */}
      {Array.from(selectedScopes).map(sc => (
        <input key={sc} type="hidden" name={name} value={sc} />
      ))}

      {/* Top Selection Summary & Privilege Posture */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-3.5">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="text-sm font-semibold tracking-tight text-foreground">
              Granular Permission Scopes
            </Label>
            <Badge
              variant="outline"
              className={`text-[10px] font-bold uppercase tracking-wider ${securityPosture.badgeClass}`}
            >
              {securityPosture.label}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Selected: {selectedScopes.size} of {availableScopes.length} scopes (least privilege principle).
          </p>
        </div>

        {/* Preset Action Bar */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {isAdmin && (
            <Button
              type="button"
              variant={activePreset === 'ADMIN' ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleApplyPreset('ADMIN')}
              className="h-7 text-[11px] px-2.5 font-medium transition-all"
            >
              Admin Full
            </Button>
          )}
          <Button
            type="button"
            variant={activePreset === 'RESPONDER' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleApplyPreset('RESPONDER')}
            className="h-7 text-[11px] px-2.5 font-medium transition-all"
          >
            Responder
          </Button>
          <Button
            type="button"
            variant={activePreset === 'READ_ONLY' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleApplyPreset('READ_ONLY')}
            className="h-7 text-[11px] px-2.5 font-medium transition-all"
          >
            Read-Only
          </Button>
          <Button
            type="button"
            variant={activePreset === 'INGEST_ONLY' ? 'default' : 'outline'}
            size="sm"
            onClick={() => handleApplyPreset('INGEST_ONLY')}
            className="h-7 text-[11px] px-2.5 font-medium transition-all"
          >
            Ingest Only
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleApplyPreset('CLEAR')}
            className="h-7 text-[11px] px-2.5 text-muted-foreground hover:text-foreground"
          >
            Clear
          </Button>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search permissions (e.g., incidents:write, runbooks, read)..."
            className="h-8 pl-8 pr-7 text-xs bg-background"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1 flex-wrap">
          <Button
            type="button"
            variant={filterType === 'ALL' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilterType('ALL')}
            className="h-7 text-[11px] px-2"
          >
            All ({availableScopes.length})
          </Button>
          <Button
            type="button"
            variant={filterType === 'SELECTED' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilterType('SELECTED')}
            className="h-7 text-[11px] px-2"
          >
            Selected ({selectedScopes.size})
          </Button>
          <Button
            type="button"
            variant={filterType === 'READ' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilterType('READ')}
            className="h-7 text-[11px] px-2"
          >
            Read ({readCount})
          </Button>
          <Button
            type="button"
            variant={filterType === 'WRITE' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFilterType('WRITE')}
            className="h-7 text-[11px] px-2"
          >
            Write ({writeCount})
          </Button>
        </div>
      </div>

      {/* Categorized Permission Scope List */}
      <div className="max-h-[30rem] overflow-y-auto pr-1.5 space-y-4">
        {groupedCategories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center rounded-xl border border-dashed border-border/80 bg-background/50">
            <Search className="h-8 w-8 text-muted-foreground/60 mb-2" />
            <p className="text-xs font-semibold text-foreground">No permission scopes match your query</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 max-w-xs">
              Try adjusting your search terms or clearing the active filters.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setFilterType('ALL');
              }}
              className="mt-3 h-7 text-xs"
            >
              Reset Filters
            </Button>
          </div>
        ) : (
          groupedCategories.map(({ category, meta, scopes, totalCategoryScopes }) => {
            const CategoryIcon = meta.icon;
            const selectedInCategory = totalCategoryScopes.filter(s => selectedScopes.has(s.value)).length;
            const isAllCategorySelected =
              totalCategoryScopes.length > 0 && selectedInCategory === totalCategoryScopes.length;

            return (
              <div
                key={category}
                className="rounded-xl border border-border/70 bg-card/60 p-3.5 space-y-2.5 shadow-2xs transition-colors hover:border-border"
              >
                {/* Category Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/50 pb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1.5 rounded-lg bg-primary/10 text-primary shrink-0 border border-primary/20">
                      <CategoryIcon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold tracking-tight text-foreground">
                          {meta.title}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-medium px-1.5 py-0 ${
                            isAllCategorySelected
                              ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                              : selectedInCategory > 0
                              ? 'border-primary/40 text-primary bg-primary/10'
                              : 'text-muted-foreground border-border/60'
                          }`}
                        >
                          {selectedInCategory} of {totalCategoryScopes.length} selected
                        </Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate max-w-lg">
                        {meta.description}
                      </p>
                    </div>
                  </div>

                  {/* Category Bulk Action Button */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleCategory(totalCategoryScopes)}
                    className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground shrink-0 self-start sm:self-center"
                  >
                    {isAllCategorySelected ? 'Deselect all' : 'Select all'}
                  </Button>
                </div>

                {/* Scope Cards Grid */}
                <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                  {scopes.map(scope => {
                    const isChecked = selectedScopes.has(scope.value);
                    const isExecution = scope.value.endsWith(':execute');
                    const isAdminScope = scope.value === 'admin:manage';

                    return (
                      <div
                        key={scope.value}
                        onClick={e => {
                          if ((e.target as HTMLElement).closest('button, input')) return;
                          handleToggleScope(scope.value);
                        }}
                        className={`group relative flex items-start gap-3 rounded-lg border p-3 text-xs cursor-pointer transition-all ${
                          isChecked
                            ? 'border-primary/60 bg-primary/5 shadow-2xs ring-1 ring-primary/20'
                            : 'border-border/70 bg-background/80 hover:border-primary/40 hover:bg-muted/30'
                        }`}
                      >
                        <Checkbox
                          checked={isChecked}
                          id={`scope-${scope.value}`}
                          aria-label={scope.title}
                          className="mt-0.5 shrink-0"
                          onCheckedChange={checked => {
                            const next = new Set(selectedScopes);
                            if (checked) next.add(scope.value);
                            else next.delete(scope.value);
                            onChange(next);
                          }}
                        />

                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="font-semibold text-foreground text-xs leading-tight group-hover:text-primary transition-colors">
                              {scope.title}
                            </span>
                            <div className="shrink-0">
                              {isAdminScope ? (
                                <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0">
                                  Admin
                                </Badge>
                              ) : isExecution ? (
                                <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0">
                                  Execute
                                </Badge>
                              ) : scope.write ? (
                                <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0">
                                  Write
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className="text-muted-foreground border-border/70 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0"
                                >
                                  Read
                                </Badge>
                              )}
                            </div>
                          </div>

                          <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
                            {scope.detail}
                          </p>

                          <div className="pt-0.5">
                            <code className="inline-block font-mono text-[10px] text-muted-foreground/80 bg-muted/60 px-1.5 py-0.5 rounded border border-border/40">
                              {scope.value}
                            </code>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
