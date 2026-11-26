import { logger } from '@/lib/logger';
import { retryFetch } from '@/lib/retry';

const NON_IDEMPOTENT_POST_METHODS = new Set([
  'conversations.create',
  'chat.postMessage',
  'bookmarks.add',
]);

export type SlackApiResult = {
  ok: boolean;
  error?: string;
  httpStatus?: number;
  transportFailure?: boolean;
  sideEffectAmbiguous?: boolean;
  /** Slack refused the call with HTTP 429 / `ratelimited`: definitely not applied, retry later. */
  rateLimited?: boolean;
  /** From Retry-After when Slack rate-limited the call. */
  retryAfterMs?: number;
  channel?: { id: string; name: string };
  channels?: Array<{ id: string; name: string }>;
  user?: { profile?: { email?: string } };
  ts?: string;
  message?: { ts?: string };
  response_metadata?: { next_cursor?: string };
};

const DEFAULT_RATE_LIMIT_RETRY_MS = 30_000;

/** Retry-After (seconds or HTTP date) → ms, bounded to [1s, 15min]. */
export function parseSlackRetryAfter(value: string | null | undefined): number {
  if (!value) return DEFAULT_RATE_LIMIT_RETRY_MS;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_RATE_LIMIT_RETRY_MS;
  return Math.min(Math.max(ms, 1000), 15 * 60_000);
}

/**
 * Classifies a non-2xx Slack response. 429 is a definite rejection (Slack applies nothing to a
 * rate-limited call), so it is retryable and never side-effect-ambiguous. A 5xx on a create may
 * have been applied, so it stays ambiguous and callers reconcile before re-posting.
 */
export function classifySlackHttpFailure(
  method: string,
  status: number,
  bodyText: string,
  retryAfterHeader: string | null
): SlackApiResult {
  const error = bodyText ? bodyText.slice(0, 500) : `HTTP ${status}`;
  if (status === 429 || /"error"\s*:\s*"(ratelimited|rate_limited)"/.test(bodyText)) {
    return {
      ok: false,
      error,
      httpStatus: status,
      transportFailure: true,
      sideEffectAmbiguous: false,
      rateLimited: true,
      retryAfterMs: parseSlackRetryAfter(retryAfterHeader),
    };
  }
  const is5xx = status >= 500 && status <= 599;
  return {
    ok: false,
    error,
    httpStatus: status,
    transportFailure: is5xx,
    sideEffectAmbiguous: is5xx && NON_IDEMPOTENT_POST_METHODS.has(method),
  };
}

function rateLimitedJson(data: SlackApiResult, retryAfterHeader: string | null): SlackApiResult {
  if (data && !data.ok && (data.error === 'ratelimited' || data.error === 'rate_limited')) {
    return {
      ...data,
      rateLimited: true,
      transportFailure: true,
      sideEffectAmbiguous: false,
      retryAfterMs: parseSlackRetryAfter(retryAfterHeader),
    };
  }
  return data;
}

function headerOf(response: Response, name: string): string | null {
  return response.headers?.get ? response.headers.get(name) : null;
}

export async function slackApiCall(
  method: string,
  botToken: string,
  body: Record<string, unknown>
): Promise<SlackApiResult> {
  const allowRetry = !NON_IDEMPOTENT_POST_METHODS.has(method);
  try {
    if (allowRetry) {
      const response = await retryFetch(
        `https://slack.com/api/${method}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${botToken}`,
          },
          body: JSON.stringify(body),
        },
        {
          maxAttempts: 2,
          initialDelayMs: 500,
          retryableErrors: error => {
            if (error instanceof Error) {
              return (
                error.message.includes('fetch') ||
                error.message.includes('network') ||
                /^HTTP (429|5\d{2}):/.test(error.message)
              );
            }
            return false;
          },
        }
      );
      return rateLimitedJson((await response.json()) as SlackApiResult, headerOf(response, 'Retry-After'));
    }
    // Non-idempotent creates: single attempt only — never blind-retry after a
    // POST that may have had a provider side effect. Callers must reconcile.
    // Preserve structured transport signals instead of folding HTTP status into the string.
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return classifySlackHttpFailure(method, response.status, text, headerOf(response, 'Retry-After'));
    }
    return rateLimitedJson((await response.json()) as SlackApiResult, headerOf(response, 'Retry-After'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('[ChatOps] Slack API call failed', { method, error: message });
    const status = (error as { statusCode?: unknown } | null)?.statusCode;
    if (status === 429 || /^HTTP 429:/.test(message)) {
      // retryFetch already waited once; hand the rest of Retry-After to the job scheduler.
      const waited = (error as { retryAfterMs?: unknown }).retryAfterMs;
      return {
        ok: false,
        error: message,
        httpStatus: 429,
        transportFailure: true,
        sideEffectAmbiguous: false,
        rateLimited: true,
        retryAfterMs:
          typeof waited === 'number' && waited > 0
            ? Math.min(waited, 15 * 60_000)
            : DEFAULT_RATE_LIMIT_RETRY_MS,
      };
    }
    const isTimeoutish = /timeout|fetch|network|econnreset|etimedout/i.test(message);
    return {
      ok: false,
      error: message,
      transportFailure: isTimeoutish,
      sideEffectAmbiguous: NON_IDEMPOTENT_POST_METHODS.has(method) && isTimeoutish,
    };
  }
}

