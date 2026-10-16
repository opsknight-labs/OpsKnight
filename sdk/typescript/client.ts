import { OPERATIONS, type OperationRequests, type OperationResponses } from './schema.js';

export type * from './schema.js';
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null
  ) {
    super(`OpsKnight request failed (${status}, ${code}).`);
    this.name = 'ApiError';
  }
}
type OperationId = keyof OperationRequests;
type ListItem<K extends OperationId> = OperationResponses[K] extends { data: Array<infer Item> }
  ? Item
  : never;
interface RequestInput {
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
}
interface Envelope {
  data?: unknown;
  pagination?: { hasMore: boolean; nextCursor: string | null };
}
async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('API returned an empty JSON body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('API response exceeds the supported size.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('API returned invalid JSON.');
  }
}
export interface ClientOptions {
  baseUrl: string;
  token: string;
  maxRetries?: number;
  timeoutMs?: number;
  allowInsecureHttp?: boolean;
  fetch?: typeof globalThis.fetch;
}

/** API keys stay in memory and headers; redirects are never followed. */
export class Client {
  #baseUrl: string;
  #token: string;
  #fetch: typeof globalThis.fetch;
  #maxRetries: number;
  #timeoutMs: number;
  constructor(options: ClientOptions) {
    const url = new URL(options.baseUrl);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && options.allowInsecureHttp))
    ) {
      throw new Error(
        'Use an HTTPS API root without credentials, query or fragment. HTTP requires allowInsecureHttp.'
      );
    }
    if (!options.token || /\s/.test(options.token))
      throw new Error('A nonempty API token without whitespace is required.');
    this.#baseUrl = url.toString().replace(/\/$/, '');
    this.#token = options.token;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#maxRetries = options.maxRetries ?? 2;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    if (
      !Number.isInteger(this.#maxRetries) ||
      this.#maxRetries < 0 ||
      this.#maxRetries > 3 ||
      !Number.isFinite(this.#timeoutMs) ||
      this.#timeoutMs <= 0 ||
      this.#timeoutMs > 120_000
    ) {
      throw new Error('maxRetries must be 0–3 and timeoutMs must be 1–120000.');
    }
  }

  async call<K extends OperationId>(
    operation: K,
    request: OperationRequests[K]
  ): Promise<OperationResponses[K]> {
    return (await this.#request(operation, request as RequestInput)) as OperationResponses[K];
  }

  async #request(operation: OperationId, input: RequestInput): Promise<unknown> {
    const definition = Object.entries(OPERATIONS).find(([id]) => id === operation)?.[1];
    if (!definition) throw new Error('Unknown OpsKnight operation.');
    const path = definition.path.replace(/\{(\w+)\}/g, (_, name: string) => {
      const value = Object.entries(input.params ?? {}).find(([key]) => key === name)?.[1];
      if (typeof value !== 'string' || !value || value === '.' || value === '..')
        throw new Error(`Missing or invalid path parameter: ${name}`);
      return encodeURIComponent(value);
    });
    const url = new URL(this.#baseUrl + path);
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers = new Headers({
      Authorization: `Bearer ${this.#token}`,
      Accept: 'application/json',
    });
    for (const [key, value] of Object.entries(input.headers ?? {})) {
      if (!['idempotency-key', 'if-match'].includes(key.toLowerCase()))
        throw new Error('Only If-Match and Idempotency-Key may be supplied as custom headers.');
      headers.set(key, value);
    }
    for (const name of definition.requiredHeaders) {
      if (!headers.get(name)?.trim()) throw new Error(`Required header: ${name}`);
    }
    if (definition.bodyRequired && input.body === undefined)
      throw new Error('A request body is required.');
    const body = input.body === undefined ? undefined : JSON.stringify(input.body);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const safeRetry =
      definition.method === 'GET' ||
      (['supported', 'required'].includes(definition.idempotency ?? '') &&
        Boolean(headers.get('idempotency-key')));

    for (let attempt = 0; ; attempt++) {
      const response = await this.#fetch(url, {
        method: definition.method,
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      if (
        safeRetry &&
        attempt < this.#maxRetries &&
        [429, 502, 503, 504].includes(response.status)
      ) {
        const retryAfter = response.headers.get('retry-after');
        const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
        const date = retryAfter ? Date.parse(retryAfter) : NaN;
        const waitMs =
          seconds !== null
            ? seconds * 1000
            : Number.isFinite(date)
              ? Math.max(0, date - Date.now())
              : Math.min(250 * 2 ** attempt, 2000);
        // Never retry earlier than the server asks, nor sleep without a bound.
        if (waitMs <= 30_000) {
          await response.body?.cancel();
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }
      }
      if (!response.ok) {
        let code = 'HTTP_ERROR';
        try {
          const problem = await readJson(response);
          if (
            problem &&
            typeof problem === 'object' &&
            'code' in problem &&
            typeof problem.code === 'string'
          )
            code = problem.code;
        } catch {
          /* Do not include raw proxy or provider error bodies in exceptions. */
        }
        throw new ApiError(response.status, code, response.headers.get('x-request-id'));
      }
      if (response.status === 204) return null;
      return readJson(response);
    }
  }

  /** Bounded traversal follows signed cursor values, never response-supplied URLs. */
  async *paginate<K extends OperationId>(
    operation: K,
    request: OperationRequests[K],
    maxPages = 10_000
  ): AsyncGenerator<ListItem<K>> {
    const definition = Object.entries(OPERATIONS).find(([id]) => id === operation)?.[1];
    if (!definition || definition.method !== 'GET' || definition.kind !== 'list')
      throw new Error('Pagination requires a list operation.');
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10_000)
      throw new Error('maxPages must be 1–10000.');
    const input = request as RequestInput;
    const query = { ...input.query };
    const seen = new Set<string>();
    for (let page = 0; page < maxPages; page++) {
      const response = (await this.#request(operation, { ...input, query })) as Envelope;
      if (!Array.isArray(response.data)) throw new Error('List response has no data array.');
      for (const item of response.data) yield item as ListItem<K>;
      if (!response.pagination?.hasMore) return;
      const cursor = response.pagination.nextCursor;
      if (!cursor || seen.has(cursor)) throw new Error('Invalid or repeated pagination cursor.');
      seen.add(cursor);
      query.cursor = cursor;
    }
    throw new Error('Pagination exceeded maxPages.');
  }
}
