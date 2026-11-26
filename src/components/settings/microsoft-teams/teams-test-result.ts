/** Plain-English outcome of "Send test card" from the /api/microsoft-teams/test response. */
export type TeamsTestResult =
  | { ok: true; message: string }
  | {
      ok: false;
      message: string;
      /** Provider or API code, shown so admins can quote it to support. */
      code: string | null;
      /** Raw provider detail, trimmed. */
      detail: string | null;
    };

const MESSAGES: Record<string, string> = {
  NOT_CONFIGURED:
    'Microsoft Teams isn’t connected. Save the app credentials in Setup & Credentials.',
  GRAPH_TOKEN_FAILED:
    'Microsoft refused the bot credentials. Check the client secret in Setup; it may have expired.',
  AUTH_EXPIRED:
    'Microsoft refused the bot credentials. Check the client secret in Setup; it may have expired.',
  APP_NOT_INSTALLED:
    'The OpsKnight app isn’t installed in this Team any more. Add the app to the Team again.',
  CHANNEL_NOT_FOUND:
    'This channel was deleted or the bot can’t see it. Pick another channel for the service.',
  CONSENT_REQUIRED:
    'A Team owner needs to grant the app’s permissions. Update or reinstall the app in Teams.',
  RATE_LIMITED: 'Teams is rate limiting OpsKnight right now. Wait a minute and try again.',
  TENANT_REQUIRED:
    'This destination has no Microsoft tenant. Re-link the channel from the service.',
  TENANT_NOT_ALLOWED: 'This Team belongs to a tenant that isn’t allowed by your Teams settings.',
  DESTINATION_NOT_FOUND: 'This destination no longer exists. Refresh the page.',
  RESOURCE_NOT_FOUND: 'This destination is disabled or the app was removed from its Team.',
  FORBIDDEN: 'You don’t have permission to test this service’s channel.',
};

export function describeTeamsTestResult(httpOk: boolean, data: unknown): TeamsTestResult {
  if (httpOk) return { ok: true, message: 'Test card sent. Check the channel in Teams.' };
  const body = (data && typeof data === 'object' ? data : {}) as {
    error?: unknown;
    code?: unknown;
    meta?: { providerCode?: unknown };
  };
  const providerCode = typeof body.meta?.providerCode === 'string' ? body.meta.providerCode : null;
  const apiCode = typeof body.code === 'string' ? body.code : null;
  const code = providerCode ?? apiCode;
  const raw = typeof body.error === 'string' ? body.error.trim().slice(0, 300) : '';
  const message =
    // eslint-disable-next-line security/detect-object-injection -- read-only lookup in a fixed constant table
    (providerCode && Object.hasOwn(MESSAGES, providerCode) && MESSAGES[providerCode]) ||
    // eslint-disable-next-line security/detect-object-injection -- read-only lookup in a fixed constant table
    (apiCode && Object.hasOwn(MESSAGES, apiCode) && MESSAGES[apiCode]) ||
    raw ||
    'The test card could not be sent.';
  return { ok: false, message, code, detail: raw && raw !== message ? raw : null };
}
