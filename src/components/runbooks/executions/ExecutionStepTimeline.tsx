import { AlertTriangle, ChevronRight, ShieldAlert, ShieldCheck } from 'lucide-react';
import { ConfirmAction } from '@/components/runbooks/RunbookControls';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import { Pill, TONE_SURFACE, type Tone } from '@/components/runbooks/ui/primitives';
import { approveExecutionStepAction } from '@/app/(app)/runbooks/executions/actions';
import ExecutionTroubleshooting from './ExecutionTroubleshooting';
import { ExecutionOutputViewer } from './ExecutionOutputViewer';
import { StepStatusIcon, stepTone } from './StepStatusIcon';
import { cn } from '@/lib/utils';

export { StepStatusIcon };

export type TimelineAttempt = {
  id: string;
  attemptNumber: number;
  status: string;
  exitCode: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  target: string;
  claimedBy: string;
  queuedAt: string;
  claimedAt: string;
  startedAt: string;
  completedAt: string;
  leaseExpiresAt: string;
  planDigest: string | null;
  outputPreview: string | null;
  outputArtifactId: string | null;
  evidence: string;
  artifactCount: number;
  artifacts: Array<{
    id: string;
    kind: string;
    sizeBytes: number;
    sha256: string;
    truncated: boolean;
  }>;
};

export type TimelineStep = {
  id: string;
  name: string;
  stepKey: string;
  type: string;
  riskClass: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  duration: string;
  attemptCount: number;
  maxRetries: number;
  errorCode: string | null;
  errorMessage: string | null;
  outputPreview: string | null;
  outputArtifactId: string | null;
  verification: string;
  requiresApproval: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  approvedPlanDigest: string | null;
  pendingApproval: { digest: string; plan: Array<[string, string]>; timeoutSeconds: number } | null;
  attempts: TimelineAttempt[];
};

export type ExecutionStepTimelineProps = {
  executionId: string;
  runbookName: string;
  steps: TimelineStep[];
  canApprove: boolean;
  targetLabel: string;
  versionLabel: string;
};

export const RISK_TONE: Record<string, Tone> = {
  READ_ONLY: 'success',
  IDEMPOTENT_WRITE: 'warning',
  NON_IDEMPOTENT: 'danger',
};

const NODE_RING: Record<ReturnType<typeof stepTone>, string> = {
  success: 'ring-emerald-500/30',
  danger: 'ring-rose-500/40',
  info: 'ring-blue-500/40',
  warning: 'ring-amber-500/40',
  neutral: 'ring-border',
};

