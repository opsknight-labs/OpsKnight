'use client';

import { useMemo } from 'react';
import { Card } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { AlertTriangle, CheckCircle2, Clock, CalendarX, Users, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type ScheduleHealthCheckProps = {
  layers: Array<{
    id: string;
    name: string;
    end: Date | null;
    users: Array<{ userId: string }>;
  }>;
  shifts: Array<{
    start: string;
    end: string;
  }>;
  timeZone: string;
};

type HealthIssue = {
  type: 'error' | 'warning' | 'info';
  title: string;
  description: string;
  icon: typeof AlertTriangle;
};

export default function ScheduleHealthCheck({
  layers,
  shifts,
  timeZone,
}: ScheduleHealthCheckProps) {
  const issues = useMemo(() => {
    const problems: HealthIssue[] = [];
    const now = new Date();

    // Check 1: No layers configured
    if (layers.length === 0) {
      problems.push({
        type: 'error',
        title: 'No layers configured',
        description: 'Add at least one rotation layer to enable on-call coverage',
        icon: CalendarX,
      });
      return problems;
    }

    // Check 2: Layers ending soon (within 7 days)
    layers.forEach(layer => {
      if (layer.end) {
        const daysUntilEnd = Math.ceil(
          (layer.end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysUntilEnd <= 0) {
          problems.push({
            type: 'error',
            title: `"${layer.name}" has ended`,
            description: 'This layer is no longer active. Remove or extend it.',
            icon: CalendarX,
          });
        } else if (daysUntilEnd <= 7) {
          problems.push({
            type: 'warning',
            title: `"${layer.name}" ends in ${daysUntilEnd} day${daysUntilEnd > 1 ? 's' : ''}`,
            description: 'Consider extending this layer or it will stop providing coverage',
            icon: Clock,
          });
        }
      }
    });

    // Check 3: Layers with no responders
    layers.forEach(layer => {
      if (layer.users.length === 0) {
        problems.push({
          type: 'error',
          title: `"${layer.name}" has no responders`,
          description: 'Add team members to this layer for on-call coverage',
          icon: Users,
        });
      } else if (layer.users.length === 1) {
        problems.push({
          type: 'warning',
          title: `"${layer.name}" has only 1 responder`,
          description: 'Consider adding more responders to prevent burnout',
          icon: Users,
        });
      }
    });

    // Check 4: Coverage gaps in next 7 days
    const next7Days = new Date(now);
    next7Days.setDate(next7Days.getDate() + 7);

    // Track unique covered minutes per day so overlapping shifts cannot hide gaps.
    const dayCoverages = new Map<string, Set<number>>();

    let formatter: Intl.DateTimeFormat;
    try {
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timeZone || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      formatter = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'UTC',
      });
    }
    const getLocalDateKey = (d: Date) => formatter.format(d);

    shifts.forEach(shift => {
      const shiftStart = new Date(shift.start);
      const shiftEnd = new Date(shift.end);

      const startMs = Math.max(shiftStart.getTime(), now.getTime());
      const endMs = Math.min(shiftEnd.getTime(), next7Days.getTime());

      if (startMs >= endMs) return;

      let currentMs = startMs;
      while (currentMs < endMs) {
        const key = getLocalDateKey(new Date(currentMs));
        const covered = dayCoverages.get(key) ?? new Set<number>();
        covered.add(currentMs);
        dayCoverages.set(key, covered);
        currentMs += 60000; // 1 minute
      }
    });

    // Expected minutes are limited to the actual seven-day inspection window.
    // This handles the partial first/last day and 23/25-hour DST days correctly.
    const expectedMinutes = new Map<string, number>();
    for (let currentMs = now.getTime(); currentMs < next7Days.getTime(); currentMs += 60000) {
      const key = getLocalDateKey(new Date(currentMs));
      expectedMinutes.set(key, (expectedMinutes.get(key) ?? 0) + 1);
    }

    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const key = getLocalDateKey(d);

      const coveredMins = dayCoverages.get(key)?.size ?? 0;
      const requiredMins = expectedMinutes.get(key) ?? 0;
      if (coveredMins === 0 && layers.length > 0 && layers.some(l => l.users.length > 0)) {
        problems.push({
          type: 'error',
          title: `No coverage on ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
          description: 'Zero coverage configured for this day',
          icon: AlertTriangle,
        });
        break; // Only show first gap
      } else if (
        coveredMins < requiredMins &&
        layers.length > 0 &&
        layers.some(l => l.users.length > 0)
      ) {
        problems.push({
          type: 'warning',
          title: `Partial coverage on ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`,
          description: `Only ${Math.floor(coveredMins / 60)}h ${coveredMins % 60}m covered`,
          icon: AlertCircle,
        });
        break; // Only show first gap
      }
    }

    return problems;
  }, [layers, shifts, timeZone]);

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 text-emerald-600 bg-emerald-50/50 rounded-lg px-3 py-2 border border-emerald-100">
        <CheckCircle2 className="h-4 w-4" />
        <span className="text-xs font-medium">Schedule is healthy</span>
      </div>
    );
  }

  // Show issues
  const errorCount = issues.filter(i => i.type === 'error').length;
  const warningCount = issues.filter(i => i.type === 'warning').length;

  return (
    <div className="space-y-2">
      {/* Summary Badge */}
      <div className="flex items-center gap-2">
        {errorCount > 0 && (
          <Badge variant="destructive" className="h-5 text-[10px] gap-1">
            <AlertTriangle className="h-3 w-3" />
            {errorCount} issue{errorCount > 1 ? 's' : ''}
          </Badge>
        )}
        {warningCount > 0 && (
          <Badge
            variant="secondary"
            className="h-5 text-[10px] gap-1 bg-amber-50 text-amber-700 border-amber-200"
          >
            <AlertCircle className="h-3 w-3" />
            {warningCount} warning{warningCount > 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {/* Issue Cards */}
      <div className="space-y-1.5">
        {issues.slice(0, 3).map((issue, index) => {
          const Icon = issue.icon;
          return (
            <div
              key={index}
              className={cn(
                'flex items-start gap-2 rounded-lg px-3 py-2 border',
                issue.type === 'error' && 'bg-red-50/50 border-red-100',
                issue.type === 'warning' && 'bg-amber-50/50 border-amber-100',
                issue.type === 'info' && 'bg-blue-50/50 border-blue-100'
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 mt-0.5 shrink-0',
                  issue.type === 'error' && 'text-red-500',
                  issue.type === 'warning' && 'text-amber-500',
                  issue.type === 'info' && 'text-blue-500'
                )}
              />
              <div className="min-w-0">
                <p
                  className={cn(
                    'text-xs font-medium',
                    issue.type === 'error' && 'text-red-800',
                    issue.type === 'warning' && 'text-amber-800',
                    issue.type === 'info' && 'text-blue-800'
                  )}
                >
                  {issue.title}
                </p>
                <p
                  className={cn(
                    'text-[10px] mt-0.5',
                    issue.type === 'error' && 'text-red-600',
                    issue.type === 'warning' && 'text-amber-600',
                    issue.type === 'info' && 'text-blue-600'
                  )}
                >
                  {issue.description}
                </p>
              </div>
            </div>
          );
        })}
        {issues.length > 3 && (
          <p className="text-[10px] text-slate-500 pl-2">
            +{issues.length - 3} more issue{issues.length - 3 > 1 ? 's' : ''}
          </p>
        )}
      </div>
    </div>
  );
}
