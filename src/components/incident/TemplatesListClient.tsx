'use client';

import React, { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search,
  Zap,
  AlertCircle,
  Info,
  Globe,
  Lock,
  Server,
  User,
  Clock,
  MoreHorizontal,
  Trash2,
  ArrowUpRight,
  Plus,
  LayoutTemplate,
  X,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import CreateIncidentButton from '@/components/incident/CreateIncidentButton';
import { deleteTemplate } from '@/app/(app)/incidents/template-actions';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';

export type IncidentTemplateItem = {
  id: string;
  name: string;
  description: string | null;
  title: string;
  descriptionText: string | null;
  defaultUrgency: 'HIGH' | 'MEDIUM' | 'LOW';
  defaultPriority: string | null;
  defaultServiceId: string | null;
  createdById: string | null;
  isPublic: boolean;
  createdAt: Date | string;
  createdBy?: { id: string; name: string } | null;
  defaultService?: { id: string; name: string } | null;
};

type TemplatesListClientProps = {
  templates: IncidentTemplateItem[];
  currentUserId?: string;
  canManageTemplates: boolean;
};

type UrgencyFilter = 'ALL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'PUBLIC' | 'PRIVATE';
type SortOption = 'newest' | 'name' | 'urgency';

const URGENCY_CONFIG = {
  HIGH: {
    label: 'High Urgency',
    sublabel: 'Immediate Paging',
    icon: Zap,
    borderClass: 'border-l-rose-500',
    badgeClass: 'text-rose-700 bg-rose-500/10 border-rose-500/30 dark:text-rose-300',
    iconBg: 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400',
  },
  MEDIUM: {
    label: 'Medium Urgency',
    sublabel: 'Standard Triage',
    icon: AlertCircle,
    borderClass: 'border-l-amber-500',
    badgeClass: 'text-amber-700 bg-amber-500/10 border-amber-500/30 dark:text-amber-300',
    iconBg: 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400',
  },
  LOW: {
    label: 'Low Urgency',
    sublabel: 'Non-Urgent',
    icon: Info,
    borderClass: 'border-l-emerald-500',
    badgeClass: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/30 dark:text-emerald-300',
    iconBg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
  },
} as const;

function formatRelativeTime(dateInput: Date | string): string {
  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 30) {
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }
    if (diffDays > 0) {
      return `${diffDays}d ago`;
    }
    if (diffHours > 0) {
      return `${diffHours}h ago`;
    }
    if (diffMins > 0) {
      return `${diffMins}m ago`;
    }
    return 'Just now';
  } catch {
    return 'Recently';
  }
}