function AttemptDetails({ attempt }: { attempt: TimelineAttempt }) {
  return (
    <details className="group rounded-xl border border-border/70 dark:border-border/60 bg-card/60 text-xs">
      <summary className="flex min-h-9 cursor-pointer list-none flex-wrap items-center gap-2 rounded-xl px-3.5 py-2 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden
        />
        <span className="font-medium">Attempt #{attempt.attemptNumber}</span>
        <RunbookStatusBadge status={attempt.status} size="sm" />
        {attempt.exitCode !== null && (
          <span className="font-mono text-muted-foreground">exit {attempt.exitCode}</span>
        )}
        <span className="text-muted-foreground">· {attempt.claimedBy}</span>
      </summary>
      <div className="space-y-3 border-t border-border/60 p-3.5 text-muted-foreground">
        <ExecutionTroubleshooting status={attempt.status} code={attempt.errorCode} />
        {(attempt.errorCode || attempt.errorMessage) && (
          <p className="break-words font-medium text-destructive">
            {attempt.errorCode}
            {attempt.errorCode && attempt.errorMessage ? ': ' : ''}
            {attempt.errorMessage}
          </p>
        )}
        <dl className="grid gap-x-4 gap-y-1 tabular-nums sm:grid-cols-[9rem_1fr]">
          <dt>Target</dt>
          <dd className="text-foreground">{attempt.target}</dd>
          <dt>Claimed by</dt>
          <dd className="text-foreground">{attempt.claimedBy}</dd>
          <dt>Queued</dt>
          <dd>{attempt.queuedAt}</dd>
          <dt>Claimed</dt>
          <dd>{attempt.claimedAt}</dd>
          <dt>Started</dt>
          <dd>{attempt.startedAt}</dd>
          <dt>Completed</dt>
          <dd>{attempt.completedAt}</dd>
          <dt>Lease expires</dt>
          <dd>{attempt.leaseExpiresAt}</dd>
          <dt>Exit code</dt>
          <dd className="font-mono">{attempt.exitCode ?? 'Not reported'}</dd>
          <dt>Plan digest</dt>
          <dd className="break-all font-mono">{attempt.planDigest ?? 'Not recorded'}</dd>
        </dl>
        {attempt.outputPreview && (
          <ExecutionOutputViewer
            label={`Attempt ${attempt.attemptNumber} output`}
            output={attempt.outputPreview}
            artifactId={attempt.outputArtifactId}
          />
        )}
        <details>
          <summary className="cursor-pointer">Verification evidence: before / after</summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono">
            {attempt.evidence}
          </pre>
        </details>
        <p>
          Artifacts: {attempt.artifactCount}
          {attempt.artifactCount > attempt.artifacts.length
            ? ` (latest ${attempt.artifacts.length})`
            : ''}
        </p>
        {attempt.artifacts.length > 0 && (
          <ul className="space-y-1">
            {attempt.artifacts.map(artifact => (
              <li key={artifact.id} className="break-all">
                <a
                  className="text-primary hover:underline"
                  href={`/api/runbook-artifacts/${encodeURIComponent(artifact.id)}`}
                >
                  {artifact.kind}
                </a>{' '}
                · {artifact.sizeBytes} bytes{artifact.truncated ? ' · Truncated' : ''} · SHA256{' '}
                <span className="font-mono">{artifact.sha256}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export function ExecutionStepTimeline({
  executionId,
  runbookName,
  steps,
  canApprove,
  targetLabel,
  versionLabel,
}: ExecutionStepTimelineProps) {
  if (steps.length === 0)
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-xs text-muted-foreground">
        This execution has no steps.
      </p>
    );
  return (
    <ol aria-label={`${runbookName} execution timeline`} className="relative">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        const tone = stepTone(step.status);
        const failed = tone === 'danger';
        const hasError = Boolean(step.errorCode || step.errorMessage);
        const detailCount =
          (step.outputPreview || step.outputArtifactId ? 1 : 0) + 1 + step.attempts.length;
        return (
          <li
            key={step.id}
            id={`step-${step.id}`}
            className={cn('relative scroll-mt-48', !last && 'pb-6')}
          >
            {!last && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-[17px] top-[50px] -bottom-0 w-0.5 rounded-full',
                  tone === 'success' ? 'bg-emerald-500/50' : 'bg-border/70 dark:bg-border/50'
                )}
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-0 top-3.5 flex h-9 w-9 items-center justify-center rounded-full ring-4 ring-background shadow-xs z-10 transition-colors',
                TONE_SURFACE[tone],
                NODE_RING[tone]
              )}
            >
              <StepStatusIcon status={step.status} />
            </span>
            <article
              aria-label={`Step ${index + 1}: ${step.name}`}
              className={cn(
                'ml-12 rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs hover:border-border hover:shadow-md transition-all duration-200 overflow-hidden',
                failed && 'border-rose-500/40 bg-rose-500/[0.02]',
                step.pendingApproval && 'border-amber-500/50 bg-amber-500/[0.02]'
              )}
            >
              <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border/50 px-5 py-3.5 bg-muted/20">
                <div className="min-w-0 space-y-1">
                  <p className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 text-xs font-bold text-muted-foreground uppercase tracking-wider tabular-nums">
                      Step {index + 1}
                    </span>
                    <span
                      className="truncate text-sm font-bold text-foreground"
                      title={`${step.name} · ${step.stepKey}`}
                    >
                      {step.name}
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Pill>{step.type.replaceAll('_', ' ')}</Pill>
                    <Pill tone={RISK_TONE[step.riskClass] ?? 'neutral'}>
                      {step.riskClass.replaceAll('_', ' ')}
                    </Pill>
                    {step.requiresApproval && (
                      <Pill
                        tone={step.approvedAt ? 'success' : 'warning'}
                        icon={step.approvedAt ? ShieldCheck : ShieldAlert}
                      >
                        {step.approvedAt ? 'Approved' : 'Approval gate'}
                      </Pill>
                    )}
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {step.stepKey}
                    </span>
                  </div>
                </div>
                <RunbookStatusBadge status={step.status} size="sm" />
              </header>
              <div className="space-y-3.5 p-5">
                <p className="text-xs text-muted-foreground tabular-nums">
                  {step.startedAt ? `Started ${step.startedAt}` : 'Not started'}
                  {step.completedAt ? ` · Completed ${step.completedAt}` : ''} · Duration{' '}
                  {step.duration} · Attempts {step.attemptCount}
                  {step.maxRetries > 0 ? ` (retry limit ${step.maxRetries})` : ''}
                </p>
                {hasError && (
                  <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs">
                    <AlertTriangle
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400"
                      aria-hidden
                    />
                    <p className="min-w-0 break-words text-rose-700 dark:text-rose-300">
                      {step.errorCode && (
                        <span className="font-mono font-semibold">{step.errorCode}</span>
                      )}
                      {step.errorCode && step.errorMessage ? ': ' : ''}
                      {step.errorMessage}
                    </p>
                  </div>
                )}
                <ExecutionTroubleshooting status={step.status} code={step.errorCode} />
                {step.requiresApproval && !step.pendingApproval && (
                  <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    {step.approvedAt
                      ? `Approved by ${step.approvedBy ?? 'Actor no longer available'} · ${step.approvedAt}`
                      : 'Approval required · not approved'}
                    {step.approvedPlanDigest && (
                      <span className="break-all font-mono" title="Approved plan digest">
                        · {step.approvedPlanDigest.slice(0, 16)}…
                      </span>
                    )}
                  </p>
                )}
                {step.pendingApproval && (
                  <section
                    aria-label={`Approval needed for ${step.name}`}
                    className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-4"
                  >
                    <div className="flex items-start gap-2.5">
                      <ShieldAlert
                        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                        aria-hidden
                      />
                      <div>
                        <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                          Needs your approval
                        </p>
                        <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-200/80">
                          This step is paused until a responder authorizes the exact plan below.
                        </p>
                      </div>
                    </div>
                    <dl className="grid gap-x-4 gap-y-1.5 rounded-md border bg-background/80 p-3 text-xs sm:grid-cols-[8rem_1fr]">
                      <dt className="text-muted-foreground">Action</dt>
                      <dd>{step.type.replaceAll('_', ' ')}</dd>
                      {step.pendingApproval.plan.map(([label, value]) => (
                        <div key={label} className="contents">
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="break-all font-mono">{value}</dd>
                        </div>
                      ))}
                      <dt className="text-muted-foreground">Execution target</dt>
                      <dd>{targetLabel}</dd>
                      <dt className="text-muted-foreground">Version</dt>
                      <dd>{versionLabel}</dd>
                      <dt className="text-muted-foreground">Timeout</dt>
                      <dd className="tabular-nums">{step.pendingApproval.timeoutSeconds}s</dd>
                      <dt className="text-muted-foreground">Plan digest</dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {step.pendingApproval.digest}
                      </dd>
                    </dl>
                    {canApprove ? (
                      <ConfirmAction
                        action={approveExecutionStepAction.bind(
                          null,
                          executionId,
                          step.id,
                          step.pendingApproval.digest
                        )}
                        title={`Approve ${step.name}?`}
                        description={`Authorize the exact displayed plan for ${targetLabel}. Risk: ${step.riskClass.replaceAll('_', ' ')}. The action may change the target; inspect its resolved parameters before approving.`}
                        label="Approve exact plan"
                        variant="default"
                        successMessage="Step approved"
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        A user with runbook approval permission must approve this step.
                      </p>
                    )}
                  </section>
                )}
                <details className="group/details" open={failed || Boolean(step.pendingApproval)}>
                  <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      className="h-3.5 w-3.5 transition-transform group-open/details:rotate-90"
                      aria-hidden
                    />
                    Output and evidence
                    <span className="rounded bg-muted px-1 text-[10px] tabular-nums">
                      {detailCount}
                    </span>
                  </summary>
                  <div className="mt-3 space-y-3">
                    {step.outputPreview && (
                      <ExecutionOutputViewer
                        label="Step output"
                        output={step.outputPreview}
                        artifactId={step.outputArtifactId}
                        truncatedHint
                      />
                    )}
                    {!step.outputPreview && step.outputArtifactId && (
                      <a
                        className="text-xs font-medium text-primary hover:underline"
                        href={`/api/runbook-artifacts/${encodeURIComponent(step.outputArtifactId)}`}
                      >
                        Download full output
                      </a>
                    )}
                    <div className="space-y-1.5 text-xs">
                      <p className="font-medium text-muted-foreground">Verification result</p>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-mono">
                        {step.verification}
                      </pre>
                    </div>
                    {step.attempts.length > 0 && (
                      <div className="space-y-1.5">
                        {step.attemptCount > step.attempts.length && (
                          <p className="text-xs text-muted-foreground">
                            Showing latest {step.attempts.length} of {step.attemptCount} attempts.
                          </p>
                        )}
                        {step.attempts.map(attempt => (
                          <AttemptDetails key={attempt.id} attempt={attempt} />
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              </div>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
