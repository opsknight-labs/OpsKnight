import { EventEmitter } from 'node:events';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  clients: [] as Array<{ queries: string[]; emit: (event: string, value: unknown) => boolean }>,
}));

vi.mock('@/lib/prisma', () => ({ default: { $executeRaw: mocks.executeRaw } }));
vi.mock('@/lib/postgres-listener-config', () => ({
  postgresListenerUrl: () => 'postgresql://listener/app',
}));
vi.mock('pg', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class Client extends Emitter {
    queries: string[] = [];
    constructor() {
      super();
      mocks.clients.push(this);
    }
    async connect() {}
    async query(sql: string) {
      this.queries.push(sql);
      return { rows: [] };
    }
    async end() {}
  }
  return { Client, default: { Client } };
});

import {
  MAX_PRESENCE_INCIDENTS,
  MAX_PRESENCE_PAYLOAD_BYTES,
  MAX_VIEWERS_PER_INCIDENT,
  PRESENCE_CHANNEL,
  PresenceStore,
  applyPresenceMessage,
  decodePresenceMessage,
  encodePresenceMessage,
  heartbeatIncidentViewer,
  leaveIncidentViewer,
  stopIncidentPresenceListener,
} from '@/lib/incidents/presence';

const ivy = { id: 'u_ivy', name: 'Ivy Brown', avatarUrl: '/avatars/ivy.png' };
const leo = { id: 'u_leo', name: 'Leo Patel', avatarUrl: null };

function clockedStore() {
  let now = 1_000_000;
  const store = new PresenceStore(() => now);
  return { store, advance: (ms: number) => (now += ms) };
}

describe('PresenceStore', () => {
  it('expires a viewer 75s after the last heartbeat', () => {
    const { store, advance } = clockedStore();
    store.beat('inc1', ivy, true);
    advance(74_999);
    expect(store.viewers('inc1').map(v => v.id)).toEqual(['u_ivy']);
    advance(1);
    expect(store.viewers('inc1')).toEqual([]);
    expect(store.size).toBe(0);
  });

  it('keeps join order stable across heartbeats and returns published name and avatar', () => {
    const { store, advance } = clockedStore();
    store.beat('inc1', ivy, true);
    store.beat('inc1', leo, false);
    advance(30_000);
    store.beat('inc1', ivy, true);
    expect(store.viewers('inc1')).toEqual([ivy, leo]);
  });

  it('publishes a viewer at most once per 20s, and never for remote heartbeats', () => {
    const { store, advance } = clockedStore();
    expect(store.beat('inc1', ivy, true)).toBe(true);
    advance(19_999);
    expect(store.beat('inc1', ivy, true)).toBe(false);
    advance(1);
    expect(store.beat('inc1', ivy, true)).toBe(true);
    expect(store.beat('inc1', leo, false)).toBe(false);
    // A remote echo does not reset the local throttle window.
    advance(20_000);
    store.beat('inc1', ivy, false);
    expect(store.beat('inc1', ivy, true)).toBe(true);
    // Leaving and coming back publishes straight away.
    store.leave('inc1', 'u_ivy');
    expect(store.beat('inc1', ivy, true)).toBe(true);
  });

  it('caps viewers per incident by dropping the least recently seen', () => {
    const { store, advance } = clockedStore();
    for (let i = 0; i < MAX_VIEWERS_PER_INCIDENT; i++) {
      store.beat('inc1', { id: `u${i}`, name: null, avatarUrl: null }, true);
      advance(1);
    }
    store.beat('inc1', { id: 'u0', name: null, avatarUrl: null }, true); // u0 is fresh again
    store.beat('inc1', { id: 'late', name: null, avatarUrl: null }, true);
    const ids = store.viewers('inc1').map(v => v.id);
    expect(ids).toHaveLength(MAX_VIEWERS_PER_INCIDENT);
    expect(ids).toContain('u0');
    expect(ids).toContain('late');
    expect(ids).not.toContain('u1');
  });

  it('caps incidents by dropping the least recently touched', () => {
    const { store } = clockedStore();
    for (let i = 0; i <= MAX_PRESENCE_INCIDENTS; i++) store.beat(`inc${i}`, ivy, false);
    expect(store.size).toBe(MAX_PRESENCE_INCIDENTS);
    expect(store.viewers('inc0')).toEqual([]);
    expect(store.viewers(`inc${MAX_PRESENCE_INCIDENTS}`)).toEqual([ivy]);
  });

  it('sweeps idle incidents on the next heartbeat', () => {
    const { store, advance } = clockedStore();
    store.beat('old', ivy, true);
    advance(75_000);
    store.beat('new', leo, true);
    expect(store.size).toBe(1);
  });

  it('reports whether a leave removed anyone', () => {
    const { store } = clockedStore();
    store.beat('inc1', ivy, true);
    expect(store.leave('inc1', 'u_leo')).toBe(false);
    expect(store.leave('inc1', 'u_ivy')).toBe(true);
    expect(store.leave('inc1', 'u_ivy')).toBe(false);
    expect(store.size).toBe(0);
  });
});

