const DEFAULT_POOL_SIZE = 10;

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
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', String(poolSize(configuredPoolSize)));
    }
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '10');
    if (!url.searchParams.has('statement_cache_size')) {
      url.searchParams.set('statement_cache_size', '100');
    }
    return url.toString();
  } catch {
    // Preserve provider-specific Prisma URLs that the WHATWG parser does not
    // understand. Prisma will surface any genuine configuration error.
    return rawUrl;
  }
}
