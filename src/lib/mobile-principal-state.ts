'use client';

import { readMobilePrincipalContext } from '@/lib/mobile-principal';

const STORAGE_PREFIX = 'opsknight:principal-state:';

/**
 * Principal-scoped device preferences. These values are deliberately not tied to
 * authGeneration because preferences such as local app-lock should survive a
 * normal session refresh for the same account, while never bleeding into a
 * different signed-in principal on a shared browser profile.
 */
export function principalStateKey(name: string): string | null {
  const context = readMobilePrincipalContext();
  if (!context?.principalId) return null;
  return `${STORAGE_PREFIX}${encodeURIComponent(context.principalId)}:${name}`;
}

export function readPrincipalState(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const key = principalStateKey(name);
  if (!key) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePrincipalState(name: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  const key = principalStateKey(name);
  if (!key) return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removePrincipalState(name: string): void {
  if (typeof window === 'undefined') return;
  const key = principalStateKey(name);
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Device preference cleanup is best-effort and must not break sign-out.
  }
}

export function purgeLegacyUnscopedMobileState(): void {
  if (typeof window === 'undefined') return;
  for (const key of [
    'opsknight-biometric-enabled',
    'opsknight_biometric_credential_id',
    'mobileQuickSwitcherRecents',
  ]) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore browsers where local storage is unavailable/restricted.
    }
  }
}
