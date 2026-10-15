'use client';
import RecoveryPasswordDisplay from './RecoveryPasswordDisplay';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/shadcn/dialog';
import AuthenticationActionGuard, { actionAvailability } from './AuthenticationActionGuard';
import { useAuthenticationWorkspace } from './useAuthenticationController';
import { authenticationRequest } from './request';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';

type Operation = {
  accountId: string;
  kind: 'PASSWORD' | 'WEBAUTHN' | 'disable' | 'enroll' | 'revoke';
  credentialId?: string;
};
export default function RecoveryAccounts() {
  const {
    data,
    pending,
    perform,
    refresh,
    inputClass,
    generatedRecovery,
    setGeneratedRecovery,
    setMessage,
    message,
    messageError,
  } = useAuthenticationWorkspace();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [method, setMethod] = useState<'PASSWORD' | 'WEBAUTHN'>('PASSWORD');
  const [independent, setIndependent] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [compromised, setCompromised] = useState(false);
  const [keyName, setKeyName] = useState('Primary hardware key');
  const account = data.emergencyAccounts.find(
    value => value.id === (operation?.accountId ?? selected)
  );
  const openOperation = (value: Operation) => {
    setMessage('');
    setSelected(null);
    setOperation(value);
    setConfirmed(false);
    setCompromised(false);
    setKeyName('Primary hardware key');
  };
  const coverageBlocked = Boolean(
    account?.ready &&
    data.mode === 'SSO_REQUIRED' &&
    data.verifiedEmergencyAccounts <= 2 &&
    operation?.kind !== 'enroll' &&
    !compromised
  );
  const availability = actionAvailability('Recovery change', [
    pending && { code: 'busy', message: 'Wait for the current operation to finish.' },
    data.freshAuthenticationRequired && {
      code: 'fresh',
      message:
        'Sign in again or verify your recovery credential again before changing credentials.',
    },
    !confirmed && {
      code: 'confirm',
      message: 'Acknowledge the session revocation and required sign-in drill.',
    },
    coverageBlocked && {
      code: 'coverage',
      message:
        'Create and independently verify a third identity before routine rotation or removal. Confirm compromise only for an exposed credential.',
    },
    operation?.kind === 'enroll' &&
      !keyName.trim() && {
        code: 'name',
        message: 'Name the authenticator so custodians can identify it.',
      },
  ]);
  const execute = async () => {
    if (!operation || !account || !availability.allowed) return;
    const changed = await perform(async () => {
      if (operation.kind === 'enroll') {
        const options = await authenticationRequest<{
          options: PublicKeyCredentialCreationOptionsJSON;
          challengeId: string;
        }>({ action: 'enroll', accountId: account.id });
        const response = await (
          await import('@simplewebauthn/browser')
        ).startRegistration({ optionsJSON: options.options });
        await authenticationRequest({
          action: 'verifyEnrollment',
          challengeId: options.challengeId,
          displayName: keyName.trim(),
          response,
        });
      } else if (operation.kind === 'disable' || operation.kind === 'revoke') {
        await authenticationRequest(
          operation.kind === 'disable'
            ? { action: 'disableEmergency', accountId: account.id, compromised }
            : { action: 'revoke', credentialId: operation.credentialId, compromised }
        );
      } else {
        const result = await authenticationRequest<{ id: string; password?: string }>({
          action: 'changeEmergencyMethod',
          confirmation: 'CHANGE RECOVERY CREDENTIAL',
          accountId: account.id,
          method: operation.kind,
          compromised,
          expectedVersion: account.credentialVersion,
        });
        setOperation(null);
        if (result.password) {
          setGeneratedRecovery({ id: result.id, password: result.password });
        }
        if (data.actor.kind === 'emergency' && data.actor.id === account.id && result.password) {
          setMessage(
            'Your session was revoked. Store the new password, then sign in again to complete a drill.'
          );
          return;
        }
      }
      setOperation(null);
      if (data.actor.kind === 'emergency' && data.actor.id === account.id) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Credential changes require a fresh recovery capability.
        window.location.assign('/login/emergency');
        return;
      }
      await refresh();
      setMessage(
        'Recovery credential updated. Complete a fresh independent sign-in drill before relying on it.'
      );
    });
    if (changed) setOperation(null);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Recovery identities</h3>
          <p className="text-sm text-muted-foreground">
            {data.verifiedEmergencyAccounts} independently verified. Keep at least two ready; verify
            a replacement before routine rotation.
          </p>
        </div>
        <Button
          disabled={pending || Boolean(generatedRecovery)}
          onClick={() => {
            setMessage('');
            setName('');
            setIndependent(false);
            setCreating(true);
          }}
        >
          Create emergency identity
        </Button>
      </div>
      {!data.emergencyAccounts.length ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          No recovery identities yet. Create the first identity and store its credential
          independently of your identity provider.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border border-border">
          {data.emergencyAccounts.map(value => (
            <li key={value.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="break-words font-medium">{value.displayName}</p>
                <p className="text-sm text-muted-foreground">
                  {value.authenticationMethod === 'PASSWORD' ? 'Vault password' : 'Hardware key'} ·{' '}
                  {value.status === 'DISABLED'
                    ? 'Disabled'
                    : value.ready
                      ? 'Verified'
                      : 'Needs a drill'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Last drill:{' '}
                  {value.verifiedAt ? new Date(value.verifiedAt).toLocaleString() : 'Not recorded'}
                </p>
              </div>
              <Button variant="outline" onClick={() => setSelected(value.id)}>
                Manage<span className="sr-only"> {value.displayName}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {data.emergencyAccounts.filter(value => value.status === 'DISABLED').length >= 25 && (
        <p className="text-xs text-muted-foreground">
          The latest 25 disabled identities are shown. Use Recovery &amp; audit in Diagnostics for
          earlier disablement evidence.
        </p>
      )}
      <Dialog
        open={creating}
        onOpenChange={open => {
          if (!pending) setCreating(open);
        }}
      >
        <DialogContent>
          <DialogTitle>Create emergency identity</DialogTitle>
          <DialogDescription>
            Create a separately held credential, then verify it in a fresh browser session.
          </DialogDescription>
          {messageError && message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
          <label className="space-y-1 text-sm">
            Emergency identity name
            <input
              className={inputClass}
              value={name}
              maxLength={80}
              onChange={event => setName(event.target.value)}
              disabled={pending}
            />
          </label>
          <label className="space-y-1 text-sm">
            Recovery method
            <select
              className={inputClass}
              value={method}
              onChange={event => setMethod(event.target.value as typeof method)}
              disabled={pending}
            >
              <option value="PASSWORD">Generated vault password</option>
              <option value="WEBAUTHN">Hardware security key</option>
            </select>
          </label>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={independent}
              onChange={event => setIndependent(event.target.checked)}
              disabled={pending}
            />
            This identity has custody independent of the other emergency identity and the external
            IdP.
          </label>
          <AuthenticationActionGuard
            availability={actionAvailability('Create identity', [
              pending && { code: 'busy', message: 'Wait for the current operation.' },
              !name.trim() && { code: 'name', message: 'Enter an identity name.' },
              !independent && { code: 'custody', message: 'Confirm independent custody.' },
              data.freshAuthenticationRequired && {
                code: 'fresh',
                message: 'Verify your sign-in again before creating credentials.',
              },
            ])}
          >
            <Button
              onClick={() =>
                void (async () => {
                  const success = await perform(async () => {
                    const result = await authenticationRequest<{ id: string; password?: string }>({
                      action: 'createEmergency',
                      authenticationMethod: method,
                      displayName: name.trim(),
                      independenceConfirmed: true,
                    });
                    setCreating(false);
                    if (result.password) {
                      setGeneratedRecovery({ id: result.id, password: result.password });
                    }
                    await refresh();
                  });
                  if (success) setCreating(false);
                })()
              }
            >
              Create identity
            </Button>
          </AuthenticationActionGuard>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(selected && account)}
        onOpenChange={open => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogTitle>{account?.displayName}</DialogTitle>
          <DialogDescription>
            Account details and scoped credential actions. Changes revoke existing sessions and
            require a new drill.
          </DialogDescription>
          {account && (
            <>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Account identifier</dt>
                  <dd className="break-all font-mono">{account.id}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last used</dt>
                  <dd>
                    {account.lastUsedAt
                      ? new Date(account.lastUsedAt).toLocaleString()
                      : 'Not recorded'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Readiness</dt>
                  <dd>
                    {account.ready
                      ? 'Verified independent sign-in'
                      : 'Complete a fresh sign-in drill'}
                  </dd>
                </div>
              </dl>
              <Link
                href="/login/emergency"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm underline"
              >
                Open emergency sign-in for a drill
              </Link>
              {account.status !== 'DISABLED' && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => openOperation({ accountId: account.id, kind: 'PASSWORD' })}
                  >
                    {account.authenticationMethod === 'PASSWORD'
                      ? 'Rotate password'
                      : 'Use vault password'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => openOperation({ accountId: account.id, kind: 'WEBAUTHN' })}
                  >
                    Reset to hardware key
                  </Button>
                  {account.authenticationMethod !== 'PASSWORD' && (
                    <Button
                      variant="outline"
                      onClick={() => openOperation({ accountId: account.id, kind: 'enroll' })}
                    >
                      Enroll hardware key
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    onClick={() => openOperation({ accountId: account.id, kind: 'disable' })}
                  >
                    Disable identity
                  </Button>
                </div>
              )}
              <h4 className="text-sm font-medium">Hardware credentials</h4>
              {!account.credentials.length && (
                <p className="text-sm text-muted-foreground">No hardware credentials recorded.</p>
              )}
              <ul className="divide-y">
                {account.credentials.map(credential => (
                  <li
                    key={credential.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span>
                      {credential.displayName} · {credential.revokedAt ? 'Revoked' : 'Active'}
                    </span>
                    {!credential.revokedAt && account.status !== 'DISABLED' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          openOperation({
                            accountId: account.id,
                            kind: 'revoke',
                            credentialId: credential.id,
                          })
                        }
                      >
                        Revoke key
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(operation)}
        onOpenChange={open => {
          if (!open && !pending) setOperation(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {operation?.kind === 'enroll'
              ? 'Enroll hardware key'
              : operation?.kind === 'disable'
                ? 'Disable recovery identity'
                : operation?.kind === 'revoke'
                  ? 'Revoke hardware key'
                  : operation?.kind === 'PASSWORD'
                    ? 'Generate replacement vault password'
                    : 'Reset to hardware key'}
          </DialogTitle>
          <DialogDescription>
            This action applies only to {account?.displayName}. Existing sessions are revoked.
            Credential changes reset readiness until a new independent sign-in drill.
          </DialogDescription>
          {messageError && message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
          {operation?.kind === 'enroll' ? (
            <label className="space-y-1 text-sm">
              Authenticator name
              <input
                className={inputClass}
                maxLength={80}
                value={keyName}
                onChange={event => setKeyName(event.target.value)}
                disabled={pending}
              />
            </label>
          ) : (
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={compromised}
                onChange={event => setCompromised(event.target.checked)}
                disabled={pending}
              />
              This credential is confirmed compromised. Urgent revocation may reduce recovery
              coverage.
            </label>
          )}
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={event => setConfirmed(event.target.checked)}
              disabled={pending}
            />
            I understand the session revocation and the required new independent drill.
          </label>
          <AuthenticationActionGuard availability={availability}>
            <Button
              variant={
                operation?.kind === 'disable' || operation?.kind === 'revoke'
                  ? 'destructive'
                  : 'default'
              }
              onClick={() => void execute()}
            >
              Confirm recovery change
            </Button>
          </AuthenticationActionGuard>
        </DialogContent>
      </Dialog>
      {generatedRecovery && <RecoveryPasswordDisplay />}
    </div>
  );
}
