import type { OidcClaims } from '@/lib/oidc/provider-policy';

export function boundedStringClaim(
  claims: OidcClaims,
  name: string,
  maximumLength: number
): string | null {
  const value = Object.getOwnPropertyDescriptor(claims, name)?.value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) return null;
  return normalized;
}

export function boundedStringArrayClaim(
  claims: OidcClaims,
  name: string,
  limits: { maximumItems: number; maximumItemLength: number }
): string[] | null {
  const value = Object.getOwnPropertyDescriptor(claims, name)?.value;
  if (!Array.isArray(value) || value.length > limits.maximumItems) return null;
  if (!value.every(item => typeof item === 'string' && item.length <= limits.maximumItemLength)) {
    return null;
  }
  return value;
}

/** Normalize provider boolean claims identically in login and staged verification. */
export function coerceBooleanClaim(value: unknown): boolean | undefined {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}