export default function TemplatesListClient({
  templates,
  currentUserId,
  canManageTemplates,
}: TemplatesListClientProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<UrgencyFilter>('ALL');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [isDeleting, startDeleteTransition] = useTransition();

  // Filter and search
  const filteredTemplates = useMemo(() => {
    return templates
      .filter(tpl => {
        // Query match
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchName = tpl.name.toLowerCase().includes(q);
          const matchTitle = tpl.title.toLowerCase().includes(q);
          const matchDesc = tpl.description?.toLowerCase().includes(q) || false;
          const matchService = tpl.defaultService?.name.toLowerCase().includes(q) || false;
          const matchAuthor = tpl.createdBy?.name.toLowerCase().includes(q) || false;

          if (!matchName && !matchTitle && !matchDesc && !matchService && !matchAuthor) {
            return false;
          }
        }

        // Tab filter
        if (activeFilter === 'HIGH') return tpl.defaultUrgency === 'HIGH';
        if (activeFilter === 'MEDIUM') return tpl.defaultUrgency === 'MEDIUM';
        if (activeFilter === 'LOW') return tpl.defaultUrgency === 'LOW';
        if (activeFilter === 'PUBLIC') return tpl.isPublic;
        if (activeFilter === 'PRIVATE') return !tpl.isPublic;

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'name') {
          return a.name.localeCompare(b.name);
        }
        if (sortBy === 'urgency') {
          const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
          return rank[b.defaultUrgency] - rank[a.defaultUrgency];
        }
        // Default: newest
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        return timeB - timeA;
      });
  }, [templates, searchQuery, activeFilter, sortBy]);

  // Counts for filter chips
  const counts = useMemo(() => {
    return {
      all: templates.length,
      high: templates.filter(t => t.defaultUrgency === 'HIGH').length,
      medium: templates.filter(t => t.defaultUrgency === 'MEDIUM').length,
      low: templates.filter(t => t.defaultUrgency === 'LOW').length,
      public: templates.filter(t => t.isPublic).length,
      private: templates.filter(t => !t.isPublic).length,
    };
  }, [templates]);

  const handleDelete = (templateId: string, templateName: string) => {
    // eslint-disable-next-line no-alert
    if (
      !window.confirm(
        `Are you sure you want to delete template "${templateName}"? This action cannot be undone.`
      )
    ) {
      return;
    }

    startDeleteTransition(async () => {
      try {
        await deleteTemplate(templateId);
        notify.success(`Template "${templateName}" deleted`);
        router.refresh();
      } catch (err) {
        notify.error(err instanceof Error ? err.message : 'Failed to delete template');
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Search & Filter Toolbar */}
      <div className="rounded-xl border border-border/80 bg-card/70 backdrop-blur-xs p-3.5 shadow-2xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search templates by name, service, or title..."
              className="pl-9 pr-9 h-9 bg-background/80 border-border/70 text-sm focus-visible:ring-primary/20"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Sort Selector */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sort:</span>
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortOption)}
              className="h-9 rounded-lg border border-border/70 bg-background/80 px-2.5 text-xs font-medium text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/20 cursor-pointer"
            >
              <option value="newest">Newest First</option>
              <option value="name">Name (A-Z)</option>
              <option value="urgency">Urgency (High to Low)</option>
            </select>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveFilter('ALL')}
            className={cn(
              'px-2.5 py-1 rounded-lg border font-medium transition-all whitespace-nowrap cursor-pointer',
              activeFilter === 'ALL'
                ? 'bg-primary/10 border-primary/40 text-primary font-semibold shadow-2xs'
                : 'bg-background/60 border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            All <span className="ml-1 opacity-70">({counts.all})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('HIGH')}
            className={cn(
              'px-2.5 py-1 rounded-lg border font-medium transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer',
              activeFilter === 'HIGH'
                ? 'bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-300 font-semibold shadow-2xs'
                : 'bg-background/60 border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
            High Urgency <span className="opacity-70">({counts.high})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('MEDIUM')}
            className={cn(
              'px-2.5 py-1 rounded-lg border font-medium transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer',
              activeFilter === 'MEDIUM'
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300 font-semibold shadow-2xs'
                : 'bg-background/60 border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Medium <span className="opacity-70">({counts.medium})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('LOW')}
            className={cn(
              'px-2.5 py-1 rounded-lg border font-medium transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer',
              activeFilter === 'LOW'
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 font-semibold shadow-2xs'
                : 'bg-background/60 border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Low <span className="opacity-70">({counts.low})</span>
          </button>

          <div className="h-3 w-px bg-border/80 mx-1 shrink-0" />

          <button
            type="button"
            onClick={() => setActiveFilter('PUBLIC')}
            className={cn(
              'px-2.5 py-1 rounded-lg border font-medium transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer',
              activeFilter === 'PUBLIC'
                ? 'bg-primary/10 border-primary/40 text-primary font-semibold shadow-2xs'
                : 'bg-background/60 border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            <Globe className="h-3 w-3" />
            Public <span className="opacity-70">({counts.public})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('PRIVATE')}
            className={cn(
              'px-2.5 py-1 rounded-lg border font-medium transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer',
              activeFilter === 'PRIVATE'
                ? 'bg-primary/10 border-primary/40 text-primary font-semibold shadow-2xs'
                : 'bg-background/60 border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/40'
            )}
          >
            <Lock className="h-3 w-3" />
            Private <span className="opacity-70">({counts.private})</span>
          </button>
        </div>
      </div>

      {/* Main List Container */}
      <div className="rounded-2xl border border-border/80 bg-card text-card-foreground shadow-sm overflow-hidden min-h-[380px]">
        {/* Top Header Strip */}
        <div className="px-5 py-3 border-b border-border/70 flex flex-wrap justify-between items-center gap-3 bg-muted/20">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-bold">
              Standard Operating Templates
            </span>
            <span className="text-xs text-muted-foreground/60">&bull;</span>
            <span className="text-xs text-muted-foreground">
              Showing <strong className="text-foreground">{filteredTemplates.length}</strong> of{' '}
              {templates.length}
            </span>
          </div>

          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setActiveFilter('ALL');
              }}
              className="text-xs text-primary hover:underline font-medium cursor-pointer"
            >
              Reset filters
            </button>
          )}
        </div>

        {/* Templates Rows */}
        <div className="p-4 sm:p-5 space-y-3">
          {templates.length === 0 ? (
            /* System Empty State */
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/60 border border-border/70 shadow-xs mb-4">
                <LayoutTemplate className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-bold text-foreground mb-1">No Templates Found</h3>
              <p className="text-xs sm:text-sm text-muted-foreground max-w-sm mb-6">
                Create incident templates with pre-configured titles, severities, and runbook
                checklists to speed up triage.
              </p>
              {canManageTemplates && (
                <Link href="/incidents/templates/create">
                  <Button className="font-semibold shadow-xs">
                    <Plus className="w-4 h-4 mr-2" />
                    Create First Template
                  </Button>
                </Link>
              )}
            </div>
          ) : filteredTemplates.length === 0 ? (
            /* Filter Empty State */
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/60 border border-border/70 mb-3">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-1">
                No matching templates
              </h3>
              <p className="text-xs text-muted-foreground max-w-xs mb-4">
                We couldn&apos;t find any templates matching &quot;{searchQuery}&quot; with the
                selected filter.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setActiveFilter('ALL');
                }}
              >
                Clear all filters
              </Button>
            </div>
          ) : (
            filteredTemplates.map(template => {
              const urgencyMeta = URGENCY_CONFIG[template.defaultUrgency] || URGENCY_CONFIG.HIGH;
              const UrgencyIcon = urgencyMeta.icon;
              const isOwner = template.createdById === currentUserId;

              return (
                <div
                  key={template.id}
                  className={cn(
                    'group/card relative rounded-xl border border-border/80 bg-card/80 hover:bg-card hover:border-border hover:shadow-md transition-all duration-200 overflow-hidden',
                    'border-l-4',
                    urgencyMeta.borderClass
                  )}
                >
                  <div className="p-4 sm:p-4.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    {/* Left: Urgency Icon & Identity */}
                    <div className="flex items-start gap-3.5 min-w-0 flex-1">
                      <div
                        className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-2xs mt-0.5',
                          urgencyMeta.iconBg
                        )}
                        title={urgencyMeta.label}
                      >
                        <UrgencyIcon className="h-5 w-5" />
                      </div>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        {/* Title & Badges */}
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-bold text-foreground leading-tight tracking-tight">
                            {template.name}
                          </h3>

                          {/* Visibility badge */}
                          {template.isPublic ? (
                            <Badge
                              variant="neutral"
                              size="xs"
                              className="text-[10px] font-semibold uppercase gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                            >
                              <Globe className="h-2.5 w-2.5" />
                              Public
                            </Badge>
                          ) : (
                            <Badge
                              variant="neutral"
                              size="xs"
                              className="text-[10px] font-semibold uppercase gap-1 bg-muted text-muted-foreground border-border/70"
                            >
                              <Lock className="h-2.5 w-2.5" />
                              Private
                            </Badge>
                          )}

                          {/* Urgency badge */}
                          <Badge
                            variant="neutral"
                            size="xs"
                            className={cn(
                              'text-[10px] font-semibold uppercase font-mono',
                              urgencyMeta.badgeClass
                            )}
                          >
                            {template.defaultUrgency}
                          </Badge>

                          {/* Priority badge */}
                          {template.defaultPriority && (
                            <Badge
                              variant="neutral"
                              size="xs"
                              className={cn(
                                'text-[10px] font-bold font-mono',
                                template.defaultPriority === 'P1'
                                  ? 'bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300'
                                  : template.defaultPriority === 'P2'
                                    ? 'bg-orange-500/15 text-orange-700 border-orange-500/30 dark:text-orange-300'
                                    : 'bg-muted text-foreground border-border/70'
                              )}
                            >
                              {template.defaultPriority}
                            </Badge>
                          )}
                        </div>

                        {/* Description & Default Title Preview */}
                        <div className="space-y-1">
                          {template.description ? (
                            <p className="text-xs text-muted-foreground line-clamp-1 leading-relaxed">
                              {template.description}
                            </p>
                          ) : null}

                          <div className="flex items-center gap-1.5 flex-wrap text-xs">
                            <span className="text-[11px] font-medium text-muted-foreground/80">
                              Default Title:
                            </span>
                            <span
                              className="font-mono text-[11px] text-foreground bg-muted/60 border border-border/70 px-2 py-0.5 rounded max-w-md truncate"
                              title={template.title}
                            >
                              {template.title}
                            </span>
                          </div>
                        </div>

                        {/* Metadata Footer: Service, Author, Time */}
                        <div className="flex items-center gap-3 sm:gap-4 flex-wrap text-xs text-muted-foreground pt-0.5">
                          {template.defaultService && (
                            <div className="flex items-center gap-1 text-[11px] font-medium text-foreground bg-muted/40 border border-border/60 px-2 py-0.5 rounded">
                              <Server className="h-3 w-3 text-muted-foreground" />
                              <span>{template.defaultService.name}</span>
                            </div>
                          )}

                          {template.createdBy && (
                            <div className="flex items-center gap-1 text-[11px]">
                              <User className="h-3 w-3 text-muted-foreground/70" />
                              <span>{template.createdBy.name}</span>
                            </div>
                          )}

                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
                            <Clock className="h-3 w-3" />
                            <span>{formatRelativeTime(template.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right: Quick Actions */}
                    <div className="flex items-center gap-2 self-end md:self-center shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-border/60 w-full md:w-auto justify-end">
                      <CreateIncidentButton
                        templateId={template.id}
                        size="sm"
                        className="h-8.5 px-3.5 text-xs font-semibold gap-1.5 shadow-2xs bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer"
                      >
                        <Sparkles className="h-3.5 w-3.5 opacity-80" />
                        <span>Use Template</span>
                        <ArrowUpRight className="h-3.5 w-3.5 opacity-70 ml-0.5" />
                      </CreateIncidentButton>

                      {canManageTemplates && (isOwner || canManageTemplates) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8.5 w-8.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                              aria-label={`More options for template ${template.name}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <CreateIncidentButton
                              templateId={template.id}
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start text-xs font-medium px-2 py-1.5 h-auto text-left"
                            >
                              <ArrowUpRight className="h-3.5 w-3.5 mr-2" />
                              Declare Incident
                            </CreateIncidentButton>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              disabled={isDeleting}
                              onClick={() => handleDelete(template.id, template.name)}
                              className="text-xs text-rose-600 dark:text-rose-400 focus:text-rose-600 focus:bg-rose-500/10 cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" />
                              Delete Template
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
