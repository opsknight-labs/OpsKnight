import { createHash } from 'node:crypto';
import { normalizeOidcIssuer } from '@/lib/oidc/issuer-migration';

export function oidcTrustFingerprint(issuer: string, clientId: string): string {
  const normalizedIssuer = normalizeOidcIssuer(issuer);
  return createHash('sha256')
    .update(`${normalizedIssuer}\0${clientId.trim()}`, 'utf8')
    .digest('hex');
}
