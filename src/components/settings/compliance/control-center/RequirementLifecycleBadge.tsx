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
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold',
    icon: CheckCircle2,
  },
  FUTURE: {
    label: 'Future Staged',
    className:
      'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 font-semibold',
    icon: Clock,
  },
  SUPERSEDED: {
    label: 'Superseded',
    className:
      'border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 font-medium line-through decoration-zinc-400',
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
      className={cn('gap-1 text-[11px] py-0.5 px-2 shrink-0', config.className, className)}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{config.label}</span>
      {effectiveDate && lifecycle === 'FUTURE' && (
        <span className="text-[10px] opacity-80">({effectiveDate})</span>
      )}
    </Badge>
  );
}
