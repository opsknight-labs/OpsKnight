'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { ActionForm, SubmitButton, type RunbookFormAction } from './RunbookControls';
import type { ExecutionPreview } from '@/lib/runbooks/execution-preview';

export default function RunbookExecutionPreview({
  previewAction,
  executeAction,
  disabled = false,
  previewLabel = 'Preview execution',
  executeLabel = 'Execute this plan',
}: {
  disabled?: boolean;
  previewAction: () => Promise<{ preview?: ExecutionPreview; error?: string }>;
  executeAction: RunbookFormAction;
  previewLabel?: string;
  executeLabel?: string;
}) {
  const [preview, setPreview] = useState<ExecutionPreview>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!preview?.expiresAt) return;
    const timer = window.setTimeout(
      () => setExpired(true),
      Math.max(0, Date.parse(preview.expiresAt) - Date.now())
    );
    return () => window.clearTimeout(timer);
  }, [preview]);
  return (
    <div className="w-full min-w-0 space-y-3">
      <Button
        type="button"
        variant="outline"
        disabled={disabled || pending}
        aria-busy={pending}
        onClick={async () => {
          setPending(true);
          setError('');
          setExpired(false);
          setPreview(undefined);
          setConfirmed(false);
          try {
            const result = await previewAction();
            setPreview(result.preview);
            setError(result.error ?? '');
          } catch {
            setError('Could not load preview. Try again.');
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? 'Resolving plan…' : previewLabel}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {preview && (
        <section aria-label="Execution preview" className="space-y-3 rounded-lg border p-3 text-sm">
          <p className="font-semibold">Published version {preview.version}</p>
          <p className="break-all text-xs text-muted-foreground">Checksum: {preview.checksum}</p>
          <p className="break-all">
            Target: {preview.agentId ?? preview.agentPoolId ?? 'Control plane'} · Overall deadline:{' '}
            {preview.timeoutSeconds}s
          </p>
          <ul className="space-y-1">
            {preview.readiness?.map(check => (
              <li
                key={check.message}
                className={check.state === 'blocked' ? 'text-destructive' : 'text-muted-foreground'}
              >
                {check.state}: {check.message}
              </li>
            ))}
          </ul>
          <details>
            <summary className="min-h-11 cursor-pointer py-3">
              Resolved inputs (secrets redacted)
            </summary>
            <pre className="whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(preview.inputs, null, 2)}
            </pre>
          </details>
          <ol className="space-y-2 list-decimal pl-5">
            {preview.steps.map(step => (
              <li key={step.key}>
                <p>
                  {step.name} · {step.type} · {step.risk.replaceAll('_', ' ')}
                </p>
                <p className="text-xs">{step.purpose}</p>
                <p className="text-xs">
                  {step.requiresApproval ? 'Human approval required' : 'No approval gate'} · Step
                  timeout: {step.timeoutSeconds}s
                </p>
                <details>
                  <summary className="min-h-11 cursor-pointer py-3">Action and target</summary>
                  <pre className="whitespace-pre-wrap break-all text-xs">
                    {JSON.stringify(step.config, null, 2)}
                  </pre>
                </details>
                <p className="text-xs text-muted-foreground">{step.prerequisite}</p>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            Preview resolves configuration without executing actions. Local policy, secret access
            and live availability are checked at dispatch. Execution rejects changes to this plan or
            incident context before starting. Conditions continue to evaluate live context after
            execution starts.
          </p>
          <p className="text-xs text-muted-foreground">
            This preview can be used once and expires after five minutes. Preview again if it
            expires.
          </p>
          {preview.steps.some(step => step.risk !== 'READ_ONLY') && (
            <label className="flex min-h-11 items-start gap-2 py-2">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={event => setConfirmed(event.target.checked)}
              />
              <span>
                I reviewed the target and authorize the planned writes. Step approvals and Agent
                policy still apply.
              </span>
            </label>
          )}
          {expired && (
            <p role="alert" className="text-destructive">
              This preview expired. Preview again before executing.
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
              pendingLabel="Starting…"
              disabled={
                disabled ||
                expired ||
                preview.readiness?.some(check => check.state === 'blocked') ||
                (preview.steps.some(step => step.risk !== 'READ_ONLY') && !confirmed)
              }
            >
              {executeLabel}
            </SubmitButton>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
