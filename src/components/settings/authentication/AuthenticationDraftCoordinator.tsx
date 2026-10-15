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
import { CheckCircle2, ArrowRight, Layers, FileEdit } from 'lucide-react';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';
import { providerDefinitions } from '@/lib/auth-control/provider-definitions';
import ProviderLogo from './ProviderLogo';

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
      className={`min-w-0 space-y-3 rounded-2xl border p-4 sm:p-5 shadow-sm transition-all duration-200 mt-6 ${
        draftDirty
          ? 'border-amber-500/40 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-card dark:from-amber-950/40 dark:via-amber-950/20 dark:to-card ring-1 ring-amber-500/30'
          : data.revisions.length > 0
            ? 'border-emerald-500/40 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-card dark:from-emerald-950/35 dark:via-emerald-950/15 dark:to-card ring-1 ring-emerald-500/20'
            : 'border-blue-500/40 bg-gradient-to-r from-blue-500/10 via-indigo-500/5 to-card dark:from-blue-950/35 dark:via-indigo-950/15 dark:to-card ring-1 ring-blue-500/20'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5 min-w-0">
          <div
            className={`p-2.5 rounded-xl shrink-0 ${
              draftDirty
                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                : data.revisions.length > 0
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
            }`}
          >
            {draftDirty ? (
              <FileEdit className="h-5 w-5" />
            ) : data.revisions.length > 0 ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <Layers className="h-5 w-5" />
            )}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 font-bold text-sm text-foreground">
                <div className="w-5 h-5 rounded bg-background/80 flex items-center justify-center shrink-0 border border-border/50 p-0.5">
                  <ProviderLogo providerType={configuration.providerType} className="h-3.5 w-3.5 shrink-0" />
                </div>
                <span>
                  {draftDirty ? 'Changes not staged' : 'Provider draft'} ·{' '}
                  {providerDefinitions[configuration.providerType]?.label ??
                    (configuration.providerType === 'azure' ? 'Microsoft Entra ID' : configuration.providerType)}
                </span>
              </div>
              {draftDirty ? (
                <Badge variant="outline" className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-semibold">
                  Unstaged Edits
                </Badge>
              ) : data.revisions.length > 0 ? (
                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Configuration Staged
                </Badge>
              ) : (
                <Badge variant="outline" className="border-blue-500/40 bg-blue-500/15 text-blue-700 dark:text-blue-300 text-[10px] font-semibold">
                  Ready to Stage
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Provider, access and session changes share this draft. Staging does not change active
              sign-in.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {draftDirty || data.revisions.length === 0 ? (
            <AuthenticationActionGuard availability={availability} onResolve={setActiveTab}>
              <Button size="sm" onClick={() => void stageDraft()}>Stage configuration</Button>
            </AuthenticationActionGuard>
          ) : (
            <Button size="sm" variant="secondary" disabled className="gap-1.5 opacity-80">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              Staged
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!draftDirty || pending}
            onClick={() => setDraftDiscardRequested(true)}
            title={
              !draftDirty
                ? 'There are no edits to discard. You may stage the current configuration to validate discovery.'
                : undefined
            }
          >
            Discard changes
          </Button>
        </div>
      </div>
      {!draftDirty && data.revisions.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
          <p>
            Current configuration is staged. Proceed to test administrator access and activate SSO.
          </p>
          {activeTab !== 'policy' && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs text-primary gap-1 font-semibold"
              onClick={() => setActiveTab('policy')}
            >
              Go to Policy &amp; Activation
              <ArrowRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}
      {!draftDirty && data.revisions.length === 0 && (
        <div className="flex items-center gap-2 pt-2 border-t border-border/50 text-xs text-muted-foreground">
          <span>There are no edits to discard. You may stage the current configuration to validate discovery.</span>
        </div>
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
