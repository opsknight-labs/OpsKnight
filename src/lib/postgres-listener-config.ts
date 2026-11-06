import 'server-only';

/** LISTEN requires a session connection, never the HTTP transaction-pooler route. */
export function postgresListenerUrl(
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
