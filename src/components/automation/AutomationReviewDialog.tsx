'use client';
import { useId, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Eye,
  History,
  Rocket,
  XCircle,
  Zap,
} from 'lucide-react';
import { semanticSnapshotChanges } from '@/lib/automation/diff';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import type { Snapshot } from '@/lib/automation/contract';
import { compileAutomation, type LintIssue } from '@/lib/automation/compiler';
import { cn } from '@/lib/utils';
import { noticeClasses, toneClasses } from './workspace/status';

const copy = new Map([
  [
    'LIVE',
    {
      title: 'Review impact before LIVE',
      description:
        'New incidents will use the published routing and enrichment. Existing incident decisions stay pinned.',
    },
  ],
  [
    'activateCandidate',
    {
      title: 'Review candidate activation · Cutover to LIVE',
      description: 'New incidents will use the promoted candidate. Existing incident decisions stay pinned.',
    },
  ],
  [
    'restore',
    {
      title: 'Review version restore',
      description:
        'Publish the selected version again as a new immutable version. Restoring does not change the service mode.',
    },
  ],
  [
    'publish',
    {
      title: 'Review automation publication',
      description:
        'Publish an immutable version from the latest saved draft. Publication does not change the service mode.',
    },
  ],
]);

function lint(snapshot: Snapshot): LintIssue[] {
  try {
    return compileAutomation(snapshot).issues;
  } catch (error) {
    return [
      {
        level: 'ERROR',
        code: 'INVALID_DRAFT',
        message: error instanceof Error ? error.message : 'Invalid draft',
      },
    ];
  }
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function AutomationReviewDialog({
  action,
  snapshot,
  before,
  mode,
  policies,
  destinations,
  version,
  enabled,
  counts,
  candidateFallbacks = 0,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  action: 'publish' | 'restore' | 'LIVE' | 'activateCandidate' | null;
  snapshot: Snapshot;
  before?: Snapshot;
  mode?: string;
  policies?: Array<{ id: string; name: string }>;
  destinations?: Array<{ id: string; channelName?: string | null; provider: string }>;
  version: number | null;
  enabled: boolean;
  counts?: { evaluated: number; routes: number; priorities: number; skips: number; errors: number };
  candidateFallbacks?: number;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (acknowledgeNoShadow: boolean, acknowledgeShadowErrors: boolean, acknowledgeMaterialDifferences: boolean) => void;
}) {
  const blockedId = useId();
  const [acknowledge, setAcknowledge] = useState(false);
  const [acknowledgeErrors, setAcknowledgeErrors] = useState(false);
  const [acknowledgeDifferences, setAcknowledgeDifferences] = useState(false);
  const liveReview = action === 'LIVE' || action === 'activateCandidate';
  // Only diff and compile while the dialog is open; the closed dialog re-renders on every edit.
  const changes = useMemo(
    () =>
      action && !liveReview && before
        ? semanticSnapshotChanges(before, snapshot, { policies, destinations })
        : [],
    [action, liveReview, before, snapshot, policies, destinations]
  );
  const issues = useMemo(() => (action ? lint(snapshot) : []), [action, snapshot]);
  const errors = issues.filter(issue => issue.level === 'ERROR');
  const warnings = issues.filter(issue => issue.level === 'WARNING');
  const noShadowEvidence = !counts?.evaluated;
  const materialDifferences = !!(counts?.routes || counts?.priorities || counts?.skips);
  const blockedReason = errors.length
    ? 'Fix the blocking issues above before confirming.'
    : liveReview && !version
      ? 'Publish a version before enabling LIVE.'
      : liveReview && !enabled
        ? 'An administrator must turn on the global automation switch first.'
        : liveReview && noShadowEvidence && !acknowledge
          ? 'Acknowledge the missing Shadow evidence to continue.'
          : liveReview && (!!counts?.errors || candidateFallbacks > 0) && !acknowledgeErrors
            ? 'Accept the observed Shadow errors to continue.'
            : action === 'activateCandidate' && materialDifferences && !acknowledgeDifferences
              ? 'Approve the observed material differences to continue.'
            : null;
  const TitleIcon = liveReview ? Zap : action === 'restore' ? History : Rocket;
  const { title, description } = copy.get(action ?? 'publish')!;
  return (
    <Dialog
      open={!!action}
      onOpenChange={open => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TitleIcon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error && (
          <p
            role="alert"
            className={cn('flex gap-2 rounded-md border p-3 text-sm', noticeClasses.error)}
          >
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
        <div className="space-y-4 text-sm">
          {action === 'publish' && mode === 'LIVE' && (
            <p role="alert" className={cn('flex gap-2 rounded-lg border p-3', noticeClasses.warn)}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Publishing stages a candidate version for parallel shadow evaluation. The active LIVE version stays in place.
              </span>
            </p>
          )}
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {liveReview ? (
              <>
                <Stat label="Version" value={version ?? '—'} />
                <Stat label="Evaluations" value={counts?.evaluated ?? 0} />
                <Stat label="Route diffs" value={counts?.routes ?? 0} />
                <Stat label="Errors" value={counts?.errors ?? 0} />
              </>
            ) : (
              <>
                <Stat label="Changes" value={changes.length} />
                <Stat label="Rules" value={snapshot.rules.length} />
                <Stat label="Fields" value={snapshot.fields.length} />
                <Stat label="Blocking" value={errors.length} />
              </>
            )}
          </dl>
          {!liveReview && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-2 font-semibold">
                <ArrowRightLeft className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Changes from the active version · {changes.length}
              </h3>
              {changes.length ? (
                <ul className="divide-y rounded-md border">
                  {changes.map((change, index) => (
                    <li className="break-words px-3 py-2" key={index}>
                      {change}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-md border border-dashed px-3 py-2 text-muted-foreground">
                  No semantic changes.
                </p>
              )}
            </section>
          )}
          <p className="text-muted-foreground">
            {liveReview
              ? `Published version ${version ?? 'unavailable'}`
              : `${snapshot.fields.length} context fields · ${snapshot.rules.length} rules`}
          </p>
          <details className="rounded-md border">
            <summary className="cursor-pointer rounded-md px-3 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Inspect complete ordered behavior
            </summary>
            <ol className="space-y-2 border-t p-3">
              {snapshot.rules.map((rule, index) => (
                <li key={rule.id} className="rounded-md border p-2">
                  <span className="font-medium">
                    {index + 1}. {rule.name}
                  </span>{' '}
                  · {rule.phase} · {rule.enabled ? 'Enabled' : 'Disabled'}
                  <span className="block text-muted-foreground">
                    {rule.conditions.length
                      ? `${rule.conditions.length} conditions must match`
                      : 'Matches every alert'}{' '}
                    →{' '}
                    {rule.actions
                      .map(item => item.type.replaceAll('_', ' ').toLowerCase())
                      .join(', ')}
                  </span>
                </li>
              ))}
              {snapshot.rules.length === 0 && (
                <li className="text-muted-foreground">
                  No rules. Every alert uses the service default.
                </li>
              )}
            </ol>
          </details>
          {(errors.length > 0 || warnings.length > 0) && (
            <ul className="space-y-1">
              {[...errors, ...warnings].map((issue, index) => (
                <li
                  key={index}
                  className={cn(
                    'flex gap-2',
                    issue.level === 'ERROR' ? toneClasses.error : toneClasses.warn
                  )}
                >
                  {issue.level === 'ERROR' ? (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    {issue.level}: {issue.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {liveReview && (
            <section className="space-y-2 rounded-lg border p-3">
              <h3 className="flex items-center gap-2 font-semibold">
                <Eye className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                Shadow readiness · last 7 days
              </h3>
              <p>
                {counts?.evaluated ?? 0} evaluations · {counts?.errors ?? 0} errors · {candidateFallbacks} fallbacks
              </p>
              <p>
                {counts?.routes ?? 0} routing differences · {counts?.priorities ?? 0} priority
                differences · {counts?.skips ?? 0} would skip escalation
              </p>
              <p className="text-muted-foreground">
                Review context mapping and deployment queue/latency metrics before enabling. These
                metrics are not measured by this dialog.
              </p>
              <div className="space-y-1 rounded-md bg-muted/40 p-3">
                <p className="font-medium">When you confirm</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  <li>New incidents use this version&apos;s routing, enrichment and paging.</li>
                  <li>Existing incidents keep their pinned decisions.</li>
                  <li>You can return to SHADOW or DISABLED at any time.</li>
                </ul>
              </div>
              {noShadowEvidence && (
                <div className={cn('space-y-2 rounded-md border p-3', noticeClasses.warn)}>
                  <p className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    No Shadow evidence is available yet.
                  </p>
                  <label className="flex min-h-10 cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      checked={acknowledge}
                      onChange={event => setAcknowledge(event.target.checked)}
                    />
                    I understand this version has not been observed against real Shadow traffic.
                  </label>
                </div>
              )}
              {(!!counts?.errors || candidateFallbacks > 0) && (
                <label
                  className={cn(
                    'flex min-h-10 cursor-pointer items-start gap-2 rounded-md border p-3',
                    noticeClasses.warn
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    checked={acknowledgeErrors}
                    onChange={event => setAcknowledgeErrors(event.target.checked)}
                  />
                  I explicitly accept enabling LIVE despite observed Shadow errors and fallbacks.
                </label>
              )}
              {action === 'activateCandidate' && materialDifferences && (
                <label className={cn('flex min-h-10 cursor-pointer items-start gap-2 rounded-md border p-3', noticeClasses.warn)}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    checked={acknowledgeDifferences} onChange={event => setAcknowledgeDifferences(event.target.checked)} />
                  I approve the observed routing, priority and suppression differences.
                </label>
              )}
            </section>
          )}
          {!enabled && (
            <p className={cn('flex gap-2', toneClasses.warn)}>
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              The global switch is OFF. New evaluations remain disabled until an administrator
              enables it.
            </p>
          )}
          {!blockedReason && (
            <p className={cn('flex gap-2', toneClasses.ok)}>
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Ready to confirm.
            </p>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {blockedReason && (
            <p id={blockedId} className="text-xs text-muted-foreground sm:mr-auto">
              {blockedReason}
            </p>
          )}
          <Button variant="outline" className="h-10" disabled={busy} onClick={onCancel}>
            Keep unchanged
          </Button>
          <Button
            className="h-10"
            disabled={busy || !!blockedReason}
            aria-describedby={blockedReason ? blockedId : undefined}
            onClick={() => onConfirm(acknowledge, acknowledgeErrors, acknowledgeDifferences)}
          >
            {busy ? 'Saving…' : liveReview ? 'Confirm LIVE' : 'Confirm publication'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
