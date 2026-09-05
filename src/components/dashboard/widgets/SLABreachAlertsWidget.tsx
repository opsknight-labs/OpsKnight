'use client';

import { useRouter } from 'next/navigation';
import { buildIncidentListHref } from '@/lib/incident-links';
import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import SidebarWidget, { WIDGET_ICON_BG } from '@/components/dashboard/SidebarWidget';
import { useWidgetData } from '@/components/dashboard/WidgetProvider';
import { AlertTriangle, CheckCircle2, ChevronRight, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SLAAlert {
  incident: {
    id: string;
    title: string;
    serviceName: string;
    slaAckDeadline: Date | null;
    slaResolveDeadline: Date | null;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
  };
  alertType: 'ack' | 'resolve' | null;
  timeRemaining: number;
  severity: 'critical' | 'warning';
}

/**
 * Formats SLA deadline with live countdown or overdue elapsed timer
 */
function formatSLATime(ms: number): {
  badgeText: string;
  isBreached: boolean;
  isUrgent: boolean;
} {
  if (!Number.isFinite(ms)) {
    return { badgeText: '0s', isBreached: false, isUrgent: false };
  }

  if (ms <= 0) {
    const elapsedMs = Math.abs(ms);
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    let overdueText = '';
    if (days > 0) {
      overdueText = `+${days}d`;
    } else if (hours > 0) {
      const remainingMins = minutes % 60;
      overdueText = remainingMins > 0 ? `+${hours}h ${remainingMins}m` : `+${hours}h`;
    } else if (minutes > 0) {
      overdueText = `+${minutes}m`;
    } else {
      overdueText = `+${Math.max(1, totalSeconds)}s`;
    }

    return {
      badgeText: `${overdueText} overdue`,
      isBreached: true,
      isUrgent: true,
    };
  }

  // Active Countdown
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  let countdownText = '';
  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    countdownText = mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`;
  } else if (minutes > 0) {
    countdownText = `${minutes}m ${seconds}s left`;
  } else {
    countdownText = `${seconds}s left`;
  }

  return {
    badgeText: countdownText,
    isBreached: false,
    isUrgent: ms <= 10 * 60000,
  };
}

/**
 * Safely parses a date value
 */
function safeParseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  try {
    const date = value instanceof Date ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * SLA Breach Alerts Widget - Minimal Design
 */
const SLABreachAlertsWidget = memo(function SLABreachAlertsWidget() {
  const widgetData = useWidgetData();
  const router = useRouter();

  // Live tick state - updates every second for countdown
  const [tick, setTick] = useState(0);

  // Update tick every second for live countdown
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Calculate alerts with current time (recalculates on each tick for live countdown)
  const sortedAlerts = useMemo(() => {
    const currentTime = new Date();

    const alerts: SLAAlert[] = (widgetData.slaBreachAlerts || [])
      .map(incident => {
        let alertType: 'ack' | 'resolve' | null = null;
        let timeRemaining = 0;
        let severity: 'critical' | 'warning' = 'warning';

        const ackDeadline = safeParseDate(incident.slaAckDeadline);
        const resolveDeadline = safeParseDate(incident.slaResolveDeadline);
        const acknowledgedAt = safeParseDate(incident.acknowledgedAt);
        const resolvedAt = safeParseDate(incident.resolvedAt);

        const isAckPending = Boolean(ackDeadline && !acknowledgedAt && incident.status === 'OPEN');
        const isResolvePending = Boolean(resolveDeadline && !resolvedAt);

        const ackRemaining = ackDeadline ? ackDeadline.getTime() - currentTime.getTime() : null;
        const resolveRemaining = resolveDeadline
          ? resolveDeadline.getTime() - currentTime.getTime()
          : null;

        // Choose the most pressing alert: breached first, then shortest remaining
        if (isAckPending && ackRemaining !== null && ackRemaining <= 0) {
          alertType = 'ack';
          timeRemaining = ackRemaining;
          severity = 'critical';
        } else if (isResolvePending && resolveRemaining !== null && resolveRemaining <= 0) {
          alertType = 'resolve';
          timeRemaining = resolveRemaining;
          severity = 'critical';
        } else if (
          isAckPending &&
          ackRemaining !== null &&
          (resolveRemaining === null || ackRemaining <= resolveRemaining)
        ) {
          alertType = 'ack';
          timeRemaining = ackRemaining;
          severity = timeRemaining <= 5 * 60000 ? 'critical' : 'warning';
        } else if (isResolvePending && resolveRemaining !== null) {
          alertType = 'resolve';
          timeRemaining = resolveRemaining;
          severity = timeRemaining <= 10 * 60000 ? 'critical' : 'warning';
        }

        return {
          incident: {
            id: incident.id,
            title: incident.title,
            serviceName: incident.serviceName,
            slaAckDeadline: ackDeadline,
            slaResolveDeadline: resolveDeadline,
            acknowledgedAt,
            resolvedAt,
          },
          alertType,
          timeRemaining,
          severity,
        };
      })
      .filter(alert => alert.alertType !== null);

    // Sort by time remaining (breached and most urgent first)
    alerts.sort((a, b) => a.timeRemaining - b.timeRemaining);

    return alerts;
    // tick is intentionally included to trigger recalculation every second for live countdown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetData.slaBreachAlerts, tick]);

  const handleIncidentClick = useCallback(
    (incidentId: string) => {
      router.push(`/incidents/${incidentId}`);
    },
    [router]
  );

  const handleViewAll = useCallback(() => {
    router.push(buildIncidentListHref({ filter: 'all_open' }));
  }, [router]);

  return (
    <SidebarWidget
      title="SLA Alerts"
      iconBg={WIDGET_ICON_BG.red}
      icon={<AlertTriangle className="w-4 h-4" />}
      lastUpdated={widgetData.lastUpdated}
      actions={[
        {
          label: 'View All',
          onClick: handleViewAll,
        },
      ]}
    >
      {sortedAlerts.length === 0 ? (
        <div className="py-6 text-center">
          <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-emerald-500/10 dark:bg-emerald-950/40 border border-emerald-500/20 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-xs font-semibold text-foreground mb-0.5">All Clear</p>
          <p className="text-[10px] text-muted-foreground">No SLA breaches imminent</p>
        </div>
      ) : (
        <div className="space-y-2" role="list" aria-label="SLA breach alerts">
          {sortedAlerts.slice(0, 3).map(({ incident, alertType, timeRemaining }) => {
            const actionLabel = alertType === 'ack' ? 'ACK' : 'RESOLVE';
            const slaInfo = formatSLATime(timeRemaining);

            return (
              <button
                key={incident.id}
                onClick={() => handleIncidentClick(incident.id)}
                className={cn(
                  'group flex items-center gap-3 p-2.5 rounded-lg border text-left w-full transition-all duration-150 shadow-2xs cursor-pointer',
                  slaInfo.isBreached
                    ? 'bg-card dark:bg-[#121216] border-rose-500/25 dark:border-rose-500/30 border-l-[3px] border-l-rose-500 hover:border-rose-500/50 hover:bg-rose-500/[0.03] dark:hover:bg-rose-500/[0.06]'
                    : slaInfo.isUrgent
                      ? 'bg-card dark:bg-[#121216] border-amber-500/25 dark:border-amber-500/30 border-l-[3px] border-l-amber-500 hover:border-amber-500/50 hover:bg-amber-500/[0.03] dark:hover:bg-amber-500/[0.06]'
                      : 'bg-card dark:bg-[#121216] border-border/80 dark:border-zinc-800/80 border-l-[3px] border-l-zinc-400 dark:border-l-zinc-600 hover:border-border hover:bg-accent/40'
                )}
                role="listitem"
                aria-label={`${incident.title} - ${actionLabel} ${slaInfo.badgeText}`}
                suppressHydrationWarning
              >
                {/* Icon */}
                <div
                  className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-150 group-hover:scale-105',
                    slaInfo.isBreached
                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : slaInfo.isUrgent
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-muted text-muted-foreground'
                  )}
                  aria-hidden="true"
                >
                  <Zap className="w-3.5 h-3.5" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-foreground truncate mb-1">
                    {incident.title}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="text-muted-foreground truncate max-w-[85px]">
                      {incident.serviceName}
                    </span>
                    <span className="text-zinc-300 dark:text-zinc-700">•</span>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded border tabular-nums whitespace-nowrap shrink-0',
                        slaInfo.isBreached
                          ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25'
                          : slaInfo.isUrgent
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25'
                            : 'bg-muted/60 text-muted-foreground border-border/80'
                      )}
                    >
                      <span className="font-extrabold">{actionLabel}</span>
                      <span className="opacity-40">·</span>
                      <span className="inline-flex items-center gap-1" suppressHydrationWarning>
                        {slaInfo.isBreached && (
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-60" />
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500" />
                          </span>
                        )}
                        {slaInfo.badgeText}
                      </span>
                    </span>
                  </div>
                </div>

                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-foreground group-hover:translate-x-0.5 transition-all duration-150 shrink-0" />
              </button>
            );
          })}

          {sortedAlerts.length > 3 && (
            <button
              onClick={handleViewAll}
              className="w-full py-1.5 text-center text-[11px] font-medium text-muted-foreground hover:text-foreground bg-muted/20 hover:bg-muted/50 rounded-lg border border-border/60 transition-colors cursor-pointer"
            >
              +{sortedAlerts.length - 3} more SLA alerts awaiting action &rarr;
            </button>
          )}
        </div>
      )}
    </SidebarWidget>
  );
});

export default SLABreachAlertsWidget;
