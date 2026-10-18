'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RotateCw, Workflow } from 'lucide-react';
import {
  saveAutomationSettings,
  type SaveAutomationSettingsResult,
} from '@/app/(app)/settings/system/automation-actions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
import { cn } from '@/lib/utils';

type Settings = {
  automationEnabled: boolean;
  automationReadinessPolicy?: AutomationReadinessPolicy;
  automationReadinessPolicyValid?: boolean;
  automationStoreObservationPreviews?: boolean;
  automationTraceRetentionDays: number;
  automationSettingsRevision: number;
};

const MIN_RETENTION_DAYS = 1;
const MAX_RETENTION_DAYS = 3650;

type Feedback = { kind: 'saved' } | { kind: 'error'; text: string; conflict: boolean } | null;

function retentionError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter a retention period in days.';
  if (!/^\d+$/.test(trimmed)) return 'Enter a whole number of days.';
  const days = Number(trimmed);
  if (days < MIN_RETENTION_DAYS || days > MAX_RETENTION_DAYS)
    return `Enter a value from ${MIN_RETENTION_DAYS} to ${MAX_RETENTION_DAYS} days.`;
  return null;
}

function failureFeedback(result: Extract<SaveAutomationSettingsResult, { ok: false }>): Feedback {
  return { kind: 'error', conflict: result.code === 'CONFLICT', text: result.message };
}

// Unexpected failures arrive masked in production, so offer a reload in case of a stale page.
const UNEXPECTED_FEEDBACK: Feedback = {
  kind: 'error',
  conflict: true,
  text: 'Could not save automation settings. If another administrator changed them, reload and try again.',
};

