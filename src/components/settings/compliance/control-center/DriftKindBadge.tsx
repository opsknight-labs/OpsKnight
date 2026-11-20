import React from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import type { ComplianceDriftKind } from '@/lib/compliance/drift/types';

interface DriftKindBadgeProps {
  readonly kind: ComplianceDriftKind;
  readonly className?: string;
}

export function DriftKindBadge({ kind, className }: DriftKindBadgeProps) {
  switch (kind) {
    case 'CONTROL_STATUS_REGRESSION':
      return (
        <Badge
          variant="outline"
          className={`border-status-critical-border/25 bg-status-critical-soft dark:border-status-critical/35 dark:bg-status-critical/15 text-status-critical-deep dark:text-rose-300 font-normal ${className || ''}`}
        >
          Status Regression
        </Badge>
      );
    case 'CONTROL_UNVERIFIED':
      return (
        <Badge
          variant="outline"
          className={`border-status-elevated-border/30 bg-status-elevated-soft dark:border-status-elevated/35 dark:bg-status-elevated/15 text-status-elevated-deep dark:text-amber-300 font-normal ${className || ''}`}
        >
          Verification Gap
        </Badge>
      );
    case 'FINDING_SET_CHANGED':
      return (
        <Badge
          variant="outline"
          className={`border-border bg-muted text-ink-600 font-normal ${className || ''}`}
        >
          Finding Changes
        </Badge>
      );
    case 'EVIDENCE_INTEGRITY_MISMATCH':
      return (
        <Badge
          variant="outline"
          className={`border-status-critical-border/25 bg-status-critical-soft dark:border-status-critical/35 dark:bg-status-critical/15 text-status-critical-deep dark:text-rose-300 font-normal ${className || ''}`}
        >
          Integrity Mismatch
        </Badge>
      );
    case 'EVALUATOR_VERSION_CHANGED':
      return (
        <Badge
          variant="outline"
          className={`border-border bg-muted text-ink-600 font-normal ${className || ''}`}
        >
          Evaluator Version
        </Badge>
      );
    case 'FRAMEWORK_LIFECYCLE_CHANGED':
      return (
        <Badge
          variant="outline"
          className={`border-status-info-border/25 bg-status-info-soft dark:border-status-info/35 dark:bg-status-info/15 text-status-info-deep dark:text-blue-300 font-normal ${className || ''}`}
        >
          Framework Lifecycle
        </Badge>
      );
    case 'APPLICABILITY_CHANGED':
      return (
        <Badge
          variant="outline"
          className={`bg-muted border-border text-ink-500 font-normal ${className || ''}`}
        >
          Applicability Changed
        </Badge>
      );
    default:
      return <Badge variant="outline">{kind}</Badge>;
  }
}
