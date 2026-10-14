/**
 * Machine identities are User rows whose email lives in a reserved domain that
 * only the service-account service creates. That domain is the single source of
 * truth: department and job title are free-text profile fields and must never
 * decide whether an identity is a machine, because they can be set by a human.
 */
export const SERVICE_ACCOUNT_DOMAIN = 'serviceaccount.opsknight.local';

export function isServiceAccountEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase().endsWith(`@${SERVICE_ACCOUNT_DOMAIN}`);
}

export function isServiceAccountIdentity(user: { email?: string | null }): boolean {
  return isServiceAccountEmail(user.email);
}
