'use client';

import { useState } from 'react';
import {
  Check,
  Copy,
  Key,
  Terminal,
  Clock,
  AlertTriangle,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { ActionForm, SubmitButton } from '@/components/runbooks/RunbookControls';
import { RunbookStatusBadge } from '@/components/runbooks/RunbookStatusBadge';
import { formatDateTime } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import type {
  rotateExecutionSigningIdentityAction,
  updateRunbookArtifactRetentionAction,
} from '@/app/(app)/runbooks/actions';

export function ActiveKeyBox({
  publicKey,
  keyId: _keyId,
  activeSince,
}: {
  publicKey: string;
  keyId?: string;
  activeSince?: string;
}) {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);

  const handleCopyKey = async () => {
    try {
      await navigator.clipboard.writeText(publicKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  const handleCopyEnv = async () => {
    try {
      await navigator.clipboard.writeText(`OPSKNIGHT_EXECUTION_PUBLIC_KEY="${publicKey}"`);
      setCopiedEnv(true);
      setTimeout(() => setCopiedEnv(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  return (
    <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-muted/20 p-4 sm:p-5 space-y-3.5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400">
            <Key className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-foreground">Pinned execution public key</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                ACTIVE
              </span>
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground border border-border/60">
                ED25519
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Required on every Agent via{' '}
              <code className="font-mono text-foreground">OPSKNIGHT_EXECUTION_PUBLIC_KEY</code>
            </p>
            {activeSince && (
              <p className="text-[10px] text-muted-foreground mt-0.5">Active since {activeSince}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyKey}
            className="h-7 px-2.5 text-xs font-medium rounded-lg border-border/80 bg-background/80 hover:bg-accent gap-1.5 cursor-pointer shadow-2xs"
          >
            {copiedKey ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {copiedKey ? 'Copied Key' : 'Copy Key'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyEnv}
            className="h-7 px-2.5 text-xs font-medium rounded-lg border-border/80 bg-background/80 hover:bg-accent gap-1.5 cursor-pointer shadow-2xs"
          >
            {copiedEnv ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {copiedEnv ? 'Copied Env Var' : 'Copy Env Var'}
          </Button>
        </div>
      </div>

      <div className="relative group">
        <pre className="rounded-xl border border-border/80 dark:border-border/60 bg-background/90 dark:bg-zinc-950/80 p-3.5 font-mono text-xs text-foreground/90 break-all select-all whitespace-pre-wrap leading-relaxed shadow-2xs">
          {publicKey}
        </pre>
      </div>
    </div>
  );
}

export function MultiKeyMapBox({ keyMapJson, keyCount }: { keyMapJson: string; keyCount: number }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(keyMapJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  return (
    <div className="rounded-2xl border border-border/80 dark:border-border/60 bg-muted/20 p-4 sm:p-5 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-bold text-foreground">Fleet Verification Map</h4>
            <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {keyCount} {keyCount === 1 ? 'Key' : 'Keys'} Configured
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Provide as JSON to{' '}
            <code className="font-mono text-foreground">OPSKNIGHT_EXECUTION_PUBLIC_KEYS</code> on
            all hosts during rotation.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleCopy}
          className="h-7 px-2.5 text-xs font-medium rounded-lg border-border/80 bg-background/80 hover:bg-accent gap-1.5 cursor-pointer shadow-2xs self-start sm:self-auto"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {copied ? 'Copied JSON' : 'Copy Key Map'}
        </Button>
      </div>

      <pre className="rounded-xl border border-border/80 dark:border-border/60 bg-background/90 dark:bg-zinc-950/80 p-3.5 font-mono text-xs text-foreground/90 break-all select-all whitespace-pre-wrap leading-relaxed shadow-2xs max-h-36 overflow-y-auto scrollbar-none">
        {keyMapJson}
      </pre>
    </div>
  );
}

export function RotationStepper() {
  const steps = [
    {
      num: 1,
      title: 'Stage Next Identity',
      desc: 'Provision an ED25519 keypair in staged mode without dispatching traffic.',
    },
    {
      num: 2,
      title: 'Distribute Key Map',
      desc: 'Inject the dual-key map into all running and offline Agent daemons.',
    },
    {
      num: 3,
      title: 'Verify Handshake',
      desc: 'Confirm fleet heartbeats validate both current and staged identities.',
    },
    {
      num: 4,
      title: 'Promote & Grace',
      desc: 'Activate NEXT key; previous key enters a 24-hour grace period before retirement.',
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map(step => (
        <div
          key={step.num}
          className="flex flex-col justify-between rounded-xl border border-border/70 dark:border-border/50 bg-background/60 dark:bg-card/40 p-3.5 transition-colors hover:border-border"
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/20 text-[11px] font-bold text-primary tabular-nums">
                {step.num}
              </span>
              <h5 className="text-xs font-semibold text-foreground tracking-tight">{step.title}</h5>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">{step.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SigningKeyList({
  signingKeys,
  userTimeZone,
  rotateAction,
}: {
  signingKeys: Array<{
    id: string;
    publicKey: string;
    state: string;
    retiredAt: Date | null;
  }>;
  userTimeZone: string;
  rotateAction: typeof rotateExecutionSigningIdentityAction;
}) {
  const hasNext = signingKeys.some(k => k.state === 'NEXT');
  const nonActiveKeys = signingKeys.filter(k => k.state !== 'ACTIVE');

  return (
    <div className="space-y-3 pt-1">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold text-foreground">Active & Staged Keypairs</h4>
          <p className="text-[11px] text-muted-foreground">
            Identity lifecycle states across active dispatch and grace windows.
          </p>
        </div>

        <ActionForm action={rotateAction}>
          <input type="hidden" name="operation" value="stage" />
          <SubmitButton
            variant="outline"
            size="sm"
            disabled={hasNext}
            className="h-8 px-3 text-xs font-medium rounded-lg border-border/80 bg-background/80 hover:bg-accent gap-1.5 cursor-pointer shadow-2xs"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Stage next signing identity
          </SubmitButton>
        </ActionForm>
      </div>

      {nonActiveKeys.length > 0 && (
        <div className="space-y-2.5">
          {nonActiveKeys.map(key => (
            <ActionForm
              key={key.id}
              action={rotateAction}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/80 dark:border-border/60 bg-muted/20 p-3.5 transition-colors"
            >
              <input
                type="hidden"
                name="operation"
                value={key.state === 'NEXT' ? 'activate' : 'retire'}
              />
              <input type="hidden" name="keyId" value={key.id} />

              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <RunbookStatusBadge status={key.state} size="sm" />
                  <span className="font-mono text-xs text-foreground font-semibold break-all">
                    {key.id}
                  </span>
                </div>
                {key.state === 'RETIRING' && key.retiredAt && (
                  <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                    <Clock className="h-3 w-3" />
                    <span>
                      Grace period ends{' '}
                      {formatDateTime(key.retiredAt, userTimeZone, {
                        format: 'datetime',
                        includeTimeZone: true,
                      })}
                    </span>
                  </div>
                )}
                <div className="font-mono text-[11px] text-muted-foreground truncate max-w-md">
                  {key.publicKey}
                </div>
              </div>

              <div className="shrink-0 self-end sm:self-center">
                <SubmitButton
                  size="sm"
                  className={cn(
                    'h-8 px-3 text-xs font-semibold rounded-lg shadow-2xs cursor-pointer',
                    key.state === 'NEXT'
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100'
                  )}
                >
                  {key.state === 'NEXT' ? (
                    <>
                      <Check className="h-3.5 w-3.5 mr-1" />
                      Activate acknowledged identity
                    </>
                  ) : (
                    <>
                      <Clock className="h-3.5 w-3.5 mr-1" />
                      Retire After Grace Period
                    </>
                  )}
                </SubmitButton>
              </div>
            </ActionForm>
          ))}
        </div>
      )}
    </div>
  );
}

export function ArtifactRetentionForm({
  defaultDays,
  action,
}: {
  defaultDays: number;
  action: typeof updateRunbookArtifactRetentionAction;
}) {
  const [days, setDays] = useState(defaultDays);
  const [confirmed, setConfirmed] = useState(false);

  const presets = [
    { label: '30d (Standard)', value: 30 },
    { label: '60d', value: 60 },
    { label: '90d (Quarterly)', value: 90 },
    { label: '180d', value: 180 },
    { label: '365d (Annual)', value: 365 },
  ];

  return (
    <ActionForm action={action} className="flex flex-col justify-between h-full space-y-4">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="artifact-days" className="text-xs font-semibold text-foreground">
              Artifact Retention Window
            </Label>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {days >= 365
                ? `≈ ${(days / 365).toFixed(1)} years`
                : days >= 30
                  ? `≈ ${(days / 30).toFixed(1)} months`
                  : `${days} days`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                id="artifact-days"
                name="days"
                type="number"
                min={1}
                max={3650}
                required
                value={days}
                onChange={e => setDays(Number(e.target.value))}
                className="h-9 font-semibold tabular-nums pr-12 text-xs rounded-xl border-border/80 bg-background/80"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground pointer-events-none">
                days
              </span>
            </div>
          </div>

          {/* Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {presets.map(p => (
              <button
                key={p.value}
                type="button"
                onClick={() => setDays(p.value)}
                className={cn(
                  'rounded-lg px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer border',
                  days === p.value
                    ? 'border-primary/40 bg-primary/10 text-primary font-semibold'
                    : 'border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Informative Warning Callout */}
        <div className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/[0.04] p-3 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1 leading-relaxed text-[11px]">
            <p className="font-semibold text-destructive">
              Reconciliation permanently deletes step output blobs
            </p>
            <p className="text-muted-foreground">
              Evidence artifacts older than {days} days will be unrecoverably erased. High-level
              execution logs and audit records are preserved.
            </p>
          </div>
        </div>

        {/* Confirmation Checkbox */}
        <label className="flex items-start gap-2.5 text-xs text-foreground cursor-pointer rounded-xl border border-border/60 bg-muted/20 p-3 hover:bg-muted/30 transition-colors">
          <input
            type="checkbox"
            name="confirm"
            required
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-destructive rounded cursor-pointer"
          />
          <span className="leading-snug select-none text-[11px] text-muted-foreground">
            I confirm that evidence older than{' '}
            <strong className="text-foreground">{days} days</strong> will be permanently destroyed
            on next reconciliation.
          </span>
        </label>
      </div>

      <div className="pt-2">
        <SubmitButton
          variant="destructive"
          disabled={!confirmed}
          className="w-full h-9 text-xs font-semibold rounded-xl shadow-xs cursor-pointer"
        >
          <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
          Save Artifact Retention Policy
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
