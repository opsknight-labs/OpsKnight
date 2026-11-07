import 'server-only';
import { Client } from 'pg';
import { logger } from '@/lib/logger';
import { INTELLIGENCE_WAKE_CHANNEL } from './wake-publisher';

import { postgresListenerUrl as intelligenceListenerUrl } from '@/lib/postgres-listener-config';
export { intelligenceListenerUrl };

/** Reconnect delays grow from here to the ceiling with jitter, so a flapping database is not hammered. */
export const LISTENER_RECONNECT_MIN_MS = 1_000;
export const LISTENER_RECONNECT_MAX_MS = 60_000;
/** A follower re-tries to become the wake leader this often (the leader may have gone away). */
export const LEADER_RETRY_MS = 30_000;

export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(LISTENER_RECONNECT_MAX_MS, LISTENER_RECONNECT_MIN_MS * 2 ** Math.min(attempt, 10));
  return Math.floor(base / 2 + random() * (base / 2));
}

export interface WakeListenerOptions {
  /**
   * With several lane replicas every one of them receives every notification and would upsert the same
   * work, bumping generations and forcing extra passes. With leader election only the replica holding a
   * session advisory lock turns hints into work; the others rely on the durable discovery watermark.
   */
  electLeader?: boolean;
  random?: () => number;
}

/** One bounded session per lane process; disconnects reconnect while normal polling keeps working. */
export function listenForIntelligenceWake(
  onIds: (ids: string[]) => void,
  connectionString = intelligenceListenerUrl(),
  options: WakeListenerOptions = {}
) {
  let stopped = false;
  let client: Client | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let leaderRetry: ReturnType<typeof setTimeout> | undefined;
  let connecting: Promise<boolean> | undefined;
  let attempt = 0;
  // Without election every listener acts on hints, as before.
  let leader = !options.electLeader;

  const clearLeaderRetry = () => {
    if (leaderRetry) clearTimeout(leaderRetry);
    leaderRetry = undefined;
  };

  const tryLead = async (current: Client): Promise<void> => {
    if (stopped || client !== current || leader) return;
    try {
      const { rows } = await current.query<{ leader: boolean }>(
        `SELECT pg_try_advisory_lock(hashtextextended('intelligence-wake-leader', 0)) AS leader`
      );
      leader = rows[0]?.leader === true;
    } catch {
      leader = false;
    }
    if (!leader && !stopped && client === current) {
      leaderRetry = setTimeout(() => {
        leaderRetry = undefined;
        void tryLead(current);
      }, LEADER_RETRY_MS);
      leaderRetry.unref?.();
    }
  };

  const connect = async (): Promise<boolean> => {
    if (stopped || !connectionString) return false;
    const current = new Client({
      connectionString,
      application_name: 'opsknight-intelligence-listen',
      connectionTimeoutMillis: 3000,
      query_timeout: 1000,
      keepAlive: true,
    });
    client = current;
    const retry = () => {
      if (stopped || client !== current) return;
      client = undefined;
      if (options.electLeader) leader = false; // the session lock went away with the session
      clearLeaderRetry();
      void current.end().catch(() => {});
      if (!reconnect) {
        const delay = reconnectDelayMs(attempt, options.random);
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
      if (
        stopped ||
        !leader ||
        notification.channel !== INTELLIGENCE_WAKE_CHANNEL ||
        !notification.payload ||
        notification.payload.length > 4096
      )
        return;
      try {
        const ids: unknown = JSON.parse(notification.payload);
        if (
          Array.isArray(ids) &&
          ids.length <= 50 &&
          ids.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id))
        )
          onIds(ids);
      } catch {
        /* Untrusted/malformed hints have no effect. */
      }
    });
    try {
      await current.connect();
      if (stopped) {
        await current.end();
        return false;
      }
      await current.query(`LISTEN ${INTELLIGENCE_WAKE_CHANNEL}`);
      attempt = 0;
      if (options.electLeader) await tryLead(current);
      return true;
    } catch {
      logger.debug('[Intelligence] Notification listener unavailable; polling remains active');
      retry();
      return false;
    }
  };
  const ready = (connecting = connect());
  return {
    ready,
    /** True while this process acts on wake hints (always true without election). */
    isLeader: () => leader,
    async stop() {
      stopped = true;
      if (reconnect) clearTimeout(reconnect);
      clearLeaderRetry();
      // pg.end() during Client.connect() can strand its connect promise. Let the bounded
      // handshake finish first; connect() itself observes stopped before issuing LISTEN.
      await connecting;
      const current = client;
      client = undefined;
      if (current) await current.end().catch(() => {});
    },
  };
}
