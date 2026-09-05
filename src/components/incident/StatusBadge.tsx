'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/shadcn/badge';

type StatusBadgeProps = {
  status: string;
  size?: 'sm' | 'md' | 'lg';
  showDot?: boolean;
  className?: string;
};

function StatusBadge({ status, size = 'md', showDot = false, className }: StatusBadgeProps) {
  const sizeMap: Record<NonNullable<StatusBadgeProps['size']>, 'xs' | 'sm' | 'md'> = {
    sm: 'xs',
    md: 'sm',
    lg: 'md',
  };

  const statusVariantMap: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
    OPEN: 'danger',
    ACKNOWLEDGED: 'warning',
    RESOLVED: 'success',
    SNOOZED: 'neutral',
    SUPPRESSED: 'neutral',
    OPERATIONAL: 'success',
    DEGRADED: 'warning',
    CRITICAL: 'danger',
    // Postmortem statuses
    DRAFT: 'neutral',
    PUBLISHED: 'success',
    ARCHIVED: 'warning',
  };

  const variant = statusVariantMap[status] ?? 'info';
  return (
    <Badge variant={variant} size={sizeMap[size]} className={cn('uppercase', className)}>
      {showDot && <span className="h-2 w-2 rounded-full bg-white/80" />}
      {status}
    </Badge>
  );
}

// Memoize StatusBadge to prevent unnecessary re-renders
export default memo(StatusBadge);
