/** Entra client-secret expiry state shown on the Teams settings page and health checklist. */
export type TeamsSecretExpiryLevel = 'unknown' | 'ok' | 'soon' | 'urgent' | 'expired';

export type TeamsSecretExpiryState = {
  level: TeamsSecretExpiryLevel;
  /** Whole days until expiry (negative once expired); null when no date is recorded. */
  daysLeft: number | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
export const TEAMS_SECRET_WARN_DAYS = 30;
export const TEAMS_SECRET_URGENT_DAYS = 7;

export function getTeamsSecretExpiryState(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date()
): TeamsSecretExpiryState {
  if (!expiresAt) return { level: 'unknown', daysLeft: null };
  const at = typeof expiresAt === 'string' ? new Date(expiresAt) : expiresAt;
  if (Number.isNaN(at.getTime())) return { level: 'unknown', daysLeft: null };
  const ms = at.getTime() - now.getTime();
  const daysLeft = Math.ceil(ms / DAY_MS);
  if (ms <= 0) return { level: 'expired', daysLeft: -Math.floor(-ms / DAY_MS) || 0 };
  if (daysLeft <= TEAMS_SECRET_URGENT_DAYS) return { level: 'urgent', daysLeft };
  if (daysLeft <= TEAMS_SECRET_WARN_DAYS) return { level: 'soon', daysLeft };
  return { level: 'ok', daysLeft };
}

export function describeTeamsSecretExpiry(state: TeamsSecretExpiryState): string {
  const d = state.daysLeft ?? 0;
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  switch (state.level) {
    case 'unknown':
      return 'Expiry date not recorded. Add it so OpsKnight can warn you before the secret stops working.';
    case 'expired':
      return d === 0
        ? 'The client secret expired today. Teams cards and actions stop working until you save a new secret.'
        : `The client secret expired ${days(-d)} ago. Teams cards and actions stop working until you save a new secret.`;
    case 'urgent':
    case 'soon':
      return `The client secret expires in ${days(d)}. Create a new secret in Entra ID and save it here before then.`;
    default:
      return `The client secret is valid for ${days(d)}.`;
  }
}
