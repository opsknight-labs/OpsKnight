'use client';

import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, Lightbulb, X, AlertTriangle, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { useState } from 'react';

type Insight = {
  id: string;
  type: 'warning' | 'info' | 'success';
  icon: React.ReactNode;
  message: string;
};

type SmartInsightsBannerProps = {
  totalIncidents: number;
  activeIncidents: number;
  criticalIncidents: number;
  unassignedIncidents: number;
  avgIncidentsPerDay?: number;
  topServiceName?: string;
  topServiceCount?: number;
};

export default function SmartInsightsBanner({
  totalIncidents,
  activeIncidents,
  criticalIncidents,
  unassignedIncidents,
  avgIncidentsPerDay = 0,
  topServiceName,
  topServiceCount = 0,
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
        icon: <AlertTriangle className="h-4 w-4" />,
        message: `${unassignedPct}% of active incidents are unassigned. Consider distributing workload.`,
      });
    }

    // Critical incidents spike
    if (criticalIncidents >= 3) {
      results.push({
        id: 'critical-spike',
        type: 'warning',
        icon: <Zap className="h-4 w-4" />,
        message: `${criticalIncidents} critical incidents active. Prioritize immediate response.`,
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
          icon: <Lightbulb className="h-4 w-4" />,
          message: `${concentration}% of incidents originate from "${topServiceName}". Consider investigating root cause.`,
        });
      }
    }

    // High volume day
    if (avgIncidentsPerDay > 0 && totalIncidents > avgIncidentsPerDay * 1.5) {
      const volumePct = Math.max(0, Math.round((totalIncidents / avgIncidentsPerDay - 1) * 100));
      results.push({
        id: 'high-volume',
        type: 'info',
        icon: <TrendingUp className="h-4 w-4" />,
        message: `Incident volume is ${volumePct}% higher than average today.`,
      });
    }

    // All clear
    if (results.length === 0 && activeIncidents === 0) {
      results.push({
        id: 'all-clear',
        type: 'success',
        icon: <Lightbulb className="h-4 w-4" />,
        message: 'All systems operational. No active incidents.',
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
    topServiceCount,
    dismissedIds,
  ]);

  const dismissInsight = (id: string) => {
    setDismissedIds(prev => new Set([...prev, id]));
  };

  if (insights.length === 0) return null;

  const typeStyles = {
    warning: 'bg-card border-border text-foreground shadow-2xs',
    info: 'bg-card border-border text-foreground shadow-2xs',
    success: 'bg-card border-border text-foreground shadow-2xs',
  };

  const iconStyles = {
    warning: 'text-amber-600',
    info: 'text-blue-600',
    success: 'text-emerald-600',
  };

  return (
    <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
      {insights.map(insight => (
        <div
          key={insight.id}
          className={cn(
            'flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border',
            typeStyles[insight.type]
          )}
        >
          <div className="flex items-center gap-2.5">
            <span className={cn('shrink-0', iconStyles[insight.type])}>{insight.icon}</span>
            <span className="text-sm font-medium">{insight.message}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 hover:bg-black/5"
            onClick={() => dismissInsight(insight.id)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
