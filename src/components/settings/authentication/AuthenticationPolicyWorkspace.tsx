'use client';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  KeyRound,
  Lock,
  Info,
  ChevronRight,
  UserCheck,
  ExternalLink,
} from 'lucide-react';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';
import AuthenticationSessionPolicyForm from './AuthenticationSessionPolicyForm';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';
import AuthenticationAdminPicker from '../AuthenticationAdminPicker';
import AuthenticationRevisionSelector from './AuthenticationRevisionSelector';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import type { enforcementPreview } from '@/lib/auth-control/oidc-revisions';

type Preview = Awaited<ReturnType<typeof enforcementPreview>>;

export default function AuthenticationPolicyWorkspace() {
  const {
    draftDirty,
    setDraftBaseConfigVersion,
    setActiveTab,
    modeConfirmed,
    setModeConfirmed,
    data,
    revisionId,
    impact,
    setImpact,
    mode,
    setMode,
    confirmation,
    setConfirmation,
    setMessage,
    password,
    setPassword,
    normalMode,
    setNormalMode,
    refresh,
    pending,
    perform,
    inputClass,
    sectionClass,
    adminId,
    setAdminId,
    linkApproved,
    setLinkApproved,
  } = useAuthenticationWorkspace();

  const selectedRevision =
    data.revisions.find(rev => rev.id === revisionId) ?? data.revisions[0];

  const adminTestAvailability = actionAvailability('Test administrator sign-in', [
    pending && { code: 'busy', message: 'Wait for current operation to finish.' },
    draftDirty && {
      code: 'draft',
      message: 'Stage your draft changes before testing sign-in.',
      resolutionTarget: 'connection',
      resolutionLabel: 'Go to draft',
    },
    !revisionId && { code: 'revision', message: 'Select a staged configuration first.' },
    !adminId && { code: 'admin', message: 'Select an administrator to verify.' },
    data.freshAuthenticationRequired && {
      code: 'fresh',
      message: 'Authenticate again before starting a sensitive operation.',
    },
  ]);

  return (
    <section id="authentication-3" className={sectionClass} aria-labelledby="auth-policy-title">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/80 pb-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary shrink-0">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 id="auth-policy-title" className="text-lg font-semibold tracking-tight text-foreground">
                Sessions &amp; Policies
              </h2>
              <Badge
                variant={data.mode === 'SSO_REQUIRED' ? 'success' : 'neutral'}
                className="text-xs font-semibold uppercase"
              >
                {data.mode.replaceAll('_', ' ')}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Current mode: {data.mode.replaceAll('_', ' ')}. Validate administrator sign-in and review enforcement impact before activating SSO.
            </p>
          </div>
        </div>
      </div>

      {/* Session Policies Form */}
      <AuthenticationSessionPolicyForm key={revisionId} />

      {/* Clubbed: Validate Administrator Access & Sign-in Policy Activation Card */}
      <div className="space-y-6 rounded-xl border border-border/80 bg-card p-4 sm:p-6 shadow-xs">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            Validate Administrator Access &amp; Sign-in Policy Activation
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Complete the real administrator sign-in test, preview user impact, and activate your staged single sign-on policy.
          </p>
        </div>

        {/* Step 1: Configuration & Administrator Verification */}
        <div className="space-y-4 rounded-xl border border-border/60 bg-muted/15 p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border/50">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                <UserCheck className="h-4 w-4" />
              </div>
              <h4 className="text-sm font-semibold text-foreground">
                Step 1: Administrator Sign-in Verification
              </h4>
            </div>
            {selectedRevision?.testedAt ? (
              <Badge variant="success" className="text-xs shrink-0 font-medium">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Sign-in Verified
              </Badge>
            ) : (
              <Badge variant="warning" className="text-xs shrink-0 font-medium">
                <AlertTriangle className="h-3 w-3 mr-1" />
                Sign-in Test Required
              </Badge>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <AuthenticationRevisionSelector label="Saved configuration to activate" />
            </div>

            <div className="flex flex-col justify-end space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Configuration status</span>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-muted/40">
                  <span className="font-semibold text-muted-foreground">Discovery:</span>
                  {selectedRevision?.discoveryVerifiedAt ? (
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Validated
                    </Badge>
                  ) : (
                    <Badge variant="neutral" className="text-[10px]">Not validated</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-muted/40">
                  <span className="font-semibold text-muted-foreground">Admin Sign-in:</span>
                  {selectedRevision?.testedAt ? (
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Verified ({new Date(selectedRevision.testedAt).toLocaleTimeString()})
                    </Badge>
                  ) : (
                    <Badge variant="warning" className="text-[10px]">Needs Test</Badge>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Test Controls or Verified Notice */}
          {!selectedRevision?.testedAt ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3.5">
              <p className="text-xs text-foreground/90 leading-relaxed">
                Before activating this configuration, complete a real sign-in drill with your identity provider to confirm you will not be locked out.
              </p>
              <AuthenticationAdminPicker
                label="Administrator to verify"
                value={adminId}
                onChange={setAdminId}
                initialAdmins={data.users.filter(user => user.role === 'ADMIN' && user.status === 'ACTIVE')}
                disabled={data.actor.kind === 'admin'}
              />
              <label className="flex items-start gap-2.5 text-xs text-foreground select-none cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-border"
                  checked={linkApproved}
                  onChange={event => setLinkApproved(event.target.checked)}
                />
                <span className="leading-relaxed">
                  Authorize linking the verified identity to this existing administrator if needed. Email alone never links an account.
                </span>
              </label>
              <div>
                <AuthenticationActionGuard
                  availability={adminTestAvailability}
                  onResolve={setActiveTab}
                >
                  <Button
                    className="gap-2 shadow-xs"
                    onClick={() =>
                      void perform(async () => {
                        const result = await authenticationRequest<{ url: string }>({
                          action: 'test',
                          revisionId: selectedRevision?.id ?? revisionId,
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
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3.5 text-xs">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                <span className="leading-relaxed">
                  Administrator sign-in verified on {new Date(selectedRevision.testedAt).toLocaleString()}. You can now preview impact and activate this configuration below.
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-xs shrink-0 self-start sm:self-center"
                onClick={() =>
                  void perform(async () => {
                    const result = await authenticationRequest<{ url: string }>({
                      action: 'test',
                      revisionId: selectedRevision.id,
                      adminUserId: adminId,
                      linkApproved: true,
                    });
                    window.location.assign(result.url);
                  })
                }
              >
                Retest sign-in
              </Button>
            </div>
          )}
        </div>

        {/* Step 2: Policy Mode & Activation */}
        <div className="space-y-4 pt-1">
          <div className="flex items-center gap-2 pb-1">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Lock className="h-4 w-4" />
            </div>
            <h4 className="text-sm font-semibold text-foreground">
              Step 2: Sign-in Policy &amp; Activation
            </h4>
          </div>

          <label className="block space-y-1.5 text-sm font-medium">
            <span className="text-foreground">Activation mode</span>
            <select
              className={inputClass}
              value={mode}
              onChange={event => {
                setMode(event.target.value as typeof mode);
                setConfirmation(false);
              }}
            >
              <option value="SSO_OPTIONAL" disabled={data.mode === 'SSO_REQUIRED'}>
                SSO Optional
              </option>
              <option value="SSO_REQUIRED">SSO Required</option>
            </select>
            <span className="block text-xs font-normal text-muted-foreground pt-0.5">
              {mode === 'SSO_REQUIRED'
                ? 'SSO Required enforces authentication via external IdP for all non-emergency users.'
                : 'SSO Optional permits local password fallbacks and progressive onboarding.'}
            </span>
          </label>

          {/* Enforcement Impact Preview */}
          <div className="space-y-3 pt-1">
            <AuthenticationActionGuard
              availability={actionAvailability('Preview impact', [
                pending && {
                  code: 'busy',
                  message: 'Wait for the current operation or section to finish loading.',
                },
                draftDirty && {
                  code: 'draft',
                  message: 'Stage your draft before previewing its enforcement impact.',
                  resolutionTarget: 'connection',
                  resolutionLabel: 'Stage draft',
                },
                !revisionId && {
                  code: 'revision',
                  message: 'Stage or select a saved configuration first.',
                },
              ])}
              onResolve={setActiveTab}
            >
              <Button
                variant="outline"
                className="gap-2"
                onClick={() =>
                  void perform(async () => {
                    setImpact(await authenticationRequest<Preview>({ action: 'preview', revisionId }));
                    setConfirmation(false);
                  })
                }
              >
                <Info className="h-4 w-4" />
                Preview enforcement impact
              </Button>
            </AuthenticationActionGuard>

            {impact && (
              <div
                className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm"
                aria-live="polite"
              >
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                  <span>Enforcement impact summary</span>
                </div>
                <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed">
                  {impact.passwordSessionCount} registered password sessions affected;{' '}
                  {impact.usersRequiringLinking} users require linking;{' '}
                  {impact.verifiedEmergencyAccounts} emergency identities verified.
                </p>
                <div className="flex items-center gap-2 text-xs">
                  <Badge
                    variant={impact.adminVerified ? 'success' : 'warning'}
                    className="font-semibold text-xs"
                  >
                    Real administrator login: {impact.adminVerified ? 'verified' : 'required'}
                  </Badge>
                </div>
                {impact.blockers.length > 0 && (
                  <div className="mt-2 space-y-1.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Blockers preventing activation:
                    </p>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {impact.blockers.map(blocker => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Activation Review Confirmation */}
          <div className="border-t border-border/70 pt-4 space-y-3">
            <label className="flex items-start gap-2.5 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-border text-primary focus:ring-ring"
                checked={confirmation}
                onChange={event => setConfirmation(event.target.checked)}
              />
              <span className="text-xs sm:text-sm font-medium text-foreground leading-snug">
                I reviewed the impact and confirm activation of this verified revision and sign-in policy.
              </span>
            </label>

            <AuthenticationActionGuard
              availability={actionAvailability('Activate SSO', [
                pending && {
                  code: 'busy',
                  message: 'Wait for the current operation or section to finish loading.',
                },
                draftDirty && {
                  code: 'draft',
                  message: 'Stage draft changes and repeat the real administrator sign-in test.',
                  resolutionTarget: 'connection',
                },
                !impact && { code: 'preview', message: 'Preview enforcement impact before activation.' },
                !confirmation && { code: 'confirm', message: 'Confirm that you reviewed the impact.' },
                Boolean(impact && !impact.adminVerified) && {
                  code: 'test',
                  message: 'Complete the administrator sign-in test above for this revision.',
                },
                data.freshAuthenticationRequired && {
                  code: 'fresh',
                  message: 'Sign in again or verify your recovery credential before activating.',
                },
                data.originConflict && {
                  code: 'origin',
                  message: 'Repair conflicting deployment URLs before activation.',
                  resolutionTarget: 'diagnostics',
                },
                ...(mode === 'SSO_REQUIRED'
                  ? (impact?.blockers ?? []).map((message, index) => ({
                      code: `server-${index}`,
                      message,
                    }))
                  : []),
              ])}
              onResolve={setActiveTab}
            >
              <Button
                className="gap-2 shadow-xs"
                onClick={() =>
                  void perform(async () => {
                    const activated = await authenticationRequest<{ providerConfigVersion: number }>({
                      action: 'activate',
                      revisionId,
                      expectedVersion: impact!.policyVersion,
                      mode,
                      confirmation: 'ACTIVATE VERIFIED SSO',
                    });
                    setDraftBaseConfigVersion(activated.providerConfigVersion);
                    setConfirmation(false);
                    setImpact(null);
                    setMessage(
                      'Verified SSO activated. Disallowed sessions are revoked; complete a new sign-in if this provider changed.'
                    );
                    await refresh();
                  })
                }
              >
                <ShieldCheck className="h-4 w-4" />
                Activate verified SSO
              </Button>
            </AuthenticationActionGuard>
          </div>
        </div>
      </div>

      {/* Emergency Rollback or Manual Policy Change Accordion */}
      {data.actor.kind === 'admin' && (
        <details className="group rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs transition-all open:ring-1 open:ring-border">
          <summary className="flex cursor-pointer items-center justify-between font-semibold text-sm text-foreground list-none select-none">
            <span className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
              Change to Password Only or SSO Optional
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-90" />
          </summary>
          <div className="mt-4 space-y-4 border-t border-border/60 pt-4 text-sm">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Administrative Policy Override
              </p>
              <p className="mt-1 leading-relaxed">
                Reverting to Password Only or SSO Optional allows local password logins. Use this if your external identity provider experiences an extended outage.
              </p>
            </div>

            <label className="block space-y-1.5">
              <span className="font-medium text-foreground">New authentication mode</span>
              <select
                className={inputClass}
                value={normalMode}
                onChange={event => setNormalMode(event.target.value as typeof normalMode)}
              >
                <option value="SSO_OPTIONAL">SSO Optional</option>
                <option value="PASSWORD_ONLY">Password Only</option>
              </select>
            </label>

            <label className="block space-y-1.5">
              <span className="font-medium text-foreground">
                Current password (required for Password Only)
              </span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                className={inputClass}
                placeholder="Enter your current administrator password"
              />
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-border text-primary focus:ring-ring"
                checked={modeConfirmed}
                onChange={event => setModeConfirmed(event.target.checked)}
              />
              <span className="text-xs text-muted-foreground">
                I confirm this deliberate sign-in policy change and its session effects.
              </span>
            </label>

            <AuthenticationActionGuard
              availability={actionAvailability('Change mode', [
                pending && { code: 'busy', message: 'Wait for the current operation.' },
                !modeConfirmed && {
                  code: 'confirm',
                  message: 'Confirm the deliberate policy change.',
                },
                normalMode === 'PASSWORD_ONLY' &&
                  !password && {
                    code: 'password',
                    message: 'Enter your current password to verify local access.',
                  },
                data.freshAuthenticationRequired && {
                  code: 'fresh',
                  message: 'Sign in again before changing authentication policy.',
                },
              ])}
            >
              <Button
                variant="outline"
                className="gap-2"
                onClick={() =>
                  void perform(async () => {
                    await authenticationRequest({
                      action: 'mode',
                      mode: normalMode,
                      expectedVersion: data.policyVersion,
                      currentPassword: password,
                      confirmation: 'CHANGE AUTHENTICATION POLICY',
                    });
                    setPassword('');
                    await refresh();
                  })
                }
              >
                <KeyRound className="h-4 w-4" />
                Change authentication mode
              </Button>
            </AuthenticationActionGuard>
          </div>
        </details>
      )}
    </section>
  );
}
