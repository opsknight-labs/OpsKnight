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
