// stdio <-> Streamable HTTP proxy. The OpsKnight server is stateless, so each JSON-RPC line from
// stdin becomes one POST and every message in its answer becomes one stdout line.
import { createInterface } from 'node:readline';

export const PAGES_URI = 'opsknight://oncall/me/pages';
const MODERN = '2026-07-28';
const VERSION_META = 'io.modelcontextprotocol/protocolVersion';
// Which body field Mcp-Name mirrors, per the 2026-07-28 standard headers.
const NAME_SOURCE = new Map([
  ['tools/call', 'name'],
  ['prompts/get', 'name'],
  ['resources/read', 'uri'],
  ['tasks/get', 'taskId'],
  ['tasks/update', 'taskId'],
  ['tasks/cancel', 'taskId'],
]);
const MAX_RETRY_AFTER_S = 30;
const MAX_429_RETRIES = 3;
const BRIDGE_ERROR = -32000;
const CHANNEL_INSTRUCTIONS =
  'Events in <channel source="opsknight"> tags mean OpsKnight paged the signed-in person. Look at the page with oncall_catch_up or incident_search before acting.';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Header values must be visible ASCII; anything else travels as the spec's Base64 sentinel. */
export function headerValue(value) {
  return value !== '' && value === value.trim() && /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Each SSE event's joined `data:` lines. */
async function* sseData(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  let data = [];
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (line === '') {
        if (data.length) yield data.join('\n');
        data = [];
      } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (data.length) yield data.join('\n');
}

function retryAfterSeconds(header) {
  if (!header) return 1;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, (date - Date.now()) / 1000) : 1;
}

