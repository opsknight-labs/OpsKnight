'use client';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';
import AuthenticationSessionPolicyForm from './AuthenticationSessionPolicyForm';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';
import { Button } from '@/components/ui/shadcn/button';
import type { enforcementPreview } from '@/lib/auth-control/oidc-revisions';
type Preview = Awaited<ReturnType<typeof enforcementPreview>>;
export default function AuthenticationPolicyWorkspace() {
  const {
    draftDirty,
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
  return (
    <section id="authentication-3" className={sectionClass} aria-labelledby="auth-policy-title">
      <h2 id="auth-policy-title" className="text-lg font-semibold">
        Sessions &amp; Policies
      </h2>
      <p className="text-sm">
        Current mode: {data.mode.replaceAll('_', ' ')}. Sign in again or verify your emergency
        credential within five minutes before activation.
      </p>
      <AuthenticationSessionPolicyForm key={revisionId} />
      <label className="block space-y-1 text-sm">
        <span>Activation mode</span>
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
      </label>
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
            resolutionTarget: 'connection',
          },
        ])}
        onResolve={setActiveTab}
      >
        <Button
          variant="outline"
          onClick={() =>
            void perform(async () => {
              setImpact(await authenticationRequest<Preview>({ action: 'preview', revisionId }));
              setConfirmation(false);
            })
          }
        >
          Preview enforcement impact
        </Button>
      </AuthenticationActionGuard>
      {impact && (
        <div className="space-y-2 text-sm" aria-live="polite">
          <p>
            {impact.passwordSessionCount} registered password sessions affected;{' '}
            {impact.usersRequiringLinking} users require linking; {impact.verifiedEmergencyAccounts}{' '}
            emergency identities verified.
          </p>
          <p>Real administrator login: {impact.adminVerified ? 'verified' : 'required'}</p>
          <ul className="list-disc pl-5">
            {impact.blockers.map(blocker => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmation}
          onChange={event => setConfirmation(event.target.checked)}
        />
        I reviewed the impact and confirm activation of this verified revision and sign-in policy.
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
            message: 'Complete a real administrator sign-in test for this revision.',
            resolutionTarget: 'connection',
          },
          data.freshAuthenticationRequired && {
            code: 'fresh',
            message: 'Sign in again or verify your recovery credential within five minutes.',
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
          onClick={() =>
            void perform(async () => {
              await authenticationRequest({
                action: 'activate',
                revisionId,
                expectedVersion: impact!.policyVersion,
                mode,
                confirmation: 'ACTIVATE VERIFIED SSO',
              });
              setConfirmation(false);
              setImpact(null);
              setMessage(
                'Verified SSO activated. Disallowed sessions are revoked; complete a new sign-in if this provider changed.'
              );
              await refresh();
            })
          }
        >
          Activate verified SSO
        </Button>
      </AuthenticationActionGuard>
      {data.actor.kind === 'admin' && (
        <details className="space-y-3 text-sm">
          <summary className="cursor-pointer">Change to Password Only or SSO Optional</summary>
          <label className="block">
            <span>New authentication mode</span>
            <select
              className={inputClass}
              value={normalMode}
              onChange={event => setNormalMode(event.target.value as typeof normalMode)}
            >
              <option value="SSO_OPTIONAL">SSO Optional</option>
              <option value="PASSWORD_ONLY">Password Only</option>
            </select>
          </label>
          <label className="block">
            <span>Current password (required for Password Only)</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={modeConfirmed}
              onChange={event => setModeConfirmed(event.target.checked)}
            />
            I confirm this deliberate sign-in policy change and its session effects.
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
                message: 'Sign in again within five minutes before changing policy.',
              },
            ])}
          >
            <Button
              variant="outline"
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
              Change authentication mode
            </Button>
          </AuthenticationActionGuard>
        </details>
      )}
    </section>
  );
}
