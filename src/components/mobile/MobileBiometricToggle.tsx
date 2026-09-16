'use client';

import { useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import MobileSettingCard from '@/components/mobile/MobileSettingCard';
import { MobileSwitch } from '@/components/mobile/MobileSwitch';
import { logger } from '@/lib/logger';
import {
  getOrCreateAppLockUserHandle,
  isAppLockEnabled,
  persistAppLockCredential,
  platformAuthenticatorAvailable,
  setAppLockEnabled,
} from '@/lib/mobile-app-lock';
import { purgeLegacyUnscopedMobileState } from '@/lib/mobile-principal-state';
import { promiseWithTimeout } from '@/lib/client-timeout';

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
      const credential = await promiseWithTimeout(
        navigator.credentials.create({
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
        }),
        15_000,
        'App Lock configuration timed out.'
      );
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
    <MobileSettingCard
      icon={<Fingerprint className="h-5 w-5" aria-hidden="true" />}
      title="App Lock"
      status={isEnabled ? 'On' : 'Off'}
      action={
        <MobileSwitch
          checked={isEnabled}
          disabled={busy}
          onCheckedChange={checked => {
            if (checked) void enable();
            else disable();
          }}
          aria-label="Require device verification when reopening OpsKnight"
        />
      }
    >
      <p className="text-xs leading-relaxed text-muted-foreground">
        Hide responder data after the app is backgrounded and require the device authenticator to
        reveal it again.
      </p>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        This is a local privacy control only. Server authentication, authorization, expiry and
        device revocation remain authoritative.
      </p>
      {error ? (
        <p
          className="rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
          role="status"
        >
          {error}
        </p>
      ) : null}
    </MobileSettingCard>
  );
}
