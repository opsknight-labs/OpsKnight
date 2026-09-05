'use client';

import { memo } from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import { AlertCircle, ArrowUp, Zap, Info, ShieldAlert, type LucideIcon } from 'lucide-react';

type PriorityBadgeProps = {
  priority: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
};

type PriorityConfig = {
  label: string;
  variant: 'danger' | 'warning' | 'info' | 'neutral';
  icon: LucideIcon;
  customClass?: string;
};

function getPriorityConfig(priority: string): PriorityConfig {
  switch (priority) {
    case 'P1':
      return {
        label: 'Crisis',
        variant: 'danger',
        icon: ShieldAlert,
      };
    case 'P2':
      return {
        label: 'High',
        variant: 'warning',
        icon: ArrowUp,
      };
    case 'P3':
      return {
        label: 'Medium',
        variant: 'warning',
        icon: AlertCircle,
        customClass:
          'bg-gradient-to-r from-orange-500 to-amber-600 border-transparent text-white shadow-sm',
      };
    case 'P4':
      return {
        label: 'Low',
        variant: 'info',
        icon: Zap,
      };
    case 'P5':
      return {
        label: 'Info',
        variant: 'neutral',
        icon: Info,
      };
    default:
      return {
        label: priority,
        variant: 'neutral',
        icon: Info,
      };
  }
}

function getBadgeSize(size: 'sm' | 'md' | 'lg'): 'xs' | 'sm' | 'md' {
  switch (size) {
    case 'sm':
      return 'xs';
    case 'lg':
      return 'md';
    case 'md':
    default:
      return 'sm';
  }
}

function PriorityBadge({ priority, size = 'md', showLabel = true, className }: PriorityBadgeProps) {
  if (!priority) return null;

  const { label, variant, icon: Icon, customClass } = getPriorityConfig(priority);
  const badgeSize = getBadgeSize(size);

  const displayLabel =
    size === 'sm' && !showLabel ? priority : showLabel ? `${priority} · ${label}` : priority;

  return (
    <Badge
      variant={variant}
      size={badgeSize}
      className={cn(
        'font-bold tracking-wide shadow-2xs gap-1 shrink-0 transition-all uppercase',
        customClass,
        className
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            'shrink-0 text-white',
            badgeSize === 'xs' ? 'h-3 w-3' : badgeSize === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'
          )}
        />
      )}
      <span>{displayLabel}</span>
    </Badge>
  );
}

export default memo(PriorityBadge);
