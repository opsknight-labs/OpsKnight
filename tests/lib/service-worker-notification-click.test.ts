import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type Listener = (event: unknown) => void;
type FakeWindow = {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate: ReturnType<typeof vi.fn>;
};

const workerSource = readFileSync(resolve(__dirname, '../../public/custom-sw.js'), 'utf8');

function fakeWindow(url: string): FakeWindow {
  return { url, focus: vi.fn(async () => undefined), navigate: vi.fn(async () => undefined) };
}

async function tapNotification(windows: FakeWindow[], url = '/m/incidents/inc-1') {
  const listeners = new Map<string, Listener>();
  const openWindow = vi.fn(async () => undefined);
  vm.runInNewContext(workerSource, {
    self: {
      addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
      registration: { pushManager: {} },
      location: { origin: 'https://ops.example' },
      crypto: globalThis.crypto,
    },
    clients: { matchAll: async () => windows, openWindow },
    fetch: vi.fn(),
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

  let pending: Promise<unknown> = Promise.resolve();
  listeners.get('notificationclick')!({
    notification: { close: () => {}, data: { url } },
    action: '',
    waitUntil: (promise: Promise<unknown>) => (pending = promise),
  });
  await pending;
  return { openWindow };
}

describe('service worker notification click', () => {
  it('opens a new window instead of navigating a desktop tab on the same origin', async () => {
    const desktopTab = fakeWindow('https://ops.example/postmortems/pm-1/edit');

    const { openWindow } = await tapNotification([desktopTab]);

    expect(desktopTab.focus).not.toHaveBeenCalled();
    expect(desktopTab.navigate).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith('/m/incidents/inc-1');
  });

  it('does not treat a path that only starts with /m as the mobile shell', async () => {
    const lookalike = fakeWindow('https://ops.example/metrics');

    const { openWindow } = await tapNotification([lookalike]);

    expect(lookalike.navigate).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalled();
  });

  it('reuses an open mobile shell window', async () => {
    const desktopTab = fakeWindow('https://ops.example/incidents');
    const shell = fakeWindow('https://ops.example/m/incidents?tab=open');

    const { openWindow } = await tapNotification([desktopTab, shell]);

    expect(shell.focus).toHaveBeenCalled();
    expect(shell.navigate).toHaveBeenCalledWith('/m/incidents/inc-1');
    expect(desktopTab.navigate).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });
});
