'use client';

import { useState } from 'react';
import { changeAuthenticationMode } from '@/app/(app)/settings/system/authentication-actions';
import type { AuthenticationMode } from '@/lib/authentication-policy-evaluator';
import { notify as toast } from '@/lib/toast';
import { Eye, EyeOff } from 'lucide-react';
import { useRateLimitCountdown } from './authentication/useRateLimitCountdown';

const labels = {
  PASSWORD_ONLY: 'Password Only',
  SSO_OPTIONAL: 'SSO Optional',
  SSO_REQUIRED: 'SSO Required',
};

export default function AuthenticationPolicySettings({
  initialMode,
  initialVersion,
  legacyEmergencyConfigured,
}: {
  initialMode: AuthenticationMode;
  initialVersion: number;
  legacyEmergencyConfigured: boolean;
}) {
  const [current, setCurrent] = useState({ mode: initialMode, version: initialVersion });
  const [mode, setMode] = useState(initialMode);
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { displayMessage: liveMessage } = useRateLimitCountdown(message);
  return (
    <section
      className="space-y-4 rounded-lg border border-border p-4 sm:p-6"
      aria-labelledby="authentication-policy-title"
    >
      <div>
        <h2 id="authentication-policy-title" className="text-lg font-semibold">
          Authentication policy
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose how users sign in to this OpsKnight instance. Current mode: {labels[current.mode]}.
        </p>
      </div>
      <form
        className="space-y-4"
        onSubmit={async event => {
          event.preventDefault();
          setPending(true);
          setMessage('');
          try {
            const result = await changeAuthenticationMode({
              mode,
              expectedVersion: current.version,
              confirmation: 'CHANGE AUTHENTICATION POLICY',
              ...(mode === 'PASSWORD_ONLY' ? { currentPassword: password } : {}),
            });
            setCurrent(result);
            setConfirmed(false);
            setPassword('');
            const successMessage =
              'Authentication policy updated. Disallowed sessions will be rejected on their next protected request.';
            setMessage(successMessage);
            toast.success('Authentication update', { description: successMessage });
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Unable to change authentication policy.';
            setMessage(errorMessage);
            toast.error('Action could not complete', { description: errorMessage });
          } finally {
            setPending(false);
          }
        }}
      >
        <label className="block space-y-1 text-sm" htmlFor="authentication-mode">
          <span>Sign-in mode</span>
          <select
            id="authentication-mode"
            value={mode}
            onChange={event => {
              setMode(event.target.value as AuthenticationMode);
              setConfirmed(false);
            }}
            disabled={pending}
            className="block w-full rounded-md border border-border bg-background p-2 sm:max-w-md"
          >
            <option value="PASSWORD_ONLY">Password Only</option>
            <option value="SSO_OPTIONAL">SSO Optional</option>
            <option value="SSO_REQUIRED" disabled>
              SSO Required
            </option>
          </select>
        </label>
        <p className="text-sm text-muted-foreground">
          SSO Optional keeps password sign-in available while you test and link accounts. Password
          Only rejects OIDC sign-in and existing OIDC sessions. SSO Required activation is
          unavailable until a verified SSO administrator and two independent emergency accounts are
          ready.
        </p>
        {legacyEmergencyConfigured && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            An emergency password identity was imported from deployment settings. Its sessions are
            limited to one hour, with a 15-minute inactivity timeout. Keep its recovery credentials
            secure.
          </p>
        )}
        {mode === 'PASSWORD_ONLY' && mode !== current.mode && (
          <label className="block space-y-1 text-sm" htmlFor="policy-current-password">
            <span>Verify your current password</span>
            <div className="relative sm:max-w-md">
              <input
                id="policy-current-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                disabled={pending}
                required
                className="block w-full rounded-md border border-border bg-background p-2 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(prev => !prev)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
        )}
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={event => setConfirmed(event.target.checked)}
            disabled={pending}
            className="mt-1"
          />
          I understand that changing this policy rejects sessions that use a disallowed sign-in
          method. Sign in again first if your last sign-in was more than two hours ago.
        </label>
        <button
          type="submit"
          disabled={pending || !confirmed || current.mode === mode || mode === 'SSO_REQUIRED'}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {pending ? 'Updating…' : 'Change authentication policy'}
        </button>
        <p role="status" aria-live="polite" className="text-sm">
          {liveMessage}
        </p>
      </form>
    </section>
  );
}
