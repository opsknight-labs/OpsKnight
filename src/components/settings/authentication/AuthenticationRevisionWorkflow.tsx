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
import { AuthenticationVerificationBadge } from './AuthenticationVerificationStatus';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';

import { UserCheck, RotateCcw, ChevronDown } from 'lucide-react';

/**
 * Saved configurations: pick one to edit, delete drafts, or restore an earlier one. Testing
 * happens in Test & activate, so this step stays about connecting the provider.
 */
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
      message: 'Save your latest changes first.',
      resolutionLabel: 'Save changes in Connect provider',
      resolutionTarget: 'connection' as const,
    },
    !revisionId && {
      code: 'revision',
      message: 'Choose a saved configuration, or save your changes first.',
      resolutionTarget: 'connection' as const,
      resolutionLabel: 'Go to Connect provider',
    },
    Boolean(
      selected &&
      selected.id !== data.activeRevisionId &&
      selected.baseConfigVersion !== data.providerConfigVersion
    ) && {
      code: 'stale',
      message:
        'This saved configuration is older than the active provider. Save a new one instead.',
      resolutionTarget: 'connection' as const,
      resolutionLabel: 'Review in Connect provider',
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
              Saved configurations
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Open a saved configuration to keep editing it, or restore an earlier one.
            </p>
          </div>
        </div>
        {selected && (
          <AuthenticationVerificationBadge verification={selected.verification} compact />
        )}
      </div>

      <div className="space-y-4">
        <AuthenticationRevisionSelector
          label="Saved provider configuration"
          onSelect={id => {
            if (draftDirty) setPendingRevision(id);
            else load(id);
          }}
        />
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
          Restoring saves a copy of the selected configuration. Test it in Test &amp; activate
          before turning it on.
        </p>
        <AuthenticationActionGuard
          availability={actionAvailability('Restore configuration', common)}
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
                setMessage(
                  'Earlier configuration restored as a new copy. Test it in Test & activate.'
                );
              })
            }
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restore the selected configuration
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
            <DialogTitle>Discard your unsaved changes?</DialogTitle>
            <DialogDescription>
              Opening another saved configuration discards what you have not saved yet. Your active
              sign-in settings stay unchanged.
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
