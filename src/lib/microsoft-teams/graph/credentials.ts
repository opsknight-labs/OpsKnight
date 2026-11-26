import 'server-only';

/**
 * Health-check probes against Microsoft: an uncached client-credentials token request (are the
 * Entra app ID and secret valid in this tenant?) and the installed Teams app version.
 * Tokens are never returned or logged; only Entra error codes are surfaced.
 */

export type TeamsCredentialProbe = { ok: true } | { ok: false; code: string; message: string };

const PROBE_TIMEOUT_MS = 8_000;

/** Plain-English meaning of the Entra (AADSTS) errors admins actually hit. */
export function describeEntraTokenError(
  errorCodes: number[],
  error?: string | null
): {
  code: string;
  message: string;
} {
  if (errorCodes.includes(7000222))
    return {
      code: 'SECRET_EXPIRED',
      message:
        'The client secret has expired. Create a new secret in Entra ID (Certificates & secrets) and save it here.',
    };
  if (errorCodes.includes(7000215))
    return {
      code: 'SECRET_INVALID',
      message:
        'The client secret is wrong. Paste the secret Value (not the Secret ID) from Entra ID and save again.',
    };
  if (errorCodes.includes(700016))
    return {
      code: 'APP_NOT_FOUND',
      message:
        'The Application (client) ID was not found in this tenant. Check the client ID and tenant ID.',
    };
  if (errorCodes.includes(90002) || errorCodes.includes(900023))
    return { code: 'TENANT_NOT_FOUND', message: 'The tenant ID is not a valid Entra tenant.' };
  if (errorCodes.includes(7000112))
    return { code: 'APP_DISABLED', message: 'The Entra application is disabled.' };
  return {
    code: error ? `ENTRA_${error.toUpperCase().slice(0, 40)}` : 'TOKEN_FAILED',
    message: 'Microsoft refused the bot credentials. Check the client ID, secret and tenant ID.',
  };
}

export async function probeMicrosoftTeamsCredentials(input: {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}): Promise<TeamsCredentialProbe> {
  const tenantId = input.tenantId.trim();
  if (!tenantId)
    return {
      ok: false,
      code: 'TENANT_REQUIRED',
      message: 'Set the tenant ID to verify credentials.',
    };
  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: input.clientId,
          client_secret: input.clientSecret,
          scope: 'https://api.botframework.com/.default',
          grant_type: 'client_credentials',
        }).toString(),
        cache: 'no-store',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }
    );
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      error_codes?: unknown;
    };
    const codes = Array.isArray(body.error_codes)
      ? body.error_codes.filter((c): c is number => typeof c === 'number')
      : [];
    return { ok: false, ...describeEntraTokenError(codes, body.error) };
  } catch {
    return {
      ok: false,
      code: 'NETWORK',
      message: 'Could not reach Microsoft Entra ID to verify the credentials. Try again shortly.',
    };
  }
}

export type InstalledTeamsAppVersion =
  | { ok: true; version: string | null }
  | { ok: false; code: 'GRAPH_TOKEN_FAILED' | 'FORBIDDEN' | 'TEAM_NOT_FOUND' | 'UNAVAILABLE' };

/** The OpsKnight app version installed in one Team (null when the app isn't found there). */
export async function getInstalledTeamsAppVersion(input: {
  tenantId: string;
  teamId: string;
  clientId: string;
}): Promise<InstalledTeamsAppVersion> {
  const { getMicrosoftTeamsGraphAccessToken } = await import('../client');
  const token = await getMicrosoftTeamsGraphAccessToken(input.tenantId);
  if (!token) return { ok: false, code: 'GRAPH_TOKEN_FAILED' };
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/teams/${encodeURIComponent(input.teamId)}/installedApps?$expand=teamsAppDefinition($expand=bot)`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }
    );
    if (res.status === 403 || res.status === 401) return { ok: false, code: 'FORBIDDEN' };
    if (res.status === 404) return { ok: false, code: 'TEAM_NOT_FOUND' };
    if (!res.ok) return { ok: false, code: 'UNAVAILABLE' };
    const body = (await res.json()) as {
      value?: Array<{
        teamsAppDefinition?: {
          teamsAppId?: string | null;
          version?: string | null;
          authorization?: { clientAppId?: string | null } | null;
          bot?: { id?: string | null } | null;
        } | null;
      }>;
    };
    const expected = input.clientId.trim().toLowerCase();
    const app = body.value?.find(row => {
      const def = row.teamsAppDefinition;
      return [def?.authorization?.clientAppId, def?.bot?.id, def?.teamsAppId].some(
        id => id?.trim().toLowerCase() === expected
      );
    });
    return { ok: true, version: app?.teamsAppDefinition?.version?.trim() || null };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
