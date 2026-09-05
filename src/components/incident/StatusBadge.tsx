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

function getStatusVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  switch (status) {
    case 'RESOLVED':
    case 'OPERATIONAL':
    case 'PUBLISHED':
      return 'success';
    case 'ACKNOWLEDGED':
    case 'DEGRADED':
    case 'ARCHIVED':
      return 'warning';
    case 'OPEN':
    case 'CRITICAL':
      return 'danger';
    case 'SNOOZED':
    case 'SUPPRESSED':
    case 'DRAFT':
      return 'neutral';
    default:
      return 'info';
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

function StatusBadge({ status, size = 'md', showDot = false, className }: StatusBadgeProps) {
  const variant = getStatusVariant(status);
  const badgeSize = getBadgeSize(size);

  return (
    <Badge variant={variant} size={badgeSize} className={cn('uppercase', className)}>
      {showDot && <span className="h-2 w-2 rounded-full bg-white/80" />}
      {status}
    </Badge>
  );
}

// Memoize StatusBadge to prevent unnecessary re-renders
export default memo(StatusBadge);
