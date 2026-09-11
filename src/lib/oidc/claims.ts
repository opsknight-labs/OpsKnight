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
