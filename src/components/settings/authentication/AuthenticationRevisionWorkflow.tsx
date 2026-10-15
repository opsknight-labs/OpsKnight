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
import AuthenticationAdminPicker from '../AuthenticationAdminPicker';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';

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
    adminId,
    setAdminId,
    linkApproved,
    pending,
    perform,
    refresh,
    setMessage,
    inputClass,
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
      resolutionLabel: 'Stage changes above',
      resolutionTarget: 'connection' as const,
    },
    !revisionId && {
      code: 'revision',
      message: 'Stage the draft or select a saved configuration.',
    },
    Boolean(
      selected &&
      selected.id !== data.activeRevisionId &&
      selected.baseConfigVersion !== data.providerConfigVersion
    ) && {
      code: 'stale',
      message:
        'This saved configuration predates the active provider. Reload and stage a current draft.',
    },
    data.freshAuthenticationRequired && {
      code: 'fresh',
      message: 'Authenticate again before starting a sensitive operation.',
    },
  ];
  return (
    <section className="space-y-4 border-t border-border pt-5" aria-labelledby="auth-test-title">
      <h3 id="auth-test-title" className="font-semibold">
        Validate administrator access
      </h3>
      <p className="text-sm text-muted-foreground">
        First stage the shared draft, then complete a real provider sign-in. Discovery success alone
        does not prove administrator access.
      </p>
      <label className="block space-y-1 text-sm">
        <span>Saved provider configuration</span>
        <select
          className={inputClass}
          value={revisionId}
          disabled={pending}
          onChange={event => {
            if (draftDirty) setPendingRevision(event.target.value);
            else load(event.target.value);
          }}
        >
          <option value="" disabled>
            Choose a saved configuration
          </option>
          {data.revisions.map((revision, index) => (
            <option key={revision.id} value={revision.id}>
              {revision.id === data.activeRevisionId
                ? 'Active configuration'
                : revision.activatedAt
                  ? 'Previous configuration'
                  : `Staged configuration ${data.revisions.length - index}`}{' '}
              · {new Date(revision.createdAt).toLocaleString()}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        Discovery:{' '}
        {selected?.discoveryVerifiedAt
          ? new Date(selected.discoveryVerifiedAt).toLocaleString()
          : 'Not validated'}
        . Administrator sign-in:{' '}
        {selected?.testedAt ? new Date(selected.testedAt).toLocaleString() : 'Not verified'}.
      </p>
      <AuthenticationAdminPicker
        label="Administrator to verify"
        value={adminId}
        onChange={setAdminId}
        initialAdmins={data.users.filter(user => user.role === 'ADMIN' && user.status === 'ACTIVE')}
        disabled={data.actor.kind === 'admin'}
      />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={linkApproved}
          onChange={event => setLinkApproved(event.target.checked)}
        />
        Authorize linking the verified identity to this existing administrator if needed. Email
        alone never links an account.
      </label>
      <AuthenticationActionGuard
        availability={actionAvailability('Test administrator sign-in', [
          ...common,
          !adminId && {
            code: 'admin',
            message: 'Select an active existing administrator to verify.',
          },
        ])}
        onResolve={setActiveTab}
      >
        <Button
          onClick={() =>
            void perform(async () => {
              const result = await authenticationRequest<{ url: string }>({
                action: 'test',
                revisionId,
                adminUserId: adminId,
                linkApproved,
              });
              window.location.assign(result.url);
            })
          }
        >
          Test administrator sign-in
        </Button>
      </AuthenticationActionGuard>
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm font-medium">
          Restore a previously saved configuration
        </summary>
        <p className="text-xs text-muted-foreground">
          Rollback stages a new candidate and still requires a fresh real administrator test before
          activation.
        </p>
        <AuthenticationActionGuard
          availability={actionAvailability('Stage rollback', common)}
          onResolve={setActiveTab}
        >
          <Button
            variant="outline"
            onClick={() =>
              void perform(async () => {
                const result = await authenticationRequest<{ revisionId: string }>({
                  action: 'rollback',
                  revisionId,
                });
                setRevisionId(result.revisionId);
                setDraftBaseConfigVersion(data.providerConfigVersion);
                await refresh();
                setMessage('Previous configuration staged. Test it before activation.');
              })
            }
          >
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
          <div className="flex flex-wrap gap-2">
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
    </section>
  );
}
