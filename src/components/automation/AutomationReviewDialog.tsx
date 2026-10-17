'use client';
import { useMemo, useState } from 'react';
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
import { compileAutomation } from '@/lib/automation/compiler';
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
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  action: 'publish' | 'restore' | 'LIVE' | null;
  snapshot: Snapshot;
  before?: Snapshot;
  mode?: string;
  policies?: Array<{ id: string; name: string }>;
  destinations?: Array<{ id: string; channelName?: string | null; provider: string }>;
  version: number | null;
  enabled: boolean;
  counts?: { evaluated: number; routes: number; priorities: number; skips: number; errors: number };
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (acknowledgeNoShadow: boolean, acknowledgeShadowErrors: boolean) => void;
}) {
  const [acknowledge, setAcknowledge] = useState(false);
  const [acknowledgeErrors, setAcknowledgeErrors] = useState(false);

  const changes = useMemo(
    () => (before ? semanticSnapshotChanges(before, snapshot, { policies, destinations }) : []),
    [before, snapshot, policies, destinations]
  );
  let issues: ReturnType<typeof compileAutomation>['issues'];
  try {
    issues = compileAutomation(snapshot).issues;
  } catch (error) {
    issues = [
      {
        level: 'ERROR',
        code: 'INVALID_DRAFT',
        message: error instanceof Error ? error.message : 'Invalid draft',
      },
    ];
  }
  return (
    <Dialog
      open={!!action}
      onOpenChange={open => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {action === 'LIVE'
              ? 'Review impact before LIVE'
              : action === 'restore'
                ? 'Review version restore'
                : 'Review automation publication'}
          </DialogTitle>
          <DialogDescription>
            {action === 'LIVE'
              ? 'New incidents will use the published routing and enrichment. Existing incident decisions stay pinned.'
              : 'Publish an immutable version from the latest saved draft. Publication does not change the service mode.'}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="space-y-3 text-sm">
          {action !== 'LIVE' && mode === 'LIVE' && (
            <p role="alert" className="rounded-lg border border-amber-500 p-3">
              This service is LIVE. Publishing immediately changes automation behavior for new
              incidents. Existing incidents remain pinned to their previous routing decision.
            </p>
          )}
          {action !== 'LIVE' && (
            <div>
              <h3 className="font-semibold">Changes from the active version · {changes.length}</h3>
              {changes.length ? (
                changes.map((change, index) => (
                  <p className="border-b py-2" key={index}>
                    {change}
                  </p>
                ))
              ) : (
                <p>No semantic changes.</p>
              )}
            </div>
          )}
          <p>
            {action === 'LIVE'
              ? `Published version ${version ?? 'unavailable'}`
              : `${snapshot.fields.length} context fields · ${snapshot.rules.length} rules`}
          </p>
          <details>
            <summary className="cursor-pointer font-semibold">
              Inspect complete ordered behavior
            </summary>
            {snapshot.rules.map((rule, index) => (
              <p key={rule.id} className="rounded-md border p-2">
                {index + 1}. {rule.name} · {rule.phase} · {rule.enabled ? 'Enabled' : 'Disabled'}
                <span className="block text-muted-foreground">
                  {rule.conditions.length
                    ? `${rule.conditions.length} conditions must match`
                    : 'Matches every alert'}{' '}
                  →{' '}
                  {rule.actions
                    .map(item => item.type.replaceAll('_', ' ').toLowerCase())
                    .join(', ')}
                </span>
              </p>
            ))}
          </details>
          {issues.map((issue, index) => (
            <p
              key={index}
              className={
                issue.level === 'ERROR' ? 'text-destructive' : 'text-amber-700 dark:text-amber-300'
              }
            >
              {issue.level}: {issue.message}
            </p>
          ))}
          {action === 'LIVE' && (
            <div className="rounded-lg border p-3 space-y-1">
              <h3 className="font-semibold">Shadow readiness · last 7 days</h3>
              <p>
                {counts?.evaluated ?? 0} evaluations · {counts?.errors ?? 0} errors/fallbacks
              </p>
              <p>
                {counts?.routes ?? 0} routing differences · {counts?.priorities ?? 0} priority
                differences · {counts?.skips ?? 0} would skip escalation
              </p>
              <p className="text-muted-foreground">
                Review context mapping and deployment queue/latency metrics before enabling. These
                metrics are not measured by this dialog.
              </p>
              {!counts?.evaluated && (
                <p className="text-amber-700 dark:text-amber-300">
                  No Shadow evidence is available yet.
                  <label className="block mt-2">
                    <input
                      type="checkbox"
                      checked={acknowledge}
                      onChange={event => setAcknowledge(event.target.checked)}
                    />{' '}
                    I understand this version has not been observed against real Shadow traffic.
                  </label>
                </p>
              )}
              {!!counts?.errors && (
                <label className="block text-amber-700 dark:text-amber-300">
                  <input
                    type="checkbox"
                    checked={acknowledgeErrors}
                    onChange={event => setAcknowledgeErrors(event.target.checked)}
                  />{' '}
                  I explicitly accept enabling LIVE despite observed Shadow errors and fallbacks.
                </label>
              )}
            </div>
          )}
          {!enabled && (
            <p className="text-amber-700 dark:text-amber-300">
              The global switch is OFF. New evaluations remain disabled until an administrator
              enables it.
            </p>
          )}
        </div>
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Keep unchanged
          </Button>
          <Button
            disabled={
              busy ||
              issues.some(issue => issue.level === 'ERROR') ||
              (action === 'LIVE' &&
                (!version ||
                  !enabled ||
                  (!counts?.evaluated && !acknowledge) ||
                  (!!counts?.errors && !acknowledgeErrors)))
            }
            onClick={() => onConfirm(acknowledge, acknowledgeErrors)}
          >
            {busy ? 'Saving…' : action === 'LIVE' ? 'Confirm LIVE' : 'Confirm publication'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
