import { createHash } from 'node:crypto';

export function oidcTrustFingerprint(issuer: string, clientId: string): string {
  const normalizedIssuer = issuer.trim().replace(/\/+$/, '');
  return createHash('sha256')
    .update(`${normalizedIssuer}\0${clientId.trim()}`, 'utf8')
    .digest('hex');
}
