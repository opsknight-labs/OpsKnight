import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type {
  EscalationExecutionHealth as Health,
  EscalationStepOutcome,
} from '@/lib/escalation/execution-health';

const OUTCOME_LABEL: Record<EscalationStepOutcome, string> = {
  COMPLETED: 'Executed',
  SCHEDULED: 'Scheduled',
  RUNNING: 'Running',
  FAILED: 'Failed',
  UNCERTAIN: 'Outcome uncertain',
};

const OUTCOME_STYLE: Record<EscalationStepOutcome, string> = {
  COMPLETED: 'text-emerald-700 dark:text-emerald-300',
  SCHEDULED: 'text-muted-foreground',
  RUNNING: 'text-muted-foreground',
  FAILED: 'font-semibold text-red-700 dark:text-red-300',
  UNCERTAIN: 'font-semibold text-amber-700 dark:text-amber-300',
};

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
      aria-label="Escalation execution health"
      className="rounded-xl border border-border bg-card text-card-foreground shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        {health.needsAttention ? (
          <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        )}
        <h3 className="text-sm font-bold">Escalation Execution Health</h3>
      </div>
      <div className="space-y-3 p-4">
        {health.needsAttention && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          >
            {health.incidentEscalationStatus === 'FAILED'
              ? 'Escalation for this incident has failed. No further steps will run automatically.'
              : 'One or more escalation steps need operator review. A step that failed is not retried automatically, because a retry could page responders twice.'}
          </p>
        )}
        <ol className="space-y-2">
          {health.steps.map(step => (
            <li key={step.stepIndex} className="rounded-lg border border-border/70 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold">
                  Step {step.stepNumber}
                  {step.targetLabel ? ` · ${step.targetLabel}` : ''}
                </span>
                <span className={OUTCOME_STYLE[step.outcome]}>
                  {step.outcome === 'SCHEDULED' || step.outcome === 'RUNNING' ? (
                    <Clock className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  ) : null}
                  {OUTCOME_LABEL[step.outcome]}
                </span>
              </div>
              {step.maxAttempts > 0 && step.outcome !== 'COMPLETED' && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Attempts {step.attempts} of {step.maxAttempts}
                  {step.failedAt ? ` · failed ${step.failedAt}` : ''}
                </p>
              )}
              {step.error && <p className="mt-1 text-[11px] text-muted-foreground">{step.error}</p>}
              {explanation(step) && <p className="mt-1 text-xs">{explanation(step)}</p>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
