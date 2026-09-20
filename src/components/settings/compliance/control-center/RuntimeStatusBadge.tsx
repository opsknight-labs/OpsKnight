import React from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import { CheckCircle2, TriangleAlert, AlertCircle, HelpCircle, MinusCircle } from 'lucide-react';
import type { ComplianceEvaluationStatus } from '@/lib/compliance/types';
import { cn } from '@/lib/utils';

interface RuntimeStatusBadgeProps {
  readonly status: ComplianceEvaluationStatus;
  readonly className?: string;
}

const statusConfig: Record<
  ComplianceEvaluationStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  IMPLEMENTED: {
    label: 'Implemented',
    className:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold',
    icon: CheckCircle2,
  },
  PARTIAL: {
    label: 'Partial',
    className:
      'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold',
    icon: TriangleAlert,
  },
  ACTION_REQUIRED: {
    label: 'Action Required',
    className: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 font-semibold',
    icon: AlertCircle,
  },
  UNVERIFIED: {
    label: 'Unverified',
    className: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 font-semibold',
    icon: HelpCircle,
  },
  NOT_APPLICABLE: {
    label: 'Not Applicable',
    className: 'border-border bg-muted text-muted-foreground font-normal',
    icon: MinusCircle,
  },
};

function getStatusConfig(status: ComplianceEvaluationStatus) {
  switch (status) {
    case 'IMPLEMENTED':
      return statusConfig.IMPLEMENTED;
    case 'PARTIAL':
      return statusConfig.PARTIAL;
    case 'ACTION_REQUIRED':
      return statusConfig.ACTION_REQUIRED;
    case 'NOT_APPLICABLE':
      return statusConfig.NOT_APPLICABLE;
    case 'UNVERIFIED':
    default:
      return statusConfig.UNVERIFIED;
  }
}

export function RuntimeStatusBadge({ status, className }: RuntimeStatusBadgeProps) {
  const config = getStatusConfig(status);
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn('gap-1 text-[11px] py-0.5 px-2', config.className, className)}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{config.label}</span>
    </Badge>
  );
}
