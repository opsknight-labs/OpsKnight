import { logger } from '@/lib/logger';
import { assertSafeOutboundUrl, safeOutboundFetch } from '@/lib/network-security';
import {
  getMicrosoftEntraTenantAuthority,
  isMicrosoftEntraGenericAuthority,
  isMicrosoftEntraHost,
} from '@/lib/oidc-provider';
import { getOidcProviderPolicy } from '@/lib/oidc/provider-policy';

export type OidcValidationResult = {
  isValid: boolean;
  error?: string;
  metadata?: OidcRuntimeMetadata;
};

export type OidcRuntimeMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  tokenEndpointAuthMethodsSupported?: string[];
};

type OidcDiscoveryMetadata = {
  issuer?: unknown;
  authorization_endpoint?: unknown;
  token_endpoint?: unknown;
  jwks_uri?: unknown;
  id_token_signing_alg_values_supported?: unknown;
  token_endpoint_auth_methods_supported?: unknown;
};

export type ValidateOidcConnectionOptions = {
  tokenEndpointAuthMethod?: string;
};

type JsonWebKeySet = {
  keys?: unknown;
};

const MAX_JWKS_BYTES = 1_048_576;
const RUNTIME_METADATA_TTL_MS = 300_000;
let runtimeMetadataCache:
  | { key: string; result: OidcValidationResult; expiresAt: number }
  | undefined;

function hasUsableSigningKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const key = value as Record<string, unknown>;
  if (typeof key.kid !== 'string' || !key.kid.trim()) return false;
  if (key.use !== undefined && key.use !== 'sig') return false;
  if (key.kty === 'RSA') return typeof key.n === 'string' && typeof key.e === 'string';
  if (key.kty === 'EC') {
    return typeof key.crv === 'string' && typeof key.x === 'string' && typeof key.y === 'string';
  }
  return false;
}

