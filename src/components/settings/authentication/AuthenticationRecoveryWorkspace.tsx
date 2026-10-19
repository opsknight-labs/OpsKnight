'use client';
import { useState } from 'react';
import {
  KeyRound,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  LogOut,
  ExternalLink,
  Lock,
  ChevronRight,
  ShieldCheck,
  UserCheck,
  Eye,
  EyeOff,
} from 'lucide-react';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';
import RecoveryAccounts from './RecoveryAccounts';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import AuthenticationAdminPicker from '../AuthenticationAdminPicker';
import Link from 'next/link';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';

export default function AuthenticationRecoveryWorkspace() {
  const {
    originRepairConfirmed,
    setOriginRepairConfirmed,
    data,
    setMessage,
    recoveryReauthPassword,
    setRecoveryReauthPassword,
    router,
    refresh,
    pending,
    perform,
    inputClass,
    sectionClass,
  } = useAuthenticationWorkspace();

  const [showReauthPassword, setShowReauthPassword] = useState(false);

  return (
    <section className={sectionClass} aria-labelledby="emergency-access-title">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/80 pb-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary shrink-0">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2
                id="emergency-access-title"
                className="text-lg font-semibold tracking-tight text-foreground"
              >
                Emergency Access
              </h2>
              <Badge
                variant={data.verifiedEmergencyAccounts >= 2 ? 'success' : 'warning'}
                className="text-xs font-semibold"
              >
                {data.verifiedEmergencyAccounts} Verified{' '}
                {data.verifiedEmergencyAccounts === 1 ? 'Identity' : 'Identities'}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Create an independently vaulted password or enroll separately held hardware keys. Sign
              in at{' '}
              <Link
                className="underline text-primary hover:text-primary/80 font-medium inline-flex items-center gap-0.5"
                href="/login/emergency"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>Emergency sign-in</span>
                <ExternalLink className="h-3 w-3" />
              </Link>{' '}
              in a fresh browser session to verify each identity. There is no Remember Me. Recovery
              sessions last at most one hour and expire after 15 minutes without deliberate
              interaction.
            </p>
          </div>
        </div>
      </div>

      {/* Origin Conflict Alert */}
      {data.actor.kind === 'emergency' && data.originConflict && data.recoveryOriginPinned && (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <h3 className="font-semibold text-sm text-amber-900 dark:text-amber-200">
              Repair the configured application URL
            </h3>
          </div>
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            Only the deployment-pinned recovery origin can be saved. First align deployment URL
            settings on every web replica.
          </p>
          <label className="flex items-start gap-2.5 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              className="mt-0.5 rounded border-amber-500/40 text-amber-600 focus:ring-amber-500"
              checked={originRepairConfirmed}
              onChange={event => setOriginRepairConfirmed(event.target.checked)}
            />
            <span className="text-xs text-amber-950 dark:text-amber-100 font-medium">
              I confirm the pinned origin is the trusted URL used for these recovery identities.
            </span>
          </label>
          <AuthenticationActionGuard
            availability={actionAvailability('Repair pinned application URL', [
              pending && { code: 'busy', message: 'Wait for the current operation.' },
              !originRepairConfirmed && {
                code: 'confirm',
                message: 'Confirm that the pinned origin is trusted.',
              },
              data.freshAuthenticationRequired && {
                code: 'fresh',
                message: 'Verify your recovery credential again before repairing the origin.',
              },
            ])}
          >
            <Button
              variant="outline"
              size="sm"
              className="border-amber-500/40 hover:bg-amber-500/10 text-amber-900 dark:text-amber-200"
              onClick={() =>
                void perform(async () => {
                  await authenticationRequest({
                    action: 'repairOrigin',
                    expectedVersion: data.policyVersion,
                    confirmation: 'REPAIR PINNED ORIGIN',
                  });
                  await refresh();
                  setMessage(
                    'Application URL repaired. Wait for replica observations to converge, then test SSO again.'
                  );
                })
              }
            >
              Repair pinned application URL
            </Button>
          </AuthenticationActionGuard>
        </div>
      )}

      {/* Recovery Identities Management */}
      <RecoveryAccounts />

      {/* Legacy Emergency Password Notice */}
      {data.legacyEmergencyConfigured && (
        <div className="space-y-3 rounded-xl border border-border/80 bg-muted/20 p-4 text-sm">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-500" />
            <h4 className="font-semibold text-xs uppercase tracking-wider text-foreground">
              Legacy Emergency Access
            </h4>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            A legacy emergency password is still configured. It grants recovery-only access.
            Retiring it preserves its original User record and revokes legacy recovery sessions.
          </p>
          <AuthenticationActionGuard
            availability={actionAvailability('Retire legacy emergency password', [
              pending && { code: 'busy', message: 'Wait for the current operation.' },
              data.verifiedEmergencyAccounts < 2 && {
                code: 'recovery',
                message:
                  'Verify two independent recovery identities before retiring the legacy password.',
              },
              data.freshAuthenticationRequired && {
                code: 'fresh',
                message: 'Verify your sign-in again before retiring credentials.',
              },
            ])}
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void perform(async () => {
                  await authenticationRequest({ action: 'retireLegacy' });
                  await refresh();
                  setMessage('Legacy emergency password retired successfully.');
                })
              }
            >
              Retire legacy emergency password
            </Button>
          </AuthenticationActionGuard>
        </div>
      )}

      {/* Self-service password access for a normally signed-in administrator */}
      {data.actor.kind === 'admin' && data.mode === 'SSO_REQUIRED' && (
        <div className="space-y-3 rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs text-sm">
          <div className="flex items-center gap-2 border-b border-border/70 pb-3">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm text-foreground">Password access recovery</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            While SSO Required is active, set a password for your own administrator account, for
            example before an identity provider outage or while your current SSO session is still
            active. To restore another administrator, sign in with an emergency recovery account.
          </p>
          <PasswordAccessRecovery />
        </div>
      )}

      {/* Recovery Actor Mode Active Banner & Controls */}
      {data.actor.kind !== 'admin' && (
        <div className="space-y-4 rounded-xl border border-border/80 bg-card p-4 sm:p-5 shadow-xs text-sm">
          <div className="flex items-center gap-2 border-b border-border/70 pb-3">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm text-foreground">Recovery Session Actions</h3>
          </div>

          {/* Fresh reauth for password */}
          {data.actor.kind === 'emergency' &&
            data.emergencyAccounts.find(account => account.id === data.actor.id)
              ?.authenticationMethod === 'PASSWORD' && (
              <form
                className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center"
                onSubmit={event => {
                  event.preventDefault();
                  void perform(async () => {
                    try {
                      await authenticationRequest(
                        {
                          action: 'passwordReauth',
                          accountId: data.actor.id,
                          password: recoveryReauthPassword,
                        },
                        '/api/auth/emergency'
                      );
                      await refresh();
                      setMessage('Recovery credentials verified successfully.');
                    } finally {
                      setRecoveryReauthPassword('');
                    }
                  });
                }}
              >
                <div className="relative flex-1">
                  <input
                    aria-label="Recovery password for fresh verification"
                    className={`${inputClass} pr-10`}
                    type={showReauthPassword ? 'text' : 'password'}
                    placeholder="Enter recovery password"
                    autoComplete="current-password"
                    required
                    value={recoveryReauthPassword}
                    onChange={event => setRecoveryReauthPassword(event.target.value)}
                    disabled={pending}
                  />
                  <button
                    type="button"
                    onClick={() => setShowReauthPassword(prev => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={showReauthPassword ? 'Hide password' : 'Show password'}
                  >
                    {showReauthPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button type="submit" disabled={pending} className="shrink-0 gap-1.5">
                  <RefreshCw className="h-4 w-4" />
                  Verify recovery password again
                </Button>
              </form>
            )}

          {/* Fresh reauth for webauthn */}
          {data.actor.kind === 'emergency' &&
            data.emergencyAccounts.find(account => account.id === data.actor.id)
              ?.authenticationMethod !== 'PASSWORD' && (
              <Button
                variant="outline"
                disabled={pending}
                className="gap-2"
                onClick={() =>
                  void perform(async () => {
                    const options = await authenticationRequest<{
                      options: PublicKeyCredentialRequestOptionsJSON;
                      challengeId: string;
                    }>(
                      { action: 'options', accountId: data.actor.id, reauthenticate: true },
                      '/api/auth/emergency'
                    );
                    const response = await (
                      await import('@simplewebauthn/browser')
                    ).startAuthentication({ optionsJSON: options.options });
                    await authenticationRequest(
                      { action: 'verify', challengeId: options.challengeId, response },
                      '/api/auth/emergency'
                    );
                    await refresh();
                    setMessage(
                      'Emergency credential verified again. The absolute session expiry is unchanged.'
                    );
                  })
                }
              >
                <KeyRound className="h-4 w-4" />
                Verify emergency credential again
              </Button>
            )}

          {/* Legacy actor link */}
          {data.actor.kind === 'legacy' && (
            <Link
              className="text-xs font-semibold text-primary underline inline-flex items-center gap-1 hover:text-primary/80"
              href="/login/emergency"
            >
              <span>Sign in again for fresh legacy verification</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}

          <PasswordAccessRecovery />

          {/* Sign out of recovery session */}
          <div className="pt-2 border-t border-border/60">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              className="gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() =>
                void perform(async () => {
                  await authenticationRequest({ action: 'logout' }, '/api/auth/emergency');
                  router.replace('/login/emergency');
                })
              }
            >
              <LogOut className="h-4 w-4" />
              Sign out of recovery
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Restores password sign-in for an administrator. In an emergency recovery session any active
 * administrator may be selected; a normally signed-in administrator can restore only their own
 * account (enforced by the server as well).
 */
function PasswordAccessRecovery() {
  const {
    restoreScope,
    setRestoreScope,
    data,
    adminId,
    setAdminId,
    setMessage,
    password,
    setPassword,
    restoreConfirmed,
    setRestoreConfirmed,
    router,
    refresh,
    pending,
    perform,
    inputClass,
  } = useAuthenticationWorkspace();
  const selfService = data.actor.kind === 'admin';
  const targetId = selfService ? data.actor.id : adminId;
  const self = data.users.find(user => user.id === data.actor.id);
  const [showRestorePassword, setShowRestorePassword] = useState(false);

  return (
    <details className="group rounded-xl border border-border/80 bg-muted/20 p-4 transition-all open:ring-1 open:ring-border">
      <summary className="flex cursor-pointer items-center justify-between font-semibold text-xs sm:text-sm text-foreground list-none select-none">
        <span className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-primary" />
          {selfService
            ? 'Restore password access for your account'
            : 'Restore ordinary administrator access during an IdP outage'}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-open:rotate-90" />
      </summary>
      <div className="mt-4 space-y-4 border-t border-border/60 pt-4 text-sm">
        <p className="text-xs text-muted-foreground leading-relaxed">
          {restoreScope === 'INSTANCE'
            ? 'This switches the whole instance to Password Only, replaces the administrator’s password, and signs out SSO sessions and old reset links.'
            : 'This replaces the administrator’s password and allows password sign-in for that administrator only, for one hour. The SSO policy for everyone else is unchanged.'}{' '}
          The administrator is signed out everywhere and signs in again with the new password.
          Prefer repairing and testing a staged provider when the IdP is available.
        </p>

        <label className="block space-y-1.5 text-xs font-medium">
          <span className="text-foreground">Password recovery scope</span>
          <select
            className={inputClass}
            value={restoreScope}
            onChange={event => {
              setRestoreScope(event.target.value as typeof restoreScope);
              setRestoreConfirmed(false);
            }}
          >
            <option value="ADMIN_ONLY">Only this administrator · one hour</option>
            <option value="INSTANCE">Entire instance · Password Only</option>
          </select>
          <p className="text-muted-foreground text-[11px] pt-0.5">
            Instance recovery reactivates all existing local passwords and revokes OIDC sessions.
            Choose it only when deliberately abandoning SSO enforcement.
          </p>
        </label>

        {selfService ? (
          <div className="space-y-1 text-xs">
            <span className="font-medium text-foreground">Administrator to restore</span>
            <p className="rounded-lg border bg-background px-3 py-2 text-foreground break-all">
              {self ? `${self.name || self.email} · ${self.email}` : 'Your account'}
            </p>
          </div>
        ) : (
          <AuthenticationAdminPicker
            label="Administrator to restore"
            value={adminId}
            onChange={setAdminId}
            initialAdmins={data.users.filter(
              user => user.role === 'ADMIN' && user.status === 'ACTIVE'
            )}
            disabled={data.actor.kind === 'legacy'}
            disabledReason="Legacy recovery cannot select an administrator. Use an independent recovery identity to restore administrator access."
          />
        )}

        <label className="block space-y-1.5 text-xs font-medium">
          <span className="text-foreground">New strong administrator password</span>
          <div className="relative">
            <input
              className={`${inputClass} pr-10`}
              type={showRestorePassword ? 'text' : 'password'}
              placeholder="Enter a new strong password"
              autoComplete="new-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowRestorePassword(prev => !prev)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={showRestorePassword ? 'Hide password' : 'Show password'}
            >
              {showRestorePassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>

        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-border text-primary focus:ring-ring"
            checked={restoreConfirmed}
            onChange={event => setRestoreConfirmed(event.target.checked)}
          />
          <span className="text-xs text-muted-foreground leading-snug">
            I authorize the selected password recovery scope for this existing administrator. Other
            users’ local passwords stay blocked in administrator-only recovery.
          </span>
        </label>

        <AuthenticationActionGuard
          availability={actionAvailability('Restore password access', [
            pending && { code: 'busy', message: 'Wait for the current operation.' },
            !restoreConfirmed && {
              code: 'confirm',
              message: 'Authorize the selected password recovery scope.',
            },
            !targetId && {
              code: 'admin',
              message: 'Select the existing administrator to restore.',
            },
            !password && {
              code: 'password',
              message: 'Enter a new strong administrator password.',
            },
            data.actor.kind === 'legacy' && {
              code: 'legacy',
              message: 'Use an independent recovery identity to restore an administrator.',
            },
            data.freshAuthenticationRequired && {
              code: 'fresh',
              message: selfService
                ? 'Your last sign-in was more than two hours ago. Sign in again to continue.'
                : 'Verify your recovery credential again before restoring access.',
            },
          ])}
        >
          <Button
            size="sm"
            className="gap-2"
            onClick={() =>
              void perform(async () => {
                await authenticationRequest({
                  action: 'restorePassword',
                  adminUserId: targetId,
                  password,
                  expectedVersion: data.policyVersion,
                  confirmation:
                    restoreScope === 'INSTANCE'
                      ? 'RESTORE INSTANCE PASSWORD ACCESS'
                      : 'RESTORE PASSWORD ACCESS',
                  scope: restoreScope,
                });
                setPassword('');
                if (selfService) {
                  // Restoring rotates this administrator's sessions, including the current one.
                  router.replace('/login?passwordRestored=1');
                  return;
                }
                if (data.actor.kind === 'emergency') await refresh();
                setMessage(
                  restoreScope === 'INSTANCE'
                    ? 'Password Only restored instance-wide. Existing local passwords can sign in.'
                    : 'Temporary password sign-in enabled only for the restored administrator for one hour. SSO policy stays unchanged.'
                );
              })
            }
          >
            <Lock className="h-4 w-4" />
            Restore password access
          </Button>
        </AuthenticationActionGuard>
      </div>
    </details>
  );
}
