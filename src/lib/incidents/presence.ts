import 'server-only';
import { Client } from 'pg';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { postgresListenerUrl } from '@/lib/postgres-listener-config';
import { reconnectDelayMs } from '@/lib/intelligence/jobs/wake-listener';

/**
 * Who is viewing an incident right now. Held only in process memory: no table reads or writes.
 * Replicas share heartbeats through pg_notify on one channel, with one LISTEN session per process.
 */
export const PRESENCE_CHANNEL = 'incident_presence';
export const PRESENCE_TTL_MS = 75_000;
export const PRESENCE_PUBLISH_THROTTLE_MS = 20_000;
export const MAX_VIEWERS_PER_INCIDENT = 50;
export const MAX_PRESENCE_INCIDENTS = 5000;
export const MAX_PRESENCE_PAYLOAD_BYTES = 1024;

export type PresenceViewer = { id: string; name: string | null; avatarUrl: string | null };
type Entry = {
  name: string | null;
  avatarUrl: string | null;
  lastSeen: number;
  publishedAt: number;
};
type Room = { touchedAt: number; viewers: Map<string, Entry> };

export class PresenceStore {
  // Insertion order is last-touch order (rooms are re-inserted on every beat), so the first room is the stalest.
  private rooms = new Map<string, Room>();

  constructor(private now: () => number = Date.now) {}

  /** Records a heartbeat. Returns true when this process should publish it (local and not throttled). */
  beat(incidentId: string, viewer: PresenceViewer, local: boolean): boolean {
    const now = this.now();
    this.sweep(now);
    const room = this.rooms.get(incidentId) ?? {
      touchedAt: now,
      viewers: new Map<string, Entry>(),
    };
    this.rooms.delete(incidentId);
    room.touchedAt = now;
    this.rooms.set(incidentId, room);
    while (this.rooms.size > MAX_PRESENCE_INCIDENTS)
      this.rooms.delete(this.rooms.keys().next().value!);

    const prev = room.viewers.get(viewer.id);
    const publish = local && (!prev || now - prev.publishedAt >= PRESENCE_PUBLISH_THROTTLE_MS);
    const entry = {
      name: viewer.name,
      avatarUrl: viewer.avatarUrl,
      lastSeen: now,
      publishedAt: publish ? now : (prev?.publishedAt ?? -Infinity),
    };
    // Updated in place so the avatar order (join order) stays stable between heartbeats.
    if (prev) Object.assign(prev, entry);
    else room.viewers.set(viewer.id, entry);
    if (room.viewers.size > MAX_VIEWERS_PER_INCIDENT) {
      this.prune(room, now);
      while (room.viewers.size > MAX_VIEWERS_PER_INCIDENT) {
        let oldest: string | undefined;
        let oldestSeen = Infinity;
        for (const [id, e] of room.viewers)
          if (e.lastSeen < oldestSeen) [oldest, oldestSeen] = [id, e.lastSeen];
        room.viewers.delete(oldest!);
      }
    }
    return publish;
  }

  /** Returns true when the viewer was present (so only real departures are fanned out). */
  leave(incidentId: string, userId: string): boolean {
    const room = this.rooms.get(incidentId);
    if (!room?.viewers.delete(userId)) return false;
    if (!room.viewers.size) this.rooms.delete(incidentId);
    return true;
  }

  viewers(incidentId: string): PresenceViewer[] {
    const room = this.rooms.get(incidentId);
    if (!room) return [];
    this.prune(room, this.now());
    if (!room.viewers.size) this.rooms.delete(incidentId);
    return [...room.viewers].map(([id, e]) => ({ id, name: e.name, avatarUrl: e.avatarUrl }));
  }

  get size() {
    return this.rooms.size;
  }

  private prune(room: Room, now: number) {
    for (const [id, e] of room.viewers)
      if (now - e.lastSeen >= PRESENCE_TTL_MS) room.viewers.delete(id);
  }

  /** Drops rooms nobody has touched within the TTL; amortized O(1) per beat. */
  private sweep(now: number) {
    for (const [id, room] of this.rooms) {
      if (now - room.touchedAt < PRESENCE_TTL_MS) break;
      this.rooms.delete(id);
    }
  }
}

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,191}$/);
const presenceMessageSchema = z
  .object({
    op: z.enum(['beat', 'leave']),
    incidentId: idSchema,
    userId: idSchema,
    name: z.string().max(120).nullable(),
    // Rendered as an <img src>: only web URLs and same-origin paths, never data:/javascript:.
    avatarUrl: z
      .string()
      .max(512)
      .regex(/^(https?:\/\/|\/(?!\/))/)
      .nullable(),
  })
  .strict();
export type PresenceMessage = z.infer<typeof presenceMessageSchema>;

const fits = (json: string) => Buffer.byteLength(json, 'utf8') <= MAX_PRESENCE_PAYLOAD_BYTES;

