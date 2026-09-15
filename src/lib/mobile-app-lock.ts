'use client';

import {
  readPrincipalState,
  removePrincipalState,
  writePrincipalState,
} from '@/lib/mobile-principal-state';

const ENABLED_KEY = 'app-lock:enabled';
const CREDENTIAL_KEY = 'app-lock:credential-id';
const USER_HANDLE_KEY = 'app-lock:user-handle';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function isAppLockEnabled(): boolean {
  return readPrincipalState(ENABLED_KEY) === 'true';
}

export function setAppLockEnabled(enabled: boolean): void {
  if (enabled) writePrincipalState(ENABLED_KEY, 'true');
  else {
    removePrincipalState(ENABLED_KEY);
    removePrincipalState(CREDENTIAL_KEY);
  }
}

export function persistAppLockCredential(credential: PublicKeyCredential): void {
  const raw = new Uint8Array(credential.rawId);
  writePrincipalState(CREDENTIAL_KEY, bytesToBase64Url(raw));
}

export function getAppLockCredentialDescriptor(): PublicKeyCredentialDescriptor[] | undefined {
  const encoded = readPrincipalState(CREDENTIAL_KEY);
  if (!encoded) return undefined;
  try {
    return [{ type: 'public-key', id: base64UrlToBytes(encoded) as BufferSource }];
  } catch {
    removePrincipalState(CREDENTIAL_KEY);
    return undefined;
  }
}

export function getOrCreateAppLockUserHandle(): Uint8Array {
  const existing = readPrincipalState(USER_HANDLE_KEY);
  if (existing) {
    try {
      const decoded = base64UrlToBytes(existing);
      if (decoded.byteLength >= 16 && decoded.byteLength <= 64) return decoded;
    } catch {
      // Fall through to generate fresh non-identifying local material.
    }
  }

  const generated = crypto.getRandomValues(new Uint8Array(32));
  writePrincipalState(USER_HANDLE_KEY, bytesToBase64Url(generated));
  return generated;
}

export function isValidAppLockAssertion(value: Credential | null): value is PublicKeyCredential {
  if (!(value instanceof PublicKeyCredential)) return false;
  if (!(value.response instanceof AuthenticatorAssertionResponse)) return false;
  return value.rawId.byteLength > 0 && value.response.authenticatorData.byteLength > 0;
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    typeof PublicKeyCredential === 'undefined' ||
    typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function'
  ) {
    return false;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
      new Promise<boolean>(resolve => {
        timer = setTimeout(() => resolve(false), 3_000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
