const DEFAULT_POOL_SIZE = 10;

export function selectPrismaDatasourceUrl(
  role: string,
  env: { DATABASE_URL?: string; WEB_DATABASE_URL?: string } = {
    DATABASE_URL: process.env.DATABASE_URL,
    WEB_DATABASE_URL: process.env.WEB_DATABASE_URL,
  }
): string | undefined {
  return role === 'web' ? env.WEB_DATABASE_URL ?? env.DATABASE_URL : env.DATABASE_URL;
}

function poolSize(value: string | undefined): number {
  if (!value) return DEFAULT_POOL_SIZE;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : DEFAULT_POOL_SIZE;
}

export function configurePrismaDatasource(
  rawUrl: string | undefined,
  configuredPoolSize: string | undefined
): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    if (configuredPoolSize?.trim()) {
      // A role-specific pool setting is an explicit deployment override. This
      // lets all roles share one DATABASE_URL even when that URL contains a
      // legacy connection_limit value.
      url.searchParams.set('connection_limit', String(poolSize(configuredPoolSize)));
    } else if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', String(poolSize(configuredPoolSize)));
    }
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '10');
    if (!url.searchParams.has('statement_cache_size')) {
      url.searchParams.set('statement_cache_size', '100');
    }
    if (!url.searchParams.has('options')) {
      url.searchParams.set('options', '-c statement_timeout=30000');
    }
    return url.toString();
  } catch {
    // Preserve provider-specific Prisma URLs that the WHATWG parser does not
    // understand. Prisma will surface any genuine configuration error.
    return rawUrl;
  }
}
