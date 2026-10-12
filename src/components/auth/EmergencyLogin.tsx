'use client';
import { useHydrated } from '@/hooks/useHydrated';
import { useState } from 'react';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import { authenticationRequest } from '@/components/settings/AuthenticationConsole';
import { Button } from '@/components/ui/shadcn/button';

export default function EmergencyLogin({ legacyAvailable }: { legacyAvailable: boolean }) {
  const [accountId, setAccountId] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const hydrated = useHydrated();
  const [busy, setPending] = useState(false);
  const [error, setError] = useState('');
  const pending = busy || !hydrated;
  const perform = async (work: () => Promise<void>) => {
    setPending(true);
    setError('');
    try {
      await work();
      // Enter the authenticated boundary with a new document and fresh server cookies.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Authentication changes require clearing the client route cache after the cookie is set.
      window.location.assign('/recovery');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Emergency authentication failed.');
    } finally {
      setPending(false);
    }
  };
  const fieldClass = 'block w-full rounded-md border border-border bg-background px-3 py-2';
  return (
    <div className="space-y-6">
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          void perform(async () => {
            const options = await authenticationRequest<{
              options: PublicKeyCredentialRequestOptionsJSON;
              challengeId: string;
            }>({ action: 'options', accountId }, '/api/auth/emergency');
            const response = await (
              await import('@simplewebauthn/browser')
            ).startAuthentication({ optionsJSON: options.options });
            await authenticationRequest(
              { action: 'verify', challengeId: options.challengeId, response },
              '/api/auth/emergency'
            );
          });
        }}
      >
        <label className="block space-y-1">
          <span>Emergency account identifier</span>
          <input
            className={fieldClass}
            value={accountId}
            onChange={event => setAccountId(event.target.value)}
            required
            autoComplete="username"
            maxLength={128}
            disabled={pending}
          />
        </label>
        <Button disabled={pending || !accountId} type="submit">
          Sign in with hardware key
        </Button>
      </form>
      {legacyAvailable && (
        <details>
          <summary className="cursor-pointer text-sm">Imported legacy emergency password</summary>
          <form
            className="mt-4 space-y-4"
            onSubmit={event => {
              event.preventDefault();
              void perform(async () => {
                await authenticationRequest(
                  { action: 'legacy', email, password },
                  '/api/auth/emergency'
                );
                setPassword('');
              });
            }}
          >
            <p className="text-sm">
              This compatibility credential opens only the recovery console. Enroll two independent
              identities and retire it after successful drills.
            </p>
            <label className="block space-y-1">
              <span>Emergency administrator email</span>
              <input
                className={fieldClass}
                type="email"
                autoComplete="username"
                value={email}
                onChange={event => setEmail(event.target.value)}
                required
                disabled={pending}
              />
            </label>
            <label className="block space-y-1">
              <span>Emergency password</span>
              <input
                className={fieldClass}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                required
                disabled={pending}
              />
            </label>
            <Button disabled={pending} type="submit">
              Sign in to recovery
            </Button>
          </form>
        </details>
      )}
      <p role="alert" className="break-words text-sm">
        {error}
      </p>
    </div>
  );
}
