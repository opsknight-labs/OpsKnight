'use client';

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/shadcn/hover-card';
import { AlertTriangle, ShieldCheck, ArrowRight, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useOperationalStats } from '@/hooks/useOperationalStats';

type Props = {
  // Optional props for fallback or override
  tone?: 'ok' | 'danger' | 'warning';
  label?: string;
  detail?: string;
  criticalCount?: number;
  mediumCount?: number;
  lowCount?: number;
};

export default function OperationalStatus({
  tone: initialTone,
  label: initialLabel,
  detail: initialDetail,
  criticalCount: criticalCountOverride,
  mediumCount = 0,
  lowCount = 0,
}: Props) {
  const {
    activeCount: activeCountLive,
    criticalCount: criticalCountLive,
    mediumCount: mediumCountLive,
    lowCount: lowCountLive,
    loading,
    hasLiveStats,
  } = useOperationalStats();

  const hasInitialProps =
    typeof criticalCountOverride === 'number' ||
    typeof mediumCount === 'number' ||
    typeof lowCount === 'number';

  // Use live stats once loaded; otherwise use server-rendered props
  const critical = hasLiveStats
    ? criticalCountLive
    : typeof criticalCountOverride === 'number'
      ? criticalCountOverride
      : 0;
  const medium = hasLiveStats ? mediumCountLive : (mediumCount ?? 0);
  const low = hasLiveStats ? lowCountLive : (lowCount ?? 0);
  const active = hasLiveStats ? activeCountLive : critical + medium + low;

  // Determine state from data
  const nonCriticalCount = Math.max(0, active - critical);

  // Logic:
  // - Danger: Critical count > 0
  // - Warning: Low urgency count > 0
  // - OK: Active count == 0

  const isDanger = critical > 0;
  // Warning if explicitly passed mediumCount > 0 OR if falling back to old logic
  const isWarning = !isDanger && (medium > 0 || nonCriticalCount > 0);
  const _isOk = !isDanger && !isWarning;

  // Derived Label/Detail: prioritize live stats if fetched, otherwise initial props
  const label = hasLiveStats
    ? isDanger
      ? 'Critical Alert'
      : isWarning
        ? 'Yellow Alert'
        : 'Green Corridor'
    : initialLabel || (isDanger ? 'Critical Alert' : isWarning ? 'Yellow Alert' : 'Green Corridor');

  const detail = hasLiveStats
    ? isDanger
      ? `${critical} critical incidents active`
      : isWarning
        ? `${medium} warning signs detected`
        : 'Systems Normal'
    : initialDetail ||
      (isDanger
        ? `${critical} critical incidents active`
        : isWarning
          ? `${medium} warning signs detected`
          : 'Systems Normal');

  interface ThemeConfig {
    bg: string;
    border: string;
    text: string;
    dot: string;
    dotBg: string;
    icon: React.ReactNode;
    title: string;
    desc: string;
  }

  // Dynamic Theme Configuration
  const theme: Record<'danger' | 'warning' | 'ok', ThemeConfig> = {
    danger: {
      bg: 'bg-rose-500/15',
      border: 'border-rose-500/30',
      text: 'text-rose-300',
      dot: 'bg-rose-500',
      dotBg: 'bg-rose-500',
      icon: <AlertTriangle className="h-4 w-4 text-rose-400" />,
      title: 'Critical Alert',
      desc: 'Critical incidents detected. Immediate resolution required.',
    },
    warning: {
      bg: 'bg-amber-500/15',
      border: 'border-amber-500/30',
      text: 'text-amber-300',
      dot: 'bg-amber-500',
      dotBg: 'bg-amber-500',
      icon: <AlertCircle className="h-4 w-4 text-amber-400" />,
      title: 'Yellow Alert',
      desc: 'Non-critical issues reported. Monitoring medium and low urgency alerts.',
    },
    ok: {
      bg: 'bg-emerald-500/15',
      border: 'border-emerald-500/30',
      text: 'text-emerald-300',
      dot: 'bg-emerald-500',
      dotBg: 'bg-emerald-500',
      icon: <ShieldCheck className="h-4 w-4 text-emerald-400" />,
      title: 'Green Corridor',
      desc: 'All systems fully operational. No active anomalies.',
    },
  };

  const currentTone = hasLiveStats
    ? isDanger
      ? 'danger'
      : isWarning
        ? 'warning'
        : 'ok'
    : initialTone || (isDanger ? 'danger' : isWarning ? 'warning' : 'ok');

  const currentTheme =
    currentTone === 'danger' ? theme.danger : currentTone === 'warning' ? theme.warning : theme.ok;

  if (loading && !initialTone && !hasInitialProps) {
    // Show loading only if no fallback
    return (
      <div className="flex items-center gap-2 px-2.5 py-1 rounded-full border bg-muted/20 animate-pulse">
        <div className="h-2 w-2 rounded-full bg-muted-foreground/50" />
        <span className="text-[10px] uppercase font-semibold text-muted-foreground">Checking</span>
      </div>
    );
  }

  const summary = `H ${critical} · M ${medium} · L ${low}`;

  return (
    <HoverCard openDelay={0} closeDelay={150}>
      <HoverCardTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-1.5 sm:gap-2 px-2.5 py-1 rounded-full select-none border shrink-0 whitespace-nowrap',
            currentTheme.bg,
            currentTheme.border,
            currentTheme.text
          )}
        >
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span
              className={cn(
                'animate-ping absolute inline-flex h-full w-full rounded-full opacity-60',
                currentTheme.dot
              )}
            />
            <span
              className={cn(
                'animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] absolute inline-flex h-full w-full rounded-full opacity-30 animation-delay-500',
                currentTheme.dot
              )}
            />
            <span
              className={cn(
                'relative inline-flex rounded-full h-2.5 w-2.5 shadow-sm',
                currentTheme.dotBg
              )}
            />
          </span>

          <span className="text-[10.5px] sm:text-[11px] font-semibold tracking-wide uppercase">
            {label}
          </span>
          <span className="hidden sm:inline text-[11px] text-slate-500">|</span>
          <span className="hidden sm:inline text-[11px] font-semibold text-slate-200">
            {summary}
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        sideOffset={10}
        align="start"
        className={cn('w-72 p-4 border shadow-md bg-white text-slate-900 z-[1050]')}
      >
        <div className="flex items-center gap-2 mb-2">
          {currentTheme.icon}
          <div>
            <div className="text-sm font-semibold">{currentTheme.title}</div>
            <div className="text-xs text-muted-foreground">{currentTheme.desc}</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md border bg-slate-50 p-2 text-center">
            <div className="text-[10px] uppercase text-muted-foreground">High</div>
            <div className="text-sm font-semibold text-slate-900">{critical}</div>
          </div>
          <div className="rounded-md border bg-slate-50 p-2 text-center">
            <div className="text-[10px] uppercase text-muted-foreground">Medium</div>
            <div className="text-sm font-semibold text-slate-900">{medium}</div>
          </div>
          <div className="rounded-md border bg-slate-50 p-2 text-center">
            <div className="text-[10px] uppercase text-muted-foreground">Low</div>
            <div className="text-sm font-semibold text-slate-900">{low}</div>
          </div>
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">
          Active counts exclude snoozed and suppressed incidents.
        </div>
        <Link
          href="/incidents"
          className="mt-3 group/btn flex items-center justify-between w-full p-2 rounded-md bg-muted/40 hover:bg-muted/70 transition-all border border-transparent hover:border-border"
        >
          <div className="flex items-center gap-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">{detail}</span>
          </div>
          <div className="flex items-center justify-center h-6 w-6 rounded bg-background shadow-sm border">
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
          </div>
        </Link>
      </HoverCardContent>
    </HoverCard>
  );
}
