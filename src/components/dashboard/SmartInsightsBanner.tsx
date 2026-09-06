'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp,
  Lightbulb,
  X,
  AlertTriangle,
  Zap,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';

type Insight = {
  id: string;
  type: 'critical' | 'warning' | 'info' | 'success';
  tag: string;
  icon: React.ReactNode;
  headline: string;
  action?: {
    label: string;
    href: string;
  };
};

type SmartInsightsBannerProps = {
  totalIncidents: number;
  activeIncidents: number;
  criticalIncidents: number;
  unassignedIncidents: number;
  avgIncidentsPerDay?: number;
  topServiceName?: string;
  topServiceId?: string;
  topServiceCount?: number;
};

function getInsightTheme(type: Insight['type']) {
  switch (type) {
    case 'critical':
      return {
        card: 'border border-rose-300/80 dark:border-rose-900/40 bg-rose-50/90 dark:bg-rose-950/40 shadow-xs border-l-4 border-l-rose-600 text-rose-950 dark:text-rose-100',
        icon: 'text-rose-600 dark:text-rose-400',
        badge:
          'bg-white/90 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800/60 font-bold text-[10px] tracking-wider uppercase',
        actionButton:
          'text-rose-700 dark:text-rose-200 hover:text-rose-900 dark:hover:text-white bg-white hover:bg-rose-100/60 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-rose-300/80 dark:border-rose-800/60 shadow-xs',
      };
    case 'warning':
      return {
        card: 'border border-amber-300/80 dark:border-amber-900/40 bg-amber-50/90 dark:bg-amber-950/40 shadow-xs border-l-4 border-l-amber-500 text-amber-950 dark:text-amber-100',
        icon: 'text-amber-600 dark:text-amber-400',
        badge:
          'bg-white/90 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800/60 font-bold text-[10px] tracking-wider uppercase',
        actionButton:
          'text-amber-700 dark:text-amber-200 hover:text-amber-900 dark:hover:text-white bg-white hover:bg-amber-100/60 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-amber-300/80 dark:border-amber-800/60 shadow-xs',
      };
    case 'info':
      return {
        card: 'border border-sky-300/80 dark:border-sky-900/40 bg-sky-50/90 dark:bg-sky-950/40 shadow-xs border-l-4 border-l-sky-500 text-sky-950 dark:text-sky-100',
        icon: 'text-sky-600 dark:text-sky-400',
        badge:
          'bg-white/90 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-800/60 font-bold text-[10px] tracking-wider uppercase',
        actionButton:
          'text-sky-700 dark:text-sky-200 hover:text-sky-900 dark:hover:text-white bg-white hover:bg-sky-100/60 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-sky-300/80 dark:border-sky-800/60 shadow-xs',
      };
    case 'success':
      return {
        card: 'border border-emerald-300/80 dark:border-emerald-900/40 bg-emerald-50/90 dark:bg-emerald-950/40 shadow-xs border-l-4 border-l-emerald-500 text-emerald-950 dark:text-emerald-100',
        icon: 'text-emerald-600 dark:text-emerald-400',
        badge:
          'bg-white/90 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800/60 font-bold text-[10px] tracking-wider uppercase',
        actionButton:
          'text-emerald-700 dark:text-emerald-200 hover:text-emerald-900 dark:hover:text-white bg-white hover:bg-emerald-100/60 dark:bg-zinc-900 dark:hover:bg-zinc-800 border border-emerald-300/80 dark:border-emerald-800/60 shadow-xs',
      };
  }
}

