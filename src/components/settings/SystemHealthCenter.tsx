'use client';

import { useState, useEffect, useTransition, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Activity,
  Database,
  Cpu,
  Bell,
  Shield,
  Layers,
  RefreshCw,
  Download,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CircleHelp,
  ExternalLink,
  Clock,
  Radio,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Input } from '@/components/ui/shadcn/input';
import { Switch } from '@/components/ui/shadcn/switch';
import { cn } from '@/lib/utils';
import { notify as toast } from '@/lib/toast';
import { refreshAdminHealthAction } from '@/app/(app)/settings/system/actions';
import type {
  AdminHealthReport,
  AdminHealthCheck,
  HealthLevel,
  HealthCategory,
} from '@/lib/admin-health';

type Props = {
  initialReport: AdminHealthReport;
};

const CATEGORIES: { key: 'all' | HealthCategory; label: string; icon: typeof Activity }[] = [
  { key: 'all', label: 'All Signals', icon: Layers },
  { key: 'database', label: 'Database & Storage', icon: Database },
  { key: 'workers', label: 'Workers & Queues', icon: Cpu },
  { key: 'alerting', label: 'Alerting & Delivery', icon: Bell },
  { key: 'security', label: 'Security & Auth', icon: Shield },
  { key: 'platform', label: 'Platform & Version', icon: Activity },
];

const STATUS_CONFIG: Record<
  HealthLevel,
  {
    label: string;
    badgeClass: string;
    cardBorder: string;
    icon: typeof Activity;
    iconBg: string;
    iconText: string;
    dotClass: string;
  }
