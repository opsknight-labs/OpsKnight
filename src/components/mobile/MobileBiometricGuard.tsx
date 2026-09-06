'use client';

import { useEffect, useState, useRef } from 'react';
import { Lock, Fingerprint } from 'lucide-react';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

const BIOMETRIC_ENABLED_KEY = 'opsknight-biometric-enabled';

export default function MobileBiometricGuard({ children }: { children: React.ReactNode }) {
  const [isLocked, setIsLocked] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [isProtecting, setIsProtecting] = useState(true); // Initial load protection state

  useEffect(() => {
    // Check if biometric is enabled and supported
    if (typeof window === 'undefined') return;

    const enabled = window.localStorage.getItem(BIOMETRIC_ENABLED_KEY) === 'true';
    const supported =
      window.PublicKeyCredential &&
      (
        window.PublicKeyCredential as unknown as {
          isUserVerifyingPlatformAuthenticatorAvailable: () => Promise<boolean>;
        }
      ).isUserVerifyingPlatformAuthenticatorAvailable;

    if (supported) {
      supported().then(setIsSupported);
    }

    if (enabled) {
      setIsLocked(true);
    } else {
      setIsProtecting(false);
    }
  }, []);

  const authenticate = async () => {
    try {
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);
      const storedCredId = window.localStorage.getItem('opsknight_biometric_credential_id');

      let allowCredentials: PublicKeyCredentialDescriptor[] | undefined = undefined;
      if (storedCredId) {
        try {
          const rawId = Uint8Array.from(
            atob(storedCredId.replace(/-/g, '+').replace(/_/g, '/')),
            c => c.charCodeAt(0)
          );
          allowCredentials = [{ id: rawId, type: 'public-key' }];
        } catch {
          // Ignore conversion error and fall back to broad search
        }
      }

      await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: 60000,
          rpId: window.location.hostname,
          userVerification: 'required', // This forces FaceID/TouchID/PIN
          ...(allowCredentials ? { allowCredentials } : {}),
        },
      });

      // If we get here, the OS successfully verified the user
      setIsLocked(false);
      setIsProtecting(false);
    } catch (error) {
      logger.warn('mobile.biometric.unlock_failed', { error });
      // Remain locked
    }
  };

  // Auto-trigger auth on mount if locked
  useEffect(() => {
    if (isLocked && isSupported) {
      authenticate();
    }
  }, [isLocked, isSupported]);

  // Handle visibility change (background/foreground)
  useEffect(() => {
    const handleVisibility = () => {
      if (typeof window === 'undefined') return;
      const enabled = window.localStorage.getItem(BIOMETRIC_ENABLED_KEY) === 'true';

      if (document.hidden && enabled) {
        // Immediately lock when going to background to protect privacy
        setIsLocked(true);
      } else if (!document.hidden && enabled && isLocked) {
        // When coming back, try to authenticate
        authenticate();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isLocked]); // Re-bind if lock state changes isn't strictly necessary but safe

  if (!isProtecting && !isLocked) {
    return <>{children}</>;
  }

  // Locked Overlay
  return (
    <>
      <div
        className={cn(
          'fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-slate-950/40 backdrop-blur-xl transition-all duration-300',
          !isLocked ? 'pointer-events-none opacity-0' : 'opacity-100'
        )}
      >
        <div className="flex flex-col items-center gap-6 p-8 text-center animate-in zoom-in-95 duration-300">
          <div className="relative">
            <div className="absolute inset-0 animate-pulse rounded-full bg-primary/20 blur-xl" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-slate-900 shadow-2xl ring-1 ring-white/10">
              <Lock className="h-8 w-8 text-white" />
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-white">App Locked</h2>
            <p className="text-sm text-slate-300 max-w-[240px]">
              Verify your identity to access OpsKnight
            </p>
          </div>

          <button
            onClick={authenticate}
            className="group flex items-center gap-3 rounded-full bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur-md transition-all hover:bg-white/20 active:scale-95"
          >
            <Fingerprint className="h-5 w-5" />
            <span>Unlock with FaceID</span>
          </button>
        </div>
      </div>

      {/* 
        Hide underlying content from accessibility tree while locked 
        to prevent screen readers from reading sensitive info 
      */}
      <div aria-hidden={isLocked} className={isLocked ? 'invisible' : ''}>
        {children}
      </div>
    </>
  );
}
