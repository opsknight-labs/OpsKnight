import 'server-only';
import { guardedFetchFor } from '../ai/gateway';
import { CONNECTOR_BOUNDS } from './contract';

/**
 * The only way connector code reaches the network. Every request goes through the AI gateway's guarded fetch:
 * public endpoints use the SSRF-safe fetch (HTTPS, public addresses only, no redirects); a private endpoint is
 * reachable only with an administrator's explicit consent and then only at the exact origin they saved.
 * Metadata and link-local addresses are refused either way. On top of that every request has a timeout, is
 * read-only by construction (GET, or POST to a search endpoint) and its body is read up to a size cap.
 */
export type ConnectorFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type ConnectorErrorCode =
  | 'BLOCKED'
  | 'UNREACHABLE'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE'
  | 'UNSUPPORTED'
  | 'ABORTED';

export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export function connectorFetchFor(connection: {
  baseUrl: string;
  allowPrivateNetwork: boolean;
}): ConnectorFetch {
  const guarded = guardedFetchFor({
    baseUrl: connection.baseUrl,
    allowPrivateNetwork: connection.allowPrivateNetwork,
  });
  return (input, init) => guarded(input, init);
}

export interface ConnectorHttp {
  /** Absolute URL of a path under the connection's base URL. */
  url(path: string, query?: Record<string, string | number | undefined>): string;
  getJson(path: string, options?: RequestOptions): Promise<unknown>;
  postJson(path: string, body: unknown, options?: RequestOptions): Promise<unknown>;
  getText(path: string, options?: RequestOptions): Promise<string>;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  /** Absolute URL on another host of the same vendor (CloudWatch Logs); still guarded. */
  absoluteUrl?: string;
  /** Overrides the JSON body serialisation, for signed requests. */
  rawBody?: string;
}

/** Classifies a fetch failure without exposing its message, which can contain the URL. */
function classify(error: unknown, timedOut: boolean, aborted: boolean): ConnectorError {
  if (error instanceof ConnectorError) return error;
  if (timedOut) return new ConnectorError('TIMEOUT', 'The connection did not answer in time');
  if (aborted) return new ConnectorError('ABORTED', 'The request was cancelled');
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
  const message = `${error instanceof Error ? error.message : ''} ${cause}`;
  if (
    /HTTPS is required|outside the approved|metadata|not allowed|restricted network|credentials are not/i.test(
      message
    )
  )
    return new ConnectorError('BLOCKED', 'This address is not allowed');
  return new ConnectorError('UNREACHABLE', 'The connection could not be reached');
}

/** Reads a body up to `limit` bytes; larger bodies are cancelled and rejected. */
export async function readBounded(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new ConnectorError('TOO_LARGE', 'The response was too large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ConnectorError('TOO_LARGE', 'The response was too large');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export function createConnectorHttp(options: {
  baseUrl: string;
  fetch: ConnectorFetch;
  timeoutMs: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  maxBytes?: number;
  /** Signs a request just before it is sent (CloudWatch). */
  sign?: (request: {
    method: string;
    url: URL;
    headers: Record<string, string>;
    body: string;
  }) => Record<string, string>;
}): ConnectorHttp {
  const base = options.baseUrl.replace(/\/+$/, '');
  const limit = options.maxBytes ?? CONNECTOR_BOUNDS.maxResponseBytes;
  const build = (path: string, query?: RequestOptions['query']) => {
    const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query ?? {}))
      if (value !== undefined) url.searchParams.set(key, String(value));
    return url;
  };

  async function send(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    request: RequestOptions = {}
  ): Promise<string> {
    const url = request.absoluteUrl ? new URL(request.absoluteUrl) : build(path, request.query);
    if (request.absoluteUrl)
      for (const [key, value] of Object.entries(request.query ?? {}))
        if (value !== undefined) url.searchParams.set(key, String(value));
    const payload = method === 'POST' ? (request.rawBody ?? JSON.stringify(body ?? {})) : '';
    let headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': 'OpsKnight-Squire/1',
      ...options.headers,
      ...request.headers,
      ...(method === 'POST' && !request.headers?.['content-type']
        ? { 'content-type': 'application/json' }
        : {}),
    };
    if (options.sign)
      headers = { ...headers, ...options.sign({ method, url, headers, body: payload }) };

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) controller.abort();
    try {
      const response = await options.fetch(url.toString(), {
        method,
        headers,
        ...(method === 'POST' ? { body: payload } : {}),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new ConnectorError(
          'HTTP_ERROR',
          `The connection answered with status ${response.status}`,
          response.status
        );
      }
      return await readBounded(response, limit);
    } catch (error) {
      throw classify(error, timedOut, Boolean(options.signal?.aborted));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  const json = (text: string): unknown => {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new ConnectorError('INVALID_RESPONSE', 'The connection returned unreadable data');
    }
  };

  return {
    url: (path, query) => build(path, query).toString(),
    getJson: async (path, request) => json(await send('GET', path, undefined, request)),
    postJson: async (path, body, request) => json(await send('POST', path, body, request)),
    getText: (path, request) => send('GET', path, undefined, request),
  };
}
