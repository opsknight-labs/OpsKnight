export type AuthPublicOriginSource =
  | 'NEXTAUTH_URL'
  | 'NEXT_PUBLIC_APP_URL'
  | 'SYSTEM_SETTINGS'
  | 'DEVELOPMENT_FALLBACK';

export type AuthPublicOriginResolution = {
  origin: string;
  callbackUrl: string;
  source: AuthPublicOriginSource;
  conflicts: Array<{ source: Exclude<AuthPublicOriginSource, 'DEVELOPMENT_FALLBACK'>; origin: string }>;
};

function normalizeConfiguredOrigin(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the public origin used for authentication-facing configuration.
 * NEXTAUTH_URL is authoritative because NextAuth uses it when explicitly set.
 * Other sources are fallbacks for deployments that do not set NEXTAUTH_URL.
 */
export function resolveAuthPublicOrigin(options: {
  dbAppUrl?: string | null;
  nextAuthUrl?: string | null;
  nextPublicAppUrl?: string | null;
  nodeEnv?: string | null;
} = {}): AuthPublicOriginResolution {
  const nextAuth = normalizeConfiguredOrigin(options.nextAuthUrl ?? process.env.NEXTAUTH_URL);
  const nextPublic = normalizeConfiguredOrigin(
    options.nextPublicAppUrl ?? process.env.NEXT_PUBLIC_APP_URL
  );
  const database = normalizeConfiguredOrigin(options.dbAppUrl);

  const selected = nextAuth
    ? { origin: nextAuth, source: 'NEXTAUTH_URL' as const }
    : nextPublic
      ? { origin: nextPublic, source: 'NEXT_PUBLIC_APP_URL' as const }
      : database
        ? { origin: database, source: 'SYSTEM_SETTINGS' as const }
        : { origin: 'http://localhost:3000', source: 'DEVELOPMENT_FALLBACK' as const };

  const configured: Array<{
    source: Exclude<AuthPublicOriginSource, 'DEVELOPMENT_FALLBACK'>;
    origin: string | null;
  }> = [
    { source: 'NEXTAUTH_URL', origin: nextAuth },
    { source: 'NEXT_PUBLIC_APP_URL', origin: nextPublic },
    { source: 'SYSTEM_SETTINGS', origin: database },
  ];

  const conflicts = configured
    .filter(
      (entry): entry is { source: Exclude<AuthPublicOriginSource, 'DEVELOPMENT_FALLBACK'>; origin: string } =>
        Boolean(entry.origin && entry.origin !== selected.origin)
    )
    .map(entry => ({ source: entry.source, origin: entry.origin }));

  return {
    origin: selected.origin,
    callbackUrl: `${selected.origin}/api/auth/callback/oidc`,
    source: selected.source,
    conflicts,
  };
}

export function isProductionAuthOriginSafe(
  resolution: AuthPublicOriginResolution,
  nodeEnv = process.env.NODE_ENV
): boolean {
  return nodeEnv !== 'production' || resolution.origin.startsWith('https://');
}
