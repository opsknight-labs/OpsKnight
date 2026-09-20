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
          className={`bg-rose-500/10 text-rose-500 border-rose-500/20 font-medium ${className || ''}`}
        >
          Open
        </Badge>
      );
    case 'ACKNOWLEDGED':
      return (
        <Badge
          variant="secondary"
          className={`bg-amber-500/10 text-amber-500 border-amber-500/20 font-medium ${className || ''}`}
        >
          Acknowledged
        </Badge>
      );
    case 'RESOLVED':
      return (
        <Badge
          variant="outline"
          className={`bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-medium ${className || ''}`}
        >
          Resolved
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
