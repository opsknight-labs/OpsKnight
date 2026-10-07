'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Activity, BookOpen, Bot, CheckCircle2, CircleHelp, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/shadcn/badge';

export type RunbookModuleNavProps = {
  summary?: import('@/lib/runbooks/presentation/contracts').NavigationSummary;
  className?: string;
};

export function RunbookModuleNav({ summary, className }: RunbookModuleNavProps) {
  const pathname = usePathname();

  const items = [
    {
      href: '/runbooks',
      label: 'Library',
      icon: BookOpen,
      matchExact: true,
      count: undefined,
    },
    {
      href: '/runbooks/executions',
      label: 'Executions',
      icon: Play,
      matchExact: false,
      count: summary?.activeExecutions,
      countTone: summary?.activeExecutions && summary.activeExecutions > 0 ? 'info' : 'secondary',
    },
    {
      href: '/runbooks/agents',
      label: 'Agents',
      icon: Bot,
      matchExact: false,
      count: summary?.onlineAgents,
      countTone: 'secondary',
    },
    {
      href: '/runbooks/health',
      label: 'Health',
      icon: Activity,
      matchExact: false,
      healthIndicator: summary?.health ?? 'UNKNOWN',
    },
  ];

  return (
    <nav
      aria-label="Runbook navigation"
      className={cn(
        'sticky top-14 z-20 flex items-center gap-1 overflow-x-auto border-b border-border/80 bg-background/95 backdrop-blur-sm px-1 py-1 sm:px-2 no-scrollbar',
        className
      )}
    >
      <div className="flex items-center gap-1 min-w-max">
        {items.map(item => {
          const isActive = item.matchExact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'group relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary',
                isActive
                  ? 'text-foreground font-semibold bg-muted/60 dark:bg-muted/30 shadow-2xs'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0 transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                )}
              />
              <span>{item.label}</span>

              {item.count !== undefined && (
                <Badge
                  variant={isActive ? 'default' : 'secondary'}
                  className={cn(
                    'h-5 px-1.5 text-[11px] font-medium leading-none shrink-0 transition-colors',
                    isActive && 'bg-primary text-primary-foreground'
                  )}
                >
                  {item.count}
                </Badge>
              )}

              {item.healthIndicator && (
                <span aria-label={`Health: ${item.healthIndicator.toLowerCase()}`} className="flex items-center gap-1 shrink-0">
                  {item.healthIndicator === 'HEALTHY' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : item.healthIndicator === 'UNKNOWN' ? (
                    <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                    </span>
                  )}
                </span>
              )}

              {/* Active bottom bar */}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary"
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