function hasQueryOrHash(urlObj: URL): boolean {
  const hasQuery = !!urlObj.search;
  const hasHash = !!urlObj.hash;
  return hasQuery || hasHash;
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // Disallow obvious local names
  if (['localhost', '0.0.0.0', '127.0.0.1', '::1'].includes(lower)) {
    return true;
  }

  if (lower.endsWith('.local') || lower.endsWith('.internal')) {
    return true;
  }

  // Basic private IPv4 ranges
  if (/^10\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;

  return false;
}

/**
 * Normalize an issuer for comparison: strip trailing slashes and lowercase
 * the scheme+host (path remains case-sensitive per OIDC).
 */
function normalizeIssuerForComparison(issuer: string): string {
  const parsed = new URL(issuer);
  const scheme = parsed.protocol.toLowerCase();
  const host = parsed.host.toLowerCase();
  return `${scheme}//${host}${parsed.pathname.replace(/\/+$/, '')}`;
}

export async function validateOidcConnection(
  issuer: string,
  options?: ValidateOidcConnectionOptions
): Promise<OidcValidationResult> {
  try {
    const trimmedIssuer = issuer?.trim();
    if (!trimmedIssuer) {
      return { isValid: false, error: 'Issuer URL is required.' };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedIssuer);
    } catch {
      return { isValid: false, error: 'Invalid Issuer URL format.' };
    }

    if (parsedUrl.protocol !== 'https:') {
      return {
        isValid: false,
        error: 'OIDC issuer must use HTTPS for security. HTTP URLs are not allowed.',
      };
    }

    if (hasQueryOrHash(parsedUrl)) {
      return {
        isValid: false,
        error: 'Issuer URL must not include a query string or fragment.',
      };
    }

    const validatedHostname = parsedUrl.hostname.toLowerCase();
    const port = parsedUrl.port;

    if (!validatedHostname) {
      return { isValid: false, error: 'Issuer URL has no hostname.' };
    }

    if (isPrivateOrLocalHostname(validatedHostname)) {
      logger.warn(
        `[OIDC Validation] SSRF attempt blocked for internal hostname: ${validatedHostname}`
      );
      return {
        isValid: false,
        error: 'OIDC issuer cannot be an internal or private address.',
      };
    }

    // OpsKnight currently models one enterprise/workforce OIDC provider. Entra
    // generic authorities admit identities from multiple tenants, so require a
    // tenant-specific authority until an explicit tenant allowlist exists.
    if (isMicrosoftEntraHost(validatedHostname)) {
      const authority = getMicrosoftEntraTenantAuthority(parsedUrl);
      if (!authority || isMicrosoftEntraGenericAuthority(authority)) {
        logger.warn('[OIDC Validation] Entra non-tenant-specific authority rejected', {
          component: 'oidc-validation',
          hostname: validatedHostname,
          authority,
        });
        return {
          isValid: false,
          error:
            'Microsoft Entra common, organizations, and consumers authorities are not allowed. Configure a tenant-specific issuer URL (for example https://login.microsoftonline.com/<tenant-id>/v2.0).',
        };
      }
    }

    const providerPolicy = getOidcProviderPolicy(trimmedIssuer);
    if (!providerPolicy.validateIssuer(parsedUrl)) {
      return {
        isValid: false,
        error: `The configured issuer is not valid for the detected ${providerPolicy.family} provider policy.`,
      };
    }

    // Build the discovery URL only from validated primitives.
    const cleanPath = parsedUrl.pathname.replace(/\/+$/, '');
    const pathSegments = cleanPath.split('/').filter(Boolean);
    if (pathSegments.some(seg => !/^[a-zA-Z0-9._-]+$/.test(seg))) {
      return {
        isValid: false,
        error: 'Issuer URL path contains invalid characters.',
      };
    }
    const safePath = pathSegments.join('/');
    const safeHost = port ? `${validatedHostname}:${port}` : validatedHostname;
    const discoveryUrl = safePath
      ? `https://${safeHost}/${safePath}/.well-known/openid-configuration`
      : `https://${safeHost}/.well-known/openid-configuration`;

    logger.info(`[OIDC Validation] Checking discovery URL: ${discoveryUrl}`);

    try {
      await assertSafeOutboundUrl(discoveryUrl, { requireHttps: true });
    } catch {
      return { isValid: false, error: 'OIDC issuer resolves to a restricted network address.' };
    }

    // Fetch through the socket-validating safe dispatcher, closing the DNS
    // rebinding / TOCTOU gap between validation and the actual connection.
    const response = await safeOutboundFetch(discoveryUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        isValid: false,
        error: 'OIDC discovery redirects are not allowed. Configure the canonical issuer URL.',
      };
    }

    if (!response.ok) {
      logger.warn(`[OIDC Validation] Discovery failed with status: ${response.status}`);
      return {
        isValid: false,
        error: `Could not connect to Issuer URL (Status: ${response.status}). Please verify the URL.`,
      };
    }

    const config = (await response.json()) as OidcDiscoveryMetadata;

    // OIDC Discovery requires metadata issuer equality with the configured
    // issuer. Preserve this check: it prevents discovery substitution.
    if (typeof config.issuer !== 'string' || !config.issuer) {
      return {
        isValid: false,
        error: 'Issuer metadata is missing the required "issuer" field.',
      };
    }

    const expectedIssuer = normalizeIssuerForComparison(trimmedIssuer);
    const metadataIssuer = normalizeIssuerForComparison(config.issuer);
    if (metadataIssuer !== expectedIssuer) {
      logger.warn('[OIDC Validation] Discovery issuer mismatch', {
        component: 'oidc-validation',
        configuredIssuer: trimmedIssuer,
        metadataIssuer: config.issuer,
      });
      return {
        isValid: false,
        error:
          'Issuer metadata "issuer" field does not match the configured issuer URL. Configure the exact issuer returned by the identity provider.',
      };
    }

    const requiredEndpoints = [
      config.authorization_endpoint,
      config.token_endpoint,
      config.jwks_uri,
    ];
    if (requiredEndpoints.some(endpoint => typeof endpoint !== 'string' || !endpoint)) {
      return {
        isValid: false,
        error:
          'Issuer metadata is missing required endpoints (authorization_endpoint, token_endpoint, jwks_uri).',
      };
    }

    for (const endpoint of requiredEndpoints) {
      try {
        await assertSafeOutboundUrl(endpoint as string, { requireHttps: true });
      } catch {
        return {
          isValid: false,
          error: 'Issuer metadata contains an unsafe or non-HTTPS endpoint.',
        };
      }
    }

    // Permit asymmetric enterprise-safe algorithms only when the provider
    // advertises the metadata. Providers that omit the optional advertisement
    // remain compatible; token verification still enforces the provider's OIDC
    // cryptographic checks at authentication time.
    if (Array.isArray(config.id_token_signing_alg_values_supported)) {
      const permittedAlgorithms = new Set(providerPolicy.acceptedIdTokenAlgorithms);
      if (
        !config.id_token_signing_alg_values_supported.some((alg: unknown) =>
          permittedAlgorithms.has(String(alg))
        )
      ) {
        return {
          isValid: false,
          error: `Identity Provider must support an accepted ID-token signing algorithm (${[...permittedAlgorithms].join(', ')}).`,
        };
      }
    }

    const tokenEndpointAuthMethodsSupported = Array.isArray(
      config.token_endpoint_auth_methods_supported
    )
      ? config.token_endpoint_auth_methods_supported
          .filter((item): item is string => typeof item === 'string')
          .map(item => item.trim())
      : undefined;

    if (
      options?.tokenEndpointAuthMethod &&
      tokenEndpointAuthMethodsSupported &&
      tokenEndpointAuthMethodsSupported.length > 0
    ) {
      if (!tokenEndpointAuthMethodsSupported.includes(options.tokenEndpointAuthMethod)) {
        return {
          isValid: false,
          error: `Identity Provider does not support the selected token endpoint authentication method (${options.tokenEndpointAuthMethod}). Supported methods: ${tokenEndpointAuthMethodsSupported.join(', ')}.`,
        };
      }
    }

    const jwksUri = config.jwks_uri as string;
    const jwksResponse = await safeOutboundFetch(jwksUri, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (jwksResponse.status >= 300 && jwksResponse.status < 400) {
      return { isValid: false, error: 'OIDC JWKS redirects are not allowed.' };
    }
    if (!jwksResponse.ok) {
      return {
        isValid: false,
        error: `Could not fetch the OIDC signing-key set (Status: ${jwksResponse.status}).`,
      };
    }
    const contentLength = Number.parseInt(jwksResponse.headers.get('content-length') ?? '', 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_JWKS_BYTES) {
      return { isValid: false, error: 'OIDC signing-key set exceeds the maximum allowed size.' };
    }
    const jwks = (await jwksResponse.json()) as JsonWebKeySet;
    if (!Array.isArray(jwks.keys) || !jwks.keys.some(hasUsableSigningKey)) {
      return {
        isValid: false,
        error: 'OIDC signing-key set does not contain a usable public signing key.',
      };
    }

    return {
      isValid: true,
      metadata: {
        issuer: config.issuer,
        authorizationEndpoint: config.authorization_endpoint as string,
        tokenEndpoint: config.token_endpoint as string,
        jwksUri,
        ...(tokenEndpointAuthMethodsSupported
          ? { tokenEndpointAuthMethodsSupported }
          : {}),
      },
    };
  } catch (error) {
    logger.error('[OIDC Validation] Connection error', { error });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (errorMessage.includes('fetch failed') || errorMessage.includes('timeout')) {
      return {
        isValid: false,
        error: 'Failed to connect to Issuer URL. Please check your network or the URL.',
      };
    }

    return {
      isValid: false,
      error: `Validation failed: ${errorMessage}`,
    };
  }
}

/**
 * Resolve pinned metadata for the authentication runtime. Successful results
 * are cached independently from the short-lived Auth.js options cache so every
 * session evaluation does not contact the IdP. Actual token/JWKS sockets still
 * use the protected DNS lookup supplied to openid-client.
 */
export async function getValidatedOidcRuntimeMetadata(
  issuer: string,
  options?: ValidateOidcConnectionOptions
): Promise<OidcValidationResult> {
  const normalizedIssuer = issuer.trim();
  const cacheKey = options?.tokenEndpointAuthMethod
    ? `${normalizedIssuer}::${options.tokenEndpointAuthMethod}`
    : normalizedIssuer;

  if (
    runtimeMetadataCache?.key === cacheKey &&
    runtimeMetadataCache.expiresAt > Date.now()
  ) {
    return runtimeMetadataCache.result;
  }
  const result = await validateOidcConnection(normalizedIssuer, options);
  if (result.isValid && result.metadata) {
    runtimeMetadataCache = {
      key: cacheKey,
      result,
      expiresAt: Date.now() + RUNTIME_METADATA_TTL_MS,
    };
  }
  return result;
}

export function resetOidcRuntimeMetadataCache() {
  runtimeMetadataCache = undefined;
}
