'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Eye,
  Info,
  Loader2,
  Lock,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import { ActionForm, SubmitButton, type RunbookFormAction } from './RunbookControls';
import { Pill, type Tone } from './ui/primitives';
import type { ExecutionPreview } from '@/lib/runbooks/execution-preview';

const RISK_TONE: Record<string, Tone> = {
  READ_ONLY: 'success',
  IDEMPOTENT_WRITE: 'warning',
  NON_IDEMPOTENT: 'danger',
};

const READINESS_ICON = {
  passed: {
    icon: CheckCircle2,
    className: 'text-emerald-600 dark:text-emerald-400',
    label: 'Passed',
  },
  deferred: {
    icon: AlertTriangle,
    className: 'text-amber-600 dark:text-amber-400',
    label: 'Checked at dispatch',
  },
  blocked: { icon: XCircle, className: 'text-rose-600 dark:text-rose-400', label: 'Blocked' },
} as const;

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function InputValue({ value }: { value: unknown }) {
  if (value === '[REDACTED]')
    return (
      <span className="inline-flex items-center gap-1 font-mono text-muted-foreground">
        <Lock className="h-3 w-3" aria-hidden />
        <span aria-label="Secret value hidden">••••••</span>
      </span>
    );
  if (value === null || value === undefined || value === '')
    return <span className="text-muted-foreground">Not set</span>;
  return (
    <span className="break-all font-mono">
      {typeof value === 'string' ? value : JSON.stringify(value)}
    </span>
  );
}

function PlanRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 px-4 py-2.5 sm:px-5 sm:py-3 border-b border-border/40 last:border-b-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="min-w-0 text-xs">{children}</div>
    </div>
  );
}

