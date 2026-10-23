import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  HelpCircle,
  Siren,
  XCircle,
} from 'lucide-react';
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

  const completedSteps = health.steps.filter(s => s.outcome === 'COMPLETED').length;

  return (
    <section
      id="escalation-health"
      aria-label="Escalation execution health"
      className={cn(
        'min-w-0 scroll-mt-24 overflow-hidden rounded-xl border bg-card text-xs text-card-foreground shadow-2xs transition-all',
        health.needsAttention ? 'border-rose-500/40 dark:border-rose-500/30' : 'border-border/70'
      )}
    >
      <details className="group" open={health.needsAttention}>
        <summary
          className={cn(
            'flex cursor-pointer list-none items-center justify-between gap-2 px-3 select-none transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden',
            health.needsAttention ? 'min-h-9 py-2' : 'min-h-8 py-1.5'
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Siren
              className={cn(
                'h-3.5 w-3.5 shrink-0',
                health.needsAttention
                  ? 'text-rose-500 animate-pulse'
                  : 'text-emerald-600 dark:text-emerald-400'
              )}
              aria-hidden="true"
            />
            <h2 className="truncate text-xs font-semibold tracking-tight text-foreground">
              Escalation Execution Health
            </h2>
            {!health.needsAttention && !!health.steps.length && (
              <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline-block">
                ({completedSteps}/{health.steps.length} executed)
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide',
                toneChipClass(health.needsAttention ? 'critical' : 'success')
              )}
            >
              {health.needsAttention ? (
                <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
              )}
              {health.needsAttention ? 'Needs review' : 'Healthy'}
            </span>
            <ChevronDown
              className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </div>
        </summary>

        <div className="border-t border-border/60 bg-muted/10 p-3 space-y-2.5">
          {health.needsAttention && (
            <p
              role="alert"
              className={cn(
                'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-medium',
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
            <ol className="space-y-1.5" aria-label="Escalation steps">
              {health.steps.map(step => {
                const outcome = OUTCOME[step.outcome];
                const note = explanation(step);
                return (
                  <li
                    key={step.stepIndex}
                    className="rounded-lg border border-border/70 bg-card p-2.5 text-xs transition-colors hover:border-border"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="min-w-0 break-words font-semibold text-foreground">
                        Step {step.stepNumber}
                        {step.targetLabel ? ` · ${step.targetLabel}` : ''}
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider',
                          toneChipClass(outcome.tone)
                        )}
                      >
                        <outcome.Icon className="h-2.5 w-2.5" aria-hidden="true" />
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
                      <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">
                        {step.error}
                      </p>
                    )}
                    {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </details>
    </section>
  );
}
