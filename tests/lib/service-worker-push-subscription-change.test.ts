import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type Listener = (event: unknown) => void;
type FetchCall = { url: string; init: RequestInit };

const workerSource = readFileSync(resolve(__dirname, '../../public/custom-sw.js'), 'utf8');
const VAPID_KEY_BYTES = new Uint8Array(65).fill(4);
const VAPID_KEY_B64URL = Buffer.from(VAPID_KEY_BYTES).toString('base64url');

function subscription(endpoint: string, applicationServerKey: ArrayBuffer | null = null) {
  return {
    endpoint,
    options: { applicationServerKey },
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) } }),
  };
}

function loadWorker({
  responses = {},
  existing = null,
}: {
  responses?: Record<string, number>;
  existing?: ReturnType<typeof subscription> | null;
}) {
  const listeners = new Map<string, Listener>();
  const fetchCalls: FetchCall[] = [];
  const messages: Array<Record<string, unknown>> = [];
  const subscribe = vi.fn(async (options: { applicationServerKey: Uint8Array }) => {
    expect(options).toMatchObject({ userVisibleOnly: true });
    return subscription('https://fcm.googleapis.com/fcm/send/new-token', options.applicationServerKey.buffer as ArrayBuffer);
  });

  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    fetchCalls.push({ url, init });
    const key = `${init.method ?? 'GET'} ${url}`;
    const status = responses[key] ?? 200;
    const body = url === '/api/system/vapid-public-key' ? { enabled: true, publicKey: VAPID_KEY_B64URL } : { success: status < 400, error: status >= 400 ? 'Authentication required' : undefined };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });

  const self = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    registration: { pushManager: { getSubscription: vi.fn(async () => existing), subscribe } },
    location: { origin: 'https://ops.example' },
    crypto: globalThis.crypto,
  };
  const clients = {
    matchAll: async () => [{ postMessage: (message: Record<string, unknown>) => messages.push(message) }],
  };
  vm.runInNewContext(workerSource, {
    self,
    clients,
    fetch,
    caches: { keys: async () => [] },
    indexedDB: {},
    atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    AbortController,
    setTimeout,
    clearTimeout,
    URL,
    Response,
    console: { warn: () => {}, error: () => {}, log: () => {} },
  });

  async function dispatch(event: Record<string, unknown>) {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get('pushsubscriptionchange')!({ ...event, waitUntil: (promise: Promise<unknown>) => (pending = promise) });
    await pending;
  }

  return { dispatch, fetchCalls, messages, subscribe, hasListener: () => listeners.has('pushsubscriptionchange') };
}

const body = (call: FetchCall) => JSON.parse(String(call.init.body));

describe('service worker pushsubscriptionchange recovery', () => {
  it('registers a pushsubscriptionchange handler', () => {
    expect(loadWorker({}).hasListener()).toBe(true);
  });

  it('saves a browser-provided replacement endpoint and retires the old one', async () => {
    const worker = loadWorker({});
    await worker.dispatch({
      oldSubscription: subscription('https://fcm.googleapis.com/fcm/send/old-token'),
      newSubscription: subscription('https://fcm.googleapis.com/fcm/send/rotated-token'),
    });

    expect(worker.subscribe).not.toHaveBeenCalled();
    const [save, retire] = worker.fetchCalls;
    expect(save).toMatchObject({ url: '/api/user/push-subscription', init: { method: 'POST', credentials: 'include' } });
    expect(body(save).endpoint).toBe('https://fcm.googleapis.com/fcm/send/rotated-token');
    expect(retire).toMatchObject({ url: '/api/user/push-subscription', init: { method: 'DELETE' } });
    expect(body(retire)).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/old-token' });
    expect(worker.messages).toContainEqual({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
  });

  it('re-subscribes with the previous VAPID key when the browser provides no replacement', async () => {
    const worker = loadWorker({});
    await worker.dispatch({
      oldSubscription: subscription('https://fcm.googleapis.com/fcm/send/old-token', VAPID_KEY_BYTES.buffer),
      newSubscription: null,
    });

    expect(worker.subscribe).toHaveBeenCalledTimes(1);
    expect(worker.fetchCalls.map(call => call.url)).not.toContain('/api/system/vapid-public-key');
    expect(body(worker.fetchCalls[0]).endpoint).toBe('https://fcm.googleapis.com/fcm/send/new-token');
  });

  it('fetches the server VAPID key when the old subscription is unavailable', async () => {
    const worker = loadWorker({});
    await worker.dispatch({ oldSubscription: null, newSubscription: null });

    expect(worker.fetchCalls[0].url).toBe('/api/system/vapid-public-key');
    const key = worker.subscribe.mock.calls[0][0].applicationServerKey as Uint8Array;
    expect(Array.from(key)).toEqual(Array.from(VAPID_KEY_BYTES));
    expect(worker.fetchCalls[1]).toMatchObject({ url: '/api/user/push-subscription', init: { method: 'POST' } });
    expect(worker.fetchCalls).toHaveLength(2);
  });

  it('keeps the old endpoint and asks the app to repair when the save is rejected', async () => {
    const worker = loadWorker({ responses: { 'POST /api/user/push-subscription': 401 } });
    await worker.dispatch({
      oldSubscription: subscription('https://fcm.googleapis.com/fcm/send/old-token'),
      newSubscription: subscription('https://fcm.googleapis.com/fcm/send/rotated-token'),
    });

    expect(worker.fetchCalls.filter(call => call.init.method === 'DELETE')).toHaveLength(0);
    expect(worker.messages).toContainEqual(
      expect.objectContaining({ type: 'PUSH_SUBSCRIPTION_CHANGE_FAILED', status: 401 })
    );
  });
});
