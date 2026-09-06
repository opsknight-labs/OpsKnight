import prisma from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { z } from 'zod';

const OIDC_CONFIG_RECORD_CACHE_TTL_MS = Number.parseInt(
  process.env.OIDC_CONFIG_RECORD_CACHE_TTL_MS ?? '5000',
  10
);
const OIDC_CONFIG_CACHE_TTL_MS = Number.parseInt(
  process.env.OIDC_CONFIG_CACHE_TTL_MS ?? '5000',
  10
);

function safeTtlMs(value: number, fallback: number) {
  // Avoid NaN/negative TTLs and keep behavior predictable.
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

const RECORD_TTL_MS = safeTtlMs(OIDC_CONFIG_RECORD_CACHE_TTL_MS, 5000);
const CONFIG_TTL_MS = safeTtlMs(OIDC_CONFIG_CACHE_TTL_MS, 5000);

type OidcConfigRecord = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  autoProvision: boolean;
  allowedDomains: string[];
  roleMapping?: unknown;
  customScopes?: string | null;
  providerType?: string | null;
  providerLabel?: string | null;
  profileMapping?: unknown;
};

export type OidcConfig = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  autoProvision: boolean;
  allowedDomains: string[];
  roleMapping?: Array<{
    claim: string;
    value: string;
    role: 'ADMIN' | 'RESPONDER' | 'AUDITOR' | 'USER';
  }>;
  customScopes?: string | null;
  providerType?: string | null;
  providerLabel?: string | null;
  profileMapping?: Record<string, string> | null;
};

export type OidcPublicConfig = {
  enabled: boolean;
  issuer: string | null;
  clientId: string | null;
  autoProvision: boolean;
  allowedDomains: string[];
  providerType?: string | null;
  providerLabel?: string | null;
};

function detectProviderType(issuer: string | null): string | null {
  if (!issuer) return null;
  const url = issuer.toLowerCase();

  if (
    url.includes('accounts.google.com') ||
    url.includes('googleapis.com') ||
    url.includes('google')
  ) {
    return 'google';
  }
  if (url.includes('okta')) return 'okta';
  if (
    url.includes('login.microsoftonline.com') ||
    url.includes('login.microsoft.com') ||
    url.includes('sts.windows.net') ||
    url.includes('microsoftonline')
  ) {
    return 'azure';
  }
  if (url.includes('auth0')) return 'auth0';
  return 'custom';
}

function normalizeDomains(domains: string[]) {
  return domains.map(domain => domain.trim().toLowerCase()).filter(Boolean);
}

