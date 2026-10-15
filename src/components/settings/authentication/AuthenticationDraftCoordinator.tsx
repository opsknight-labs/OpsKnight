'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
} from '@/components/ui/shadcn/dialog';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';

export default function AuthenticationDraftCoordinator() {
  const {
    configuration,
    data,
    draftDirty,
    pending,
    stageDraft,
    fieldErrors,
    discardDraft,
    draftDiscardRequested,
    setDraftDiscardRequested,
    draftBaseConfigVersion,
    setActiveTab,
    activeTab,
    setConfiguration,
    setProfileJson,
    setRevisionId,
    setDraftBaseConfigVersion,
    setDraftDirty,
    setImpact,
    setConfirmation,
  } = useAuthenticationWorkspace();
  const [reloadRequested, setReloadRequested] = useState(false);
  if (!['connection', 'access', 'policy'].includes(activeTab)) return null;
  const stale = data.providerConfigVersion !== draftBaseConfigVersion;
  const availability = actionAvailability('Stage configuration', [
    pending && {
      code: 'busy',
      message: 'Wait for the current operation or section to finish loading.',
    },
    stale && {
      code: 'stale',
      message:
        'Another administrator changed the active provider. Reload and review it before staging.',
      resolutionLabel: 'Review provider',
      resolutionTarget: 'connection',
    },
  ]);
  return (
    <aside
      aria-label="Shared authentication draft"
      className={`sticky top-0 z-20 min-w-0 space-y-3 rounded-xl border p-4 shadow-sm backdrop-blur-md transition-all duration-200 ${
        draftDirty
          ? 'border-amber-500/40 bg-card/95 ring-1 ring-amber-500/20'
          : 'border-border/80 bg-card/90'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-foreground">
              {draftDirty ? 'Changes not staged' : 'Provider draft'} ·{' '}
              {configuration.providerType === 'azure'
                ? 'Microsoft Entra ID'
                : configuration.providerType}
            </p>
            {draftDirty ? (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold">
                Unstaged Edits
              </Badge>
            ) : (
              <Badge variant="neutral" className="text-[10px]">
                Ready to Stage
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Provider, access and session changes share this draft. Staging does not change active
            sign-in.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AuthenticationActionGuard availability={availability} onResolve={setActiveTab}>
            <Button size="sm" onClick={() => void stageDraft()}>Stage configuration</Button>
          </AuthenticationActionGuard>
          <Button
            variant="outline"
            size="sm"
            disabled={!draftDirty || pending}
            onClick={() => setDraftDiscardRequested(true)}
          >
            Discard changes
          </Button>
        </div>
      </div>
      {!draftDirty && (
        <p className="text-xs text-muted-foreground">
          There are no edits to discard. You may stage the current configuration to validate
          discovery.
        </p>
      )}
      {stale && (
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !data.activeProvider}
          onClick={() => setReloadRequested(true)}
        >
          Reload active configuration
        </Button>
      )}
      <Dialog open={reloadRequested} onOpenChange={setReloadRequested}>
        <DialogContent>
          <DialogTitle>Reload active configuration?</DialogTitle>
          <DialogDescription>
            This replaces the entire shared draft with the current active provider. Review and stage
            it again before testing or activation.
          </DialogDescription>
          <Button
            variant="destructive"
            onClick={() => {
              if (!data.activeProvider) return;
              const { hasClientSecret: _secret, ...configuration } = data.activeProvider;
              setConfiguration(configuration);
              setProfileJson(JSON.stringify(configuration.profileMapping, null, 2));
              setRevisionId('');
              setDraftBaseConfigVersion(data.providerConfigVersion);
              setDraftDirty(false);
              setImpact(null);
              setConfirmation(false);
              setReloadRequested(false);
            }}
          >
            Replace draft with active configuration
          </Button>
        </DialogContent>
      </Dialog>
      {Object.keys(fieldErrors).length > 0 && (
        <div role="alert" className="text-sm text-destructive">
          <p className="font-medium">Resolve these fields before staging:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {Object.entries(fieldErrors).map(([field, error]) => (
              <li key={field}>
                <button
                  className="text-left underline underline-offset-2"
                  onClick={() => {
                    setActiveTab(
                      field.startsWith('session')
                        ? 'policy'
                        : field === 'roleMapping' ||
                            field === 'allowedDomains' ||
                            field === 'profileMapping'
                          ? 'access'
                          : 'connection'
                    );
                    window.setTimeout(
                      () => document.getElementById(`auth-field-${field}`)?.focus(),
                      0
                    );
                  }}
                >
                  {error}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Dialog open={draftDiscardRequested} onOpenChange={setDraftDiscardRequested}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard draft changes?</DialogTitle>
            <DialogDescription>
              This returns every editing section to the last loaded or staged configuration. The
              active provider and stored credentials do not change.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={discardDraft}>
              Discard draft changes
            </Button>
            <Button variant="outline" onClick={() => setDraftDiscardRequested(false)}>
              Keep editing
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
