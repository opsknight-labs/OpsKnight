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
 * Formats milliseconds as a human-readable countdown
 */
function formatTimeRemaining(ms: number): string {
  if (!Number.isFinite(ms)) return '0s';
  if (ms <= 0) return 'Breached';

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
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
        <div className="py-5 text-center">
          <div className="w-9 h-9 mx-auto mb-1.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-xs font-semibold text-slate-800 mb-0.5">All Clear</p>
          <p className="text-[10px] text-slate-500 font-medium">No SLA breaches imminent</p>
        </div>
      ) : (
        <div className="space-y-1.5" role="list" aria-label="SLA breach alerts">
          {sortedAlerts.slice(0, 3).map(({ incident, alertType, timeRemaining, severity }) => {
            const isUrgent = severity === 'critical';
            const actionLabel = alertType === 'ack' ? 'ACK' : 'RESOLVE';
            const timeStr = formatTimeRemaining(timeRemaining);

            return (
              <button
                key={incident.id}
                onClick={() => handleIncidentClick(incident.id)}
                className={cn(
                  'group flex items-center gap-2.5 p-2 rounded-lg border text-left w-full transition-all shadow-2xs',
                  isUrgent
                    ? 'bg-rose-50/70 border-rose-200 hover:border-rose-300 hover:bg-rose-50'
                    : 'bg-amber-50/70 border-amber-200 hover:border-amber-300 hover:bg-amber-50'
                )}
                role="listitem"
                aria-label={`${incident.title} - ${actionLabel} deadline in ${timeStr}`}
              >
                {/* Icon */}
                <div
                  className={cn(
                    'w-7 h-7 rounded-md flex items-center justify-center shrink-0 border',
                    isUrgent
                      ? 'bg-rose-100/80 text-rose-700 border-rose-200'
                      : 'bg-amber-100/80 text-amber-700 border-amber-200'
                  )}
                  aria-hidden="true"
                >
                  <Zap className="w-3.5 h-3.5" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-800 truncate">
                    {incident.title}
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium truncate">
                    {incident.serviceName}
                  </div>
                </div>

                <span
                  className={cn(
                    'font-mono text-[10px] font-bold px-1.5 py-0.5 rounded border shadow-2xs shrink-0',
                    isUrgent
                      ? 'bg-white text-rose-700 border-rose-200'
                      : 'bg-white text-amber-700 border-amber-200'
                  )}
                >
                  {actionLabel} {timeStr}
                </span>

                <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-transform group-hover:translate-x-0.5 shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </SidebarWidget>
  );
});

export default SLABreachAlertsWidget;