export function slackWarRoomMarker(incidentId: string, generation: number): string {
  return `[OKWR:${incidentId}:g${generation}]`;
}

export async function findExistingSlackChannel(
  botToken: string,
  channelName: string
): Promise<{ id: string; name: string } | null> {
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await slackApiCall('conversations.list', botToken, {
      exclude_archived: true,
      limit: 200,
      types: 'public_channel,private_channel',
      ...(cursor ? { cursor } : {}),
    });
    if (!result.ok || !result.channels) return null;
    const found = result.channels.find(channel => channel.name === channelName);
    if (found) return found;
    cursor = result.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return null;
}

export async function findSlackChannelByMarker(
  botToken: string,
  marker: string
): Promise<{ id: string; name: string } | null> {
  // Marker is stored in channel topic/purpose, which conversations.list does not
  // return. We scan by listing channels then verify each candidate's topic via
  // conversations.info. This is bounded and only used for AMBIGUOUS reconciliation.
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await slackApiCall('conversations.list', botToken, {
      exclude_archived: true,
      limit: 200,
      types: 'public_channel,private_channel',
      ...(cursor ? { cursor } : {}),
    });
    if (!result.ok || !result.channels) return null;
    for (const channel of result.channels) {
      const info = await slackApiCall('conversations.info', botToken, { channel: channel.id });
      const topic = (info as unknown as { channel?: { topic?: { value?: string }; purpose?: { value?: string } } }).channel?.topic?.value ?? '';
      const purpose = (info as unknown as { channel?: { topic?: { value?: string }; purpose?: { value?: string } } }).channel?.purpose?.value ?? '';
      if (topic.includes(marker) || purpose.includes(marker)) return channel;
    }
    cursor = result.response_metadata?.next_cursor;
    if (!cursor) break;
  }
  return null;
}

// ── Terminal-drift safe tri-state lookup ──────────────────────────────────

export type SlackTerminalLookupResult =
  | { status: 'FOUND'; channel: { id: string; name: string } }
  | { status: 'NOT_FOUND' }
  | { status: 'UNAVAILABLE'; code: 'RATE_LIMITED' | 'AUTH_FAILED' | 'PERMISSION_DENIED' | 'TRANSIENT'; error?: string };

function classifySlackListError(result: SlackApiResult): SlackTerminalLookupResult & { status: 'UNAVAILABLE' } {
  const raw = (result.error ?? '').toLowerCase();
  const status = result.httpStatus;
  if (status === 429 || raw.includes('rate_limited') || raw.includes('ratelimited') || raw.includes('429')) {
    return { status: 'UNAVAILABLE', code: 'RATE_LIMITED', error: result.error };
  }
  if (['invalid_auth', 'account_inactive', 'token_revoked', 'no_team', 'not_authed'].some(k => raw.includes(k))) {
    return { status: 'UNAVAILABLE', code: 'AUTH_FAILED', error: result.error };
  }
  if (raw.includes('missing_scope') || raw.includes('permission') || raw.includes('not_allowed') || raw.includes('restricted_action')) {
    return { status: 'UNAVAILABLE', code: 'PERMISSION_DENIED', error: result.error };
  }
  if (result.transportFailure || result.sideEffectAmbiguous || status === undefined || (status >= 500 && status <= 599) || raw.includes('timeout') || raw.includes('fetch') || raw.includes('network') || raw.includes('econnreset') || raw.includes('etimedout')) {
    return { status: 'UNAVAILABLE', code: 'TRANSIENT', error: result.error };
  }
  // Any other non-ok with no explicit classification is still unavailable — we
  // cannot prove absence when the API itself failed.
  return { status: 'UNAVAILABLE', code: 'TRANSIENT', error: result.error };
}

/**
 * Cleanup-safe Slack lookup for the terminal drift lane.
 * Tri-state: never conflates provider failure with "definitely absent".
 *
 * - FOUND      → channel exists, return it
 * - NOT_FOUND  → full paginated scan completed successfully, no match
 * - UNAVAILABLE→ any list/info call was rate-limited / auth / transport failure;
 *               caller must KEEP externalCleanupPending debt and retry later.
 */
