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
          className={`bg-rose-500/10 text-rose-500 border-rose-500/20 font-normal ${className || ''}`}
        >
          Status Regression
        </Badge>
      );
    case 'CONTROL_UNVERIFIED':
      return (
        <Badge
          variant="outline"
          className={`bg-amber-500/10 text-amber-500 border-amber-500/20 font-normal ${className || ''}`}
        >
          Verification Gap
        </Badge>
      );
    case 'FINDING_SET_CHANGED':
      return (
        <Badge
          variant="outline"
          className={`bg-purple-500/10 text-purple-500 border-purple-500/20 font-normal ${className || ''}`}
        >
          Finding Changes
        </Badge>
      );
    case 'EVIDENCE_INTEGRITY_MISMATCH':
      return (
        <Badge
          variant="outline"
          className={`bg-red-500/10 text-red-500 border-red-500/20 font-normal ${className || ''}`}
        >
          Integrity Mismatch
        </Badge>
      );
    case 'EVALUATOR_VERSION_CHANGED':
      return (
        <Badge
          variant="outline"
          className={`bg-sky-500/10 text-sky-500 border-sky-500/20 font-normal ${className || ''}`}
        >
          Evaluator Version
        </Badge>
      );
    case 'FRAMEWORK_LIFECYCLE_CHANGED':
      return (
        <Badge
          variant="outline"
          className={`bg-blue-500/10 text-blue-500 border-blue-500/20 font-normal ${className || ''}`}
        >
          Framework Lifecycle
        </Badge>
      );
    case 'APPLICABILITY_CHANGED':
      return (
        <Badge
          variant="outline"
          className={`bg-slate-500/10 text-slate-500 border-slate-500/20 font-normal ${className || ''}`}
        >
          Applicability Changed
        </Badge>
      );
    default:
      return <Badge variant="outline">{kind}</Badge>;
  }
}
