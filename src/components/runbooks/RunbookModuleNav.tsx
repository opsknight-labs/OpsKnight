'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, BookOpen, Bot, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TONE_SURFACE } from './ui/primitives';

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
    <nav
      aria-label="Runbook navigation"
      className={cn(
        'sticky top-0 z-20 bg-background/80 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/70',
        className
      )}
    >
      <div className="no-scrollbar overflow-x-auto">
        <div className="inline-flex min-w-max items-center gap-0.5 rounded-xl border bg-muted/40 p-1 shadow-xs">
          {items.map(item => {
            const isActive = isRunbookSectionActive(pathname, item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group inline-flex h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-background text-foreground shadow-xs ring-1 ring-border/60'
                    : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    'h-4 w-4 shrink-0 transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                  )}
                />
                <span>{item.label}</span>

                {item.count !== undefined && (
                  <span
                    className={cn(
                      'inline-flex h-5 min-w-[1.25rem] items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-medium tabular-nums ring-1 ring-inset',
                      item.live ? TONE_SURFACE.info : TONE_SURFACE.neutral
                    )}
                  >
                    {item.live && (
                      <span aria-hidden="true" className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75 motion-reduce:hidden" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-500" />
                      </span>
                    )}
                    {item.count}
                  </span>
                )}

                {item.healthIndicator && (
                  <span
                    aria-label={`Health: ${item.healthIndicator.toLowerCase()}`}
                    className="flex shrink-0 items-center"
                  >
                    {item.healthIndicator === 'HEALTHY' ? (
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    ) : item.healthIndicator === 'UNKNOWN' ? (
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                    ) : (
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75 motion-reduce:hidden" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
                      </span>
                    )}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
