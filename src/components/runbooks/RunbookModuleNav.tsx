'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, BookOpen, Bot, Play } from 'lucide-react';
import { cn } from '@/lib/utils';

export type RunbookModuleNavProps = {
  summary?: import('@/lib/runbooks/presentation/contracts').NavigationSummary;
  className?: string;
};

const SECTION_ROOTS = ['/runbooks/executions', '/runbooks/agents', '/runbooks/health'];

export function isRunbookSectionActive(pathname: string, href: string) {
  const within = (target: string) => pathname === target || pathname.startsWith(`${target}/`);
  if (href !== '/runbooks') return within(href);
  // Library owns /runbooks and runbook detail routes, but not the other module sections.
  return within(href) && !SECTION_ROOTS.some(within);
}

export function RunbookModuleNav({ summary, className }: RunbookModuleNavProps) {
  const pathname = usePathname() ?? '';
  const activeExecutions = summary?.activeExecutions;
  const health = summary?.health ?? 'UNKNOWN';

  const items: Array<{
    href: string;
    label: string;
    icon: typeof BookOpen;
    count?: number;
    live?: boolean;
    healthIndicator?: 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';
  }> = [
    { href: '/runbooks', label: 'Library', icon: BookOpen },
    {
      href: '/runbooks/executions',
      label: 'Executions',
      icon: Play,
      count: activeExecutions,
      live: Boolean(activeExecutions && activeExecutions > 0),
    },
    { href: '/runbooks/agents', label: 'Agents', icon: Bot, count: summary?.onlineAgents },
    { href: '/runbooks/health', label: 'Health', icon: Activity, healthIndicator: health },
  ];

  return (
    <nav aria-label="Runbook navigation" className={cn('w-full', className)}>
      <div className="grid w-full grid-cols-2 sm:grid-cols-4 gap-1.5 rounded-xl border border-border/80 bg-muted/60 p-1.5 backdrop-blur-xs shadow-2xs">
        {items.map(item => {
          const isActive = isRunbookSectionActive(pathname, item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'group relative flex items-center justify-center gap-2 rounded-lg py-2.5 px-3.5 text-xs font-medium transition-all duration-150 select-none cursor-pointer',
                'border shadow-2xs',
                isActive
                  ? 'bg-background text-foreground font-semibold border-primary/50 shadow-xs ring-2 ring-primary/20'
                  : 'border-border/40 bg-background/50 text-muted-foreground/90 hover:text-foreground hover:bg-background hover:border-border hover:shadow-xs active:scale-[0.98]'
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  'h-4 w-4 shrink-0 transition-transform duration-150 group-hover:scale-110',
                  isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'
                )}
              />
              <span className="truncate">{item.label}</span>

              {item.count !== undefined && item.count !== null && (
                <span
                  className={cn(
                    'ml-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors tabular-nums',
                    isActive
                      ? 'bg-primary/10 text-primary font-bold'
                      : item.live
                        ? 'border border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                        : 'bg-muted-foreground/15 text-muted-foreground group-hover:bg-muted-foreground/20'
                  )}
                >
                  {item.live && (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-sky-500 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                  {item.count}
                </span>
              )}

              {item.healthIndicator && (
                <span
                  aria-label={`Health: ${item.healthIndicator.toLowerCase()}`}
                  className={cn(
                    'ml-0.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                    item.healthIndicator === 'HEALTHY' &&
                      'border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                    item.healthIndicator === 'DEGRADED' &&
                      'border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
                    item.healthIndicator === 'UNKNOWN' &&
                      'border border-border/80 bg-muted/80 text-muted-foreground'
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full shrink-0',
                      item.healthIndicator === 'HEALTHY' && 'bg-emerald-500',
                      item.healthIndicator === 'DEGRADED' && 'bg-amber-500',
                      item.healthIndicator === 'UNKNOWN' && 'bg-muted-foreground/40'
                    )}
                    aria-hidden="true"
                  />
                  <span className="hidden lg:inline capitalize">
                    {item.healthIndicator.toLowerCase()}
                  </span>
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
