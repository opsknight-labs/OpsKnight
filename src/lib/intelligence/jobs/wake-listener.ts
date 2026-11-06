import 'server-only';
import { Client } from 'pg';
import { logger } from '@/lib/logger';
import { INTELLIGENCE_WAKE_CHANNEL } from './wake-publisher';

/** LISTEN requires a session connection, never the HTTP transaction-pooler route. */
export function intelligenceListenerUrl(
  env: {
    DIRECT_DATABASE_URL?: string;
    PGBOUNCER_ENABLED?: string;
    DATABASE_URL?: string;
  } = {
    DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
    PGBOUNCER_ENABLED: process.env.PGBOUNCER_ENABLED,
    DATABASE_URL: process.env.DATABASE_URL,
  }
): string | undefined {
  const raw =
    env.DIRECT_DATABASE_URL ?? (env.PGBOUNCER_ENABLED === 'true' ? undefined : env.DATABASE_URL);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.searchParams.get('pgbouncer') === 'true'
    )
      return undefined;
    for (const key of [
      'schema',
      'connection_limit',
      'pool_timeout',
      'connect_timeout',
      'statement_cache_size',
      'pgbouncer',
    ])
      url.searchParams.delete(key);
    return url.toString();
  } catch {
    return undefined;
  }
}

/** One bounded session per lane process; disconnects reconnect while normal polling keeps working. */
export function listenForIntelligenceWake(
  onIds: (ids: string[]) => void,
  connectionString = intelligenceListenerUrl()
) {
  let stopped = false;
  let client: Client | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let connecting: Promise<boolean> | undefined;
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
      void current.end().catch(() => {});
      if (!reconnect) {
        reconnect = setTimeout(() => {
          reconnect = undefined;
          connecting = connect();
        }, 15000);
        reconnect.unref?.();
      }
    };
    current.on('error', retry);
    current.on('end', retry);
    current.on('notification', notification => {
      if (
        stopped ||
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
    async stop() {
      stopped = true;
      if (reconnect) clearTimeout(reconnect);
      // pg.end() during Client.connect() can strand its connect promise. Let the bounded
      // handshake finish first; connect() itself observes stopped before issuing LISTEN.
      await connecting;
      const current = client;
      client = undefined;
      if (current) await current.end().catch(() => {});
    },
  };
}