export function runBridge({ base, auth, toolsets, channel, input, output, log }) {
  const endpoint = `${base}/mcp`;
  let negotiated;
  const write = message => output.write(`${JSON.stringify(message)}\n`);
  const fail = (id, message, data) =>
    id === undefined
      ? log(message)
      : write({
          jsonrpc: '2.0',
          id,
          error: { code: BRIDGE_ERROR, message, ...(data ? { data } : {}) },
        });

  async function post(message, signal) {
    const version =
      message.params?._meta?.['io.modelcontextprotocol/protocolVersion'] ??
      (message.method === 'initialize' ? undefined : negotiated);
    const nameField = NAME_SOURCE.get(message.method);
    // eslint-disable-next-line security/detect-object-injection -- nameField comes from NAME_SOURCE
    const name = nameField ? message.params?.[nameField] : undefined;
    const send = async () =>
      fetch(endpoint, {
        method: 'POST',
        signal,
        headers: {
          authorization: `Bearer ${await auth.token()}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'user-agent': 'opsknight-mcp-bridge/0.1.0',
          ...(version ? { 'mcp-protocol-version': version } : {}),
          ...(typeof message.method === 'string'
            ? { 'mcp-method': headerValue(message.method) }
            : {}),
          ...(typeof name === 'string' ? { 'mcp-name': headerValue(name) } : {}),
          ...(toolsets ? { 'x-opsknight-toolsets': toolsets } : {}),
        },
        body: JSON.stringify(message),
      });
    let response = await send();
    if (response.status === 401) {
      await response.body?.cancel();
      if (await auth.refresh()) response = await send();
    }
    for (let attempt = 0; response.status === 429 && attempt < MAX_429_RETRIES; attempt++) {
      const wait = retryAfterSeconds(response.headers.get('retry-after'));
      if (wait > MAX_RETRY_AFTER_S) break;
      await response.body?.cancel();
      await sleep(wait * 1000);
      response = await send();
    }
    return response;
  }

  /** Messages in a JSON or SSE answer, one at a time. */
  async function* messages(response) {
    if (!response.body) return;
    if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
      for await (const data of sseData(response.body)) {
        try {
          yield JSON.parse(data);
        } catch {
          log('Skipped an event that was not JSON.');
        }
      }
      return;
    }
    const text = await response.text();
    if (!text.trim()) return;
    const parsed = JSON.parse(text);
    yield* Array.isArray(parsed) ? parsed : [parsed];
  }

  function adjust(request, message) {
    if (message.id === undefined || message.id !== request.id || !message.result) return message;
    if (request.method === 'initialize' && typeof message.result.protocolVersion === 'string')
      negotiated = message.result.protocolVersion;
    if (channel && (request.method === 'initialize' || request.method === 'server/discover')) {
      const result = message.result;
      result.capabilities = {
        ...result.capabilities,
        experimental: { ...result.capabilities?.experimental, 'claude/channel': {} },
      };
      result.instructions = [result.instructions, CHANNEL_INSTRUCTIONS]
        .filter(Boolean)
        .join('\n\n');
      startChannel();
    }
    return message;
  }

  async function handle(line) {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (!request || typeof request !== 'object') {
      write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
      return;
    }
    const id = request.id;
    try {
      const response = await post(request);
      if (response.status === 202) return;
      if (response.status === 401)
        return fail(
          id,
          `OpsKnight rejected the credentials (HTTP 401). Set a valid OPSKNIGHT_TOKEN or run: opsknight-mcp login --url ${base}`
        );
      if (response.status === 429)
        return fail(
          id,
          'OpsKnight is rate limiting this connection (HTTP 429). Try again shortly.',
          {
            retryAfter: response.headers.get('retry-after'),
          }
        );
      let answered = false;
      try {
        for await (const message of messages(response)) {
          answered ||= message.id !== undefined && message.id === id;
          write(adjust(request, message));
        }
      } catch {
        // An unreadable body (a proxy's HTML error page, a cut stream) is reported below.
      }
      if (!answered && id !== undefined)
        fail(id, `OpsKnight sent no usable answer (HTTP ${response.status}).`, {
          status: response.status,
        });
    } catch (error) {
      fail(
        id,
        `Could not reach OpsKnight at ${base}: ${error?.cause?.code ?? error?.message ?? 'network error'}`
      );
    }
  }

  // Optional Claude Code channel: hold a subscriptions/listen stream for the person's pages and
  // turn each update into a notifications/claude/channel event. The server ends every stream after
  // ten minutes, so the loop reconnects; failures back off up to five minutes.
  const listening = new AbortController();
  let channelStarted = false;
  function startChannel() {
    if (channelStarted) return;
    channelStarted = true;
    void (async () => {
      let backoff = 5_000;
      let id = 0;
      while (!listening.signal.aborted) {
        let healthy = false;
        try {
          const response = await post(
            {
              jsonrpc: '2.0',
              id: `opsknight-channel-${++id}`,
              method: 'subscriptions/listen',
              params: {
                notifications: { resourceSubscriptions: [PAGES_URI] },
                _meta: {
                  [VERSION_META]: MODERN,
                  'io.modelcontextprotocol/clientCapabilities': {},
                  'io.modelcontextprotocol/clientInfo': {
                    name: 'opsknight-mcp-bridge',
                    version: '0.1.0',
                  },
                },
              },
            },
            listening.signal
          );
          if (!response.ok) {
            await response.body?.cancel();
            log(`Page channel: subscription refused (HTTP ${response.status}); retrying.`);
          } else
            for await (const message of messages(response)) {
              if (message.error)
                log(`Page channel: subscription refused (${message.error.message}); retrying.`);
              if (message.method === 'notifications/subscriptions/acknowledged') healthy = true;
              if (
                message.method === 'notifications/resources/updated' &&
                message.params?.uri === PAGES_URI
              )
                write({
                  jsonrpc: '2.0',
                  method: 'notifications/claude/channel',
                  params: {
                    content: 'You have a new OpsKnight page. Check it with oncall_catch_up.',
                    meta: { uri: PAGES_URI },
                  },
                });
            }
        } catch {
          if (!listening.signal.aborted) log('Page channel: connection lost; reconnecting.');
        }
        if (listening.signal.aborted) break;
        backoff = healthy ? 5_000 : Math.min(backoff * 2, 300_000);
        await sleep(healthy ? 1_000 : backoff);
      }
    })();
  }

  const inflight = new Set();
  const lines = createInterface({ input, crlfDelay: Infinity });
  lines.on('line', line => {
    if (!line.trim()) return;
    const task = handle(line).finally(() => inflight.delete(task));
    inflight.add(task);
  });
  return new Promise(resolve =>
    lines.on('close', async () => {
      await Promise.allSettled([...inflight]);
      listening.abort();
      resolve();
    })
  );
}