export default function SmartInsightsBanner({
  totalIncidents,
  activeIncidents,
  criticalIncidents,
  unassignedIncidents,
  avgIncidentsPerDay = 0,
  topServiceName,
  topServiceId,
  topServiceCount = 0,
}: SmartInsightsBannerProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const insights = useMemo(() => {
    const results: Insight[] = [];

    // 1. Critical incidents spike (Top priority)
    if (criticalIncidents >= 3) {
      results.push({
        id: 'critical-spike',
        type: 'critical',
        tag: 'CRITICAL',
        icon: <Zap className="h-4 w-4" />,
        headline: `${criticalIncidents} critical incidents active${activeIncidents > 0 ? ` (out of ${activeIncidents} active incidents)` : ''}.`,
        action: {
          label: 'View Critical Feed',
          href: '/?status=ACTIVE&urgency=HIGH',
        },
      });
    }

    // 2. High unassigned ratio (Second priority)
    if (activeIncidents > 0 && unassignedIncidents / activeIncidents > 0.3) {
      const unassignedPct = Math.min(
        100,
        Math.max(0, Math.round((unassignedIncidents / activeIncidents) * 100))
      );
      results.push({
        id: 'unassigned',
        type: 'warning',
        tag: 'WORKLOAD',
        icon: <AlertTriangle className="h-4 w-4" />,
        headline: `${unassignedPct}% of active incidents (${unassignedIncidents} of ${activeIncidents}) are unassigned.`,
        action: {
          label: 'Triage Unassigned',
          href: '/?status=ACTIVE&assignee=unassigned',
        },
      });
    }

    // 3. Service concentration (Fallback insight if space allows)
    if (topServiceName && topServiceCount >= 3 && totalIncidents > 0) {
      const concentration = Math.min(
        100,
        Math.max(0, Math.round((topServiceCount / totalIncidents) * 100))
      );
      if (concentration >= 40) {
        results.push({
          id: 'service-concentration',
          type: 'info',
          tag: 'CONCENTRATION',
          icon: <Lightbulb className="h-4 w-4" />,
          headline: `${concentration}% of incidents (${topServiceCount} of ${totalIncidents}) originate from "${topServiceName}".`,
          action: {
            label: `Inspect ${topServiceName}`,
            href: topServiceId
              ? `/services/${topServiceId}`
              : `/?service=${encodeURIComponent(topServiceName)}`,
          },
        });
      }
    }

    // 4. High volume day (Fallback insight if space allows)
    if (avgIncidentsPerDay > 0 && totalIncidents > avgIncidentsPerDay * 1.5) {
      const volumePct = Math.max(0, Math.round((totalIncidents / avgIncidentsPerDay - 1) * 100));
      results.push({
        id: 'high-volume',
        type: 'info',
        tag: 'SURGE',
        icon: <TrendingUp className="h-4 w-4" />,
        headline: `Incident volume is ${volumePct}% higher than average today (${totalIncidents} incidents vs ${Math.round(avgIncidentsPerDay)}/day avg).`,
        action: {
          label: 'View Trends',
          href: '/analytics',
        },
      });
    }

    // 5. All clear (Only when 0 active incidents)
    if (results.length === 0 && activeIncidents === 0) {
      results.push({
        id: 'all-clear',
        type: 'success',
        tag: 'OPERATIONAL',
        icon: <CheckCircle2 className="h-4 w-4" />,
        headline: 'All systems operational. No active incidents.',
        action: {
          label: 'Public Status',
          href: '/status',
        },
      });
    }

    // Keep at most two insights to keep the banner sleek and compact
    return results.filter(insight => !dismissedIds.has(insight.id)).slice(0, 2);
  }, [
    totalIncidents,
    activeIncidents,
    criticalIncidents,
    unassignedIncidents,
    avgIncidentsPerDay,
    topServiceName,
    topServiceId,
    topServiceCount,
    dismissedIds,
  ]);

  const dismissInsight = (id: string) => {
    setDismissedIds(prev => new Set([...prev, id]));
  };

  if (insights.length === 0) return null;

  return (
    <div className="space-y-2 mb-6 animate-in fade-in slide-in-from-top-1 duration-200">
      {insights.map(insight => {
        const theme = getInsightTheme(insight.type);
        return (
          <div
            key={insight.id}
            className={cn(
              'flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl border transition-all',
              theme.card
            )}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className={cn('shrink-0', theme.icon)}>{insight.icon}</span>
              <Badge
                variant="outline"
                className={cn(
                  'h-5 px-2 py-0 shrink-0 text-[10px] rounded-md font-bold',
                  theme.badge
                )}
              >
                {insight.tag}
              </Badge>
              <span className="text-xs sm:text-sm font-semibold tracking-tight truncate">
                {insight.headline}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {insight.action && (
                <Link
                  href={insight.action.href}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border transition-all hover:opacity-90 active:scale-95 shadow-2xs',
                    theme.actionButton
                  )}
                >
                  <span>{insight.action.label}</span>
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
              <Button
                variant="ghost"
                size="sm"
                aria-label="Dismiss insight"
                className="h-7 w-7 p-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                onClick={() => dismissInsight(insight.id)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
