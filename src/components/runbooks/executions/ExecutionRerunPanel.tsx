'use client';

import { Info, RotateCcw } from 'lucide-react';
import RunbookExecutionPreview from '../RunbookExecutionPreview';
import { SectionCard } from '../ui/primitives';
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
    <section aria-label="Re-run execution">
      <SectionCard
        icon={RotateCcw}
        title="Re-run"
        description="Builds a fresh plan from the original runbook, service, incident and inputs. Service rules use their current version strategy and saved inputs. Nothing runs until you review the preview."
        bodyClassName="space-y-3"
      >
        {reason && (
          <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{reason}</span>
          </p>
        )}
        <RunbookExecutionPreview
          disabled={Boolean(reason)}
          previewAction={previewRerunAction.bind(null, executionId)}
          executeAction={executeRerunAction.bind(null, executionId)}
          previewLabel="Preview re-run"
          executeLabel="Re-run this plan"
        />
      </SectionCard>
    </section>
  );
}
