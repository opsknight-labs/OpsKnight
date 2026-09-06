'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/shadcn/card';
import { cn } from '@/lib/utils';

interface ActionItemsStatsProps {
  stats: {
    total: number;
    open: number;
    inProgress: number;
    completed: number;
    blocked: number;
    overdue: number;
    highPriority: number;
  };
}

const STAT_CONFIGS = [
  {
    key: 'total',
    label: 'Total',
    colorClass: 'text-gray-500',
    borderColorClass: 'border-gray-200',
    bgGradient: 'from-white to-slate-50',
    highlightBg: 'from-gray-50 to-gray-25',
    shadowColor: 'shadow-gray-200/50',
    href: '/action-items',
    isHighlightable: false,
  },
  {
    key: 'open',
    label: 'Open',
    colorClass: 'text-blue-500',
    borderColorClass: 'border-blue-200',
    bgGradient: 'from-white to-slate-50',
    highlightBg: 'from-blue-50/60 to-blue-50/20',
    shadowColor: 'shadow-blue-200/50',
    href: '/action-items?status=OPEN',
    isHighlightable: false,
  },
  {
    key: 'inProgress',
    label: 'In Progress',
    colorClass: 'text-amber-500',
    borderColorClass: 'border-amber-200',
    bgGradient: 'from-white to-slate-50',
    highlightBg: 'from-amber-50/60 to-amber-50/20',
    shadowColor: 'shadow-amber-200/50',
    href: '/action-items?status=IN_PROGRESS',
    isHighlightable: false,
  },
  {
    key: 'completed',
    label: 'Completed',
    colorClass: 'text-green-500',
    borderColorClass: 'border-green-200',
    bgGradient: 'from-white to-slate-50',
    highlightBg: 'from-green-50/60 to-green-50/20',
    shadowColor: 'shadow-green-200/50',
    href: '/action-items?status=COMPLETED',
    isHighlightable: false,
  },
  {
    key: 'blocked',
    label: 'Blocked',
    colorClass: 'text-red-500',
    borderColorClass: 'border-red-200',
    bgGradient: 'from-white to-slate-50',
    highlightBg: 'from-red-50/60 to-red-50/20',
    shadowColor: 'shadow-red-200/50',
    href: '/action-items?status=BLOCKED',
    isHighlightable: false,
  },
  {
    key: 'overdue',
    label: 'Overdue',
    colorClass: 'text-red-600',
    borderColorClass: 'border-red-300',
    bgGradient: 'from-white to-slate-50',
    highlightBg: 'from-red-50/60 to-red-50/20',
    shadowColor: 'shadow-red-300/50',
    href: '/action-items?status=OPEN',
    isHighlightable: true,
  },
  {
    key: 'highPriority',
    label: 'High Priority',
    colorClass: 'text-red-500',
    borderColorClass: 'border-red-300',
    bgGradient: 'from-white to-slate-50',
    highlightBg: 'from-red-50/60 to-red-50/20',
    shadowColor: 'shadow-red-300/50',
    href: '/action-items?priority=HIGH',
    isHighlightable: true,
  },
] as const;

export default function ActionItemsStats({ stats }: ActionItemsStatsProps) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-4 mb-8">
      {STAT_CONFIGS.map(config => {
        const value = stats[config.key as keyof typeof stats];
        const isHighlighted = config.isHighlightable && value > 0;

        return (
          <Link key={config.key} href={config.href} className="no-underline text-inherit">
            <Card
              className={cn(
                'relative overflow-hidden p-5 cursor-pointer',
                'transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
                'hover:-translate-y-1 hover:shadow-xl',
                'bg-gradient-to-br',
                isHighlighted ? config.highlightBg : config.bgGradient,
                isHighlighted ? config.borderColorClass : 'border-slate-200',
                isHighlighted && config.shadowColor
              )}
            >
              {/* Highlight bar at top */}
              {isHighlighted && (
                <div
                  className={cn(
                    'absolute top-0 left-0 right-0 h-[3px]',
                    config.key === 'overdue' && 'bg-gradient-to-r from-red-600 to-red-600/80',
                    config.key === 'highPriority' && 'bg-gradient-to-r from-red-500 to-red-500/80'
                  )}
                />
              )}

              {/* Label */}
              <div className="text-xs text-muted-foreground mb-2 font-semibold uppercase tracking-wider">
                {config.label}
              </div>

              {/* Value */}
              <div
                className={cn(
                  'text-[2.5rem] font-extrabold leading-none tracking-tight',
                  config.colorClass
                )}
              >
                {value}
              </div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