> = {
  healthy: {
    label: 'Healthy',
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    cardBorder: 'hover:border-emerald-500/40',
    icon: CheckCircle2,
    iconBg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
    iconText: 'text-emerald-600 dark:text-emerald-400',
    dotClass: 'bg-emerald-500',
  },
  degraded: {
    label: 'Needs Attention',
    badgeClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    cardBorder: 'border-amber-500/40 ring-1 ring-amber-500/20',
    icon: AlertTriangle,
    iconBg: 'bg-amber-500/10 dark:bg-amber-500/20',
    iconText: 'text-amber-600 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
  unhealthy: {
    label: 'Action Required',
    badgeClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    cardBorder: 'border-rose-500/40 ring-1 ring-rose-500/20',
    icon: XCircle,
    iconBg: 'bg-rose-500/10 dark:bg-rose-500/20',
    iconText: 'text-rose-600 dark:text-rose-400',
    dotClass: 'bg-rose-500',
  },
  unknown: {
    label: 'Not Reported',
    badgeClass: 'bg-muted text-muted-foreground border-border',
    cardBorder: 'hover:border-border',
    icon: CircleHelp,
    iconBg: 'bg-muted',
    iconText: 'text-muted-foreground',
    dotClass: 'bg-muted-foreground',
  },
};

const CATEGORY_LABELS: Record<HealthCategory, string> = {
  database: 'Database',
  workers: 'Workers & Queues',
  alerting: 'Alerting',
  security: 'Security',
  platform: 'Platform',
};

export default function SystemHealthCenter({ initialReport }: Props) {
  const [report, setReport] = useState<AdminHealthReport>(initialReport);
  const [isPending, startTransition] = useTransition();
  const [selectedCategory, setSelectedCategory] = useState<'all' | HealthCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(
    () => new Date(initialReport.generatedAt)
  );

  const handleRefresh = useCallback(() => {
    startTransition(async () => {
      try {
        const { report: freshReport } = await refreshAdminHealthAction();
        setReport(freshReport);
        setLastRefreshedAt(new Date(freshReport.generatedAt));
        toast.success('System diagnostics refreshed');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to refresh diagnostics');
      }
    });
  }, []);

  // Live auto-refresh timer (every 30 seconds if enabled)
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      handleRefresh();
    }, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, handleRefresh]);

  // Aggregate stats
  const healthyCount = useMemo(
    () => report.checks.filter(c => c.status === 'healthy').length,
    [report.checks]
  );
  const degradedCount = useMemo(
    () => report.checks.filter(c => c.status === 'degraded').length,
    [report.checks]
  );
  const unhealthyCount = useMemo(
    () => report.checks.filter(c => c.status === 'unhealthy').length,
    [report.checks]
  );
  const attentionCount = degradedCount + unhealthyCount;

  // Category badge counts
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: report.checks.length };
    for (const check of report.checks) {
      counts[check.category] = (counts[check.category] || 0) + 1;
    }
    return counts;
  }, [report.checks]);

  // Filtered check list
  const filteredChecks = useMemo(() => {
    return report.checks.filter(check => {
      // Category filter
      if (selectedCategory !== 'all' && check.category !== selectedCategory) {
        return false;
      }
      // Needs attention only filter
      if (onlyAttention && check.status !== 'degraded' && check.status !== 'unhealthy') {
        return false;
      }
      // Search keyword filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesLabel = check.label.toLowerCase().includes(query);
        const matchesSummary = check.summary.toLowerCase().includes(query);
        const matchesDetails = check.details.some(d => d.toLowerCase().includes(query));
        const matchesCategory = check.category.toLowerCase().includes(query);
        if (!matchesLabel && !matchesSummary && !matchesDetails && !matchesCategory) {
          return false;
        }
      }
      return true;
    });
  }, [report.checks, selectedCategory, onlyAttention, searchQuery]);

  // Export diagnostic report as JSON
  const handleExport = () => {
    const exportData = {
      app: 'OpsKnight',
      type: 'System Health Diagnostic Report',
      generatedAt: report.generatedAt,
      overallStatus: report.overall,
      summary: {
        totalChecks: report.checks.length,
        healthy: healthyCount,
        degraded: degradedCount,
        unhealthy: unhealthyCount,
      },
      checks: report.checks.map(c => ({
        id: c.id,
        category: c.category,
        label: c.label,
        status: c.status,
        summary: c.summary,
        details: c.details,
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opsknight-system-health-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Diagnostic report downloaded');
  };

  const overallConfig = STATUS_CONFIG[report.overall];
  const OverallIcon = overallConfig.icon;

  return (
    <div className="space-y-6">
      {/* Top Glassmorphic Health Cockpit Capsule */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-b from-card via-card/90 to-muted/20 p-5 md:p-6 shadow-xs">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />

        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          {/* Status Indicator & Title */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3">
                <span
                  className={cn(
                    'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
                    overallConfig.dotClass
                  )}
                />
                <span
                  className={cn(
                    'relative inline-flex rounded-full h-3 w-3',
                    overallConfig.dotClass
                  )}
                />
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Operational Telemetry
              </span>
              <Badge
                variant="outline"
                className={cn('text-xs font-semibold px-2.5 py-0.5 ml-1', overallConfig.badgeClass)}
              >
                <OverallIcon className="mr-1.5 h-3.5 w-3.5" />
                {overallConfig.label}
              </Badge>
            </div>
            <h2 className="text-xl md:text-2xl font-black tracking-tight text-foreground">
              {report.overall === 'healthy'
                ? 'All Core Systems Operational'
                : report.overall === 'degraded'
                  ? 'Operational with Warnings'
                  : 'Critical System Gaps Detected'}
            </h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground/70" />
              Last diagnostic scan completed{' '}
              <span className="font-semibold text-foreground">
                {lastRefreshedAt.toLocaleTimeString()}
              </span>
            </p>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Live Auto-Refresh Toggle */}
            <div className="flex items-center gap-2 rounded-lg border border-border/80 bg-background/80 px-3 py-1.5 shadow-2xs backdrop-blur-xs">
              <Radio
                className={cn(
                  'h-3.5 w-3.5 transition-colors',
                  autoRefresh ? 'text-primary animate-pulse' : 'text-muted-foreground'
                )}
              />
              <span className="text-xs font-semibold text-muted-foreground select-none">
                Live (30s)
              </span>
              <Switch
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
                aria-label="Toggle live 30s refresh"
              />
            </div>

            {/* Export Diagnostic Bundle */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              className="text-xs font-semibold h-8 gap-1.5 border-border/80 hover:bg-accent"
            >
              <Download className="h-3.5 w-3.5" />
              Export Report
            </Button>

            {/* Re-run Diagnostics */}
            <Button
              variant="default"
              size="sm"
              onClick={handleRefresh}
              disabled={isPending}
              className="text-xs font-semibold h-8 gap-1.5 shadow-xs"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isPending && 'animate-spin')} />
              {isPending ? 'Running Diagnostics...' : 'Re-run Diagnostics'}
            </Button>
          </div>
        </div>

        {/* Quick Health Metrics Ribbon */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-border/60 pt-4">
          <div className="space-y-0.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Total Signals</span>
            <div className="text-xl font-bold text-foreground">{report.checks.length}</div>
          </div>
          <div className="space-y-0.5">
            <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              Healthy
            </span>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
              {healthyCount}
            </div>
          </div>
          <div className="space-y-0.5">
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              Degraded Warnings
            </span>
            <div className="text-xl font-bold text-amber-600 dark:text-amber-400">
              {degradedCount}
            </div>
          </div>
          <div className="space-y-0.5">
            <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
              Action Required
            </span>
            <div className="text-xl font-bold text-rose-600 dark:text-rose-400">
              {unhealthyCount}
            </div>
          </div>
        </div>
      </div>

      {/* Filter Toolbar: Category Chips, Attention Toggle & Search */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Category Filter Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {CATEGORIES.map(cat => {
              const Icon = cat.icon;
              const count = categoryCounts[cat.key] || 0;
              const isSelected = selectedCategory === cat.key;

              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setSelectedCategory(cat.key)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-all border shadow-2xs',
                    isSelected
                      ? 'bg-primary/10 border-primary/40 text-primary ring-1 ring-primary/30'
                      : 'bg-card border-border/80 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {cat.label}
                  <span
                    className={cn(
                      'ml-0.5 text-[10px] rounded-full px-1.5 py-0.2',
                      isSelected ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Attention Only Toggle Button */}
          <button
            type="button"
            onClick={() => setOnlyAttention(prev => !prev)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all border shrink-0',
              onlyAttention
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30 shadow-2xs'
                : 'bg-card border-border/80 text-muted-foreground hover:bg-muted/40 hover:text-foreground'
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Needs Attention Only
            {attentionCount > 0 && (
              <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] text-amber-700 dark:text-amber-300 font-bold">
                {attentionCount}
              </span>
            )}
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search diagnostic signals by keyword (e.g. postgres, scheduler, encryption, migrations)..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs bg-card border-border/80"
          />
        </div>
      </div>

      {/* Diagnostic Signals Grid */}
      {filteredChecks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/80 bg-card p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-3">
            <Search className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-bold text-foreground">No Diagnostic Signals Found</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            No health checks matched your current category or search query.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedCategory('all');
                setOnlyAttention(false);
                setSearchQuery('');
              }}
              className="text-xs h-8"
            >
              Reset All Filters
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredChecks.map(check => (
            <HealthCheckCard key={check.id} check={check} />
          ))}
        </div>
      )}
    </div>
  );
}

function HealthCheckCard({ check }: { check: AdminHealthCheck }) {
  const config = STATUS_CONFIG[check.status];
  const StatusIcon = config.icon;
  const categoryLabel = CATEGORY_LABELS[check.category] || check.category;

  return (
    <div
      className={cn(
        'group flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4 transition-all duration-150 shadow-2xs hover:shadow-xs',
        config.cardBorder
      )}
    >
      <div>
        {/* Header: Category Badge + Status Badge */}
        <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/60">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
            {categoryLabel}
          </span>
          <Badge
            variant="outline"
            className={cn('text-[10px] font-semibold px-2 py-0.5', config.badgeClass)}
          >
            <StatusIcon className="mr-1 h-3 w-3 shrink-0" />
            {config.label}
          </Badge>
        </div>

        {/* Title & Icon */}
        <div className="flex items-start gap-2.5 pt-3 pb-2">
          <div className={cn('p-2 rounded-lg shrink-0 mt-0.5', config.iconBg, config.iconText)}>
            <StatusIcon className="h-4 w-4" />
          </div>
          <div className="space-y-0.5 min-w-0">
            <h3 className="text-sm font-bold text-foreground tracking-tight leading-tight truncate">
              {check.label}
            </h3>
            <p className="text-xs font-medium text-foreground/90 leading-snug break-words">
              {check.summary}
            </p>
          </div>
        </div>

        {/* Structured Details Bullet List */}
        {check.details.length > 0 && (
          <div className="pt-2 pb-3 space-y-1.5">
            {check.details.map((detail, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
                <span className="leading-relaxed break-words font-mono text-[11px] text-muted-foreground/90">
                  {detail}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action Button */}
      {check.action && (
        <div className="pt-2 border-t border-border/50">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs h-7.5 font-semibold justify-between border-border/80 hover:bg-accent/60"
            asChild
          >
            <Link
              href={check.action.href}
              target={check.action.href.startsWith('http') ? '_blank' : undefined}
              rel={check.action.href.startsWith('http') ? 'noopener noreferrer' : undefined}
            >
              <span>{check.action.label}</span>
              {check.action.href.startsWith('http') ? (
                <ExternalLink className="h-3 w-3 opacity-70" />
              ) : (
                <Activity className="h-3 w-3 opacity-70" />
              )}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
