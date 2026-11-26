/**
 * Minimal Slack Web API client for incident channel delivery.
 *
 * Never sleeps on a rate limit: a 429 (or `ok:false, error:"ratelimited"`) comes back with
 * `retryAfterMs` so the durable notification queue defers the job instead of holding a worker.
 * Only network failures and 5xx are retried in-process, and only up to `maxAttempts`.
 */

const SLACK_API = 'https://slack.com/api';
const DEFAULT_RATE_LIMIT_MS = 30_000;

/** Slack errors that will not heal on retry: the channel, token or app must be fixed first. */
export const PERMANENT_SLACK_ERRORS = new Set([
  'channel_not_found',
  'not_in_channel',
  'is_archived',
  'invalid_auth',
  'not_authed',
  'token_revoked',
  'token_expired',
  'account_inactive',
  'missing_scope',
  'team_access_not_granted',
  'invalid_blocks',
  'msg_too_long',
]);

/** chat.update errors that mean the stored card is gone or frozen, so a new card must be posted. */
export const SLACK_MESSAGE_GONE_ERRORS = new Set([
  'message_not_found',
  'cant_update_message',
  'edit_window_closed',
]);

const RETRYABLE_SLACK_ERRORS = new Set([
  'internal_error',
  'fatal_error',
  'service_unavailable',
  'request_timeout',
]);

export type SlackErrorClass =
  'permanent' | 'rate_limited' | 'retryable' | 'message_gone' | 'unknown';

export function classifySlackError(code: string, status?: number): SlackErrorClass {
  if (status === 429 || code === 'ratelimited') return 'rate_limited';
  if (SLACK_MESSAGE_GONE_ERRORS.has(code)) return 'message_gone';
  if (PERMANENT_SLACK_ERRORS.has(code)) return 'permanent';
  if (RETRYABLE_SLACK_ERRORS.has(code) || (status !== undefined && status >= 500))
    return 'retryable';
  return 'unknown';
}

/** Retry predicate for thrown fetch errors: status-based first, then network failure shapes. */
export function isRetryableSlackTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { statusCode?: unknown }).statusCode;
  if (typeof status === 'number') return status >= 500 || status === 429;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  return /fetch failed|network|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|timed? ?out/i.test(
    error.message
  );
}

/** Parses Retry-After as seconds or an HTTP date. */
export function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1_000);
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? Math.max(1_000, at - Date.now()) : undefined;
}

export type SlackApiResult<T> =
  { ok: true; data: T } | { ok: false; error: string; status?: number; retryAfterMs?: number };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function callSlackApi<T extends Record<string, unknown>>(
  method: string,
  token: string,
  body: Record<string, unknown>,
  options: { maxAttempts?: number; timeoutMs?: number; form?: boolean } = {}
): Promise<SlackApiResult<T>> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 1);
  let last: SlackApiResult<T> = { ok: false, error: 'Slack API request failed' };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let retryable = false;
    try {
      // Read methods such as users.lookupByEmail do not accept JSON bodies, so they go form-encoded.
      const response = await fetch(`${SLACK_API}/${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': options.form
            ? 'application/x-www-form-urlencoded'
            : 'application/json; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
        body: options.form
          ? new URLSearchParams(
              Object.entries(body).map(([key, value]) => [key, String(value)])
            ).toString()
          : JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      const status = typeof response.status === 'number' ? response.status : 200;
      const retryAfter = response.headers?.get?.('Retry-After');
      if (status === 429) {
        return {
          ok: false,
          error: 'ratelimited',
          status: 429,
          retryAfterMs: parseRetryAfterMs(retryAfter) ?? DEFAULT_RATE_LIMIT_MS,
        };
      }
      const data = (await response.json().catch(() => null)) as
        (T & { ok?: boolean; error?: string }) | null;
      if (status < 400 && data?.ok) return { ok: true, data };
      const error = data?.error || `HTTP ${status}`;
      if (error === 'ratelimited') {
        return {
          ok: false,
          error,
          status: 429,
          retryAfterMs: parseRetryAfterMs(retryAfter) ?? DEFAULT_RATE_LIMIT_MS,
        };
      }
      last = { ok: false, error, status };
      retryable = classifySlackError(error, status) === 'retryable';
    } catch (caught) {
      last = {
        ok: false,
        error: caught instanceof Error ? caught.message : 'Slack API request failed',
      };
      retryable = isRetryableSlackTransportError(caught);
    }
    if (!retryable || attempt === maxAttempts) return last;
    await sleep(Math.min(2_000, 250 * 2 ** (attempt - 1)));
  }
  return last;
}
