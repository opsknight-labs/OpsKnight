'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  TrendingUp,
  Lightbulb,
  X,
  AlertTriangle,
  Zap,
  Clock,
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
  subtext?: string;
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
  resolveCompliance?: number | null;
};

function getInsightTheme(type: Insight['type']) {
  switch (type) {
    case 'critical':
      return {
        card: 'border-rose-500/30 bg-rose-500/10 dark:bg-rose-950/30 text-rose-950 dark:text-rose-100 shadow-2xs',
        icon: 'text-rose-600 dark:text-rose-400',
        badge:
          'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/30 font-semibold text-[10px] tracking-wider uppercase',
        actionButton:
          'border-rose-500/30 bg-rose-500/15 hover:bg-rose-500/25 text-rose-800 dark:text-rose-200',
        subtext: 'text-rose-800/80 dark:text-rose-300/80',
      };
    case 'warning':
      return {
        card: 'border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/30 text-amber-950 dark:text-amber-100 shadow-2xs',
        icon: 'text-amber-600 dark:text-amber-400',
        badge:
          'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30 font-semibold text-[10px] tracking-wider uppercase',
        actionButton:
          'border-amber-500/30 bg-amber-500/15 hover:bg-amber-500/25 text-amber-800 dark:text-amber-200',
        subtext: 'text-amber-800/80 dark:text-amber-300/80',
      };
    case 'info':
      return {
        card: 'border-sky-500/30 bg-sky-500/10 dark:bg-sky-950/30 text-sky-950 dark:text-sky-100 shadow-2xs',
        icon: 'text-sky-600 dark:text-sky-400',
        badge:
          'bg-sky-500/20 text-sky-700 dark:text-sky-300 border-sky-500/30 font-semibold text-[10px] tracking-wider uppercase',
        actionButton:
          'border-sky-500/30 bg-sky-500/15 hover:bg-sky-500/25 text-sky-800 dark:text-sky-200',
        subtext: 'text-sky-800/80 dark:text-sky-300/80',
      };
    case 'success':
      return {
        card: 'border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-950/30 text-emerald-950 dark:text-emerald-100 shadow-2xs',
        icon: 'text-emerald-600 dark:text-emerald-400',
        badge:
          'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 font-semibold text-[10px] tracking-wider uppercase',
        actionButton:
          'border-emerald-500/30 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-800 dark:text-emerald-200',
        subtext: 'text-emerald-800/80 dark:text-emerald-300/80',
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
  resolveCompliance,
}: SmartInsightsBannerProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const insights = useMemo(() => {
    const results: Insight[] = [];

    // High unassigned ratio
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
        subtext:
          'Unassigned incidents delay response times. Distribute ownership across available responders.',
        action: {
          label: 'Triage Unassigned',
          href: '/?status=ACTIVE&assignee=unassigned',
        },
      });
    }

    // Critical incidents spike
    if (criticalIncidents >= 3) {
      results.push({
        id: 'critical-spike',
        type: 'critical',
        tag: 'CRITICAL',
        icon: <Zap className="h-4 w-4" />,
        headline: `${criticalIncidents} critical incidents active${activeIncidents > 0 ? ` (out of ${activeIncidents} active incidents)` : ''}.`,
        subtext:
          'High-urgency incidents require immediate responder triage to mitigate service impact.',
        action: {
          label: 'View Critical Feed',
          href: '/?status=ACTIVE&urgency=HIGH',
        },
      });
    }

    // SLA compliance risk
    if (
      resolveCompliance !== undefined &&
      resolveCompliance !== null &&
      resolveCompliance < 85 &&
      totalIncidents > 0
    ) {
      results.push({
        id: 'sla-risk',
        type: 'warning',
        tag: 'SLA RISK',
        icon: <Clock className="h-4 w-4" />,
        headline: `Resolution SLA compliance is ${resolveCompliance.toFixed(0)}% (target ≥ 85%).`,
        subtext: 'Breached resolution targets impact customer reliability commitments.',
        action: {
          label: 'View SLA Analytics',
          href: '/analytics',
        },
      });
    }

    // Service concentration
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
          subtext:
            'A high volume from a single service indicates possible systemic failure or cascading errors.',
          action: {
            label: `Inspect ${topServiceName}`,
            href: topServiceId
              ? `/services/${topServiceId}`
              : `/?service=${encodeURIComponent(topServiceName)}`,
          },
        });
      }
    }

    // High volume day
    if (avgIncidentsPerDay > 0 && totalIncidents > avgIncidentsPerDay * 1.5) {
      const volumePct = Math.max(0, Math.round((totalIncidents / avgIncidentsPerDay - 1) * 100));
      results.push({
        id: 'high-volume',
        type: 'info',
        tag: 'SURGE',
        icon: <TrendingUp className="h-4 w-4" />,
        headline: `Incident volume is ${volumePct}% higher than average today (${totalIncidents} incidents vs ${Math.round(avgIncidentsPerDay)}/day avg).`,
        subtext: 'Unusual spike in alert generation across monitored services.',
        action: {
          label: 'View Trends',
          href: '/analytics',
        },
      });
    }

    // All clear
    if (results.length === 0 && activeIncidents === 0) {
      results.push({
        id: 'all-clear',
        type: 'success',
        tag: 'OPERATIONAL',
        icon: <CheckCircle2 className="h-4 w-4" />,
        headline: 'All systems operational. No active incidents.',
        subtext: 'Monitored services and notification channels are healthy.',
        action: {
          label: 'Public Status',
          href: '/status',
        },
      });
    }

    return results.filter(insight => !dismissedIds.has(insight.id));
  }, [
    totalIncidents,
    activeIncidents,
    criticalIncidents,
    unassignedIncidents,
    avgIncidentsPerDay,
    topServiceName,
    topServiceId,
    topServiceCount,
    resolveCompliance,
    dismissedIds,
  ]);

  const dismissInsight = (id: string) => {
    setDismissedIds(prev => new Set([...prev, id]));
  };

  if (insights.length === 0) return null;

  return (
    <div className="space-y-2.5 animate-in fade-in slide-in-from-top-2 duration-300">
      {insights.map(insight => {
        const theme = getInsightTheme(insight.type);
        return (
          <div
            key={insight.id}
            className={cn(
              'flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-all',
              theme.card
            )}
          >
            <div className="flex items-start gap-3 min-w-0">
              <span className={cn('shrink-0 mt-0.5', theme.icon)}>{insight.icon}</span>
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className={cn('h-4 px-1.5 py-0 text-[9px]', theme.badge)}
                  >
                    {insight.tag}
                  </Badge>
                  <span className="text-sm font-semibold tracking-tight">{insight.headline}</span>
                </div>
                {insight.subtext && (
                  <p className={cn('text-xs leading-relaxed', theme.subtext)}>{insight.subtext}</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto pt-1 sm:pt-0">
              {insight.action && (
                <Link
                  href={insight.action.href}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all hover:scale-[1.02] active:scale-[0.98]',
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
                className="h-7 w-7 p-0 text-current opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg"
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
