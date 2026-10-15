'use client';
import RecoveryPasswordDisplay from './RecoveryPasswordDisplay';
import { useState } from 'react';
import Link from 'next/link';
import {
  KeyRound,
  AlertTriangle,
  Plus,
  Key,
  ExternalLink,
  ShieldAlert,
  HardDrive,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
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
      {/* Recovery Identities Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/80 bg-muted/20 p-4">
        <div>
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm text-foreground">Recovery identities</h3>
            <Badge
              variant={data.verifiedEmergencyAccounts >= 2 ? 'success' : 'warning'}
              className="text-xs"
            >
              {data.verifiedEmergencyAccounts >= 2
                ? 'Sufficient Coverage'
                : `${data.verifiedEmergencyAccounts}/2 Verified`}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            {data.verifiedEmergencyAccounts} independently verified. Keep at least two ready; verify
            a replacement before routine rotation.
          </p>
        </div>
        <Button
          size="sm"
          className="gap-1.5 shrink-0 shadow-xs"
          disabled={pending || Boolean(generatedRecovery)}
          onClick={() => {
            setMessage('');
            setName('');
            setIndependent(false);
            setCreating(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Create emergency identity
        </Button>
      </div>

      {/* Account List */}
      {!data.emergencyAccounts.length ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center bg-card/40">
          <KeyRound className="h-10 w-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium text-foreground">No recovery identities yet</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-md">
            Create the first identity and store its credential independently of your identity
            provider.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4 gap-1.5"
            onClick={() => {
              setMessage('');
              setName('');
              setIndependent(false);
              setCreating(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Create emergency identity
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-border/70 rounded-xl border border-border/80 bg-card shadow-xs overflow-hidden">
          {data.emergencyAccounts.map(value => (
            <li
              key={value.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/30"
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0 mt-0.5">
                  {value.authenticationMethod === 'PASSWORD' ? (
                    <Key className="h-4 w-4" />
                  ) : (
                    <HardDrive className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="break-words font-semibold text-sm text-foreground">
                      {value.displayName}
                    </p>
                    <Badge
                      variant={
                        value.status === 'DISABLED'
                          ? 'neutral'
                          : value.ready
                            ? 'success'
                            : 'warning'
                      }
                      className="text-[10px] font-semibold py-0"
                    >
                      {value.status === 'DISABLED'
                        ? 'Disabled'
                        : value.ready
                          ? 'Verified'
                          : 'Needs a drill'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {value.authenticationMethod === 'PASSWORD' ? 'Vault password' : 'Hardware key'}{' '}
                    ·{' '}
                    {value.status === 'DISABLED'
                      ? 'Disabled'
                      : value.ready
                        ? 'Verified'
                        : 'Needs a drill'}
                  </p>
                  <p className="text-[11px] text-muted-foreground/80 mt-0.5 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Last drill:{' '}
                    {value.verifiedAt
                      ? new Date(value.verifiedAt).toLocaleString()
                      : 'Not recorded'}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setSelected(value.id)}
              >
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

      {/* Modal: Create Emergency Identity */}
      <Dialog
        open={creating}
        onOpenChange={open => {
          if (!pending) setCreating(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              Create emergency identity
            </DialogTitle>
            <DialogDescription>
              Create a separately held credential, then verify it in a fresh browser session.
            </DialogDescription>
          </DialogHeader>

          {messageError && message && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{message}</span>
            </div>
          )}

          <div className="space-y-4 py-2">
            <label className="block space-y-1.5 text-sm font-medium">
              <span className="text-foreground">Emergency identity name</span>
              <input
                className={inputClass}
                placeholder="e.g. Primary Vault Key"
                value={name}
                maxLength={80}
                onChange={event => setName(event.target.value)}
                disabled={pending}
              />
            </label>

            <label className="block space-y-1.5 text-sm font-medium">
              <span className="text-foreground">Recovery method</span>
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

            <label className="flex items-start gap-2.5 text-sm cursor-pointer select-none rounded-lg border border-border/60 bg-muted/20 p-3">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-border text-primary focus:ring-ring"
                checked={independent}
                onChange={event => setIndependent(event.target.checked)}
                disabled={pending}
              />
              <span className="text-xs text-foreground/90 leading-relaxed font-medium">
                This identity has custody independent of the other emergency identity and the
                external IdP.
              </span>
            </label>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
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
                className="w-full sm:w-auto"
                onClick={() =>
                  void (async () => {
                    const success = await perform(async () => {
                      const result = await authenticationRequest<{ id: string; password?: string }>(
                        {
                          action: 'createEmergency',
                          authenticationMethod: method,
                          displayName: name.trim(),
                          independenceConfirmed: true,
                        }
                      );
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
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Manage Selected Identity */}
      <Dialog
        open={Boolean(selected && account)}
        onOpenChange={open => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" />
              {account?.displayName}
            </DialogTitle>
            <DialogDescription>
              Account details and scoped credential actions. Changes revoke existing sessions and
              require a new drill.
            </DialogDescription>
          </DialogHeader>

          {account && (
            <div className="space-y-4 py-2">
              <dl className="grid gap-3 rounded-xl border border-border/80 bg-muted/20 p-4 text-xs sm:text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground font-medium">Account identifier</dt>
                  <dd className="break-all font-mono text-xs bg-background/80 rounded px-2 py-1 mt-1 border border-border/60">
                    {account.id}
                  </dd>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/50">
                  <div>
                    <dt className="text-xs text-muted-foreground font-medium">Last used</dt>
                    <dd className="text-foreground font-medium mt-0.5">
                      {account.lastUsedAt
                        ? new Date(account.lastUsedAt).toLocaleString()
                        : 'Not recorded'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground font-medium">Readiness</dt>
                    <dd className="mt-0.5">
                      <Badge
                        variant={account.ready ? 'success' : 'warning'}
                        className="text-[10px]"
                      >
                        {account.ready
                          ? 'Verified independent sign-in'
                          : 'Complete a fresh sign-in drill'}
                      </Badge>
                    </dd>
                  </div>
                </div>
              </dl>

              <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
                <span className="text-muted-foreground">Perform an emergency drill:</span>
                <Link
                  href="/login/emergency"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-primary underline inline-flex items-center gap-1 hover:text-primary/80"
                >
                  <span>Open emergency sign-in for a drill</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </div>

              {account.status !== 'DISABLED' && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openOperation({ accountId: account.id, kind: 'PASSWORD' })}
                  >
                    {account.authenticationMethod === 'PASSWORD'
                      ? 'Rotate password'
                      : 'Use vault password'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openOperation({ accountId: account.id, kind: 'WEBAUTHN' })}
                  >
                    Reset to hardware key
                  </Button>
                  {account.authenticationMethod !== 'PASSWORD' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openOperation({ accountId: account.id, kind: 'enroll' })}
                    >
                      Enroll hardware key
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => openOperation({ accountId: account.id, kind: 'disable' })}
                  >
                    Disable identity
                  </Button>
                </div>
              )}

              <div className="border-t border-border/70 pt-3 space-y-2">
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Hardware credentials
                </h4>
                {!account.credentials.length ? (
                  <p className="text-xs text-muted-foreground italic">
                    No hardware credentials recorded.
                  </p>
                ) : (
                  <ul className="divide-y divide-border/50 rounded-lg border border-border/60 overflow-hidden text-xs">
                    {account.credentials.map(credential => (
                      <li
                        key={credential.id}
                        className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-background"
                      >
                        <div className="flex items-center gap-2">
                          <HardDrive className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium">
                            {credential.displayName} ·{' '}
                            <span
                              className={
                                credential.revokedAt
                                  ? 'text-muted-foreground'
                                  : 'text-emerald-600 dark:text-emerald-400 font-semibold'
                              }
                            >
                              {credential.revokedAt ? 'Revoked' : 'Active'}
                            </span>
                          </span>
                        </div>
                        {!credential.revokedAt && account.status !== 'DISABLED' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
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
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal: Confirm Operation (Enroll / Revoke / Disable / Change Method) */}
      <Dialog
        open={Boolean(operation)}
        onOpenChange={open => {
          if (!open && !pending) setOperation(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-500" />
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
          </DialogHeader>

          {messageError && message && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{message}</span>
            </div>
          )}

          <div className="space-y-4 py-2">
            {operation?.kind === 'enroll' ? (
              <label className="block space-y-1.5 text-sm font-medium">
                <span className="text-foreground">Authenticator name</span>
                <input
                  className={inputClass}
                  maxLength={80}
                  value={keyName}
                  onChange={event => setKeyName(event.target.value)}
                  disabled={pending}
                />
              </label>
            ) : (
              <label className="flex items-start gap-2.5 text-sm cursor-pointer select-none rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-border text-primary focus:ring-ring"
                  checked={compromised}
                  onChange={event => setCompromised(event.target.checked)}
                  disabled={pending}
                />
                <span className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed font-medium">
                  This credential is confirmed compromised. Urgent revocation may reduce recovery
                  coverage.
                </span>
              </label>
            )}

            <label className="flex items-start gap-2.5 text-sm cursor-pointer select-none rounded-lg border border-border/60 bg-muted/20 p-3">
              <input
                type="checkbox"
                className="mt-0.5 rounded border-border text-primary focus:ring-ring"
                checked={confirmed}
                onChange={event => setConfirmed(event.target.checked)}
                disabled={pending}
              />
              <span className="text-xs text-foreground/90 leading-relaxed font-medium">
                I understand the session revocation and the required new independent drill.
              </span>
            </label>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
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
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {generatedRecovery && <RecoveryPasswordDisplay />}
    </div>
  );
}
