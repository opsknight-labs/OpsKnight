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
      bg: 'bg-rose-500/10 dark:bg-rose-950/40 hover:bg-rose-500/15 dark:hover:bg-rose-950/60',
      border: 'border-rose-500/30 dark:border-rose-500/40',
      text: 'text-rose-400',
      dot: 'bg-rose-500',
      dotBg: 'bg-rose-500',
      icon: <AlertTriangle className="h-4 w-4 text-rose-500 dark:text-rose-400" />,
      title: 'Critical Alert',
      desc: 'Critical incidents detected. Immediate resolution required.',
    },
    warning: {
      bg: 'bg-amber-500/10 dark:bg-amber-950/40 hover:bg-amber-500/15 dark:hover:bg-amber-950/60',
      border: 'border-amber-500/30 dark:border-amber-500/40',
      text: 'text-amber-400',
      dot: 'bg-amber-500',
      dotBg: 'bg-amber-500',
      icon: <AlertCircle className="h-4 w-4 text-amber-500 dark:text-amber-400" />,
      title: 'Yellow Alert',
      desc: 'Non-critical issues reported. Monitoring medium and low urgency alerts.',
    },
    ok: {
      bg: 'bg-emerald-500/10 dark:bg-emerald-950/40 hover:bg-emerald-500/15 dark:hover:bg-emerald-950/60',
      border: 'border-emerald-500/30 dark:border-emerald-500/40',
      text: 'text-emerald-400',
      dot: 'bg-emerald-500',
      dotBg: 'bg-emerald-500',
      icon: <ShieldCheck className="h-4 w-4 text-emerald-500 dark:text-emerald-400" />,
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
      <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg border border-border/60 bg-muted/20 animate-pulse">
        <div className="h-2 w-2 rounded-full bg-muted-foreground/50" />
        <span className="text-[10px] uppercase font-semibold text-muted-foreground">Checking</span>
      </div>
    );
  }

  return (
    <HoverCard openDelay={0} closeDelay={150}>
      <HoverCardTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-2 px-2.5 py-1 rounded-lg select-none border shrink-0 whitespace-nowrap transition-all duration-150 shadow-2xs cursor-pointer',
            currentTheme.bg,
            currentTheme.border,
            currentTheme.text
          )}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span
              className={cn(
                'animate-ping absolute inline-flex h-full w-full rounded-full opacity-60',
                currentTheme.dot
              )}
            />
            <span
              className={cn(
                'relative inline-flex rounded-full h-2 w-2 shadow-xs',
                currentTheme.dotBg
              )}
            />
          </span>

          <span className="text-[10.5px] sm:text-[11px] font-bold tracking-wider uppercase">
            {label}
          </span>
          <span className="hidden sm:inline text-[11px] text-zinc-500/60 font-mono">|</span>
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono font-medium tabular-nums text-zinc-300">
            <span>
              H <span className="font-bold text-rose-300">{critical}</span>
            </span>
            <span className="text-zinc-600">·</span>
            <span>
              M <span className="font-bold text-amber-300">{medium}</span>
            </span>
            <span className="text-zinc-600">·</span>
            <span>
              L <span className="font-bold text-zinc-400">{low}</span>
            </span>
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        sideOffset={8}
        align="start"
        className={cn(
          'w-72 p-4 border border-border dark:border-zinc-800 shadow-xl bg-popover dark:bg-[#121216] text-popover-foreground dark:text-zinc-100 z-[1050] rounded-xl'
        )}
      >
        <div className="flex items-center gap-2.5 mb-3">
          <div
            className={cn('p-1.5 rounded-lg shrink-0 border', currentTheme.bg, currentTheme.border)}
          >
            {currentTheme.icon}
          </div>
          <div>
            <div className="text-xs font-bold text-foreground dark:text-zinc-100">
              {currentTheme.title}
            </div>
            <div className="text-[11px] text-muted-foreground leading-tight">
              {currentTheme.desc}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-border/80 dark:border-zinc-800 bg-muted/40 dark:bg-zinc-900/60 p-2 text-center">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">High</div>
            <div className="text-sm font-bold tabular-nums text-rose-600 dark:text-rose-400">
              {critical}
            </div>
          </div>
          <div className="rounded-lg border border-border/80 dark:border-zinc-800 bg-muted/40 dark:bg-zinc-900/60 p-2 text-center">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">Medium</div>
            <div className="text-sm font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {medium}
            </div>
          </div>
          <div className="rounded-lg border border-border/80 dark:border-zinc-800 bg-muted/40 dark:bg-zinc-900/60 p-2 text-center">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">Low</div>
            <div className="text-sm font-bold tabular-nums text-foreground dark:text-zinc-200">
              {low}
            </div>
          </div>
        </div>
        <div className="mt-2.5 text-[10px] text-muted-foreground">
          Active counts exclude snoozed and suppressed incidents.
        </div>
        <Link
          href="/incidents"
          className="mt-3 group/btn flex items-center justify-between w-full p-2 rounded-lg bg-muted/30 dark:bg-zinc-900/40 hover:bg-muted/70 dark:hover:bg-zinc-800/60 transition-all border border-border/60 dark:border-zinc-800/80"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-medium text-foreground dark:text-zinc-200 truncate">
              {detail}
            </span>
          </div>
          <div className="flex items-center justify-center h-5 w-5 rounded bg-background dark:bg-zinc-800 shadow-2xs border border-border/60 dark:border-zinc-700 shrink-0">
            <ArrowRight className="h-3 w-3 text-muted-foreground group-hover/btn:text-foreground group-hover/btn:translate-x-0.5 transition-all" />
          </div>
        </Link>
      </HoverCardContent>
    </HoverCard>
  );
}
