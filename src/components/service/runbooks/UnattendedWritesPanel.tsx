'use client';

import { CheckCircle2, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { ConfirmAction } from '@/components/runbooks/RunbookControls';
import {
  authorizeUnattendedWritesAction,
  revokeUnattendedWritesAction,
} from '@/app/(app)/services/[id]/runbook-actions';
import { cn } from '@/lib/utils';

export type UnattendedWriteAction = {
  key: string;
  name: string;
  type: string;
  riskClass: string;
  hasVerification: boolean;
  alwaysRequiresApproval?: boolean;
};

export type UnattendedWriteEligibility = {
  writeActions: UnattendedWriteAction[];
  eligible: boolean;
  reasons: string[];
};

export type UnattendedWriteAuthorization = {
  versionId: string;
  authorizedAtLabel: string;
  authorizedAtIso: string;
  authorizedBy: string | null;
};

/** Domain reasons carry a machine code prefix (`CODE: message`); show only the message. */
function reasonText(reason: string) {
  return reason.replace(/^[A-Z][A-Z_]+:\s*/, '');
}

export type UnattendedWritesStatus = 'AUTHORIZED' | 'STALE' | 'REQUIRES_APPROVAL';

export function unattendedWritesStatus(
  pinnedVersionId: string | null,
  authorization: UnattendedWriteAuthorization | null
): UnattendedWritesStatus {
  if (!authorization) return 'REQUIRES_APPROVAL';
  return pinnedVersionId && authorization.versionId === pinnedVersionId ? 'AUTHORIZED' : 'STALE';
}

export function UnattendedWritesBadge({
  status,
  versionNumber,
}: {
  status: UnattendedWritesStatus;
  versionNumber: number | null;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1 text-[11px] font-medium',
        status === 'AUTHORIZED'
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
      )}
    >
      {status === 'AUTHORIZED' ? (
        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
      ) : (
        <ShieldAlert className="h-3 w-3" aria-hidden="true" />
      )}
      {status === 'AUTHORIZED'
        ? `Unattended writes · v${versionNumber ?? '?'}`
        : 'Writes require approval'}
    </Badge>
  );
}

export default function UnattendedWritesPanel({
  serviceId,
  bindingId,
  runbookName,
  pinnedVersionId,
  pinnedVersionNumber,
  authorization,
  eligibility,
  canAuthorize,
}: {
  serviceId: string;
  bindingId: string;
  runbookName: string;
  pinnedVersionId: string | null;
  pinnedVersionNumber: number | null;
  authorization: UnattendedWriteAuthorization | null;
  eligibility: UnattendedWriteEligibility | null;
  canAuthorize: boolean;
}) {
  const status = unattendedWritesStatus(pinnedVersionId, authorization);
  const headingId = `unattended-writes-${bindingId}`;
  const writeActions = eligibility?.writeActions ?? [];
  const canGrant =
    canAuthorize &&
    status !== 'AUTHORIZED' &&
    Boolean(pinnedVersionId) &&
    Boolean(eligibility?.eligible) &&
    writeActions.length > 0;

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-2.5 rounded-lg border border-border/80 bg-muted/20 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="text-sm font-semibold text-foreground">
          Unattended write steps
        </h4>
        <UnattendedWritesBadge status={status} versionNumber={pinnedVersionNumber} />
      </div>

      <p className="text-xs text-muted-foreground" role="status">
        {status === 'AUTHORIZED' && authorization ? (
          <>
            Authorized for v{pinnedVersionNumber ?? '?'} by{' '}
            {authorization.authorizedBy ?? 'a former user'} at{' '}
            <time dateTime={authorization.authorizedAtIso}>{authorization.authorizedAtLabel}</time>.
            Automatic executions of this pinned version run write steps without approval.
          </>
        ) : status === 'STALE' ? (
          'Requires approval. The previous authorization was for a different version and no longer applies.'
        ) : (
          'Requires approval. Automatic executions pause at every write step until an operator approves it.'
        )}
      </p>

      {!canAuthorize ? (
        <p className="text-[11px] text-muted-foreground">
          Only administrators can authorize unattended write steps.
        </p>
      ) : (
        <>
          {eligibility === null ? (
            <p className="text-xs text-destructive" role="alert">
              Eligibility could not be determined for the pinned version.
            </p>
          ) : writeActions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              The pinned version has no Agent write actions, so there is nothing to authorize.
            </p>
          ) : (
            <ul className="divide-y rounded-md border bg-background" aria-label="Write actions">
              {writeActions.map(action => (
                <li
                  key={action.key}
                  className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 text-xs"
                >
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{action.name}</span>{' '}
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {action.type} · {action.riskClass}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {action.hasVerification ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Verification
                        present
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <XCircle className="h-3.5 w-3.5" aria-hidden="true" /> No verification
                      </span>
                    )}
                    {(action.alwaysRequiresApproval || action.riskClass === 'NON_IDEMPOTENT') && (
                      <Badge
                        variant="outline"
                        className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
                      >
                        Always requires approval
                      </Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {eligibility && eligibility.reasons.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-muted-foreground">
              {eligibility.reasons.map(reason => (
                <li key={reason}>{reasonText(reason)}</li>
              ))}
            </ul>
          )}

          {canGrant && (
            <p
              role="note"
              className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-50 p-2 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Warning: authorizing lets automatic executions change systems with no human approval,
              including runs started by monitoring alerts. Existing AUTOMATIC bindings are never
              authorized implicitly.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {canGrant && pinnedVersionId && (
              <ConfirmAction
                action={authorizeUnattendedWritesAction.bind(
                  null,
                  serviceId,
                  bindingId,
                  pinnedVersionId
                )}
                title={`Authorize unattended writes for v${pinnedVersionNumber ?? '?'}?`}
                description={`Write steps of ${runbookName} v${pinnedVersionNumber ?? '?'} (the exact pinned version) will run without approval when this binding triggers automatically. NON_IDEMPOTENT steps still require approval. Changing the pinned version, version strategy or mode revokes this authorization.`}
                label={`Authorize v${pinnedVersionNumber ?? '?'}`}
                variant="default"
              />
            )}
            {authorization && (
              <ConfirmAction
                action={revokeUnattendedWritesAction.bind(null, serviceId, bindingId)}
                title="Revoke unattended write authorization?"
                description={`Automatic executions of ${runbookName} will pause at every write step until an operator approves it.`}
                label="Revoke"
                variant="destructive"
              />
            )}
          </div>
        </>
      )}
    </section>
  );
}
