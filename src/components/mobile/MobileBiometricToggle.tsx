'use client';

import { useState, useEffect } from 'react';
import MobileCard from '@/components/mobile/MobileCard';
import { Fingerprint } from 'lucide-react';
import { logger } from '@/lib/logger';

const BIOMETRIC_ENABLED_KEY = 'opsknight-biometric-enabled';

export default function MobileBiometricToggle() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Check support
    if (
      typeof window !== 'undefined' &&
      window.PublicKeyCredential &&
      (
        window.PublicKeyCredential as unknown as {
          isUserVerifyingPlatformAuthenticatorAvailable: () => Promise<boolean>;
        }
      ).isUserVerifyingPlatformAuthenticatorAvailable
    ) {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(available => {
        setIsSupported(available);
        if (available) {
          const stored = window.localStorage.getItem(BIOMETRIC_ENABLED_KEY);
          setIsEnabled(stored === 'true');
        }
      });
    }
  }, []);

  const handleToggle = async () => {
    const newState = !isEnabled;

    if (newState) {
      // Enabling: Verify user can actually auth
      try {
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);

        const cred = (await navigator.credentials.create({
          publicKey: {
            challenge,
            rp: { name: 'OpsKnight Mobile' },
            user: {
              id: new Uint8Array(16),
              name: 'mobile-user',
              displayName: 'Mobile User',
            },
            pubKeyCredParams: [
              { alg: -7, type: 'public-key' },
              { alg: -257, type: 'public-key' },
            ],
            authenticatorSelection: {
              authenticatorAttachment: 'platform',
              userVerification: 'required',
            },
            timeout: 60000,
            attestation: 'none',
          },
        })) as PublicKeyCredential | null;

        // Success
        if (cred?.id) {
          window.localStorage.setItem('opsknight_biometric_credential_id', cred.id);
        }
        window.localStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');
        setIsEnabled(true);
      } catch (error) {
        logger.warn('mobile.biometric.enable_failed', { error });
        // Don't enable if they cancelled or failed
      }
    } else {
      // Disabling: Just disable
      window.localStorage.removeItem(BIOMETRIC_ENABLED_KEY);
      window.localStorage.removeItem('opsknight_biometric_credential_id');
      setIsEnabled(false);
    }
  };

  if (!mounted || !isSupported) return null;

  return (
    <MobileCard variant="default" padding="md">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={handleToggle}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <span
            className="mobile-menu-icon"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <Fingerprint className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          </span>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>App Lock</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Require FaceID to open
            </div>
          </div>
        </div>

        {/* iOS-style Toggle Switch */}
        <div
          style={{
            flexShrink: 0,
            width: '52px',
            height: '32px',
            background: isEnabled
              ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
              : 'rgba(120, 120, 128, 0.16)',
            borderRadius: '16px',
            position: 'relative',
            transition: 'background 0.25s ease',
            boxShadow: isEnabled
              ? '0 2px 8px rgba(99, 102, 241, 0.3)'
              : 'inset 0 0 0 1px rgba(0,0,0,0.1)',
          }}
        >
          <div
            style={{
              width: '28px',
              height: '28px',
              background: '#ffffff',
              borderRadius: '50%',
              position: 'absolute',
              top: '2px',
              left: isEnabled ? '22px' : '2px',
              transition: 'left 0.25s cubic-bezier(0.4, 0.0, 0.2, 1), box-shadow 0.25s ease',
              boxShadow: '0 3px 8px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Icon inside toggle */}
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'opacity 0.2s ease',
                opacity: 0.8,
                color: isEnabled ? '#6366f1' : '#9ca3af',
              }}
            >
              {isEnabled ? (
                <Fingerprint className="h-3.5 w-3.5" />
              ) : (
                <div className="h-1.5 w-1.5 rounded-full bg-slate-300" />
              )}
            </span>
          </div>
        </div>
      </div>
    </MobileCard>
  );
}