/** JSON for pg_notify, or null when it cannot be sent safely. Drops an over-long avatar first. */
export function encodePresenceMessage(message: PresenceMessage): string | null {
  const name = message.name?.slice(0, 120) ?? null;
  const avatar = presenceMessageSchema.shape.avatarUrl.safeParse(message.avatarUrl);
  const clean = {
    op: message.op,
    incidentId: message.incidentId,
    userId: message.userId,
    name,
    avatarUrl: avatar.success ? avatar.data : null,
  };
  if (!presenceMessageSchema.safeParse(clean).success) return null;
  const json = JSON.stringify(clean);
  if (fits(json)) return json;
  const withoutAvatar = JSON.stringify({ ...clean, avatarUrl: null });
  return fits(withoutAvatar) ? withoutAvatar : null;
}

/** Untrusted channel input: anything malformed, oversized or with extra fields is ignored. */
export function decodePresenceMessage(payload: string | undefined): PresenceMessage | null {
  if (!payload || !fits(payload)) return null;
  try {
    const parsed = presenceMessageSchema.safeParse(JSON.parse(payload));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function applyPresenceMessage(store: PresenceStore, message: PresenceMessage) {
  if (message.op === 'leave') store.leave(message.incidentId, message.userId);
  else
    store.beat(
      message.incidentId,
      { id: message.userId, name: message.name, avatarUrl: message.avatarUrl },
      false
    );
}

/** One session per process; reconnects with backoff. Same shape as the intelligence wake listener. */
function listenForPresence(
  connectionString: string,
  onMessage: (message: PresenceMessage) => void
) {
  let stopped = false;
  let client: Client | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let connecting: Promise<boolean> | undefined;
  let attempt = 0;

  const connect = async (): Promise<boolean> => {
    if (stopped) return false;
    const current = new Client({
      connectionString,
      application_name: 'opsknight-presence-listen',
      connectionTimeoutMillis: 3000,
      query_timeout: 1000,
      keepAlive: true,
    });
    client = current;
    const retry = () => {
      if (stopped || client !== current) return;
      client = undefined;
      void current.end().catch(() => {});
      if (!reconnect) {
        const delay = reconnectDelayMs(attempt);
        attempt += 1;
        reconnect = setTimeout(() => {
          reconnect = undefined;
          connecting = connect();
        }, delay);
        reconnect.unref?.();
      }
    };
    current.on('error', retry);
    current.on('end', retry);
    current.on('notification', notification => {
      if (stopped || notification.channel !== PRESENCE_CHANNEL) return;
      const message = decodePresenceMessage(notification.payload);
      if (message) onMessage(message);
    });
    try {
      await current.connect();
      if (stopped) {
        await current.end();
        return false;
      }
      await current.query(`LISTEN ${PRESENCE_CHANNEL}`);
      attempt = 0;
      return true;
    } catch {
      logger.debug('[Presence] Listener unavailable; presence from other replicas paused');
      retry();
      return false;
    }
  };
  connecting = connect();
  return {
    async stop() {
      stopped = true;
      if (reconnect) clearTimeout(reconnect);
      // Let a bounded handshake finish first; pg.end() during connect() can strand its promise.
      await connecting;
      const current = client;
      client = undefined;
      if (current) await current.end().catch(() => {});
    },
  };
}

type PresenceRuntime = {
  store: PresenceStore;
  started: boolean;
  fanout: boolean;
  listener?: { stop(): Promise<void> };
};
// globalThis so dev hot reload keeps one store and one LISTEN session.
const globalPresence = globalThis as typeof globalThis & { __incidentPresence?: PresenceRuntime };

function runtime(): PresenceRuntime {
  const rt = (globalPresence.__incidentPresence ??= {
    store: new PresenceStore(),
    started: false,
    fanout: false,
  });
  if (!rt.started) {
    rt.started = true;
    const url = postgresListenerUrl();
    if (url) {
      rt.fanout = true;
      rt.listener = listenForPresence(url, message => applyPresenceMessage(rt.store, message));
    } else {
      logger.info(
        '[Presence] No session database connection for LISTEN; incident viewers are per-process only'
      );
    }
  }
  return rt;
}

function publish(message: PresenceMessage) {
  const json = encodePresenceMessage(message);
  if (!json) return;
  // Autocommit NOTIFY, not awaited: the heartbeat never waits on it and no table is written.
  void prisma.$executeRaw`SELECT pg_notify(${PRESENCE_CHANNEL}, ${json})`.catch(() =>
    logger.debug('[Presence] pg_notify failed; other replicas catch up on the next heartbeat')
  );
}

export function heartbeatIncidentViewer(
  incidentId: string,
  viewer: PresenceViewer
): PresenceViewer[] {
  const rt = runtime();
  if (rt.store.beat(incidentId, viewer, true) && rt.fanout)
    publish({
      op: 'beat',
      incidentId,
      userId: viewer.id,
      name: viewer.name,
      avatarUrl: viewer.avatarUrl,
    });
  return rt.store.viewers(incidentId);
}

export function leaveIncidentViewer(incidentId: string, userId: string): void {
  const rt = runtime();
  if (rt.store.leave(incidentId, userId) && rt.fanout)
    publish({ op: 'leave', incidentId, userId, name: null, avatarUrl: null });
}

/** For graceful shutdown and tests. */
export async function stopIncidentPresenceListener(): Promise<void> {
  const rt = globalPresence.__incidentPresence;
  await rt?.listener?.stop();
  if (rt) rt.listener = undefined;
}
