'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import { AlertCircle, CheckCircle2, GitCompare, Info, Trash2 } from 'lucide-react';
import { providerDefinitions } from '@/lib/auth-control/provider-definitions';
import { oidcProofLabel } from '@/lib/auth-control/proof-status';
import { useAuthenticationWorkspace, type DashboardRevision } from './useAuthenticationController';
import { authenticationRequest } from './request';
import ProviderLogo from './ProviderLogo';
import {
  AuthenticationVerificationBadge,
  formatAuthenticationDate,
} from './AuthenticationVerificationStatus';
import { issuerSummary, revisionDifferences } from './revision-differences';

export type AuthenticationRevisionSelectorProps = {
  label?: string;
  onSelect?: (id: string) => void;
  showCleanup?: boolean;
};

type RevisionKind = 'active' | 'staged' | 'previous';

function providerName(revision: DashboardRevision) {
  const configuration = revision.configuration;
  return (
    configuration.providerLabel ||
    providerDefinitions[configuration.providerType]?.label ||
    'OIDC provider'
  );
}

function StatusBadge({ kind }: { kind: RevisionKind }) {
  if (kind === 'active')
    return (
      <Badge variant="success" className="text-[10px] font-semibold shrink-0">
        Active
      </Badge>
    );
  if (kind === 'previous')
    return (
      <Badge variant="outline" className="text-[10px] font-medium shrink-0">
        Previously active
      </Badge>
    );
  return (
    <Badge
      variant="outline"
      className="text-[10px] font-medium shrink-0 border-primary/25 bg-primary/10 text-primary"
    >
      Draft
    </Badge>
  );
}