export default function AutomationSettings({ initialSettings }: { initialSettings: Settings }) {
  const ids = useId();
  const switchId = `${ids}-enabled`;
  const switchHelpId = `${ids}-enabled-help`;
  const retentionId = 'automation-retention';
  const retentionHelpId = `${ids}-retention-help`;
  const retentionErrorId = `${ids}-retention-error`;
  const retentionRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(initialSettings);
  const [enabled, setEnabled] = useState(initialSettings.automationEnabled);
  const [retention, setRetention] = useState(String(initialSettings.automationTraceRetentionDays));
  const [showRetentionError, setShowRetentionError] = useState(false);
  const [serverRetentionError, setServerRetentionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const retentionProblem = retentionError(retention);

  // The fieldset is disabled while saving, so focus once it re-enables.
  useEffect(() => {
    if (!busy && serverRetentionError) retentionRef.current?.focus();
  }, [busy, serverRetentionError]);
  const disabling = saved.automationEnabled && !enabled;
  const enabling = !saved.automationEnabled && enabled;

  async function save() {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await saveAutomationSettings({
        automationEnabled: enabled,
        automationTraceRetentionDays: Number(retention.trim()),
        expectedRevision: saved.automationSettingsRevision,
      });
      if (!result.ok) {
        const fieldError = result.fieldErrors?.automationTraceRetentionDays;
        if (fieldError) setServerRetentionError(fieldError);
        setFeedback(failureFeedback(result));
        return;
      }
      const next = result.settings;
      setSaved(next);
      setEnabled(next.automationEnabled);
      setRetention(String(next.automationTraceRetentionDays));
      setFeedback({ kind: 'saved' });
    } catch {
      setFeedback(UNEXPECTED_FEEDBACK);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (retentionProblem) {
      setShowRetentionError(true);
      retentionRef.current?.focus();
      return;
    }
    if (disabling) {
      setConfirmOpen(true);
      return;
    }
    void save();
  }

  function edited() {
    if (feedback?.kind === 'saved') setFeedback(null);
  }

  const shownRetentionError = (showRetentionError && retentionProblem) || serverRetentionError;
  const invalid = !!shownRetentionError;

  return (
    <section
      aria-label="Global automation settings"
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Workflow className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            Automation
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage automation across all services. Changes apply across replicas without a restart.
          </p>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
            saved.automationEnabled
              ? 'border-emerald-600/40 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'border-border bg-muted/40 text-muted-foreground'
          )}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              saved.automationEnabled ? 'bg-emerald-600' : 'bg-slate-400'
            )}
            aria-hidden="true"
          />
          Currently {saved.automationEnabled ? 'on' : 'off'}
        </span>
      </div>

      <form noValidate onSubmit={onSubmit} className="space-y-6 px-4 py-5 sm:px-5">
        <fieldset className="space-y-3" disabled={busy}>
          <legend className="sr-only">Global switch</legend>
          <div className="flex min-h-11 items-start justify-between gap-4 rounded-lg border border-border/70 p-3">
            <div className="min-w-0 space-y-1">
              <Label htmlFor={switchId} className="cursor-pointer text-sm font-medium">
                Enable service automation globally
              </Label>
              <p id={switchHelpId} className="text-sm text-muted-foreground">
                Disabling stops new evaluations. Existing incident decisions stay pinned. Each
                service returns to Disabled. After enabling again, review each service in Shadow
                before Live.
              </p>
            </div>
            <Switch
              id={switchId}
              checked={enabled}
              onCheckedChange={checked => {
                setEnabled(checked);
                edited();
              }}
              aria-describedby={switchHelpId}
              className="mt-0.5"
            />
          </div>
          {disabling && (
            <div className="flex items-start gap-2 rounded-md border border-amber-600/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                Saving will turn automation off and reset every service in Shadow or Live to
                Disabled. Incident decisions already pinned are kept.
              </p>
            </div>
          )}
          {enabling && (
            <p className="text-sm text-muted-foreground">
              Services stay Disabled after enabling. Activate each service from its Automation tab.
            </p>
          )}
        </fieldset>

        <fieldset className="space-y-2" disabled={busy}>
          <legend className="sr-only">Retention</legend>
          <Label htmlFor={retentionId}>Trace and observation retention (days)</Label>
          <div className="flex items-center gap-2">
            <Input
              ref={retentionRef}
              id={retentionId}
              type="number"
              inputMode="numeric"
              min={MIN_RETENTION_DAYS}
              max={MAX_RETENTION_DAYS}
              step={1}
              value={retention}
              aria-invalid={invalid || undefined}
              aria-describedby={
                invalid ? `${retentionErrorId} ${retentionHelpId}` : retentionHelpId
              }
              onChange={event => {
                setRetention(event.target.value);
                setServerRetentionError(null);
                edited();
              }}
              onBlur={() => setShowRetentionError(true)}
              className={cn(
                'h-11 max-w-[10rem] sm:h-10',
                invalid && 'border-destructive focus-visible:ring-destructive'
              )}
            />
            <span className="text-sm text-muted-foreground" aria-hidden="true">
              days
            </span>
          </div>
          {invalid && (
            <p id={retentionErrorId} className="text-sm font-medium text-destructive">
              {shownRetentionError}
            </p>
          )}
          <p id={retentionHelpId} className="text-sm text-muted-foreground">
            1–3650 days. Incident routing decisions remain for the incident lifetime. Shortening
            retention removes older diagnostics during the next cleanup.
          </p>
        </fieldset>

        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
          <Button type="submit" disabled={busy} className="min-h-11 sm:min-h-10">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {busy ? 'Saving…' : 'Save automation settings'}
          </Button>
          <p role="status" className="min-h-5 text-sm">
            {feedback?.kind === 'saved' && (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Automation settings saved.
              </span>
            )}
          </p>
        </div>
        {feedback?.kind === 'error' && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                aria-hidden="true"
              />
              <span>{feedback.text}</span>
            </p>
            {feedback.conflict && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0 sm:min-h-9"
                onClick={() => window.location.reload()}
              >
                <RotateCw className="mr-2 h-4 w-4" aria-hidden="true" />
                Reload settings
              </Button>
            )}
          </div>
        )}
      </form>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off automation for all services?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>New incidents will no longer be evaluated by service automation.</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Every service in Shadow or Live is reset to Disabled.</li>
                  <li>Routing decisions already pinned to incidents are kept.</li>
                  <li>After turning it back on, review each service in Shadow before Live.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 sm:min-h-10">
              Keep automation on
            </AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: 'destructive' }), 'min-h-11 sm:min-h-10')}
              onClick={() => void save()}
            >
              Turn off automation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