const RoleMappingRuleSchema = z.object({
  claim: z.string().min(1),
  value: z.string(),
  role: z.enum(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER']),
});

const RoleMappingSchema = z.array(RoleMappingRuleSchema);

const ProfileMappingSchema = z
  .object({
    department: z.string().min(1).optional(),
    jobTitle: z.string().min(1).optional(),
    avatarUrl: z.string().min(1).optional(),
  })
  .passthrough();

function parseRoleMapping(roleMapping: unknown) {
  if (roleMapping == null) return undefined;
  const result = RoleMappingSchema.safeParse(roleMapping);
  if (!result.success) {
    logger.warn('[OIDC] Invalid role mapping config; ignoring roleMapping', {
      component: 'oidc-config',
      issues: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
    return undefined;
  }
  return result.data;
}

function parseProfileMapping(profileMapping: unknown): Record<string, string> | null {
  if (profileMapping == null) return null;
  const result = ProfileMappingSchema.safeParse(profileMapping);
  if (!result.success) {
    logger.warn('[OIDC] Invalid profile mapping config; ignoring profileMapping', {
      component: 'oidc-config',
      issues: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
    return null;
  }
  const { department, jobTitle, avatarUrl } = result.data;
  // Only keep supported keys; ignore unknown keys in stored JSON.
  return {
    ...(department ? { department } : {}),
    ...(jobTitle ? { jobTitle } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

let oidcConfigRecordCache:
  | {
      value: OidcConfigRecord | null;
      expiresAt: number;
    }
  | undefined;
let oidcConfigRecordInFlight: Promise<OidcConfigRecord | null> | undefined;

async function fetchOidcConfigRecordUncached(): Promise<OidcConfigRecord | null> {
  logger.debug('[OIDC] Fetching OIDC config from database', {
    component: 'oidc-config',
  });

  try {
    const config = await prisma.oidcConfig.findFirst({
      orderBy: { updatedAt: 'desc' },
    });

    if (!config) {
      logger.info('[OIDC] No OIDC config found in database', {
        component: 'oidc-config',
      });
      return null;
    }

    logger.debug('[OIDC] Found OIDC config in database', {
      component: 'oidc-config',
      enabled: config.enabled,
      issuer: config.issuer,
      clientId: config.clientId,
      autoProvision: config.autoProvision,
      hasCustomScopes: !!config.customScopes,
      hasRoleMapping: !!config.roleMapping,
      hasProfileMapping: !!config.profileMapping,
      providerType: config.providerType,
      providerLabel: config.providerLabel,
      allowedDomainCount: config.allowedDomains?.length ?? 0,
    });

    return {
      enabled: config.enabled,
      issuer: config.issuer,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      autoProvision: config.autoProvision,
      allowedDomains: config.allowedDomains ?? [],
      roleMapping: config.roleMapping,
      customScopes: config.customScopes,
      profileMapping: config.profileMapping,
      providerType: config.providerType,
      providerLabel: config.providerLabel,
    };
  } catch (error) {
    // Database connection error or other Prisma errors
    // Return null to allow app to function without OIDC when DB is unavailable
    logger.error('[OIDC] Failed to fetch OIDC config from database', {
      component: 'oidc-config',
      error,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

async function getOidcConfigRecord(): Promise<OidcConfigRecord | null> {
  const now = Date.now();
  if (oidcConfigRecordCache && oidcConfigRecordCache.expiresAt > now) {
    return oidcConfigRecordCache.value;
  }

  if (oidcConfigRecordInFlight) {
    return oidcConfigRecordInFlight;
  }

  oidcConfigRecordInFlight = (async () => {
    const value = await fetchOidcConfigRecordUncached();
    oidcConfigRecordCache = {
      value,
      expiresAt: Date.now() + RECORD_TTL_MS,
    };
    return value;
  })();

  try {
    return await oidcConfigRecordInFlight;
  } finally {
    oidcConfigRecordInFlight = undefined;
  }
}

let oidcConfigCache:
  | {
      value: OidcConfig | null;
      expiresAt: number;
    }
  | undefined;
let oidcConfigInFlight: Promise<OidcConfig | null> | undefined;

export async function getOidcConfig(): Promise<OidcConfig | null> {
  const now = Date.now();
  if (oidcConfigCache && oidcConfigCache.expiresAt > now) {
    return oidcConfigCache.value;
  }

  if (oidcConfigInFlight) {
    return oidcConfigInFlight;
  }

  oidcConfigInFlight = (async () => {
    logger.debug('[OIDC] Loading OIDC config', {
      component: 'oidc-config',
    });

    const config = await getOidcConfigRecord();
    if (!config) {
      logger.info('[OIDC] OIDC config not available (no record in database)', {
        component: 'oidc-config',
      });
      return null;
    }

    if (!config.enabled) {
      logger.info('[OIDC] OIDC config is disabled', {
        component: 'oidc-config',
      });
      return null;
    }

    const missingFields: string[] = [];
    if (!config.issuer) missingFields.push('issuer');
    if (!config.clientId) missingFields.push('clientId');
    if (!config.clientSecret) missingFields.push('clientSecret');

    if (missingFields.length > 0) {
      logger.warn('[OIDC] OIDC config missing required fields', {
        component: 'oidc-config',
        missingFields,
      });
      return null;
    }

    try {
      logger.debug('[OIDC] Decrypting client secret', {
        component: 'oidc-config',
      });

      const clientSecret = await decrypt(config.clientSecret);

      const normalizedConfig = {
        enabled: config.enabled,
        issuer: config.issuer,
        clientId: config.clientId,
        clientSecret,
        autoProvision: config.autoProvision,
        allowedDomains: normalizeDomains(config.allowedDomains),
        roleMapping: parseRoleMapping(config.roleMapping),
        customScopes: config.customScopes,
        profileMapping: parseProfileMapping(config.profileMapping),
      };

      logger.info('[OIDC] Successfully loaded OIDC config', {
        component: 'oidc-config',
        issuer: normalizedConfig.issuer,
        clientId: normalizedConfig.clientId,
        autoProvision: normalizedConfig.autoProvision,
        allowedDomainCount: normalizedConfig.allowedDomains.length,
        hasRoleMapping: !!normalizedConfig.roleMapping,
        hasCustomScopes: !!normalizedConfig.customScopes,
        hasProfileMapping: !!normalizedConfig.profileMapping,
      });

      return normalizedConfig;
    } catch (error) {
      logger.error('[OIDC] Failed to decrypt client secret', {
        component: 'oidc-config',
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        hint: 'The ENCRYPTION_KEY environment variable may have changed or be invalid',
      });
      return null;
    }
  })();

  try {
    const value = await oidcConfigInFlight;
    oidcConfigCache = {
      value,
      expiresAt: Date.now() + CONFIG_TTL_MS,
    };
    return value;
  } finally {
    oidcConfigInFlight = undefined;
  }
}

export async function getOidcPublicConfig(): Promise<OidcPublicConfig | null> {
  const config = await getOidcConfigRecord();
  if (!config) {
    return null;
  }

  return {
    enabled: config.enabled,
    issuer: config.issuer || null,
    clientId: config.clientId || null,
    autoProvision: config.autoProvision,
    allowedDomains: normalizeDomains(config.allowedDomains),
    providerType: config.providerType ?? detectProviderType(config.issuer),
    providerLabel: config.providerLabel,
  };
}

export async function checkOidcIntegrity(): Promise<{ ok: boolean; error?: string }> {
  const config = await getOidcConfigRecord();
  if (!config || !config.enabled) {
    return { ok: true }; // Not enabled, so technically healthy
  }

  if (!config.clientSecret) {
    return { ok: false, error: 'Client Secret is missing' };
  }

  try {
    await decrypt(config.clientSecret);
    return { ok: true };
  } catch (error) {
    logger.error('[OIDC] Integrity check failed', { error });
    return {
      ok: false,
      error: 'Failed to decrypt Client Secret. The Encryption Key may have changed.',
    };
  }
}

/**
 * Internal helper to reset the OIDC config cache.
 * Intended for use in tests only.
 */
export function resetOidcConfigCache() {
  oidcConfigRecordCache = undefined;
  oidcConfigRecordInFlight = undefined;
  oidcConfigCache = undefined;
  oidcConfigInFlight = undefined;
}
