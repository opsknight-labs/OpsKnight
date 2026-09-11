export function normalizeOidcIssuer(issuer: string): string {
  try {
    const parsed = new URL(issuer.trim());
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return issuer.trim().replace(/\/+$/, '');
  }
}

export function isOidcIssuerMigration(currentIssuer: string, candidateIssuer: string): boolean {
  return normalizeOidcIssuer(currentIssuer) !== normalizeOidcIssuer(candidateIssuer);
}

export function hasIssuerMigrationConfirmation(formData: FormData): boolean {
  const value = formData.get('confirmIssuerMigration');
  return value === 'on' || value === 'true' || value === 'confirmed';
}

/**
 * Returns potential non-canonical issuer representations that may have been
 * persisted in previous releases (e.g., trailing slashes or unnormalized paths)
 * for seamless backwards-compatible lookup.
 */
export function getLegacyOidcIssuerVariants(canonicalIssuer: string): string[] {
  const normalized = normalizeOidcIssuer(canonicalIssuer);
  const variants = new Set<string>();

  // Single trailing slash (legacy default behavior before multi-slash stripping)
  variants.add(`${normalized}/`);
  // Double trailing slash
  variants.add(`${normalized}//`);
  // Unnormalized input itself if different
  if (canonicalIssuer.trim() !== normalized) {
    variants.add(canonicalIssuer.trim());
  }

  // Remove the canonical form itself so variants only include different legacy keys
  variants.delete(normalized);
  return Array.from(variants);
}
