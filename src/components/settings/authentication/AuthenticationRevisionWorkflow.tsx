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

import {
  UserCheck,
  CheckCircle2,
  RotateCcw,
  ExternalLink,
  ChevronDown,
} from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';

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
    <div className="rounded-xl border bg-card p-5 space-y-5 shadow-xs" aria-labelledby="auth-test-title">
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
        {selected?.testedAt && (
          <Badge variant="success" className="text-xs shrink-0">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Tested Verified
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        First stage the shared draft, then complete a real provider sign-in. Discovery success alone
        does not prove administrator access.
      </p>

      <div className="space-y-4">
        <label className="block space-y-1.5 text-sm">
          <span className="font-semibold text-foreground text-xs uppercase tracking-wider">
            Saved provider configuration
          </span>
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

        {/* Verification Status Pill Grid */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-muted/30">
            <span className="font-semibold text-muted-foreground">Discovery:</span>
            {selected?.discoveryVerifiedAt ? (
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {new Date(selected.discoveryVerifiedAt).toLocaleString()}
              </Badge>
            ) : (
              <Badge variant="neutral" className="text-[10px]">Not validated</Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border bg-muted/30">
            <span className="font-semibold text-muted-foreground">Admin Sign-in:</span>
            {selected?.testedAt ? (
              <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {new Date(selected.testedAt).toLocaleString()}
              </Badge>
            ) : (
              <Badge variant="neutral" className="text-[10px]">Not verified</Badge>
            )}
          </div>
        </div>

        <AuthenticationAdminPicker
          label="Administrator to verify"
          value={adminId}
          onChange={setAdminId}
          initialAdmins={data.users.filter(user => user.role === 'ADMIN' && user.status === 'ACTIVE')}
          disabled={data.actor.kind === 'admin'}
        />

        <label className="flex items-start gap-2.5 text-sm p-3.5 rounded-xl border bg-muted/20">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-input"
            checked={linkApproved}
            onChange={event => setLinkApproved(event.target.checked)}
          />
          <span className="text-xs text-foreground leading-relaxed">
            Authorize linking the verified identity to this existing administrator if needed. Email
            alone never links an account.
          </span>
        </label>
      </div>

      <div className="pt-2">
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
            className="gap-2"
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
            <ExternalLink className="h-4 w-4" />
            Test administrator sign-in
          </Button>
        </AuthenticationActionGuard>
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
                setRevisionId(result.revisionId);
                setDraftBaseConfigVersion(data.providerConfigVersion);
                await refresh();
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