describe('presence notifications', () => {
  const beat = {
    op: 'beat' as const,
    incidentId: 'inc1',
    userId: 'u_ivy',
    name: ivy.name,
    avatarUrl: ivy.avatarUrl,
  };

  it('round-trips only the allowed fields', () => {
    const json = encodePresenceMessage({
      ...beat,
      ...({ email: 'ivy@example.com' } as object),
    } as Parameters<typeof encodePresenceMessage>[0]);
    expect(JSON.parse(json!)).toEqual({
      op: 'beat',
      incidentId: 'inc1',
      userId: 'u_ivy',
      name: 'Ivy Brown',
      avatarUrl: '/avatars/ivy.png',
    });
    expect(decodePresenceMessage(json!)).toEqual(JSON.parse(json!));
  });

  it('keeps every payload within 1 KB, dropping the avatar first', () => {
    const json = encodePresenceMessage({
      ...beat,
      incidentId: 'i'.repeat(191),
      userId: 'u'.repeat(191),
      name: '\u{1F600}'.repeat(200),
      avatarUrl: `https://cdn.example.com/${'a'.repeat(480)}`,
    })!;
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(MAX_PRESENCE_PAYLOAD_BYTES);
    expect(JSON.parse(json).avatarUrl).toBeNull();
    expect(decodePresenceMessage(json)).not.toBeNull();
  });

  it('never sends unsafe avatar URLs or ids', () => {
    for (const avatarUrl of ['data:image/png;base64,AAAA', 'javascript:alert(1)', '//evil.test/a'])
      expect(JSON.parse(encodePresenceMessage({ ...beat, avatarUrl })!).avatarUrl).toBeNull();
    expect(encodePresenceMessage({ ...beat, incidentId: 'bad id;' })).toBeNull();
  });

  it('ignores malformed, oversized or extended notifications', () => {
    const ok = JSON.stringify(beat);
    expect(decodePresenceMessage(ok)).not.toBeNull();
    for (const payload of [
      undefined,
      '',
      'not json',
      JSON.stringify({ ...beat, op: 'drop' }),
      JSON.stringify({ ...beat, email: 'x@y.z' }),
      JSON.stringify({ ...beat, avatarUrl: 'javascript:alert(1)' }),
      JSON.stringify({ ...beat, userId: '../x' }),
      JSON.stringify({ ...beat, name: 'x'.repeat(121) }),
      JSON.stringify({
        ...beat,
        name: 'é'.repeat(120),
        userId: 'u'.repeat(191),
        incidentId: 'i'.repeat(191),
        avatarUrl: `/${'a'.repeat(400)}`,
      }),
    ])
      expect(decodePresenceMessage(payload)).toBeNull();
  });

  it('applies beats and leaves from other replicas', () => {
    const { store } = clockedStore();
    applyPresenceMessage(store, beat);
    expect(store.viewers('inc1')).toEqual([ivy]);
    applyPresenceMessage(store, { ...beat, op: 'leave', name: null, avatarUrl: null });
    expect(store.viewers('inc1')).toEqual([]);
  });
});

describe('process runtime', () => {
  beforeEach(() => {
    mocks.executeRaw.mockReset().mockResolvedValue(1);
  });
  afterAll(() => stopIncidentPresenceListener());

  it('listens once, publishes throttled heartbeats and applies remote ones', async () => {
    expect(heartbeatIncidentViewer('incR', ivy)).toEqual([ivy]);
    heartbeatIncidentViewer('incR', ivy);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    const [, channel, payload] = mocks.executeRaw.mock.calls[0];
    expect(channel).toBe(PRESENCE_CHANNEL);
    expect(JSON.parse(payload)).toMatchObject({ op: 'beat', incidentId: 'incR', userId: 'u_ivy' });

    expect(mocks.clients).toHaveLength(1);
    await vi.waitFor(() =>
      expect(mocks.clients[0].queries).toEqual([`LISTEN ${PRESENCE_CHANNEL}`])
    );
    const client = mocks.clients[0] as unknown as EventEmitter;
    client.emit('notification', {
      channel: PRESENCE_CHANNEL,
      payload: JSON.stringify({
        op: 'beat',
        incidentId: 'incR',
        userId: 'u_leo',
        name: 'Leo Patel',
        avatarUrl: null,
      }),
    });
    client.emit('notification', { channel: PRESENCE_CHANNEL, payload: '{"op":"beat"}' });
    expect(heartbeatIncidentViewer('incR', ivy)).toEqual([ivy, leo]);

    leaveIncidentViewer('incR', 'u_ivy');
    expect(JSON.parse(mocks.executeRaw.mock.calls.at(-1)![2])).toEqual({
      op: 'leave',
      incidentId: 'incR',
      userId: 'u_ivy',
      name: null,
      avatarUrl: null,
    });
    // A leave for someone not present is not fanned out.
    const calls = mocks.executeRaw.mock.calls.length;
    leaveIncidentViewer('incR', 'u_nobody');
    expect(mocks.executeRaw).toHaveBeenCalledTimes(calls);
    expect(mocks.clients).toHaveLength(1);
  });
});
