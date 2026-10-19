import { AlertTriangle, CheckCircle2, Clock, HelpCircle, Siren, XCircle } from 'lucide-react';
import type {
  EscalationExecutionHealth as Health,
  EscalationStepOutcome,
} from '@/lib/escalation/execution-health';
import { toneChipClass, type ResponseTone } from '@/lib/incidents/response-presentation';
import { cn } from '@/lib/utils';

const OUTCOME: Record<
  EscalationStepOutcome,
  { label: string; tone: ResponseTone; Icon: typeof CheckCircle2 }
> = {
  COMPLETED: { label: 'Executed', tone: 'success', Icon: CheckCircle2 },
  SCHEDULED: { label: 'Scheduled', tone: 'neutral', Icon: Clock },
  RUNNING: { label: 'Running', tone: 'info', Icon: Clock },
  FAILED: { label: 'Failed', tone: 'critical', Icon: XCircle },
  UNCERTAIN: { label: 'Outcome uncertain', tone: 'warning', Icon: HelpCircle },
};

function formatUtc(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function explanation(step: Health['steps'][number]): string | null {
  if (step.outcome === 'FAILED')
    return step.continuedAfter
      ? 'This step did not run. Later steps continued, so its responders may not have been paged.'
      : 'This step did not run, so its responders may not have been paged.';
  if (step.outcome === 'UNCERTAIN')
    return 'Pages for this step were recorded, but the job never reported completion. Check the notification records before resending.';
  return null;
}

export default function EscalationExecutionHealth({ health }: { health: Health | null }) {
  if (!health) return null;
  if (!health.steps.length && health.incidentEscalationStatus !== 'FAILED') return null;

  return (
    <section
      id="escalation-health"
      aria-label="Escalation execution health"
      className="min-w-0 scroll-mt-24 overflow-hidden rounded-xl border border-border bg-card text-sm text-card-foreground shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Siren className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Escalation Execution Health
        </h2>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
            toneChipClass(health.needsAttention ? 'critical' : 'success')
          )}
        >
          {health.needsAttention ? (
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {health.needsAttention ? 'Needs review' : 'Healthy'}
        </span>
      </div>
      <div className="space-y-3 p-4">
        {health.needsAttention && (
          <p
            role="alert"
            className={cn(
              'flex items-start gap-2 rounded-md border px-3 py-2 text-xs font-medium',
              toneChipClass('critical')
            )}
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {health.incidentEscalationStatus === 'FAILED'
                ? 'Escalation for this incident has failed. No further steps will run automatically.'
                : 'One or more escalation steps need operator review. A step that failed is not retried automatically, because a retry could page responders twice.'}
            </span>
          </p>
        )}
        {!!health.steps.length && (
          <ol className="space-y-2" aria-label="Escalation steps">
            {health.steps.map(step => {
              const outcome = OUTCOME[step.outcome];
              const note = explanation(step);
              return (
                <li key={step.stepIndex} className="rounded-lg border border-border/70 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 break-words font-semibold">
                      Step {step.stepNumber}
                      {step.targetLabel ? ` · ${step.targetLabel}` : ''}
                    </span>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        toneChipClass(outcome.tone)
                      )}
                    >
                      <outcome.Icon className="h-3 w-3" aria-hidden="true" />
                      {outcome.label}
                    </span>
                  </div>
                  {step.maxAttempts > 0 && step.outcome !== 'COMPLETED' && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Attempts {step.attempts} of {step.maxAttempts}
                      {step.failedAt && (
                        <>
                          {' · failed '}
                          <time dateTime={step.failedAt}>{formatUtc(step.failedAt)}</time>
                        </>
                      )}
                    </p>
                  )}
                  {step.error && (
                    <p className="mt-1 break-words text-[11px] text-muted-foreground">
                      {step.error}
                    </p>
                  )}
                  {note && <p className="mt-1 text-xs">{note}</p>}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
