'use client';

import { useCallback, useEffect, useState } from 'react';
import { Fingerprint, Lock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import {
  getAppLockCredentialDescriptor,
  isAppLockEnabled,
  isValidAppLockAssertion,
  platformAuthenticatorAvailable,
} from '@/lib/mobile-app-lock';
import { purgeLegacyUnscopedMobileState } from '@/lib/mobile-principal-state';

const ASSERTION_TIMEOUT_MS = 60_000;

export default function MobileBiometricGuard({ children }: { children: React.ReactNode }) {
  const [isLocked, setIsLocked] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [isProtecting, setIsProtecting] = useState(true);
  const [unlockError, setUnlockError] = useState('');
  const [authenticating, setAuthenticating] = useState(false);

  const authenticate = useCallback(async () => {
    if (authenticating || !isSupported) return;
    setAuthenticating(true);
    setUnlockError('');
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: ASSERTION_TIMEOUT_MS,
          rpId: window.location.hostname,
          userVerification: 'required',
          allowCredentials: getAppLockCredentialDescriptor(),
        },
      });

      if (!isValidAppLockAssertion(assertion)) {
        throw new Error('The platform authenticator returned an invalid assertion.');
      }

      setIsLocked(false);
      setIsProtecting(false);
    } catch (error) {
      logger.warn('mobile.app_lock.unlock_failed', {
        component: 'MobileBiometricGuard',
        error,
      });
      setUnlockError('Verification was not completed. Try again to unlock OpsKnight.');
    } finally {
      setAuthenticating(false);
    }
  }, [authenticating, isSupported]);

  useEffect(() => {
    let cancelled = false;
    purgeLegacyUnscopedMobileState();
    void platformAuthenticatorAvailable().then(supported => {
      if (cancelled) return;
      setIsSupported(supported);
      const enabled = isAppLockEnabled();
      if (enabled && supported) {
        setIsLocked(true);
      } else {
        setIsProtecting(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isLocked && isSupported && !authenticating) void authenticate();
  }, [authenticate, authenticating, isLocked, isSupported]);

  useEffect(() => {
    const handleVisibility = () => {
      if (!isAppLockEnabled()) return;
      if (document.hidden) {
        setIsLocked(true);
        setIsProtecting(true);
        setUnlockError('');
      } else if (isSupported) {
        setIsLocked(true);
        setIsProtecting(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isSupported]);

  if (!isProtecting && !isLocked) return <>{children}</>;

  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-[var(--z-critical-overlay,80)] flex flex-col items-center justify-center bg-background/95 px-6 backdrop-blur-xl',
          !isLocked && 'pointer-events-none opacity-0'
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-app-lock-title"
        aria-describedby="mobile-app-lock-description"
      >
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-foreground text-background">
            <Lock className="h-7 w-7" aria-hidden="true" />
          </div>
          <h2 id="mobile-app-lock-title" className="mt-5 text-xl font-bold tracking-tight text-foreground">
            OpsKnight is locked
          </h2>
          <p id="mobile-app-lock-description" className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Verify with your device authenticator to reveal responder data. This local privacy lock does not replace your OpsKnight session or server authorization.
          </p>

          {unlockError ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-left text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200" role="alert">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{unlockError}</span>
            </div>
          ) : null}

          <Button
            type="button"
            className="mt-5 min-h-11 w-full gap-2"
            onClick={() => void authenticate()}
            disabled={!isSupported || authenticating}
          >
            <Fingerprint className="h-4 w-4" aria-hidden="true" />
            {authenticating ? 'Verifying…' : isSupported ? 'Unlock with device verification' : 'Device verification unavailable'}
          </Button>
        </div>
      </div>

      <div aria-hidden={isLocked || isProtecting} inert={isLocked || isProtecting ? true : undefined} className={isLocked || isProtecting ? 'invisible' : ''}>
        {children}
      </div>
    </>
  );
}