export async function findSlackWarRoomForTerminalCleanup(
  botToken: string,
  marker: string,
  plannedExternalName?: string | null
): Promise<SlackTerminalLookupResult> {
  // 1) Marker scan
  let cursor: string | undefined;
  let markerScanSucceeded = true;
  for (let page = 0; page < 100; page += 1) {
    const result = await slackApiCall('conversations.list', botToken, {
      exclude_archived: true,
      limit: 200,
      types: 'public_channel,private_channel',
      ...(cursor ? { cursor } : {}),
    });
    if (!result.ok || !result.channels) {
      return classifySlackListError(result);
    }
    for (const channel of result.channels) {
      const info = await slackApiCall('conversations.info', botToken, { channel: channel.id });
      // info failure is not fatal for the whole scan unless it is a transport/auth
      // failure that suggests we cannot verify the marker at all — but a single
      // info 5xx should not abort the entire sweep. We treat info transport
      // failure as non-fatal for that channel; only list failures abort.
      // However if info returns invalid_auth / rate_limited, that IS lane-wide
      // unavailable — we cannot trust any negative result.
      if (!info.ok) {
        const lower = (info.error ?? '').toLowerCase().trim();
        if (lower.includes('rate_limited') || lower.includes('ratelimited') || lower.includes('429') || info.httpStatus === 429) {
          return { status: 'UNAVAILABLE', code: 'RATE_LIMITED', error: info.error };
        }
        if (['invalid_auth', 'account_inactive', 'token_revoked', 'not_authed'].some(k => lower.includes(k))) {
          return { status: 'UNAVAILABLE', code: 'AUTH_FAILED', error: info.error };
        }
        // Transport / 5xx at the info layer — we cannot prove the candidate is not the orphan
        if (info.transportFailure || info.sideEffectAmbiguous || info.httpStatus === 429 || (info.httpStatus !== undefined && info.httpStatus >= 500 && info.httpStatus <= 599)) {
          markerScanSucceeded = false;
          continue;
        }
        // Only genuinely benign per-channel staleness is skippable. Everything else
        // (missing_scope / restricted_action / permission / not_allowed / unknown
        // provider error) must prevent an authoritative NOT_FOUND — either return
        // UNAVAILABLE now or downgrade the eventual NOT_FOUND.
        // This fixes the narrow hole where `missing_scope` on conversations.info
        // was silently skipped, allowing a renamed orphan to leak as NOT_FOUND.
        if (lower === 'channel_not_found' || lower === 'is_archived') {
          continue;
        }
        // Permission / scope / unknown errors — classify as UNAVAILABLE so debt is kept.
        // Reuse the same classifier that covers missing_scope / restricted_action / permission.
        return classifySlackListError(info);
      }
      const topic = (info as unknown as { channel?: { topic?: { value?: string }; purpose?: { value?: string } } }).channel?.topic?.value ?? '';
      const purpose = (info as unknown as { channel?: { topic?: { value?: string }; purpose?: { value?: string } } }).channel?.purpose?.value ?? '';
      if (topic.includes(marker) || purpose.includes(marker)) return { status: 'FOUND', channel };
    }
    cursor = result.response_metadata?.next_cursor;
    if (!cursor) break;
  }

  // If any info transport failure occurred during marker scan, we cannot claim
  // NOT_FOUND authoritatively — the orphan may have been on a page we failed to verify.
  // Downgrade to UNAVAILABLE so the debt is kept.
  // Exception: if we completed list successfully but had isolated info failures,
  // we still consider the planned-name fallback before deciding.
  // Hold the flag and check fallback; if fallback also fails/not found with no
  // transport issues, we may still need to return UNAVAILABLE.

  // 2) Planned-name fallback (only if caller provided one)
  if (plannedExternalName) {
    let pCursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const result = await slackApiCall('conversations.list', botToken, {
        exclude_archived: true,
        limit: 200,
        types: 'public_channel,private_channel',
        ...(pCursor ? { cursor: pCursor } : {}),
      });
      if (!result.ok || !result.channels) {
        return classifySlackListError(result);
      }
      const found = result.channels.find(c => c.name === plannedExternalName);
      if (found) return { status: 'FOUND', channel: found };
      pCursor = result.response_metadata?.next_cursor;
      if (!pCursor) break;
    }
  }

  if (!markerScanSucceeded) {
    return { status: 'UNAVAILABLE', code: 'TRANSIENT', error: 'Partial conversations.info transport failure during marker scan — cannot prove absence' };
  }
  return { status: 'NOT_FOUND' };
}
