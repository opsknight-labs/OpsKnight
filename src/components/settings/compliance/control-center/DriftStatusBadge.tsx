import React from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import type { ComplianceDriftStatus } from '@/lib/compliance/drift/types';

interface DriftStatusBadgeProps {
  readonly status: ComplianceDriftStatus;
  readonly className?: string;
}

export function DriftStatusBadge({ status, className }: DriftStatusBadgeProps) {
  switch (status) {
    case 'OPEN':
      return (
        <Badge
          variant="destructive"
          className={`border-status-critical-border/25 bg-status-critical-soft dark:border-status-critical/35 dark:bg-status-critical/15 text-status-critical-deep dark:text-rose-300 font-medium ${className || ''}`}
        >
          Open
        </Badge>
      );
    case 'ACKNOWLEDGED':
      return (
        <Badge
          variant="secondary"
          className={`border-status-elevated-border/30 bg-status-elevated-soft dark:border-status-elevated/35 dark:bg-status-elevated/15 text-status-elevated-deep dark:text-amber-300 font-medium ${className || ''}`}
        >
          Acknowledged
        </Badge>
      );
    case 'RESOLVED':
      return (
        <Badge
          variant="outline"
          className={`border-status-ok-border/30 bg-status-ok-soft dark:border-status-ok/35 dark:bg-status-ok/15 text-status-ok-deep dark:text-emerald-300 font-medium ${className || ''}`}
        >
          Resolved
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