export default function AuthenticationRevisionSelector({
  label = 'Saved provider configuration',
  onSelect,
  showCleanup = true,
}: AuthenticationRevisionSelectorProps) {
  const {
    data,
    revisionId,
    setRevisionId,
    selectionConflict,
    pending,
    perform,
    refresh,
    setMessage,
    setImpact,
    setConfirmation,
    setLinkApproved,
  } = useAuthenticationWorkspace();

  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(null);
  const [cleanupIds, setCleanupIds] = useState<string[] | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);

  const kindOf = (revision: DashboardRevision): RevisionKind =>
    revision.id === data.activeRevisionId ? 'active' : revision.activatedAt ? 'previous' : 'staged';
  const selected = data.revisions.find(revision => revision.id === revisionId);
  const activeRevisions = data.revisions.filter(revision => kindOf(revision) === 'active');
  const stagedRevisions = data.revisions.filter(revision => kindOf(revision) === 'staged');
  const previousRevisions = data.revisions.filter(revision => kindOf(revision) === 'previous');
  const differences = selected
    ? revisionDifferences(data.activeProvider, selected.configuration)
    : [];
  const deletable = selected && kindOf(selected) === 'staged';

  const select = (id: string) => {
    if (onSelect) {
      onSelect(id);
      return;
    }
    // Switching configuration resets every result that belonged to the previous selection.
    setRevisionId(id);
    setImpact(null);
    setConfirmation(false);
    setLinkApproved(false);
  };

  const deleteSingle = (id: string) =>
    perform(async () => {
      try {
        await authenticationRequest({ action: 'deleteRevision', revisionId: id });
        setMessage('Draft configuration deleted. The active provider is unchanged.');
      } finally {
        // Always resynchronise: if another administrator already deleted it, recover cleanly.
        setDeleteCandidateId(null);
        setImpact(null);
        setConfirmation(false);
        await refresh(id === revisionId ? '' : revisionId);
      }
    });

  const cleanup = (ids: string[]) =>
    perform(async () => {
      try {
        const result = await authenticationRequest<{ count: number; skipped: number }>({
          action: 'cleanupRevisions',
          revisionIds: ids,
        });
        setMessage(
          result.skipped
            ? `Deleted ${result.count} unused drafts. ${result.skipped} changed in another session and were kept.`
            : `Deleted ${result.count} unused drafts.`
        );
      } finally {
        setCleanupIds(null);
        setImpact(null);
        setConfirmation(false);
        // Prefer the active configuration once drafts are gone.
        await refresh(ids.includes(revisionId) ? (data.activeRevisionId ?? '') : revisionId);
      }
    });

  const optionLabel = (revision: DashboardRevision) =>
    `${providerName(revision)} · ${formatAuthenticationDate(revision.createdAt)} · ${
      oidcProofLabel(revision.verification.state).short
    }`;

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground" aria-hidden>
          {label}
        </span>
        {showCleanup && stagedRevisions.length > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1"
            onClick={() => setCleanupIds(stagedRevisions.map(revision => revision.id))}
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            Delete {stagedRevisions.length} unused drafts
          </Button>
        )}
      </div>

      {selectionConflict && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-foreground/90"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
          The configuration you had selected no longer exists — it may have been deleted in another
          session. {selected ? 'Showing the closest available configuration.' : ''}
        </p>
      )}

      <select
        aria-label={label}
        value={selected?.id ?? ''}
        disabled={pending}
        onChange={event => select(event.target.value)}
        className="block h-11 w-full min-w-0 truncate rounded-xl border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {data.revisions.length === 0 && (
          <option value="" disabled>
            No saved configurations yet — stage the draft first
          </option>
        )}
        {activeRevisions.length > 0 && (
          <optgroup label="Active">
            {activeRevisions.map(revision => (
              <option key={revision.id} value={revision.id}>
                {optionLabel(revision)}
              </option>
            ))}
          </optgroup>
        )}
        {stagedRevisions.length > 0 && (
          <optgroup label={`Drafts — never activated (${stagedRevisions.length})`}>
            {stagedRevisions.map((revision, index) => (
              <option key={revision.id} value={revision.id}>
                {`Draft ${stagedRevisions.length - index} · ${optionLabel(revision)}`}
              </option>
            ))}
          </optgroup>
        )}
        {previousRevisions.length > 0 && (
          <optgroup label="Previously active — rollback history">
            {previousRevisions.map(revision => (
              <option key={revision.id} value={revision.id}>
                {optionLabel(revision)}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {selected && (
        <div
          id="auth-revision-summary"
          className="min-w-0 space-y-3 rounded-xl border bg-muted/20 p-3 sm:p-4"
        >
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <div className="rounded-lg border bg-background p-1.5 shrink-0">
                <ProviderLogo
                  providerType={selected.configuration.providerType}
                  className="h-4 w-4"
                />
              </div>
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-semibold text-foreground">
                    {providerName(selected)}
                  </span>
                  <StatusBadge kind={kindOf(selected)} />
                </div>
                <p className="text-xs text-muted-foreground break-all">
                  {issuerSummary(selected.configuration.issuer)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Saved {formatAuthenticationDate(selected.createdAt)} by {selected.createdByLabel}
                  {selected.activatedAt
                    ? ` · activated ${formatAuthenticationDate(selected.activatedAt)}`
                    : ''}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                disabled={kindOf(selected) === 'active'}
                onClick={() => setCompareOpen(true)}
              >
                <GitCompare className="h-3.5 w-3.5" aria-hidden />
                View differences
              </Button>
              {deletable && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  className="h-8 gap-1.5 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteCandidateId(selected.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  Delete draft
                </Button>
              )}
            </div>
          </div>
          <dl className="grid gap-2 text-xs sm:grid-cols-3">
            <div className="min-w-0">
              <dt className="font-medium text-muted-foreground">Discovery</dt>
              <dd className="mt-0.5 flex items-center gap-1 text-foreground">
                {selected.discoveryVerifiedAt ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                    Validated {formatAuthenticationDate(selected.discoveryVerifiedAt)}
                  </>
                ) : (
                  'Not validated'
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="font-medium text-muted-foreground">Administrator proof</dt>
              <dd className="mt-0.5">
                <AuthenticationVerificationBadge verification={selected.verification} />
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="font-medium text-muted-foreground">Compared with active</dt>
              <dd className="mt-0.5 text-foreground">
                {kindOf(selected) === 'active'
                  ? 'This is the active configuration'
                  : !data.activeProvider
                    ? 'No active provider yet'
                    : differences.length === 0
                      ? 'Same settings as active'
                      : `${differences.length} ${differences.length === 1 ? 'change' : 'changes'}: ${differences
                          .slice(0, 3)
                          .map(difference => difference.label)
                          .join(', ')}${differences.length > 3 ? '…' : ''}`}
              </dd>
            </div>
          </dl>
        </div>
      )}

      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompare className="h-5 w-5" aria-hidden />
              Active vs selected configuration
            </DialogTitle>
            <DialogDescription>
              Review what changes if this configuration is activated. Client secrets are never
              displayed or compared.
            </DialogDescription>
          </DialogHeader>
          {differences.length === 0 ? (
            <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              {data.activeProvider
                ? 'No setting differs from the active configuration.'
                : 'There is no active provider yet; every setting is new.'}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <div className="hidden grid-cols-[9rem_1fr_1fr] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground sm:grid">
                <span>Setting</span>
                <span>Active</span>
                <span>Selected</span>
              </div>
              <ul className="divide-y">
                {differences.map(difference => (
                  <li
                    key={difference.field}
                    className="grid gap-1 px-3 py-2.5 text-xs sm:grid-cols-[9rem_1fr_1fr] sm:gap-3"
                  >
                    <span className="font-medium text-foreground">{difference.label}</span>
                    <span className="break-all text-muted-foreground line-through decoration-muted-foreground/40 sm:no-underline">
                      <span className="sm:hidden font-medium not-italic">Active: </span>
                      {difference.from}
                    </span>
                    <span className="break-all text-foreground">
                      <span className="sm:hidden font-medium">Selected: </span>
                      {difference.to}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompareOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteCandidateId)}
        onOpenChange={open => !open && setDeleteCandidateId(null)}
      >
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" aria-hidden />
              Delete this draft?
            </DialogTitle>
            <DialogDescription className="leading-relaxed">
              The draft and its administrator test results are permanently removed. Any sign-in test
              still in progress for it is cancelled. The active provider and sign-in policy do not
              change.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pending} onClick={() => setDeleteCandidateId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => deleteCandidateId && void deleteSingle(deleteCandidateId)}
            >
              Delete draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cleanupIds !== null} onOpenChange={open => !open && setCleanupIds(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" aria-hidden />
              Delete {cleanupIds?.length ?? 0} unused drafts?
            </DialogTitle>
            <DialogDescription className="leading-relaxed">
              Only the drafts listed now are deleted, and each is rechecked first: anything
              activated or changed in another session meanwhile is kept. The active configuration
              and rollback history are never deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pending} onClick={() => setCleanupIds(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => cleanupIds && void cleanup(cleanupIds)}
            >
              Delete unused drafts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
