'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';
import { AlertCircle, ArrowUp, Zap, Info, ShieldAlert } from 'lucide-react';

type PriorityBadgeProps = {
  priority: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
};

function getPriorityConfig(priority: string) {
  switch (priority) {
    case 'P1':
      return {
        label: 'Crisis',
        icon: ShieldAlert,
        tone: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100/80 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
      };
    case 'P2':
      return {
        label: 'High',
        icon: ArrowUp,
        tone: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
      };
    case 'P3':
      return {
        label: 'Medium',
        icon: AlertCircle,
        tone: 'bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100/80 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800',
      };
    case 'P4':
      return {
        label: 'Low',
        icon: Zap,
        tone: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100/80 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
      };
    case 'P5':
      return {
        label: 'Info',
        icon: Info,
        tone: 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700',
      };
    default:
      return {
        label: priority,
        icon: Info,
        tone: 'bg-slate-50 text-slate-700 border-slate-200',
      };
  }
}

function getSizeClasses(size: 'sm' | 'md' | 'lg'): string {
  switch (size) {
    case 'sm':
      return 'text-xs px-2 py-0.5';
    case 'lg':
      return 'text-base px-3 py-1';
    case 'md':
    default:
      return 'text-sm px-2.5 py-0.5';
  }
}

function PriorityBadge({ priority, size = 'md', showLabel = true, className }: PriorityBadgeProps) {
  if (!priority) return null;

  const { label, icon: Icon, tone } = getPriorityConfig(priority);
  const sizeClasses = getSizeClasses(size);

  const displayLabel =
    size === 'sm' && !showLabel ? priority : showLabel ? `${priority} · ${label}` : priority;

  return (
    <div
      className={cn(
        'font-semibold rounded-md border shadow-2xs inline-flex items-center gap-1.5 shrink-0 transition-all leading-normal',
        sizeClasses,
        tone,
        className
      )}
    >
      {Icon && <Icon className={cn('shrink-0', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />}
      <span>{displayLabel}</span>
    </div>
  );
}

export default memo(PriorityBadge);
