'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from '@/components/ui/shadcn/dialog';
import AuthenticationRevisionSelector from './AuthenticationRevisionSelector';
import AuthenticationAdminTestPanel from './AuthenticationAdminTestPanel';
import { AuthenticationVerificationBadge } from './AuthenticationVerificationStatus';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';

import { UserCheck, RotateCcw, ChevronDown } from 'lucide-react';

export default function AuthenticationRevisionWorkflow() {
  const {
    data,
    configuration,
    revisionId,
    setRevisionId,
    draftDirty,
    setDraftDirty,
    setConfiguration,
    setProfileJson,
    editable,
    setClaimResult,
    setLinkApproved,
    setBroadAcknowledged,
    setImpact,
    setConfirmation,
    pending,
    perform,
    refresh,
    setMessage,
    setDraftBaseConfigVersion,
    setActiveTab,
  } = useAuthenticationWorkspace();
  const [pendingRevision, setPendingRevision] = useState<string | null>(null);
  const selected = data.revisions.find(revision => revision.id === revisionId);
  const load = (id: string) => {
    const revision = data.revisions.find(item => item.id === id);
    setRevisionId(id);
    if (revision) {
      const next = editable(revision.configuration);
      setConfiguration(next);
      setProfileJson(JSON.stringify(next.profileMapping, null, 2));
      setDraftBaseConfigVersion(
        id === data.activeRevisionId ? data.providerConfigVersion : revision.baseConfigVersion
      );
    }
    setDraftDirty(false);
    setClaimResult(null);
    setLinkApproved(false);
    setBroadAcknowledged(false);
    setImpact(null);
    setConfirmation(false);
    setPendingRevision(null);
  };
  const common = [
    pending && { code: 'busy', message: 'Wait for the current operation to finish.' },
    draftDirty && {
      code: 'draft',
      message: 'Stage your latest changes before testing or previewing.',
      resolutionLabel: 'Stage changes in Connection',
      resolutionTarget: 'connection' as const,
    },
    !revisionId && {
      code: 'revision',
      message: 'Select a saved configuration from the selector, or stage a new draft.',
      resolutionTarget: 'connection' as const,
      resolutionLabel: 'Go to Connection to stage',
    },
    Boolean(
      selected &&
      selected.id !== data.activeRevisionId &&
      selected.baseConfigVersion !== data.providerConfigVersion
    ) && {
      code: 'stale',
      message:
        'This saved configuration predates the active provider. Stage a current draft instead.',
      resolutionTarget: 'connection' as const,
      resolutionLabel: 'Review in Connection',
    },
    data.freshAuthenticationRequired && {
      code: 'fresh',
      message: 'Authenticate again before starting a sensitive operation.',
    },
  ];
  return (
    <div
      className="rounded-xl border bg-card p-5 space-y-5 shadow-xs"
      aria-labelledby="auth-test-title"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <UserCheck className="h-4 w-4" />
          </div>
          <div>
            <h3 id="auth-test-title" className="text-base font-bold text-foreground">
              Validate administrator access
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Live authentication drill required before activating any staged configuration.
            </p>
          </div>
        </div>
        {selected && (
          <AuthenticationVerificationBadge verification={selected.verification} compact />
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        First stage the shared draft, then complete a real provider sign-in. Discovery success alone
        does not prove administrator access.
      </p>

      <div className="space-y-4">
        <AuthenticationRevisionSelector
          label="Saved provider configuration"
          onSelect={id => {
            if (draftDirty) setPendingRevision(id);
            else load(id);
          }}
        />

        <AuthenticationAdminTestPanel />
      </div>

      {/* Rollback Details Section */}
      <details className="group rounded-xl border bg-card p-4 space-y-3 transition-all">
        <summary className="flex items-center justify-between cursor-pointer text-sm font-semibold text-foreground select-none list-none">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
            <span>Restore a previously saved configuration</span>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <p className="text-xs text-muted-foreground leading-relaxed pt-2 border-t">
          Rollback stages a new candidate and still requires a fresh real administrator test before
          activation.
        </p>
        <AuthenticationActionGuard
          availability={actionAvailability('Stage rollback', common)}
          onResolve={setActiveTab}
        >
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() =>
              void perform(async () => {
                const result = await authenticationRequest<{ revisionId: string }>({
                  action: 'rollback',
                  revisionId,
                });
                setDraftBaseConfigVersion(data.providerConfigVersion);
                await refresh(result.revisionId);
                setMessage('Previous configuration staged. Test it before activation.');
              })
            }
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Stage selected configuration for rollback
          </Button>
        </AuthenticationActionGuard>
      </details>

      <Dialog
        open={pendingRevision !== null}
        onOpenChange={open => {
          if (!open) setPendingRevision(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace the current draft?</DialogTitle>
            <DialogDescription>
              Your edits across provider, access and session policies will be discarded. The active
              configuration stays unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={() => load(pendingRevision!)}>Load saved configuration</Button>
            <Button variant="outline" onClick={() => setPendingRevision(null)}>
              Keep editing
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <p className="text-xs text-muted-foreground">
        Current draft client: {configuration.clientId || 'Not set'}. Encrypted secrets are never
        shown here.
      </p>
    </div>
  );
}
