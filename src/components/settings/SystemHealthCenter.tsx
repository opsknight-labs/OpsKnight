'use client';

import {
  useState,
  useEffect,
  useTransition,
  useMemo,
  useCallback,
  useRef,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { pageHeaderBadgeClass } from '@/components/patterns/PageHeader';
import { toneClasses } from '@/components/patterns/status-tone';
import DetailTabs from '@/components/ui/DetailTabs';
import EmptyState from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { Switch } from '@/components/ui/shadcn/switch';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shadcn/card';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/shadcn/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { Separator } from '@/components/ui/shadcn/separator';
import { cn } from '@/lib/utils';
import { notify as toast } from '@/lib/toast';
import {
  refreshAdminHealthAction,
  refreshSingleHealthCheckAction,
} from '@/app/(app)/settings/system/actions';
import type {
  AdminHealthReport,
  AdminHealthCheck,
  HealthLevel,
  HealthCategory,
  HealthHistorySample,
} from '@/lib/admin-health';
import {
  Activity,
  Database,
  Cpu,
  Bell,
  Shield,
  Layers,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CircleHelp,
  ExternalLink,
  Radio,
  SlidersHorizontal,
  ChevronRight,
  Terminal,
  Copy,
  Check,
  Info,
  Code2,
  Zap,
} from 'lucide-react';

type Props = {
  initialReport: AdminHealthReport;
};

const STATUS_CONFIG: Record<
  HealthLevel,
  {
    label: string;
    badgeClass: string;
    cardBorder: string;
    icon: typeof Activity;
    iconBg: string;
    iconText: string;
  }
> = {
  healthy: {
    label: 'Healthy',
    badgeClass: toneClasses('ok').soft,
    cardBorder: toneClasses('ok').hoverBorder,
    icon: CheckCircle2,
    iconBg: toneClasses('ok').soft,
    iconText: toneClasses('ok').text,
  },
  degraded: {
    label: 'Needs Attention',
    badgeClass: toneClasses('elevated').soft,
    cardBorder: 'border-status-elevated-border/40',
    icon: AlertTriangle,
    iconBg: toneClasses('elevated').soft,
    iconText: toneClasses('elevated').text,
  },
  unhealthy: {
    label: 'Action Required',
    badgeClass: toneClasses('critical').soft,
    cardBorder: 'border-status-critical-border/40',
    icon: XCircle,
    iconBg: toneClasses('critical').soft,
    iconText: toneClasses('critical').text,
  },
  unknown: {
    label: 'Not Reported',
    badgeClass: toneClasses(null).soft,
    cardBorder: 'hover:border-ink-300',
    icon: CircleHelp,
    iconBg: 'bg-muted',
    iconText: 'text-muted-foreground',
  },
  informational: {
    label: 'Informational',
    badgeClass: toneClasses('info').soft,
    cardBorder: toneClasses('info').hoverBorder,
    icon: Info,
    iconBg: toneClasses('info').soft,
    iconText: toneClasses('info').text,
  },
};

const CATEGORY_META: Record<
  HealthCategory,
  { label: string; icon: typeof Activity; description: string }
> = {
  database: {
    label: 'Database & Storage',
    icon: Database,
    description:
      'PostgreSQL instance latency, connection pool capacity, and Prisma schema migration history',
  },
  workers: {
    label: 'Workers & Queues',
    icon: Cpu,
    description:
      'Internal cron scheduler heartbeats, background jobs queue, SLA query performance, and escalation locks',
  },
  alerting: {
    label: 'Alerting & Delivery',
    icon: Bell,
    description:
      'Service paging coverage, outbound notification providers, and inbound integration error rates',
  },
  security: {
    label: 'Security & Auth',
    icon: Shield,
    description:
      'Public canonical origin consistency and AES-256 cryptographic encryption key validation',
  },
  platform: {
    label: 'Platform & Version',
    icon: Activity,
    description: 'Running OpsKnight release check and latest GitHub upstream upgrade availability',
  },
};

const emptySubscribe = () => () => {};
function useIsClient(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export default function SystemHealthCenter({ initialReport }: Props) {
  const isClient = useIsClient();
  const [report, setReport] = useState<AdminHealthReport>(initialReport);
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<string>('all');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [countdown, setCountdown] = useState<number>(30);
  const [retestingId, setRetestingId] = useState<string | null>(null);
  const [inspectingCheck, setInspectingCheck] = useState<AdminHealthCheck | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(
    () => new Date(initialReport.generatedAt)
  );
  const refreshInFlight = useRef(false);

  const handleRefresh = useCallback(() => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    startTransition(async () => {
      try {
        const { report: freshReport } = await refreshAdminHealthAction();
        setReport(freshReport);
        setLastRefreshedAt(new Date(freshReport.generatedAt));
        setRefreshError(null);
        setCountdown(30);
        toast.success('System diagnostics refreshed');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to refresh diagnostics';
        setRefreshError(message);
        toast.error(message);
      } finally {
        refreshInFlight.current = false;
      }
    });
  }, []);

  const handleRetestCheck = useCallback(async (checkId: string) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRetestingId(checkId);
    try {
      const { check: updatedCheck, report: freshReport } =
        await refreshSingleHealthCheckAction(checkId);
      if (updatedCheck) {
        setReport(freshReport);
        setLastRefreshedAt(new Date(freshReport.generatedAt));
        setRefreshError(null);
        setInspectingCheck(previous => (previous?.id === checkId ? updatedCheck : previous));
        toast.success(`"${updatedCheck.label}" re-tested`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to re-test signal');
    } finally {
      setRetestingId(null);
      refreshInFlight.current = false;
    }
  }, []);

  const handleAutoRefreshChange = useCallback((enabled: boolean) => {
    setAutoRefresh(enabled);
    if (!enabled) {
      setCountdown(30);
    }
  }, []);

  // Live auto-refresh polling with 1-second countdown ticker
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      setCountdown(prev => {
        if (prev <= 1) {
          handleRefresh();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, handleRefresh]);

  // Aggregate counts
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
  const unknownCount = useMemo(
    () => report.checks.filter(c => c.status === 'unknown').length,
    [report.checks]
  );
  const attentionCount = degradedCount + unhealthyCount + unknownCount;

  // Category counts
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
      if (activeTab !== 'all' && check.category !== activeTab) {
        return false;
      }
      if (
        onlyAttention &&
        check.status !== 'degraded' &&
        check.status !== 'unhealthy' &&
        check.status !== 'unknown'
      ) {
        return false;
      }
      return true;
    });
  }, [report.checks, activeTab, onlyAttention]);

  const overallConfig = STATUS_CONFIG[report.overall];

  const tabItems = [
    {
      id: 'all',
      label: 'All Signals',
      icon: <Layers className="h-3.5 w-3.5" />,
      count: categoryCounts.all,
    },
    {
      id: 'database',
      label: 'Database',
      icon: <Database className="h-3.5 w-3.5" />,
      count: categoryCounts.database,
    },
    {
      id: 'workers',
      label: 'Workers',
      icon: <Cpu className="h-3.5 w-3.5" />,
      count: categoryCounts.workers,
    },
    {
      id: 'alerting',
      label: 'Alerting',
      icon: <Bell className="h-3.5 w-3.5" />,
      count: categoryCounts.alerting,
    },
    {
      id: 'security',
      label: 'Security',
      icon: <Shield className="h-3.5 w-3.5" />,
      count: categoryCounts.security,
    },
    {
      id: 'platform',
      label: 'Platform',
      icon: <Activity className="h-3.5 w-3.5" />,
      count: categoryCounts.platform,
    },
  ];

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        eyebrow="Diagnostics & Telemetry"
        title="System Health Center"
        icon={Activity}
        badges={
          <>
            <span
              className={cn(
                pageHeaderBadgeClass,
                report.overall === 'healthy' && 'border-emerald-500/40 text-emerald-300',
                report.overall === 'degraded' && 'border-amber-500/40 text-amber-300',
                report.overall === 'unhealthy' && 'border-rose-500/40 text-rose-300'
              )}
            >
              {overallConfig.label}
            </span>
            <span className={pageHeaderBadgeClass}>
              {report.overall === 'healthy'
                ? 'All core systems operational'
                : report.overall === 'degraded'
                  ? 'Operational with warnings'
                  : report.overall === 'unhealthy'
                    ? 'Needs attention now'
                    : 'Not enough evidence yet'}
            </span>
          </>
        }
        description={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-primary-foreground/80">
            <span>
              Real-time operational diagnostic signals across PostgreSQL, queues, schedulers, and
              integrations.
            </span>
            <span className="opacity-40">•</span>
            <span suppressHydrationWarning>
              Last verified at{' '}
              {isClient
                ? lastRefreshedAt.toLocaleTimeString()
                : new Date(initialReport.generatedAt).toISOString().slice(11, 19)}
              {report.durationMs !== undefined ? ` in ${report.durationMs} ms` : ''}
            </span>
          </div>
        }
        statsPlacement="bottom"
        stats={[
          {
            label: 'Health Score',
            value: report.scorePercent !== undefined ? `${report.scorePercent}%` : '—',
            icon: <Layers className="h-4 w-4 opacity-80" />,
            subtext: `${report.knownSignalPercent ?? 100}% evidence coverage`,
          },
          {
            label: 'Healthy',
            value: healthyCount,
            icon: <CheckCircle2 className="h-4 w-4 text-emerald-300" />,
            subtext: 'Passing normally',
          },
          {
            label: 'Degraded',
            value: degradedCount,
            icon: <AlertTriangle className="h-4 w-4 text-amber-300" />,
            subtext: 'Sub-optimal latency/retries',
          },
          {
            label: 'Action / Unknown',
            value: `${unhealthyCount} / ${unknownCount}`,
            icon: <XCircle className="h-4 w-4 text-rose-300" />,
            subtext: 'Failures / missing evidence',
          },
        ]}
        primaryAction={
          <div className="flex flex-wrap items-center gap-2">
            {/* Live Auto-Refresh Toggle + Countdown Badge */}
            <div className="flex items-center gap-2 rounded-lg border border-primary-foreground/20 bg-primary-foreground/10 px-2.5 py-1">
              <Radio
                className={cn(
                  'h-3.5 w-3.5 transition-colors',
                  autoRefresh ? 'text-emerald-300 animate-pulse' : 'text-primary-foreground/60'
                )}
              />
              <span className="text-xs font-semibold text-primary-foreground select-none">
                Live (30s)
              </span>
              {autoRefresh && (
                <span
                  aria-label="Refresh countdown"
                  className="text-2xs font-mono font-semibold tabular-nums text-primary-foreground bg-primary-foreground/10 px-1.5 py-0.5 rounded border border-primary-foreground/20"
                >
                  {countdown}s
                </span>
              )}
              <Switch
                checked={autoRefresh}
                onCheckedChange={handleAutoRefreshChange}
                aria-label="Toggle live 30s refresh"
                className="data-[state=checked]:bg-emerald-400"
              />
            </div>

            {/* Re-run Diagnostics */}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefresh}
              disabled={isPending}
              className="text-xs font-semibold h-8 gap-1.5 shadow-sm"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isPending && 'animate-spin')} />
              {isPending ? 'Running...' : 'Re-run Diagnostics'}
            </Button>
          </div>
        }
      />

      {/* 24-Hour Diagnostic History Sparkline (Service Health Trend) */}
      <HealthHistoryRibbon history={report.history} overall={report.overall} />

      <OperationalBrief checks={report.checks} />

      {refreshError && (
        <div
          role="alert"
          className={cn(
            'flex items-start gap-2 rounded-lg border p-3 text-xs',
            toneClasses('elevated').soft
          )}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">
              Latest refresh failed; showing the last successful report.
            </p>
            <p className="mt-0.5 opacity-90">{refreshError}</p>
          </div>
        </div>
      )}

      {/* Centralized DetailTabs Navigation Header */}
      <DetailTabs
        tabs={tabItems}
        defaultTab="all"
        activeTab={activeTab}
        onTabChange={setActiveTab}
        syncWithUrl={false}
        layout="auto"
        actions={
          <div className="flex items-center gap-2">
            {/* Needs Attention Filter */}
            <button
              type="button"
              aria-pressed={onlyAttention}
              onClick={() => setOnlyAttention(prev => !prev)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors border shrink-0',
                onlyAttention
                  ? toneClasses('elevated').soft
                  : 'bg-card border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Needs Attention Only
              {attentionCount > 0 && (
                <span
                  className={cn(
                    'ml-1 rounded-full border px-1.5 text-2xs font-semibold tabular-nums',
                    toneClasses('elevated').soft
                  )}
                >
                  {attentionCount}
                </span>
              )}
            </button>
          </div>
        }
      >
        {/* Tab Content & Check Signal Cards Grid */}
        {filteredChecks.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className={cn('h-6 w-6', toneClasses('ok').text)} />}
            title="No Signals Need Attention"
            description="No degraded, unhealthy, or unreported signals match this filter."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setActiveTab('all');
                  setOnlyAttention(false);
                }}
                className="text-xs h-8"
              >
                Show All Signals
              </Button>
            }
            variant="dashed"
            size="md"
          />
        ) : (
          <div className="space-y-4">
            {/* Domain Group Header if a single category is selected */}
            {activeTab !== 'all' && CATEGORY_META[activeTab as HealthCategory] && (
              <div className="flex items-center justify-between pb-1 border-b border-border">
                <div className="space-y-0.5">
                  <h2 className="text-sm font-semibold text-foreground">
                    {CATEGORY_META[activeTab as HealthCategory].label}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {CATEGORY_META[activeTab as HealthCategory].description}
                  </p>
                </div>
                <Badge variant="outline" className="text-xs font-semibold">
                  {filteredChecks.length} Signals
                </Badge>
              </div>
            )}

            {/* Diagnostic Signal Cards Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredChecks.map(check => (
                <HealthCheckCard
                  key={check.id}
                  check={check}
                  isRetesting={retestingId === check.id}
                  onRetest={() => handleRetestCheck(check.id)}
                  onInspect={() => setInspectingCheck(check)}
                />
              ))}
            </div>
          </div>
        )}
      </DetailTabs>

      {/* Technical Diagnostics Inspector Modal */}
      {inspectingCheck && (
        <DiagnosticInspectorModal
          check={inspectingCheck}
          onClose={() => setInspectingCheck(null)}
        />
      )}
    </div>
  );
}

