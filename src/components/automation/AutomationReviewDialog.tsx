'use client';
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
  version,
  enabled,
  counts,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  action: 'publish' | 'LIVE' | null;
  snapshot: Snapshot;
  version: number | null;
  enabled: boolean;
  counts?: { evaluated: number; routes: number; priorities: number; skips: number; errors: number };
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
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
            {action === 'LIVE' ? 'Review impact before LIVE' : 'Review automation publication'}
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
          <p>
            {action === 'LIVE'
              ? `Published version ${version ?? 'unavailable'}`
              : `${snapshot.fields.length} context fields · ${snapshot.rules.length} rules`}
          </p>
          <h3 className="font-semibold">Ordered behavior</h3>
          {snapshot.rules.map((rule, index) => (
            <p key={rule.id} className="rounded-md border p-2">
              {index + 1}. {rule.name} · {rule.phase} · {rule.enabled ? 'Enabled' : 'Disabled'}
              <span className="block text-muted-foreground">
                {rule.conditions.length
                  ? `${rule.conditions.length} conditions must match`
                  : 'Matches every alert'}{' '}
                →{' '}
                {rule.actions.map(item => item.type.replaceAll('_', ' ').toLowerCase()).join(', ')}
              </span>
            </p>
          ))}
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
                </p>
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
              (action === 'LIVE' && !version)
            }
            onClick={onConfirm}
          >
            {busy ? 'Saving…' : action === 'LIVE' ? 'Confirm LIVE' : 'Confirm publication'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
