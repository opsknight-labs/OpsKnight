'use client';

import { useActionState, useState } from 'react';
import { Activity, Check, Copy, KeyRound, Loader2 } from 'lucide-react';
import {
  revokeAgentAction,
  createAgentEnrollmentAction,
  type AgentEnrollmentState,
} from '@/app/(app)/runbooks/actions';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import AgentSetupInstructions from './AgentSetupInstructions';
import { ConfirmAction } from './RunbookControls';
import type { AgentDistribution } from '@/lib/runbooks/distribution-contract';
import { formatDateTime } from '@/lib/timezone';

const initialState: AgentEnrollmentState = {};

const STEPS = ['Create token', 'Install', 'Verify heartbeat'] as const;

function Stepper({ current }: { current: number }) {
  return (
    <ol aria-label="Enrollment progress" className="flex items-center gap-2">
      {STEPS.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ring-1 ring-inset',
                done && 'bg-primary text-primary-foreground ring-primary',
                active && 'bg-primary/10 text-primary ring-primary/40',
                !done && !active && 'bg-muted text-muted-foreground ring-border'
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
            </span>
            <span
              className={cn(
                'truncate text-xs font-medium',
                active || done ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {label}
            </span>
            {index < STEPS.length - 1 && (
              <span aria-hidden="true" className="hidden h-px flex-1 bg-border sm:block" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function CopyTokenButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-8 shrink-0 gap-1.5 bg-background text-xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(token);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2_000);
        } catch {
          setCopied(false);
        }
      }}
      aria-label={copied ? 'Enrollment token copied' : 'Copy enrollment token'}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {copied ? 'Copied' : 'Copy token'}
    </Button>
  );
}

export default function AgentEnrollmentForm({
  userTimeZone,
  appUrl,
  distribution,
}: {
  userTimeZone: string;
  appUrl?: string;
  distribution?: AgentDistribution | null;
}) {
  const [state, action, pending] = useActionState(createAgentEnrollmentAction, initialState);
  const [cancelledAgentId, setCancelledAgentId] = useState<string>();
  const issued = Boolean(state.token && state.agentId !== cancelledAgentId);
  return (
    <div className="space-y-6">
      <Stepper current={issued ? 1 : 0} />
      <section aria-labelledby="enroll-step-token" className="space-y-4">
        <div>
          <h3 id="enroll-step-token" className="text-sm font-semibold">
            1. Create an enrollment token
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Name the Agent after the host or role it serves. The hostname hint is optional.
          </p>
        </div>
        <form action={action} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="agent-name" className="text-xs">
              Agent name
            </Label>
            <Input id="agent-name" name="name" required placeholder="prod-payments-01" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-hostname" className="text-xs">
              Hostname hint (optional)
            </Label>
            <Input id="agent-hostname" name="hostname" placeholder="payments-01.internal" />
          </div>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {pending ? 'Creating…' : 'Create enrollment'}
          </Button>
        </form>
        {state.error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {state.error}
          </p>
        )}
        {cancelledAgentId === state.agentId && cancelledAgentId && (
          <p
            role="status"
            className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
          >
            Enrollment revoked. Create a new enrollment before installing.
          </p>
        )}
      </section>
      {issued && state.token && (
        <>
          <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2 text-amber-900 dark:text-amber-100">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p className="font-semibold">Copy this one-time token now</p>
              </div>
              <CopyTokenButton token={state.token} />
            </div>
            <code className="block break-all rounded-lg border bg-background p-3 font-mono text-xs select-all">
              {state.token}
            </code>
            <p className="text-xs text-muted-foreground">
              Agent ID: <span className="font-mono">{state.agentId}</span>. Expires at{' '}
              {formatDateTime(state.expiresAt!, userTimeZone, { format: 'datetime' })}. The token
              cannot be displayed again.
            </p>
            <div className="flex justify-end border-t border-amber-500/20 pt-3">
              <ConfirmAction
                action={async () => {
                  await revokeAgentAction(state.agentId!);
                  setCancelledAgentId(state.agentId);
                }}
                label="Cancel this enrollment"
                title="Revoke this Agent enrollment?"
                description="This token and Agent identity can no longer enroll or authenticate. Create a new enrollment to install another Agent."
              />
            </div>
          </div>
          <section aria-labelledby="enroll-step-install" className="space-y-3">
            <h3 id="enroll-step-install" className="text-sm font-semibold">
              2. Install the Agent
            </h3>
            <AgentSetupInstructions
              agentId={state.agentId!}
              token={state.token}
              executionPublicKey={state.executionPublicKey!}
              appUrl={appUrl}
              distribution={distribution}
              expiresAt={state.expiresAt}
            />
          </section>
          <section
            aria-labelledby="enroll-step-verify"
            className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4"
          >
            <Activity className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="space-y-1">
              <h3 id="enroll-step-verify" className="text-sm font-semibold">
                3. Verify the first heartbeat
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Once the Agent starts, it authenticates outbound and appears in the fleet as Online
                within about a minute. Inspect it there to confirm runtime capabilities and policy.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
