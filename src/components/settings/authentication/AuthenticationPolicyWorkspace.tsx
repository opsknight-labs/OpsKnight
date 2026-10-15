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
} from 'lucide-react';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';
import AuthenticationSessionPolicyForm from './AuthenticationSessionPolicyForm';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';
import AuthenticationRevisionSelector from './AuthenticationRevisionSelector';
import AuthenticationAdminTestPanel from './AuthenticationAdminTestPanel';
import { AuthenticationVerificationBadge } from './AuthenticationVerificationStatus';
import { oidcProofLabel } from '@/lib/auth-control/proof-status';
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
  } = useAuthenticationWorkspace();

  const selectedRevision = data.revisions.find(rev => rev.id === revisionId);
  // Emergency recovery may only step SSO Required back to SSO Optional from this panel.
  const recoverySession = data.actor.kind === 'emergency';
  const verification = selectedRevision?.verification;

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
              <h2
                id="auth-policy-title"
                className="text-lg font-semibold tracking-tight text-foreground"
              >
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
              Current mode: {data.mode.replaceAll('_', ' ')}. Validate administrator sign-in and
              review enforcement impact before activating SSO.
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
            Complete the real administrator sign-in test, preview user impact, and activate your
            staged single sign-on policy.
          </p>
        </div>

        {/* Step 1: Configuration & Administrator Verification */}
        <div className="space-y-4 rounded-xl border border-border/60 bg-muted/15 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border/50">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                <UserCheck className="h-4 w-4" />
              </div>
              <h4 className="text-sm font-semibold text-foreground">
                Step 1: Administrator sign-in verification
              </h4>
            </div>
            {verification && (
              <AuthenticationVerificationBadge verification={verification} compact />
            )}
          </div>
          <AuthenticationRevisionSelector label="Saved configuration to activate" />
          <AuthenticationAdminTestPanel />
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
                {data.mode === 'SSO_REQUIRED'
                  ? 'SSO Optional — use “Change to Password Only or SSO Optional” below'
                  : 'SSO Optional'}
              </option>
              <option value="SSO_REQUIRED">SSO Required</option>
            </select>
            <span className="block text-xs font-normal text-muted-foreground pt-0.5">
              {mode === 'SSO_REQUIRED'
                ? 'SSO Required enforces authentication via external IdP for all non-emergency users.'
                : 'SSO Optional permits local password fallbacks and progressive onboarding.'}
            </span>
          </label>
          {data.mode === 'SSO_REQUIRED' && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span>
                SSO Required is active. Activation never relaxes it; moving back to SSO Optional is
                a separate, deliberate policy change.
              </span>
              {data.actor.kind !== 'legacy' ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs font-semibold"
                  onClick={() => {
                    const panel = document.getElementById('auth-policy-mode-change');
                    if (panel instanceof HTMLDetailsElement) panel.open = true;
                    panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  Switch to SSO Optional
                </Button>
              ) : (
                <span>
                  Use an independent recovery identity or sign in as an administrator to change it.
                </span>
              )}
            </div>
          )}

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
                  message:
                    'Stage your draft in Connection before previewing its enforcement impact.',
                  resolutionTarget: 'connection',
                  resolutionLabel: 'Stage draft in Connection',
                },
                !revisionId && {
                  code: 'revision',
                  message:
                    'Select a saved configuration from the selector above, or stage a new draft.',
                  resolutionTarget: 'connection',
                  resolutionLabel: 'Stage in Connection',
                },
              ])}
              onResolve={setActiveTab}
            >
              <Button
                variant="outline"
                className="gap-2"
                onClick={() =>
                  void perform(async () => {
                    setImpact(
                      await authenticationRequest<Preview>({ action: 'preview', revisionId })
                    );
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
                <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    {
                      label: 'Password sessions',
                      value: impact.passwordSessionCount,
                      note:
                        mode === 'SSO_REQUIRED' ? 'Revoked on activation' : 'Kept (SSO Optional)',
                    },
                    {
                      label: 'Users to link',
                      value: impact.usersRequiringLinking,
                      note: 'Need first-time SSO linking',
                    },
                    {
                      label: 'Recovery identities',
                      value: impact.verifiedEmergencyAccounts,
                      note:
                        impact.verifiedEmergencyAccounts >= 2
                          ? 'Emergency access ready'
                          : 'Two required for SSO Required',
                    },
                  ].map(item => (
                    <div key={item.label} className="rounded-lg border bg-background/70 p-2.5">
                      <dt className="text-muted-foreground">{item.label}</dt>
                      <dd className="text-lg font-semibold text-foreground">{item.value}</dd>
                      <dd className="text-[11px] text-muted-foreground">{item.note}</dd>
                    </div>
                  ))}
                  <div className="rounded-lg border bg-background/70 p-2.5">
                    <dt className="text-muted-foreground">Administrator proof</dt>
                    <dd className="mt-1">
                      <AuthenticationVerificationBadge verification={impact.verification} />
                    </dd>
                  </div>
                </dl>
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
                I reviewed the impact and confirm activation of this verified revision and sign-in
                policy.
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
                  message: 'Stage draft changes and repeat the administrator sign-in test.',
                  resolutionTarget: 'connection',
                  resolutionLabel: 'Stage in Connection',
                },
                Boolean(verification && verification.state !== 'valid') && {
                  code: 'test',
                  message: oidcProofLabel(verification!.state).detail,
                },
                data.freshAuthenticationRequired && {
                  code: 'fresh',
                  message:
                    data.actor.kind === 'admin'
                      ? 'Your last sign-in was more than two hours ago. Sign out and sign in again to continue.'
                      : 'Verify your recovery credential again before activating.',
                },
                data.originConflict && {
                  code: 'origin',
                  message: 'Repair conflicting deployment URLs before activation.',
                  resolutionTarget: 'diagnostics',
                  resolutionLabel: 'View Origin Diagnostics',
                },
                !impact && {
                  code: 'preview',
                  message: 'Preview enforcement impact before activation.',
                },
                ...(mode === 'SSO_REQUIRED'
                  ? (impact?.blockers ?? [])
                      .filter(
                        message =>
                          message !== oidcProofLabel(verification?.state ?? 'required').detail
                      )
                      .map((message, index) => ({
                        code: `server-${index}`,
                        message,
                        ...(message.includes('emergency')
                          ? {
                              resolutionTarget: 'emergency' as const,
                              resolutionLabel: 'Set up recovery',
                            }
                          : {}),
                      }))
                  : []),
                Boolean(impact) &&
                  !confirmation && {
                    code: 'confirm',
                    message: 'Confirm that you reviewed the impact.',
                  },
              ])}
              onResolve={setActiveTab}
            >
              <Button
                className="gap-2 shadow-xs"
                onClick={() =>
                  void perform(async () => {
                    const activated = await authenticationRequest<{
                      providerConfigVersion: number;
                    }>({
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
                    await refresh(revisionId);
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
      {(data.actor.kind === 'admin' ||
        (data.actor.kind === 'emergency' && data.mode === 'SSO_REQUIRED')) && (
        <details
          id="auth-policy-mode-change"
          className="group scroll-mt-24 rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs transition-all open:ring-1 open:ring-border"
        >
          <summary className="flex cursor-pointer items-center justify-between font-semibold text-sm text-foreground list-none select-none">
            <span className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-500" />
              {recoverySession
                ? 'Change to SSO Optional'
                : 'Change to Password Only or SSO Optional'}
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
                {recoverySession
                  ? 'SSO Optional keeps SSO sign-in working and allows local password sign-in again. To switch the whole instance to Password Only, use password access recovery on the Emergency Recovery tab.'
                  : 'Reverting to Password Only or SSO Optional allows local password logins. Use this if your external identity provider experiences an extended outage.'}
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
                {!recoverySession && <option value="PASSWORD_ONLY">Password Only</option>}
              </select>
            </label>

            {!recoverySession && (
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
            )}

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
                  message: recoverySession
                    ? 'Verify your recovery credential again on the Emergency Recovery tab to change the policy.'
                    : 'Your last sign-in was more than two hours ago. Sign out and sign in again to change the policy.',
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
                      mode: recoverySession ? 'SSO_OPTIONAL' : normalMode,
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