export default function RunbookExecutionPreview({
  previewAction,
  executeAction,
  disabled = false,
  previewLabel = 'Preview execution',
  executeLabel = 'Execute this plan',
  headerContent,
  className,
}: {
  disabled?: boolean;
  previewAction: () => Promise<{ preview?: ExecutionPreview; error?: string }>;
  executeAction: RunbookFormAction;
  previewLabel?: string;
  executeLabel?: string;
  headerContent?: ReactNode;
  className?: string;
}) {
  const [preview, setPreview] = useState<ExecutionPreview>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [expired, setExpired] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!preview?.expiresAt) return;
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.max(0, Date.parse(preview.expiresAt) - Date.now())
    );
    return () => window.clearTimeout(timer);
  }, [preview]);
  useEffect(() => {
    if (!preview?.expiresAt || expired) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [preview, expired]);
  const remainingMs = preview?.expiresAt ? Date.parse(preview.expiresAt) - now : null;
  const hasWrites = preview?.steps.some(step => step.risk !== 'READ_ONLY') ?? false;
  const blocked = preview?.readiness?.some(check => check.state === 'blocked') ?? false;
  const inputEntries = preview ? Object.entries(preview.inputs) : [];

  const previewButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || pending}
      aria-busy={pending}
      className="h-8 gap-1.5 text-xs font-medium border-border/80 hover:bg-muted/60 shrink-0 shadow-2xs"
      onClick={async () => {
        setPending(true);
        setError('');
        setExpired(false);
        setPreview(undefined);
        setConfirmed(false);
        try {
          const result = await previewAction();
          setPreview(result.preview);
          setNow(Date.now());
          setError(result.error ?? '');
        } catch {
          setError('Could not load preview. Try again.');
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <Eye className="h-3.5 w-3.5" aria-hidden />
      )}
      {pending ? 'Resolving plan…' : previewLabel}
    </Button>
  );

  return (
    <div className={cn('w-full min-w-0 space-y-2.5', className)}>
      {headerContent ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {headerContent}
          <div className="shrink-0 pl-9.5 sm:pl-0 flex items-center gap-2">{previewButton}</div>
        </div>
      ) : (
        previewButton
      )}
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-700 dark:text-rose-300"
        >
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      )}
      {preview && (
        <section
          aria-label="Execution preview"
          className="overflow-hidden rounded-xl border border-border/80 dark:border-border/60 bg-background/80 dark:bg-background/40 backdrop-blur-xs text-sm shadow-xs mt-2"
        >
          <header className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border/60 bg-muted/30 px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-foreground">Review Execution Plan</p>
                <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] font-medium text-foreground">
                  v{preview.version}
                </span>
              </div>
              <p
                className="mt-0.5 text-[11px] text-muted-foreground truncate"
                title={preview.checksum}
              >
                Checksum: <span className="font-mono">{preview.checksum.slice(0, 10)}</span>
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {remainingMs !== null && !expired && (
                <Pill
                  tone={remainingMs < 60_000 ? 'warning' : 'neutral'}
                  icon={Clock}
                  className="tabular-nums text-[11px] py-0.5"
                >
                  <span role="timer">{formatCountdown(remainingMs)}</span>
                </Pill>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground rounded-lg"
                onClick={() => setPreview(undefined)}
                title="Close preview"
              >
                <X className="h-3.5 w-3.5" />
                <span className="sr-only">Close preview</span>
              </Button>
            </div>
          </header>

          <div className="divide-y divide-border/40">
            <PlanRow label="Target">
              <p className="flex items-center gap-1.5 font-medium">
                <Cpu className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                <span className="break-all">
                  {preview.agentId ?? preview.agentPoolId ?? 'Control plane'}
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                Overall deadline: {preview.timeoutSeconds}s
              </p>
            </PlanRow>

            <PlanRow label="Inputs">
              {inputEntries.length === 0 ? (
                <span className="text-muted-foreground">No inputs</span>
              ) : (
                <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,auto)_minmax(0,1fr)]">
                  {inputEntries.map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="truncate text-muted-foreground" title={key}>
                        {key}
                      </dt>
                      <dd className="min-w-0">
                        <InputValue value={value} />
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">Secrets are never shown.</p>
            </PlanRow>

            {preview.readiness && preview.readiness.length > 0 && (
              <PlanRow label="Readiness">
                <ul className="space-y-1.5">
                  {preview.readiness.map(check => {
                    const style = READINESS_ICON[check.state];
                    const Icon = style.icon;
                    return (
                      <li
                        key={check.message}
                        className="flex items-start gap-2 rounded-lg border border-border/50 bg-background/50 px-2.5 py-1.5 text-xs"
                      >
                        <Icon
                          className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', style.className)}
                          aria-hidden
                        />
                        <span
                          className={cn(
                            'min-w-0 break-words',
                            check.state === 'blocked'
                              ? 'text-rose-700 dark:text-rose-300 font-medium'
                              : 'text-foreground'
                          )}
                        >
                          <span className="sr-only">{style.label}: </span>
                          {check.message}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </PlanRow>
            )}

            <PlanRow label={`Steps (${preview.steps.length})`}>
              <ol className="space-y-2">
                {preview.steps.map((step, index) => (
                  <li
                    key={step.key}
                    className="rounded-xl border border-border/70 dark:border-border/60 bg-muted/30 dark:bg-muted/15 p-3 shadow-2xs space-y-1.5"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold tabular-nums">
                        {index + 1}
                      </span>
                      <span className="min-w-0 font-semibold text-xs text-foreground truncate max-w-[160px] sm:max-w-none">
                        {step.name}
                      </span>
                      <Pill tone="neutral" className="text-[10px] py-0 px-1.5">
                        {step.type.replaceAll('_', ' ')}
                      </Pill>
                      <Pill
                        tone={RISK_TONE[step.risk] ?? 'neutral'}
                        className="text-[10px] py-0 px-1.5"
                      >
                        {step.risk.replaceAll('_', ' ')}
                      </Pill>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{step.purpose}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {step.requiresApproval ? (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300">
                          <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden />
                          Human approval required
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No approval gate</span>
                      )}
                      <span className="text-muted-foreground tabular-nums">
                        · Timeout: {step.timeoutSeconds}s
                      </span>
                    </p>
                    <details className="group mt-1">
                      <summary className="flex h-6 w-fit cursor-pointer list-none items-center gap-1 rounded text-[11px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                        <ChevronRight
                          className="h-3 w-3 transition-transform group-open:rotate-90"
                          aria-hidden
                        />
                        Action details
                      </summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/60 bg-background/80 p-2 font-mono text-[11px]">
                        {JSON.stringify(step.config, null, 2)}
                      </pre>
                    </details>
                    {step.prerequisite && (
                      <p className="text-[11px] text-muted-foreground">{step.prerequisite}</p>
                    )}
                  </li>
                ))}
              </ol>
            </PlanRow>
          </div>

          <footer className="space-y-2.5 border-t border-border/60 bg-muted/20 px-4 py-3 sm:px-5">
            <details className="group text-xs text-muted-foreground">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md text-[11px] font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <Info className="h-3.5 w-3.5" aria-hidden />
                How preview protects this run
                <ChevronRight
                  className="h-3.5 w-3.5 transition-transform group-open:rotate-90"
                  aria-hidden
                />
              </summary>
              <div className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                <p>
                  Preview resolves configuration without executing actions. Local policy, secret
                  access and live availability are checked at dispatch. Execution rejects changes to
                  this plan before starting.
                </p>
                <p>This preview expires after five minutes.</p>
              </div>
            </details>
            {hasWrites && (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs leading-relaxed text-amber-900 dark:text-amber-100">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-amber-600 rounded"
                  checked={confirmed}
                  onChange={event => setConfirmed(event.target.checked)}
                />
                <span className="text-[11px]">
                  I reviewed the target and authorize the planned writes. Step approvals and Agent
                  policy still apply.
                </span>
              </label>
            )}
            {expired && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5 text-xs text-rose-700 dark:text-rose-300"
              >
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>This preview expired. Preview again before executing.</span>
              </p>
            )}
            {blocked && !expired && (
              <p className="text-xs text-rose-700 dark:text-rose-300">
                Resolve the blocked readiness checks above, then preview again.
              </p>
            )}
            <ActionForm action={executeAction} onSuccess={() => setPreview(undefined)}>
              <input type="hidden" name="previewDigest" value={preview.digest} />
              <input
                type="hidden"
                name="previewAuthorizationToken"
                value={preview.authorizationToken ?? ''}
              />
              <SubmitButton
                variant="default"
                size="sm"
                className="w-full h-8.5 rounded-lg text-xs font-semibold shadow-xs"
                pendingLabel="Starting…"
                disabled={disabled || expired || blocked || (hasWrites && !confirmed)}
              >
                {executeLabel}
              </SubmitButton>
            </ActionForm>
          </footer>
        </section>
      )}
    </div>
  );
}
