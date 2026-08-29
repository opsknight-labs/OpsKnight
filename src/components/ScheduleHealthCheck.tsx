'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import { AlertTriangle, CheckCircle2, Clock, CalendarX, Users, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

type ScheduleHealthCheckProps = {
  layers: Array<{
    id: string;
    name: string;
    end: Date | null;
    restrictions?: { daysOfWeek?: number[]; startHour?: number; endHour?: number } | null;
    users: Array<{ userId: string }>;
  }>;
  shifts: Array<{
    start: string;
    end: string;
  }>;
  timeZone: string;
  rotationHref: string;
  overridesHref: string;
  activeOverrideCount: number;
};

type HealthIssue = {
  type: 'error' | 'warning' | 'info';
  title: string;
  description: string;
  icon: typeof AlertTriangle;
  href?: string;
};

export default function ScheduleHealthCheck({
  layers,
  shifts,
  timeZone,
  rotationHref,
  overridesHref,
  activeOverrideCount,
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
        href: rotationHref,
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
            href: `${rotationHref}#layer-${layer.id}`,
          });
        } else if (daysUntilEnd <= 7) {
          problems.push({
            type: 'warning',
            title: `"${layer.name}" ends in ${daysUntilEnd}d`,
            description: 'Consider extending this layer before coverage lapses.',
            icon: Clock,
            href: `${rotationHref}#layer-${layer.id}`,
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
          href: `${rotationHref}#layer-${layer.id}`,
        });
      } else if (layer.users.length === 1) {
        problems.push({
          type: 'warning',
          title: `"${layer.name}" has only 1 responder`,
          description: 'Add more responders to prevent on-call burnout.',
          icon: Users,
          href: `${rotationHref}#layer-${layer.id}`,
        });
      }
      if (
        layer.restrictions &&
        (layer.restrictions.daysOfWeek?.length ||
          layer.restrictions.startHour != null ||
          layer.restrictions.endHour != null)
      ) {
        problems.push({
          type: 'info',
          title: `"${layer.name}" has restricted hours`,
          description: 'Verify alternate layers cover remaining hours.',
          icon: Clock,
          href: `${rotationHref}#layer-${layer.id}`,
        });
      }
    });

    if (activeOverrideCount > 0) {
      problems.push({
        type: 'info',
        title: `${activeOverrideCount} active override${activeOverrideCount === 1 ? '' : 's'}`,
        description: 'Review temporary coverage and scheduled end time.',
        icon: AlertCircle,
        href: overridesHref,
      });
    }

    // Check 4: Coverage gaps in next 7 days
    const next7Days = new Date(now);
    next7Days.setDate(next7Days.getDate() + 7);

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
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    }

    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const dateStr = formatter.format(d);
      dayCoverages.set(dateStr, new Set());
    }

    shifts.forEach(shift => {
      const s = new Date(shift.start);
      const e = new Date(shift.end);

      for (let i = 0; i < 7; i++) {
        const currentCheck = new Date(now);
        currentCheck.setDate(currentCheck.getDate() + i);
        const dateStr = formatter.format(currentCheck);

        const currentDayStart = new Date(`${dateStr}T00:00:00Z`);
        const currentDayEnd = new Date(`${dateStr}T23:59:59.999Z`);

        if (s < currentDayEnd && e > currentDayStart) {
          const overlapStart = Math.max(s.getTime(), currentDayStart.getTime());
          const overlapEnd = Math.min(e.getTime(), currentDayEnd.getTime());

          const startMinute = Math.floor((overlapStart - currentDayStart.getTime()) / (1000 * 60));
          const endMinute = Math.floor((overlapEnd - currentDayStart.getTime()) / (1000 * 60));

          const coveredSet = dayCoverages.get(dateStr);
          if (coveredSet) {
            for (let m = Math.max(0, startMinute); m < Math.min(1440, endMinute); m++) {
              coveredSet.add(m);
            }
          }
        }
      }
    });

    let hasGap = false;
    dayCoverages.forEach(coveredMinutes => {
      if (coveredMinutes.size < 1440) {
        hasGap = true;
      }
    });

    if (hasGap) {
      problems.push({
        type: 'error',
        title: 'Coverage gaps in next 7 days',
        description: 'Ensure all time windows have active responders.',
        icon: AlertTriangle,
        href: rotationHref,
      });
    }

    return problems;
  }, [activeOverrideCount, layers, overridesHref, rotationHref, shifts, timeZone]);

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>Schedule is healthy with full layer coverage</span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {issues.slice(0, 2).map((issue, index) => {
        const Icon = issue.icon;
        return (
          <Link
            key={index}
            href={issue.href || rotationHref}
            className={cn(
              'flex items-center justify-between gap-2 rounded-md px-2.5 py-1 text-xs transition-colors hover:brightness-95',
              issue.type === 'error' &&
                'bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/20',
              issue.type === 'warning' &&
                'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20',
              issue.type === 'info' &&
                'bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/20'
            )}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="font-semibold truncate">{issue.title}</span>
              <span className="text-[11px] opacity-80 truncate hidden sm:inline">
                — {issue.description}
              </span>
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider shrink-0 underline opacity-80">
              View
            </span>
          </Link>
        );
      })}
    </div>
  );
}
