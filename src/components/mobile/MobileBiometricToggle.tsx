'use client';

import { useEffect, useState } from 'react';
import { Fingerprint, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/shadcn/card';
import { Switch } from '@/components/ui/shadcn/switch';
import { logger } from '@/lib/logger';
import {
  getOrCreateAppLockUserHandle,
  isAppLockEnabled,
  persistAppLockCredential,
  platformAuthenticatorAvailable,
  setAppLockEnabled,
} from '@/lib/mobile-app-lock';
import { purgeLegacyUnscopedMobileState } from '@/lib/mobile-principal-state';

export default function MobileBiometricToggle() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    purgeLegacyUnscopedMobileState();
    void platformAuthenticatorAvailable().then(available => {
      if (cancelled) return;
      setIsSupported(available);
      setIsEnabled(available && isAppLockEnabled());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setBusy(true);
    setError('');
    try {
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: 'OpsKnight' },
          user: {
            id: getOrCreateAppLockUserHandle() as unknown as BufferSource,
            name: 'opsknight-responder',
            displayName: 'OpsKnight responder',
          },
          pubKeyCredParams: [
            { alg: -7, type: 'public-key' },
            { alg: -257, type: 'public-key' },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            residentKey: 'preferred',
            userVerification: 'required',
          },
          timeout: 60_000,
          attestation: 'none',
        },
      });
      if (!(credential instanceof PublicKeyCredential) || credential.rawId.byteLength === 0) {
        throw new Error('No platform credential was created.');
      }
      persistAppLockCredential(credential);
      setAppLockEnabled(true);
      setIsEnabled(true);
    } catch (enableError) {
      logger.warn('mobile.app_lock.enable_failed', {
        component: 'MobileBiometricToggle',
        error: enableError,
      });
      setAppLockEnabled(false);
      setIsEnabled(false);
      setError('Device verification was not completed, so App Lock remains off.');
    } finally {
      setBusy(false);
    }
  };

  const disable = () => {
    setAppLockEnabled(false);
    setIsEnabled(false);
    setError('');
  };

  if (!isSupported) return null;

  return (
    <Card className="rounded-xl border-border bg-card p-4 shadow-none">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
            <Fingerprint className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">App Lock</h3>
              {isEnabled ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-label="Enabled" /> : null}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Hide responder data after the app is backgrounded and require the device authenticator to reveal it again.
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              This is a local privacy control only. Server authentication, authorization, expiry and device revocation remain authoritative.
            </p>
          </div>
        </div>
        <Switch
          checked={isEnabled}
          disabled={busy}
          onCheckedChange={checked => {
            if (checked) void enable();
            else disable();
          }}
          aria-label="Require device verification when reopening OpsKnight"
        />
      </div>
      {error ? (
        <p className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200" role="status">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