function OperationalBrief({ checks }: { checks: AdminHealthCheck[] }) {
  const attention = useMemo(() => {
    const rank: Record<HealthLevel, number> = {
      unhealthy: 0,
      degraded: 1,
      unknown: 2,
      informational: 3,
      healthy: 4,
    };
    return checks
      .filter(
        check =>
          check.status !== 'healthy' && check.status !== 'informational' && check.required !== false
      )
      .sort((left, right) => rank[left.status] - rank[right.status])
      .slice(0, 5);
  }, [checks]);

  if (attention.length === 0) return null;

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className={cn('h-4 w-4', toneClasses('elevated').text)} />
          Operational priorities
        </CardTitle>
        <CardDescription>
          Highest-impact failures, warnings, and evidence gaps from this diagnostic run.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {attention.map(check => {
          const config = STATUS_CONFIG[check.status];
          const StatusIcon = config.icon;
          return (
            <div
              key={check.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-muted/15 p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <StatusIcon className={cn('mt-0.5 h-4 w-4 shrink-0', config.iconText)} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">{check.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {check.summary}
                  </p>
                  {check.impact && (
                    <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                      <span className="font-semibold text-foreground">Impact:</span> {check.impact}
                    </p>
                  )}
                </div>
              </div>
              {check.action && (
                <Button variant="outline" size="sm" asChild className="h-7 shrink-0 text-2xs">
                  <Link
                    href={check.action.href}
                    target={check.action.href.startsWith('http') ? '_blank' : undefined}
                    rel={check.action.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  >
                    {check.action.label}
                    <ChevronRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/**
 * 24-Hour Diagnostic History Ribbon (Service Health Trend)
 */
function HealthHistoryRibbon({
  history,
  overall: _overall,
}: {
  history?: HealthHistorySample[];
  overall: HealthLevel;
}) {
  if (!history || history.length === 0) return null;

  const totalScore = history.reduce((sum, s) => sum + s.scorePercent, 0);
  const avgScore = totalScore / history.length;
  const uptimePercent = Number.isInteger(avgScore) ? avgScore.toString() : avgScore.toFixed(1);

  const percentColorClass =
    avgScore >= 98
      ? toneClasses('ok').text
      : avgScore >= 80
        ? toneClasses('elevated').text
        : toneClasses('critical').text;

  const statusMap: Record<HealthLevel, string> = {
    healthy: 'Operational',
    degraded: 'Degraded',
    unhealthy: 'Action Required',
    unknown: 'Not Reported',
    informational: 'Informational',
  };

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between pb-3 text-xs">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-semibold text-foreground text-xs tracking-tight">
            24-Hour Recorded Signal Trend
          </span>
          <span className={cn('text-2xs font-mono font-semibold', percentColorClass)}>
            • {uptimePercent}% Signal Score
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-2.5 text-2xs text-muted-foreground font-mono">
          <span className="flex items-center gap-1">
            <span className={cn('h-1.5 w-1.5 rounded-full', toneClasses('ok').solid)} /> Normal
          </span>
          <span className="flex items-center gap-1">
            <span className={cn('h-1.5 w-1.5 rounded-full', toneClasses('elevated').solid)} />{' '}
            Degraded
          </span>
          <span className="flex items-center gap-1">
            <span className={cn('h-1.5 w-1.5 rounded-full', toneClasses('critical').solid)} />{' '}
            Action Required
          </span>
        </div>
      </div>

      {/* Slim 24-bar sparkline flex row with smart clamped tooltip */}
      <div className="flex items-center gap-1 h-3.5 w-full">
        {history.map((sample, idx) => {
          const isHealthy = sample.status === 'healthy';
          const isDegraded = sample.status === 'degraded';
          const isUnhealthy = sample.status === 'unhealthy';

          const colorClass = isHealthy
            ? toneClasses('ok').solid
            : isDegraded
              ? toneClasses('elevated').solid
              : isUnhealthy
                ? toneClasses('critical').solid
                : 'bg-muted-foreground/30';

          const isLeftEdge = idx < 3;
          const isRightEdge = idx > history.length - 4;

          const tooltipAlignClass = isLeftEdge
            ? 'left-0 items-start'
            : isRightEdge
              ? 'right-0 items-end'
              : 'left-1/2 -translate-x-1/2 items-center';

          const arrowAlignClass = isLeftEdge
            ? 'left-3'
            : isRightEdge
              ? 'right-3'
              : 'left-1/2 -translate-x-1/2';

          const statusLabel = statusMap[sample.status] || 'Unknown';

          return (
            <div key={idx} className="group relative flex-1 h-full min-w-0">
              <div
                className={cn(
                  'h-3.5 w-full rounded-sm transition-all cursor-pointer hover:opacity-75',
                  colorClass
                )}
              />
              {/* Floating Tooltip with smart edge clamping */}
              <div
                className={cn(
                  'pointer-events-none absolute bottom-full mb-1.5 hidden group-hover:flex flex-col z-50',
                  tooltipAlignClass
                )}
              >
                <div className="rounded-md border border-border bg-popover px-2.5 py-1 text-2xs font-mono font-medium text-popover-foreground shadow-md whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <span>{sample.hourLabel}</span>
                    <span className="text-muted-foreground">•</span>
                    <span
                      className={
                        isHealthy
                          ? toneClasses('ok').text
                          : isDegraded
                            ? toneClasses('elevated').text
                            : isUnhealthy
                              ? toneClasses('critical').text
                              : 'text-muted-foreground'
                      }
                    >
                      {statusLabel}
                    </span>
                    <span className="text-muted-foreground">({sample.scorePercent}%)</span>
                  </div>
                  {sample.reason && (
                    <div className="text-2xs text-muted-foreground max-w-56 truncate pt-0.5 font-sans">
                      {sample.reason}
                    </div>
                  )}
                </div>
                <div
                  className={cn(
                    'h-1 w-1.5 border-x-4 border-t-4 border-x-transparent border-t-border',
                    arrowAlignClass
                  )}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Axis markers */}
      <div className="flex items-center justify-between pt-1.5 text-2xs text-muted-foreground font-mono">
        <span>24 hours ago</span>
        <span className="hidden sm:inline text-muted-foreground/60">12 hours ago</span>
        <span>Now</span>
      </div>
      <p className="pt-2 text-2xs leading-relaxed text-muted-foreground">
        Derived from recorded incidents and durable delivery/job failures. This is diagnostic
        context, not an uptime SLO or proof that unobserved periods were available.
      </p>
    </div>
  );
}

/**
 * Individual Diagnostic Signal Card with Gauges, Latency Pills, Command Box & Popover
 */
function HealthCheckCard({
  check,
  isRetesting,
  onRetest,
  onInspect,
}: {
  check: AdminHealthCheck;
  isRetesting: boolean;
  onRetest: () => void;
  onInspect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const config = STATUS_CONFIG[check.status];
  const StatusIcon = config.icon;
  const categoryMeta = CATEGORY_META[check.category];
  const CategoryIcon = categoryMeta?.icon || Activity;

  const copyCommand = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Command copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const telemetry = check.telemetry;

  return (
    <Card
      className={cn(
        'group flex flex-col justify-between overflow-hidden border border-border bg-card transition-all duration-150',
        config.cardBorder
      )}
    >
      <div>
        {/* Card Header: Category badge on left, Status badge on right */}
        <CardHeader className="p-4 pb-3 border-b border-border bg-muted/10">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-2xs font-semibold text-muted-foreground">
              <CategoryIcon className="h-3.5 w-3.5 text-muted-foreground/70" />
              <span>{categoryMeta?.label || check.category}</span>
            </div>
            <Badge
              variant="outline"
              className={cn('text-2xs font-semibold px-2 py-0.5', config.badgeClass)}
            >
              <StatusIcon className="mr-1 h-3 w-3 shrink-0" />
              {config.label}
            </Badge>
          </div>

          <div className="pt-2.5 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-sm font-semibold text-foreground tracking-tight leading-snug">
                {check.label}
              </CardTitle>

              {/* Latency Pill Badge for Database or SLA queries */}
              {telemetry?.latencyMs !== undefined && (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-2xs font-mono shrink-0 px-1.5 py-0.5 font-semibold leading-none',
                    telemetry.latencyMs <= 500
                      ? toneClasses('ok').soft
                      : toneClasses('elevated').soft
                  )}
                >
                  <Zap className="h-2.5 w-2.5 mr-1 inline shrink-0" aria-hidden="true" />
                  {telemetry.latencyMs}ms
                </Badge>
              )}

              {telemetry?.slaMetrics?.p95Ms !== undefined &&
                telemetry.slaMetrics.p95Ms !== null && (
                  <Badge
                    variant="outline"
                    className="text-2xs font-mono shrink-0 px-1.5 py-0.5 font-semibold leading-none"
                  >
                    p95
                    {telemetry.slaMetrics.windowLabel ? ` ${telemetry.slaMetrics.windowLabel}` : ''}
                    : {Math.round(telemetry.slaMetrics.p95Ms)}ms
                  </Badge>
                )}
            </div>

            <CardDescription className="text-xs text-muted-foreground leading-relaxed pt-0.5">
              {check.summary}
            </CardDescription>
          </div>
        </CardHeader>

        {/* Card Content */}
        <CardContent className="p-4 space-y-3">
          {/* Visual Telemetry Gauge 1: Database Connection Pool Utilization */}
          {telemetry?.poolUtilization && (
            <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-2.5">
              <div className="flex items-center justify-between text-2xs">
                <span className="font-semibold text-foreground">Pool Utilization</span>
                <span
                  className={cn(
                    'font-mono font-semibold',
                    telemetry.poolUtilization.percent > 90
                      ? toneClasses('critical').text
                      : telemetry.poolUtilization.percent > 75
                        ? toneClasses('elevated').text
                        : toneClasses('ok').text
                  )}
                >
                  {telemetry.poolUtilization.used} / {telemetry.poolUtilization.max} (
                  {telemetry.poolUtilization.percent}%)
                </span>
              </div>
              {/* Progress Bar */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full transition-all duration-300',
                    telemetry.poolUtilization.percent > 90
                      ? toneClasses('critical').solid
                      : telemetry.poolUtilization.percent > 75
                        ? toneClasses('elevated').solid
                        : toneClasses('ok').solid
                  )}
                  style={{ width: `${Math.min(100, telemetry.poolUtilization.percent)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-2xs text-muted-foreground pt-0.5">
                <span>Active: {telemetry.poolUtilization.active}</span>
                <span>Size: {telemetry.poolUtilization.sizeFormatted}</span>
              </div>
            </div>
          )}

          {/* Visual Telemetry Gauge 2: Background Jobs Queue Distribution */}
          {telemetry?.queueDistribution && (
            <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-2.5">
              <div className="flex items-center justify-between text-2xs">
                <span className="font-semibold text-foreground">Queue Distribution</span>
                <span className="font-mono text-muted-foreground text-2xs">
                  {telemetry.queueDistribution.pending +
                    telemetry.queueDistribution.processing +
                    telemetry.queueDistribution.failed}{' '}
                  total
                </span>
              </div>
              {/* Segmented Queue Distribution Bar */}
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted gap-0.5">
                {telemetry.queueDistribution.pending > 0 && (
                  <div
                    className="h-full bg-ink-400 transition-all"
                    style={{
                      width: `${Math.max(
                        10,
                        (telemetry.queueDistribution.pending /
                          Math.max(
                            1,
                            telemetry.queueDistribution.pending +
                              telemetry.queueDistribution.processing +
                              telemetry.queueDistribution.failed
                          )) *
                          100
                      )}%`,
                    }}
                  />
                )}
                {telemetry.queueDistribution.processing > 0 && (
                  <div
                    className="h-full bg-status-info motion-safe:animate-pulse transition-all"
                    style={{
                      width: `${Math.max(
                        10,
                        (telemetry.queueDistribution.processing /
                          Math.max(
                            1,
                            telemetry.queueDistribution.pending +
                              telemetry.queueDistribution.processing +
                              telemetry.queueDistribution.failed
                          )) *
                          100
                      )}%`,
                    }}
                  />
                )}
                {telemetry.queueDistribution.failed > 0 && (
                  <div
                    className={cn('h-full transition-all', toneClasses('critical').solid)}
                    style={{
                      width: `${Math.max(
                        10,
                        (telemetry.queueDistribution.failed /
                          Math.max(
                            1,
                            telemetry.queueDistribution.pending +
                              telemetry.queueDistribution.processing +
                              telemetry.queueDistribution.failed
                          )) *
                          100
                      )}%`,
                    }}
                  />
                )}
              </div>
              <div className="flex items-center justify-between text-2xs font-mono pt-0.5">
                <span className="text-muted-foreground">
                  Pending: {telemetry.queueDistribution.pending}
                </span>
                <span className={toneClasses('info').text}>
                  Processing: {telemetry.queueDistribution.processing}
                </span>
                <span
                  className={cn(
                    telemetry.queueDistribution.failed > 0
                      ? cn('font-semibold', toneClasses('critical').text)
                      : 'text-muted-foreground'
                  )}
                >
                  Failed: {telemetry.queueDistribution.failed}
                </span>
              </div>
            </div>
          )}

          {/* Details Bullet List */}
          <div className="space-y-1.5">
            {check.scope && (
              <div className="flex items-center justify-between rounded-md bg-muted/30 px-2 py-1 text-2xs text-muted-foreground">
                <span>Evidence scope</span>
                <span className="font-mono font-semibold uppercase">{check.scope}</span>
              </div>
            )}
            {check.details.map((detail, idx) => (
              <div key={idx} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 mt-1.5 shrink-0" />
                <span className="leading-relaxed break-words font-mono text-2xs text-muted-foreground/90">
                  {detail}
                </span>
              </div>
            ))}
          </div>

          {check.impact && (
            <div className="rounded-md border border-border bg-muted/40 px-2.5 py-2 text-2xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Operational impact: </span>
              {check.impact}
            </div>
          )}

          {/* Database Migrations / Remediation Command Box with (i) Popover */}
          {check.commandSnippet && (
            <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-2xs font-semibold text-primary">
                  <Terminal className="h-3.5 w-3.5 shrink-0" />
                  <span>{check.commandSnippet.description || 'Terminal Command'}</span>
                </div>

                {/* Interactive (i) Popover for Migration Deployment Steps */}
                {check.commandSnippet.steps && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label="View migration steps"
                        className="inline-flex items-center justify-center h-5 w-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                      >
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-80 p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <Terminal className="h-3.5 w-3.5 text-primary" />
                        <span>Migration Deployment Steps</span>
                      </div>
                      <div className="space-y-2 text-xs text-muted-foreground">
                        {check.commandSnippet.steps.map((step, sIdx) => (
                          <div key={sIdx} className="flex items-start gap-2">
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xs font-semibold text-primary">
                              {sIdx + 1}
                            </span>
                            <span className="leading-snug">{step}</span>
                          </div>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>

              {/* Command box with copy button */}
              <div className="flex items-center justify-between rounded-md border border-border bg-background px-2.5 py-1.5">
                <code className="text-xs font-mono font-semibold text-foreground select-all">
                  {check.commandSnippet.command}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyCommand(check.commandSnippet!.command)}
                  aria-label="Copy command"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground shrink-0 ml-2"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </div>

      {/* Action & Inspect Footer */}
      <div className="p-4 pt-0">
        <Separator className="mb-3" />
        <div className="flex items-center gap-1.5">
          {/* Collapsible/Inspect Raw Payload Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={onInspect}
            aria-label={`Inspect ${check.label}`}
            className="text-xs h-8 font-semibold border-border hover:bg-accent/60 gap-1 px-2.5"
          >
            <Code2 className="h-3.5 w-3.5 text-muted-foreground" />
            Inspect
          </Button>

          {/* Quick Single-Check Re-test Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={onRetest}
            disabled={isRetesting}
            aria-label={`Re-test ${check.label}`}
            className="text-xs h-8 font-semibold border-border hover:bg-accent/60 gap-1 px-2.5"
          >
            <RefreshCw
              className={cn(
                'h-3 w-3 text-muted-foreground',
                isRetesting && 'animate-spin text-primary'
              )}
            />
            {isRetesting ? 'Testing...' : 'Re-test'}
          </Button>

          {/* Action Runbook Link if available */}
          {check.action && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs h-8 font-semibold justify-between border-border hover:bg-accent/60 px-2.5"
              asChild
            >
              <Link
                href={check.action.href}
                target={check.action.href.startsWith('http') ? '_blank' : undefined}
                rel={check.action.href.startsWith('http') ? 'noopener noreferrer' : undefined}
              >
                <span className="truncate">{check.action.label}</span>
                {check.action.href.startsWith('http') ? (
                  <ExternalLink className="h-3 w-3 opacity-70 shrink-0 ml-1" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 opacity-70 shrink-0 ml-1" />
                )}
              </Link>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * Diagnostic Signal Inspector Modal (Raw Payload & Technical Facts)
 */
function DiagnosticInspectorModal({
  check,
  onClose,
}: {
  check: AdminHealthCheck;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const rawJson = useMemo(() => {
    const payload = {
      signalId: check.id,
      label: check.label,
      category: check.category,
      status: check.status,
      evidenceScope: check.scope || 'unspecified',
      observedAt: check.observedAt || null,
      summary: check.summary,
      operationalImpact: check.impact || null,
      details: check.details,
      commandSnippet: check.commandSnippet || null,
      telemetry: check.telemetry?.rawPayload || check.telemetry || {},
      inspectedAt: new Date().toISOString(),
    };
    return JSON.stringify(payload, null, 2);
  }, [check]);

  const copyPayload = () => {
    navigator.clipboard.writeText(rawJson);
    setCopied(true);
    toast.success('Technical payload copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const config = STATUS_CONFIG[check.status];
  const CategoryIcon = CATEGORY_META[check.category]?.icon || Activity;
  const StatusIcon = config.icon;

  return (
    <Dialog open={true} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-3xl lg:max-w-4xl p-0 gap-0 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary">
              <CategoryIcon className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-base font-semibold text-foreground tracking-tight">
                  {check.label}
                </DialogTitle>
                <Badge
                  variant="outline"
                  className={cn('text-2xs font-semibold px-2 py-0.5', config.badgeClass)}
                >
                  <StatusIcon className="mr-1 h-3 w-3 shrink-0" />
                  {config.label}
                </Badge>
              </div>
              <DialogDescription className="text-xs text-muted-foreground font-mono">
                Signal ID: {check.id} • Category: {check.category.toUpperCase()} • Scope:{' '}
                {(check.scope || 'unspecified').toUpperCase()}
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Modal Body: Two-column rectangular grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-0 divide-y md:divide-y-0 md:divide-x divide-border/80 max-h-[70vh] overflow-y-auto">
          {/* Left Column: Summary & Facts (5 cols) */}
          <div className="md:col-span-5 p-5 space-y-4 bg-card">
            {/* Status Summary */}
            <div className="space-y-1.5">
              <span className="text-2xs font-semibold text-foreground uppercase tracking-wider">
                Operational Summary
              </span>
              <p className="text-xs text-muted-foreground leading-relaxed bg-muted/40 p-2.5 rounded-lg border border-border">
                {check.summary}
              </p>
            </div>

            {check.impact && (
              <div className="space-y-1.5">
                <span className="text-2xs font-semibold uppercase tracking-wider text-foreground">
                  Operational Impact
                </span>
                <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
                  {check.impact}
                </p>
              </div>
            )}

            {/* Diagnostic Facts */}
            <div className="space-y-2">
              <span className="text-2xs font-semibold text-foreground uppercase tracking-wider">
                Diagnostic Facts ({check.details.length})
              </span>
              <div className="space-y-1.5">
                {check.details.map((fact, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 text-xs font-mono text-muted-foreground bg-muted/20 p-2 rounded border border-border/40"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/70 mt-1.5 shrink-0" />
                    <span className="leading-snug break-words text-2xs text-foreground/90">
                      {fact}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Command Snippet if available */}
            {check.commandSnippet && (
              <div className="space-y-1.5 pt-1">
                <span className="text-2xs font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5 text-primary">
                  <Terminal className="h-3 w-3" />
                  Remediation Command
                </span>
                <code className="block text-2xs font-mono font-semibold bg-primary/10 text-primary border border-primary/20 p-2 rounded">
                  {check.commandSnippet.command}
                </code>
              </div>
            )}
          </div>

          {/* Right Column: Live Raw Telemetry JSON Payload (7 cols) */}
          <div className="md:col-span-7 p-5 space-y-3 bg-muted/10 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Code2 className="h-3.5 w-3.5 text-primary" />
                  Live JSON Telemetry Payload
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyPayload}
                  className="h-7 text-xs gap-1 font-semibold bg-background"
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-emerald-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                  {copied ? 'Copied' : 'Copy JSON'}
                </Button>
              </div>

              {/* Code payload container */}
              <pre className="p-3.5 rounded-lg border border-border bg-muted text-foreground font-mono text-2xs overflow-x-auto max-h-96 leading-relaxed select-all">
                {rawJson}
              </pre>
            </div>

            <p className="text-2xs text-muted-foreground font-mono">
              Live data queried in real-time from PostgreSQL, queues, and platform services.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-muted/20">
          <span className="text-2xs text-muted-foreground font-mono">
            Status: {check.status.toUpperCase()}
          </span>
          <div className="flex items-center gap-2">
            {check.action && (
              <Button variant="outline" size="sm" asChild className="text-xs h-8 gap-1">
                <Link
                  href={check.action.href}
                  target={check.action.href.startsWith('http') ? '_blank' : undefined}
                  rel={check.action.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                >
                  <span>{check.action.label}</span>
                  <ExternalLink className="h-3 w-3 opacity-70" />
                </Link>
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={onClose} className="text-xs h-8">
              Close Inspector
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
