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
      'border-status-ok-border/30 bg-status-ok-soft dark:border-status-ok/35 dark:bg-status-ok/15 text-status-ok-deep dark:text-emerald-300 font-semibold',
    icon: CheckCircle2,
  },
  PARTIAL: {
    label: 'Partial',
    className:
      'border-status-elevated-border/30 bg-status-elevated-soft dark:border-status-elevated/35 dark:bg-status-elevated/15 text-status-elevated-deep dark:text-amber-300 font-semibold',
    icon: TriangleAlert,
  },
  ACTION_REQUIRED: {
    label: 'Action Required',
    className:
      'border-status-critical-border/25 bg-status-critical-soft dark:border-status-critical/35 dark:bg-status-critical/15 text-status-critical-deep dark:text-rose-300 font-semibold',
    icon: AlertCircle,
  },
  UNVERIFIED: {
    label: 'Unverified',
    className: 'border-border bg-muted text-ink-600 font-semibold',
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
      className={cn('gap-1 text-2xs py-0.5 px-2', config.className, className)}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span>{config.label}</span>
    </Badge>
  );
}
