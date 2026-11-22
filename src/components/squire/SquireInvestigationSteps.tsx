'use client';

import { useEffect, useRef } from 'react';
import { CheckCircle2, ChevronRight, CircleDashed, Loader2, XCircle } from 'lucide-react';
import { toneClasses } from '@/components/patterns/status-tone';
import type { InvestigationStepView } from './chat-types';

function StepIcon({ status }: { status: InvestigationStepView['status'] }) {
  if (status === 'done')
    return <CheckCircle2 aria-hidden className={`h-3.5 w-3.5 shrink-0 ${toneClasses('ok').text}`} />;
  if (status === 'failed')
    return <XCircle aria-hidden className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  return (
    <CircleDashed
      aria-hidden
      className="h-3.5 w-3.5 shrink-0 text-muted-foreground motion-safe:animate-spin"
    />
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
 *
 * Both levels are native disclosure widgets, so Enter and Space toggle them and assistive technology reads
 * the expanded state. Progress is announced by the chat's live region, not here, so a step is read once.
 */
export default function SquireInvestigationSteps({
  steps,
  streaming,
}: {
  steps: InvestigationStepView[];
  streaming: boolean;
}) {
  const rootRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    // The list folds away when the answer is complete. If the keyboard was on a step inside it, focus would
    // be left on a hidden control, so it moves to the heading that reopens the list.
    const root = rootRef.current;
    if (streaming || !root || root.open) return;
    const active = root.ownerDocument.activeElement;
    const heading = root.querySelector<HTMLElement>(':scope > summary');
    if (heading && active && active !== heading && root.contains(active)) heading.focus();
  }, [streaming]);
  if (steps.length === 0) return null;
  const reads = steps.reduce((sum, step) => sum + step.calls.length, 0);
  const running = steps.find(step => step.status === 'running');
  return (
    <details
      ref={rootRef}
      open={streaming || undefined}
      className="group/steps text-xs text-muted-foreground"
      data-testid="squire-investigation"
    >
      <summary className="inline-flex min-h-11 cursor-pointer select-none list-none items-center gap-1.5 rounded-md pr-1.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-6 [&::-webkit-details-marker]:hidden">
        {streaming ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" />
        ) : (
          <ChevronRight
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 motion-safe:transition-transform group-open/steps:rotate-90"
          />
        )}
        {streaming && running ? (
          <span className="truncate">
            Step {running.index}: {running.title}…
          </span>
        ) : (
          <span>
            Checked {reads} source{reads === 1 ? '' : 's'} in {steps.length} step
            {steps.length === 1 ? '' : 's'}
          </span>
        )}
      </summary>
      <ol className="mt-1 space-y-1 border-l border-border pl-3" aria-label="Investigation steps">
        {steps.map(step => (
          <li key={step.index}>
            <details>
              <summary
                className="flex cursor-pointer items-center gap-2 rounded py-0.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Step ${step.index}: ${step.title} (${STATUS_TEXT[step.status]})`}
              >
                <StepIcon status={step.status} />
                <span className="min-w-0 truncate">
                  Step {step.index}: {step.title}
                </span>
              </summary>
              {step.calls.length > 0 ? (
                <ul className="ml-6 list-disc space-y-0.5 py-1">
                  {step.calls.map((call, index) => (
                    <li key={`${call.tool}-${index}`}>
                      {call.label}
                      {call.ok === false ? ' — failed or not permitted' : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ml-6 py-1">No reads in this step.</p>
              )}
            </details>
          </li>
        ))}
      </ol>
    </details>
  );
}
