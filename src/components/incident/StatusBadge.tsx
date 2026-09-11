'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/shadcn/badge';

export type StatusBadgeProps = {
  status: string;
  label?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showDot?: boolean;
  pulse?: boolean;
  className?: string;
};

export function getStatusVariant(
  status: string
): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  switch (status.toUpperCase()) {
    case 'RESOLVED':
    case 'OPERATIONAL':
    case 'PUBLISHED':
    case 'COMPLETED':
      return 'success';
    case 'ACKNOWLEDGED':
    case 'DEGRADED':
    case 'PARTIAL_OUTAGE':
    case 'INVESTIGATING':
    case 'IDENTIFIED':
    case 'MONITORING':
    case 'IN_PROGRESS':
    case 'ARCHIVED':
      return 'warning';
    case 'OPEN':
    case 'CRITICAL':
    case 'MAJOR_OUTAGE':
      return 'danger';
    case 'MAINTENANCE':
    case 'SCHEDULED':
      return 'info';
    case 'SNOOZED':
    case 'SUPPRESSED':
    case 'DRAFT':
    case 'UNKNOWN':
    case 'UNVERIFIED':
      return 'neutral';
    default:
      return 'info';
  }
}

function getBadgeSize(size: 'xs' | 'sm' | 'md' | 'lg'): 'xs' | 'sm' | 'md' {
  switch (size) {
    case 'xs':
      return 'xs';
    case 'sm':
      return 'xs';
    case 'lg':
      return 'md';
    case 'md':
    default:
      return 'sm';
  }
}

function StatusBadge({
  status,
  label,
  size = 'md',
  showDot = false,
  pulse = false,
  className,
}: StatusBadgeProps) {
  const variant = getStatusVariant(status);
  const badgeSize = getBadgeSize(size);
  const displayText = label ?? status;

  return (
    <Badge
      variant={variant}
      size={badgeSize}
      data-status={status.toLowerCase().replace(/_/g, '-')}
      className={cn(
        'status-badge',
        `status-${status.toLowerCase().replace(/_/g, '-')}`,
        label ? 'normal-case' : 'uppercase',
        className
      )}
    >
      {showDot && (
        <span className="relative flex items-center justify-center shrink-0" aria-hidden="true">
          {pulse && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          )}
          <span className="status-badge__dot relative inline-flex h-1.5 w-1.5 rounded-full bg-current opacity-90" />
        </span>
      )}
      <span>{displayText}</span>
    </Badge>
  );
}

// Memoize StatusBadge to prevent unnecessary re-renders
export default memo(StatusBadge);
