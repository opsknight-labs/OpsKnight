'use client';

import { CheckCircle2, AlertTriangle, ShieldCheck, ShieldAlert, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { SubmitButton } from '../RunbookControls';
import type { RunbookDefinition } from '@/lib/runbooks/types';

interface ReadinessBarProps {
  definition: RunbookDefinition;
  errorCount: number;
  dirty: boolean;
  unappliedJson: boolean;
  readOnly?: boolean;
  draftRevision?: number;
}

export default function ReadinessBar({
  definition,
  errorCount,
  dirty,
  unappliedJson,
  readOnly = false,
  draftRevision = 0,
}: ReadinessBarProps) {
  const steps = definition.steps;
  const totalSteps = steps.length;
  const approvalGates = steps.filter(
    s => s.riskClass === 'NON_IDEMPOTENT' || s.requiresApproval || s.type === 'APPROVAL'
  ).length;
  const mutationSteps = steps.filter(s => s.riskClass !== 'READ_ONLY').length;

  return (
    <aside
      aria-label="Runbook publish readiness summary"
      className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card/95 p-3.5 backdrop-blur-md shadow-lg"
    >
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Sparkles className="h-4 w-4 text-primary" />
          <span>Workflow Summary:</span>
        </div>

        <Badge variant="outline" className="text-xs">
          {totalSteps} {totalSteps === 1 ? 'step' : 'steps'}
        </Badge>

        <Badge variant={mutationSteps > 0 ? 'warning' : 'secondary'} className="text-xs">
          {mutationSteps} {mutationSteps === 1 ? 'mutation' : 'mutations'}
        </Badge>

        <Badge variant={approvalGates > 0 ? 'warning' : 'secondary'} className="text-xs flex items-center gap-1">
          {approvalGates > 0 ? <ShieldAlert className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
          {approvalGates} {approvalGates === 1 ? 'approval gate' : 'approval gates'}
        </Badge>

        {errorCount === 0 ? (
          <span className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            Ready for execution
          </span>
        ) : (
          <span className="flex items-center gap-1 font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {errorCount} validation {errorCount === 1 ? 'issue' : 'issues'}
          </span>
        )}
      </div>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <span aria-live="polite" className="text-xs font-medium">
            {unappliedJson ? (
              <span className="text-warning">Unapplied JSON</span>
            ) : dirty ? (
              <span className="text-amber-500">Unsaved changes (rev {draftRevision})</span>
            ) : (
              <span className="text-muted-foreground">Draft saved (rev {draftRevision})</span>
            )}
          </span>

          <SubmitButton pendingLabel="Saving draft…" disabled={unappliedJson}>
            <ShieldCheck className="h-4 w-4 mr-1.5" />
            Save draft
          </SubmitButton>
        </div>
      )}
    </aside>
  );
}
