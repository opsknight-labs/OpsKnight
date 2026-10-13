export function sessionAuthenticationLabel(method: unknown): string {
  if (method === 'oidc') return 'OIDC';
  if (method === 'credentials') return 'Password';
  return 'Unknown';
}
