import React from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import { CheckCircle2, Clock, CircleDashed, Bookmark } from 'lucide-react';
import type { RequirementLifecycle } from '@/lib/compliance/framework-mappings/types';
import { cn } from '@/lib/utils';

interface RequirementLifecycleBadgeProps {
  readonly lifecycle: RequirementLifecycle;
  readonly effectiveDate?: string;
  readonly className?: string;
}

const lifecycleConfig: Record<
  RequirementLifecycle,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  ACTIVE: {
    label: 'Active Requirement',
    className:
      'border-status-ok-border/30 bg-status-ok-soft dark:border-status-ok/35 dark:bg-status-ok/15 text-status-ok-deep dark:text-emerald-300 font-semibold',
    icon: CheckCircle2,
  },
  FUTURE: {
    label: 'Future Staged',
    className: 'border-border bg-muted text-ink-600 font-semibold',
    icon: Clock,
  },
  SUPERSEDED: {
    label: 'Superseded',
    className: 'border-border bg-muted text-ink-600 font-medium line-through',
    icon: CircleDashed,
  },
  REFERENCE_ONLY: {
    label: 'Reference Only',
    className: 'border-border bg-muted text-muted-foreground font-normal',
    icon: Bookmark,
  },
};

function getLifecycleConfig(lifecycle: RequirementLifecycle) {
  switch (lifecycle) {
    case 'ACTIVE':
      return lifecycleConfig.ACTIVE;
    case 'FUTURE':
      return lifecycleConfig.FUTURE;
    case 'SUPERSEDED':
      return lifecycleConfig.SUPERSEDED;
    case 'REFERENCE_ONLY':
    default:
      return lifecycleConfig.REFERENCE_ONLY;
  }
}

export function RequirementLifecycleBadge({
  lifecycle,
  effectiveDate,
  className,
}: RequirementLifecycleBadgeProps) {
  const config = getLifecycleConfig(lifecycle);
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn('gap-1 text-2xs py-0.5 px-2 shrink-0', config.className, className)}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{config.label}</span>
      {effectiveDate && lifecycle === 'FUTURE' && (
        <span className="text-2xs opacity-80">({effectiveDate})</span>
      )}
    </Badge>
  );
}
