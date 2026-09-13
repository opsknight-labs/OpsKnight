const TRUSTED_TEAMS_CONNECTOR_HOSTS = new Set([
  'smba.trafficmanager.net',
  'smba.infra.gcc.teams.microsoft.com',
  'smba.infra.gov.teams.microsoft.us',
  'smba.infra.dod.teams.microsoft.us',
]);

/**
 * Validate the Bot Connector service URL before it can be persisted or receive
 * a bearer token. The exact hosts are Microsoft's documented public and US
 * sovereign proactive-messaging endpoints. Paths remain region-specific.
 */
export function normalizeTrustedMicrosoftTeamsServiceUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (!TRUSTED_TEAMS_CONNECTOR_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (url.hash || url.search) return null;
    const pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
    return `${url.origin.toLowerCase()}${pathname}`;
  } catch {
    return null;
  }
}
