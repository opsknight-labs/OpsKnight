'use client';
import { useHydrated } from '@/hooks/useHydrated';
import { useState } from 'react';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import { authenticationRequest } from '@/components/settings/AuthenticationConsole';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';

export default function EmergencyLogin({ legacyAvailable }: { legacyAvailable: boolean }) {
  const [method, setMethod] = useState<'WEBAUTHN' | 'PASSWORD'>('WEBAUTHN');
  const [recoveryPassword, setRecoveryPassword] = useState('');
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
  const errorProps = error
    ? ({ 'aria-invalid': true, 'aria-describedby': 'emergency-error' } as const)
    : {};
  return (
    <div className="space-y-6">
      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          void perform(async () => {
            if (method === 'PASSWORD') {
              try {
                await authenticationRequest(
                  { action: 'passwordLogin', accountId, password: recoveryPassword },
                  '/api/auth/emergency'
                );
              } finally {
                setRecoveryPassword('');
              }
              return;
            }
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
        <div className="space-y-1.5">
          <Label htmlFor="emergency-method">Recovery method</Label>
          <select
            id="emergency-method"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            value={method}
            disabled={pending}
            onChange={event => {
              setMethod(event.target.value as 'PASSWORD' | 'WEBAUTHN');
              setRecoveryPassword('');
            }}
          >
            <option value="WEBAUTHN">Hardware security key</option>
            <option value="PASSWORD">Recovery password</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="emergency-account">Emergency account identifier</Label>
          <Input
            id="emergency-account"
            {...errorProps}
            value={accountId}
            onChange={event => setAccountId(event.target.value)}
            required
            autoComplete="username"
            maxLength={128}
            disabled={pending}
          />
        </div>
        {method === 'PASSWORD' && (
          <div className="space-y-1.5">
            <Label htmlFor="emergency-recovery-password">Recovery password</Label>
            <Input
              id="emergency-recovery-password"
              {...errorProps}
              type="password"
              autoComplete="current-password"
              required
              value={recoveryPassword}
              onChange={event => setRecoveryPassword(event.target.value)}
              disabled={pending}
              maxLength={256}
            />
          </div>
        )}
        <Button disabled={pending || !accountId} type="submit" aria-busy={busy || undefined}>
          {busy
            ? 'Signing in…'
            : method === 'PASSWORD'
              ? 'Sign in to recovery'
              : 'Sign in with hardware key'}
        </Button>
      </form>
      {legacyAvailable && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            Imported legacy emergency password
          </summary>
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
            <p className="text-sm text-muted-foreground">
              This compatibility credential opens only the recovery console. Enroll two independent
              identities and retire it after successful drills.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="emergency-legacy-email">Emergency administrator email</Label>
              <Input
                id="emergency-legacy-email"
                {...errorProps}
                type="email"
                autoComplete="username"
                value={email}
                onChange={event => setEmail(event.target.value)}
                required
                disabled={pending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="emergency-legacy-password">Emergency password</Label>
              <Input
                id="emergency-legacy-password"
                {...errorProps}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                required
                disabled={pending}
              />
            </div>
            <Button disabled={pending} type="submit" aria-busy={busy || undefined}>
              {busy ? 'Signing in…' : 'Sign in to recovery'}
            </Button>
          </form>
        </details>
      )}
      <p id="emergency-error" role="alert" className="break-words text-sm text-destructive">
        {error}
      </p>
    </div>
  );
}
