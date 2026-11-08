'use client';

import { CheckCircle2, CircleDashed, XCircle } from 'lucide-react';
import type { InvestigationStepView } from './chat-types';

function StepIcon({ status }: { status: InvestigationStepView['status'] }) {
  if (status === 'done')
    return <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-emerald-600" />;
  if (status === 'failed')
    return <XCircle aria-hidden className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  return (
    <CircleDashed aria-hidden className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
  );
}

const STATUS_TEXT: Record<InvestigationStepView['status'], string> = {
  running: 'in progress',
  done: 'done',
  failed: 'failed',
};

/**
 * The steps of an investigation as a collapsible list: the whole list folds away once the answer is in, and
 * each step expands to show the reads it ran. Steps are display-only; nothing here can trigger an action.
 */
export default function SquireInvestigationSteps({
  steps,
  streaming,
}: {
  steps: InvestigationStepView[];
  streaming: boolean;
}) {
  if (steps.length === 0) return null;
  const reads = steps.reduce((sum, step) => sum + step.calls.length, 0);
  return (
    <details
      open={streaming || undefined}
      className="mb-2 rounded-lg border border-border bg-muted/30 text-xs"
      data-testid="squire-investigation"
    >
      <summary className="cursor-pointer select-none px-3 py-2 font-medium text-muted-foreground">
        Investigation · {steps.length} step{steps.length === 1 ? '' : 's'} · {reads} read
        {reads === 1 ? '' : 's'}
      </summary>
      <ol className="space-y-1 px-3 pb-2">
        {steps.map(step => (
          <li key={step.index}>
            <details>
              <summary
                className="flex cursor-pointer items-center gap-2 py-0.5"
                aria-label={`Step ${step.index}: ${step.title} (${STATUS_TEXT[step.status]})`}
              >
                <StepIcon status={step.status} />
                <span className="min-w-0 truncate">
                  Step {step.index}: {step.title}
                </span>
              </summary>
              {step.calls.length > 0 ? (
                <ul className="ml-6 list-disc space-y-0.5 py-1 text-muted-foreground">
                  {step.calls.map((call, index) => (
                    <li key={`${call.tool}-${index}`}>
                      {call.label}
                      {call.ok === false ? ' — failed or not permitted' : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ml-6 py-1 text-muted-foreground">No reads in this step.</p>
              )}
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}
