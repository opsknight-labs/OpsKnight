'use client';

import { memo } from 'react';
import SeverityBadge from '@/components/patterns/SeverityBadge';

type PriorityBadgeProps = {
  priority: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  hideIcon?: boolean;
  className?: string;
};

function badgeSize(size: 'sm' | 'md' | 'lg'): 'xs' | 'sm' | 'md' {
  switch (size) {
    case 'sm':
      return 'xs';
    case 'lg':
      return 'md';
    default:
      return 'sm';
  }
}

/** Incident priority pill; delegates to the shared `SeverityBadge` (tone from `priorityTone()`). */
function PriorityBadge({
  priority,
  size = 'md',
  showLabel = true,
  hideIcon = false,
  className,
}: PriorityBadgeProps) {
  if (!priority) return null;
  return (
    <SeverityBadge
      priority={priority}
      size={badgeSize(size)}
      showLabel={showLabel}
      hideIcon={hideIcon}
      className={className}
    />
  );
}

export default memo(PriorityBadge);
