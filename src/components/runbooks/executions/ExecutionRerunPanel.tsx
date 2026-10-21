'use client';

import { Info, RotateCcw } from 'lucide-react';
import RunbookExecutionPreview from '../RunbookExecutionPreview';
import { executeRerunAction, previewRerunAction } from '@/app/(app)/runbooks/executions/actions';

export type ExecutionRerunPanelProps = {
  executionId: string;
  blockedReason: string | null;
  canExecute: boolean;
};

export function ExecutionRerunPanel({
  executionId,
  blockedReason,
  canExecute,
}: ExecutionRerunPanelProps) {
  const reason = canExecute
    ? blockedReason
    : 'You need permission to execute runbooks to re-run this execution.';
  return (
    <section
      aria-label="Re-run execution"
      className="overflow-hidden rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/50 backdrop-blur-xs shadow-xs"
    >
      {/* Compact Enterprise Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary shadow-2xs">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-semibold text-foreground tracking-tight">
              Re-run Execution
            </h3>
            <p className="text-[11px] text-muted-foreground truncate">
              Builds a fresh plan using current rules and inputs
            </p>
          </div>
        </div>
      </div>

      {/* Body with reason and preview */}
      <div className="p-3.5 sm:p-4 space-y-3">
        {reason && (
          <div className="flex items-start gap-2 rounded-xl border border-border/70 bg-muted/40 p-2.5 text-xs text-muted-foreground">
            <Info
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="leading-snug">{reason}</span>
          </div>
        )}
        <RunbookExecutionPreview
          disabled={Boolean(reason)}
          previewAction={previewRerunAction.bind(null, executionId)}
          executeAction={executeRerunAction.bind(null, executionId)}
          previewLabel="Preview re-run"
          executeLabel="Re-run this plan"
        />
      </div>
    </section>
  );
}
