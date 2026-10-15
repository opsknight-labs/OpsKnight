'use client';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';
import RecoveryAccounts from './RecoveryAccounts';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';
import { Button } from '@/components/ui/shadcn/button';
import AuthenticationAdminPicker from '../AuthenticationAdminPicker';
import Link from 'next/link';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
export default function AuthenticationRecoveryWorkspace() {
  const {
    restoreScope,
    setRestoreScope,
    originRepairConfirmed,
    setOriginRepairConfirmed,
    data,
    adminId,
    setAdminId,
    setMessage,
    recoveryReauthPassword,
    setRecoveryReauthPassword,
    password,
    setPassword,
    restoreConfirmed,
    setRestoreConfirmed,
    router,
    refresh,
    pending,
    perform,
    inputClass,
    sectionClass,
  } = useAuthenticationWorkspace();
  return (
    <section className={sectionClass} aria-labelledby="emergency-access-title">
      <h2 id="emergency-access-title" className="text-lg font-semibold">
        Emergency Access
      </h2>
      <p className="text-sm">
        Create an independently vaulted password or enroll separately held hardware keys. Sign in at{' '}
        <Link
          className="underline"
          href="/login/emergency"
          target="_blank"
          rel="noopener noreferrer"
        >
          Emergency sign-in
        </Link>{' '}
        in a fresh browser session to verify each identity. There is no Remember Me. Recovery
        sessions last at most one hour and expire after 15 minutes without deliberate interaction.
      </p>
      {data.actor.kind === 'emergency' && data.originConflict && data.recoveryOriginPinned && (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h3 className="font-semibold">Repair the configured application URL</h3>
          <p className="text-sm text-muted-foreground">
            Only the deployment-pinned recovery origin can be saved. First align deployment URL
            settings on every web replica.
          </p>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={originRepairConfirmed}
              onChange={event => setOriginRepairConfirmed(event.target.checked)}
            />
            I confirm the pinned origin is the trusted URL used for these recovery identities.
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
      <RecoveryAccounts />
      {data.legacyEmergencyConfigured && (
        <div className="space-y-3 text-sm">
          <p>
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
              onClick={() =>
                void perform(async () => {
                  await authenticationRequest({ action: 'retireLegacy' });
                  await refresh();
                })
              }
            >
              Retire legacy emergency password
            </Button>
          </AuthenticationActionGuard>
        </div>
      )}
      {data.actor.kind !== 'admin' && (
        <div className="space-y-3 text-sm">
          {data.actor.kind === 'emergency' &&
            data.emergencyAccounts.find(account => account.id === data.actor.id)
              ?.authenticationMethod === 'PASSWORD' && (
              <form
                className="flex flex-wrap gap-2"
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
                    } finally {
                      setRecoveryReauthPassword('');
                    }
                  });
                }}
              >
                <input
                  aria-label="Recovery password for fresh verification"
                  className={inputClass}
                  type="password"
                  autoComplete="current-password"
                  required
                  value={recoveryReauthPassword}
                  onChange={event => setRecoveryReauthPassword(event.target.value)}
                  disabled={pending}
                />
                <Button type="submit" disabled={pending}>
                  Verify recovery password again
                </Button>
              </form>
            )}
          {data.actor.kind === 'emergency' &&
            data.emergencyAccounts.find(account => account.id === data.actor.id)
              ?.authenticationMethod !== 'PASSWORD' && (
              <Button
                variant="outline"
                disabled={pending}
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
                Verify emergency credential again
              </Button>
            )}
          {data.actor.kind === 'legacy' && (
            <Link className="underline" href="/login/emergency">
              Sign in again for fresh legacy verification
            </Link>
          )}
          <details className="space-y-3">
            <summary className="cursor-pointer">
              Restore ordinary administrator access during an IdP outage
            </summary>
            <p>
              This explicitly switches to Password Only and replaces the selected existing
              administrator’s password. It revokes old sessions and reset links. Prefer repairing
              and testing a staged provider when the IdP is available.
            </p>
            <label className="block space-y-2 text-sm">
              <span className="font-medium">Password recovery scope</span>
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
              <p className="text-muted-foreground">
                Instance recovery reactivates all existing local passwords and revokes OIDC
                sessions. Choose it only when deliberately abandoning SSO enforcement.
              </p>
            </label>
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
            <label className="block">
              <span>New strong administrator password</span>
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
              />
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={restoreConfirmed}
                onChange={event => setRestoreConfirmed(event.target.checked)}
              />
              I authorize the selected password recovery scope for this existing administrator.
              Other users’ local passwords stay blocked in administrator-only recovery.
            </label>
            <AuthenticationActionGuard
              availability={actionAvailability('Restore password access', [
                pending && { code: 'busy', message: 'Wait for the current operation.' },
                !restoreConfirmed && {
                  code: 'confirm',
                  message: 'Authorize the selected password recovery scope.',
                },
                !adminId && {
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
                  message: 'Verify your recovery credential again before restoring access.',
                },
              ])}
            >
              <Button
                onClick={() =>
                  void perform(async () => {
                    await authenticationRequest({
                      action: 'restorePassword',
                      adminUserId: adminId,
                      password,
                      expectedVersion: data.policyVersion,
                      confirmation:
                        restoreScope === 'INSTANCE'
                          ? 'RESTORE INSTANCE PASSWORD ACCESS'
                          : 'RESTORE PASSWORD ACCESS',
                      scope: restoreScope,
                    });
                    setPassword('');
                    if (data.actor.kind === 'emergency') await refresh();
                    setMessage(
                      restoreScope === 'INSTANCE'
                        ? 'Password Only restored instance-wide. Existing local passwords can sign in.'
                        : 'Temporary password sign-in enabled only for the restored administrator for one hour. SSO policy stays unchanged.'
                    );
                  })
                }
              >
                Restore password access
              </Button>
            </AuthenticationActionGuard>
          </details>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              void perform(async () => {
                await authenticationRequest({ action: 'logout' }, '/api/auth/emergency');
                router.replace('/login/emergency');
              })
            }
          >
            Sign out of recovery
          </Button>
        </div>
      )}
    </section>
  );
}
