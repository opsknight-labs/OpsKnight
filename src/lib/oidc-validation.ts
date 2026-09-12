import crypto from 'node:crypto';
import { logger } from '@/lib/logger';
import { assertSafeOutboundUrl, safeOutboundFetch } from '@/lib/network-security';
import { getMicrosoftEntraTenantAuthority, isMicrosoftEntraGenericAuthority, isMicrosoftEntraHost } from '@/lib/oidc-provider';
import { getOidcProviderPolicy } from '@/lib/oidc/provider-policy';
import { getOidcConfig, getOidcPublicConfig } from '@/lib/oidc-config';

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
  response_types_supported?: unknown;
  code_challenge_methods_supported?: unknown;
};

export type ValidateOidcConnectionOptions = {
  tokenEndpointAuthMethod?: string;
};

type JsonWebKeySet = {
  keys?: unknown;
};

const MAX_DISCOVERY_BYTES = 262_144; // 256 KB
const MAX_JWKS_BYTES = 1_048_576; // 1 MB
const RUNTIME_METADATA_TTL_MS = 300_000; // 5 min
const NEGATIVE_CACHE_TTL_MS = 30_000; // 30 sec negative cache
const STALE_METADATA_MAX_MS = 3_600_000; // 1 hr stale-while-revalidate fallback

/**
 * Reads a JSON response enforcing a strict maximum byte limit even on chunked
 * or streaming responses where Content-Length is omitted.
 */
async function readBoundedJson<T>(response: Response, maxBytes: number): Promise<T> {
  const contentLength = Number.parseInt(response.headers?.get?.('content-length') ?? '', 10);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Response size exceeds the maximum allowed limit of ${maxBytes} bytes.`);
  }

  // If response has body stream with getReader, use streaming bounded read
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            throw new Error(`Response stream exceeded maximum allowed limit of ${maxBytes} bytes.`);
          }
          chunks.push(value);
        }
      }
    } finally {
      reader.releaseLock();
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const text = new TextDecoder('utf-8').decode(merged);
    return JSON.parse(text) as T;
  }

  // Fallback if text() is available
  if (typeof response.text === 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf-8') > maxBytes) {
      throw new Error(`Response size exceeds the maximum allowed limit of ${maxBytes} bytes.`);
    }
    return JSON.parse(text) as T;
  }

  // Fallback for mock objects that only implement json()
  if (typeof response.json === 'function') {
    return (await response.json()) as T;
  }

  throw new Error('Unsupported response body format.');
}

function isValidRsaSigningKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const key = value as Record<string, unknown>;
  if (key.use !== undefined && key.use !== 'sig') return false;
  if (key.key_ops && Array.isArray(key.key_ops) && !key.key_ops.includes('verify')) return false;
  // OpsKnight NextAuth runtime pins RS256 for token verification.
  // Reject EC keys or incompatible algorithms during connection validation.
  if (key.alg !== undefined && key.alg !== 'RS256') return false;
  if (key.kty !== 'RSA') return false;
  if (
    typeof key.n !== 'string' ||
    typeof key.e !== 'string' ||
    key.n.length === 0 ||
    key.e.length === 0
  ) {
    return false;
  }

  // Cryptographically validate that the key material parses into a valid RSA public key
  try {
    const pubKey = crypto.createPublicKey({
      key: key as crypto.JsonWebKey,
      format: 'jwk',
    });
    return pubKey.type === 'public' && pubKey.asymmetricKeyType === 'rsa';
  } catch {
    return false;
  }
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
    if (
      pathSegments.some(
        seg => seg === '..' || seg === '.' || !/^[a-zA-Z0-9._~%:@!$&'()*+,;=-]+$/.test(seg)
      )
    ) {
      return {
        isValid: false,
        error: 'Issuer URL path contains invalid characters or path traversal.',
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

    const config = await readBoundedJson<OidcDiscoveryMetadata>(response, MAX_DISCOVERY_BYTES);

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
    if (config.id_token_signing_alg_values_supported !== undefined) {
      if (!Array.isArray(config.id_token_signing_alg_values_supported)) {
        return {
          isValid: false,
          error:
            'Identity Provider metadata contains a malformed id_token_signing_alg_values_supported list.',
        };
      }
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

    // OpenID Connect Discovery 1.0 & RFC 8414: If omitted, the default is client_secret_basic.
    // If explicitly provided, it must be a valid non-empty array of strings.
    const rawMethodsSupported = config.token_endpoint_auth_methods_supported;
    let effectiveMethods: string[];
    if (rawMethodsSupported === undefined) {
      effectiveMethods = ['client_secret_basic'];
    } else if (Array.isArray(rawMethodsSupported)) {
      const parsed = rawMethodsSupported
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean);
      if (parsed.length === 0) {
        return {
          isValid: false,
          error:
            'Identity Provider metadata contains an invalid or empty token_endpoint_auth_methods_supported list.',
        };
      }
      effectiveMethods = parsed;
    } else {
      return {
        isValid: false,
        error:
          'Identity Provider metadata contains a malformed token_endpoint_auth_methods_supported entry.',
      };
    }

    if (options?.tokenEndpointAuthMethod) {
      if (!effectiveMethods.includes(options.tokenEndpointAuthMethod)) {
        return {
          isValid: false,
          error: `Identity Provider does not support the selected token endpoint authentication method (${options.tokenEndpointAuthMethod}). Supported methods: ${effectiveMethods.join(', ')}.`,
        };
      }
    }

    // For generic/custom providers, validate the authorization-code flow and PKCE capability contracts
    if (providerPolicy.family === 'custom') {
      if (
        config.response_types_supported === undefined ||
        !Array.isArray(config.response_types_supported)
      ) {
        return {
          isValid: false,
          error:
            'Identity Provider metadata must include a valid "response_types_supported" array.',
        };
      }
      const supportsCode = config.response_types_supported.some(
        rt => typeof rt === 'string' && rt.trim() === 'code'
      );
      if (!supportsCode) {
        return {
          isValid: false,
          error:
            'Identity Provider must support the "code" response type for authorization code flow.',
        };
      }

      if (config.code_challenge_methods_supported !== undefined) {
        if (!Array.isArray(config.code_challenge_methods_supported)) {
          return {
            isValid: false,
            error:
              'Identity Provider metadata contains a malformed code_challenge_methods_supported list.',
          };
        }
        const supportsS256 = config.code_challenge_methods_supported.some(
          method => typeof method === 'string' && method.trim().toUpperCase() === 'S256'
        );
        if (!supportsS256) {
          return {
            isValid: false,
            error:
              'Identity Provider must support the "S256" code challenge method for PKCE.',
          };
        }
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
    const jwks = await readBoundedJson<JsonWebKeySet>(jwksResponse, MAX_JWKS_BYTES);
    if (!Array.isArray(jwks.keys)) {
      return {
        isValid: false,
        error: 'OIDC signing-key set does not contain a usable public signing key.',
      };
    }

    const candidateKeys = jwks.keys.filter(isValidRsaSigningKey) as Record<string, unknown>[];
    if (candidateKeys.length === 0) {
      return {
        isValid: false,
        error: 'OIDC signing-key set does not contain a usable public signing key.',
      };
    }

    // If multiple candidate signing keys exist, require unambiguous distinct kid on each
    if (candidateKeys.length > 1) {
      const allHaveKid = candidateKeys.every(
        k => typeof k.kid === 'string' && k.kid.trim().length > 0
      );
      const kids = candidateKeys.map(k => (typeof k.kid === 'string' ? k.kid.trim() : ''));
      const uniqueKids = new Set(kids);
      if (!allHaveKid || uniqueKids.size !== candidateKeys.length) {
        return {
          isValid: false,
          error:
            'OIDC signing-key set contains multiple signing keys without distinct "kid" identifiers.',
        };
      }
    }

    return {
      isValid: true,
      metadata: {
        issuer: config.issuer,
        authorizationEndpoint: config.authorization_endpoint as string,
        tokenEndpoint: config.token_endpoint as string,
        jwksUri,
        tokenEndpointAuthMethodsSupported: effectiveMethods,
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

const SWR_BACKOFF_MS = 30_000; // 30 sec backoff after revalidation failure

type CachedMetadata = {
  key: string;
  result: OidcValidationResult;
  expiresAt: number;
  staleUntil: number;
  nextRetryAt?: number;
};

let runtimeMetadataCache: CachedMetadata | undefined;
let revalidationInFlight: Promise<OidcValidationResult> | undefined;
let negativeMetadataCache:
  | { key: string; result: OidcValidationResult; expiresAt: number }
  | undefined;

/**
 * Resolve pinned metadata for the authentication runtime. Successful results
 * are cached independently from the short-lived Auth.js options cache so every
 * session evaluation does not contact the IdP.
 *
 * Implements true Stale-While-Revalidate (SWR):
 * - If fresh (< 5m): returns immediately from cache.
 * - If stale (5m - 1h): returns stale metadata IMMEDIATELY without blocking,
 *   while kicking off an asynchronous single-flight background revalidation.
 *   On revalidation failure, establishes a 30s backoff window (nextRetryAt) to
 *   prevent IdP polling storms.
 * - Cold start or fully expired (> 1h): synchronous single-flight fetch with
 *   30s negative caching on failure.
 */
export async function getValidatedOidcRuntimeMetadata(
  issuer: string,
  options?: ValidateOidcConnectionOptions
): Promise<OidcValidationResult> {
  const normalizedIssuer = issuer.trim();
  const cacheKey = options?.tokenEndpointAuthMethod
    ? `${normalizedIssuer}::${options.tokenEndpointAuthMethod}`
    : normalizedIssuer;

  const now = Date.now();

  // 1. Fresh cache hit (< 5 min)
  if (
    runtimeMetadataCache?.key === cacheKey &&
    runtimeMetadataCache.expiresAt > now
  ) {
    return runtimeMetadataCache.result;
  }

  // 2. Stale-while-revalidate hit (5 min - 1 hr)
  if (
    runtimeMetadataCache?.key === cacheKey &&
    runtimeMetadataCache.result.isValid &&
    runtimeMetadataCache.staleUntil > now
  ) {
    const staleResult = runtimeMetadataCache.result;
    const nextRetry = runtimeMetadataCache.nextRetryAt ?? 0;

    // Trigger asynchronous background revalidation if backoff has elapsed
    if (!revalidationInFlight && now >= nextRetry) {
      const currentCache = runtimeMetadataCache;
      revalidationInFlight = (async () => {
        try {
          const freshResult = await validateOidcConnection(normalizedIssuer, options);
          if (freshResult.isValid && freshResult.metadata) {
            runtimeMetadataCache = {
              key: cacheKey,
              result: freshResult,
              expiresAt: Date.now() + RUNTIME_METADATA_TTL_MS,
              staleUntil: Date.now() + STALE_METADATA_MAX_MS,
            };
            negativeMetadataCache = undefined;
            return freshResult;
          } else {
            currentCache.nextRetryAt = Date.now() + SWR_BACKOFF_MS;
            logger.warn('[OIDC] Background revalidation failed; backing off and continuing with stale metadata', {
              error: freshResult.error,
            });
            return staleResult;
          }
        } catch (error) {
          currentCache.nextRetryAt = Date.now() + SWR_BACKOFF_MS;
          logger.warn('[OIDC] Background revalidation threw; backing off and continuing with stale metadata', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          return staleResult;
        } finally {
          revalidationInFlight = undefined;
        }
      })();
    }

    return staleResult;
  }

  // 3. Negative cache hit (< 30s)
  if (
    negativeMetadataCache?.key === cacheKey &&
    negativeMetadataCache.expiresAt > now
  ) {
    return negativeMetadataCache.result;
  }

  // 4. Cold start or fully expired: synchronous single-flight fetch
  if (revalidationInFlight) {
    return revalidationInFlight;
  }

  revalidationInFlight = (async () => {
    try {
      const result = await validateOidcConnection(normalizedIssuer, options);
      if (result.isValid && result.metadata) {
        runtimeMetadataCache = {
          key: cacheKey,
          result,
          expiresAt: Date.now() + RUNTIME_METADATA_TTL_MS,
          staleUntil: Date.now() + STALE_METADATA_MAX_MS,
        };
        negativeMetadataCache = undefined;
        return result;
      }

      negativeMetadataCache = {
        key: cacheKey,
        result,
        expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS,
      };
      return result;
    } catch (error) {
      const failResult: OidcValidationResult = {
        isValid: false,
        error: error instanceof Error ? error.message : 'Validation failed due to unexpected error',
      };
      negativeMetadataCache = {
        key: cacheKey,
        result: failResult,
        expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS,
      };
      return failResult;
    } finally {
      revalidationInFlight = undefined;
    }
  })();

  return revalidationInFlight;
}

export function resetOidcRuntimeMetadataCache() {
  runtimeMetadataCache = undefined;
  negativeMetadataCache = undefined;
  revalidationInFlight = undefined;
}

export type OidcRuntimeCapability = {
  configured: boolean;
  enabled: boolean;
  runtimeReady: boolean;
  providerType?: string | null;
  providerLabel?: string | null;
  error?: string | null;
};

/**
 * Shared runtime capability contract ensuring login UI surfaces SSO availability
 * only when NextAuth runtime metadata validation has actually succeeded.
 */
export async function getOidcRuntimeCapability(): Promise<OidcRuntimeCapability> {
  const [config, publicConfig] = await Promise.all([
    getOidcConfig(),
    getOidcPublicConfig(),
  ]);

  if (!publicConfig?.enabled) {
    return {
      configured: Boolean(config),
      enabled: false,
      runtimeReady: false,
    };
  }

  if (!config) {
    return {
      configured: false,
      enabled: true,
      runtimeReady: false,
      error: 'Single sign-on is enabled but not configured correctly. Contact your administrator.',
    };
  }

  const validation = await getValidatedOidcRuntimeMetadata(config.issuer, {
    tokenEndpointAuthMethod: config.tokenEndpointAuthMethod,
  });

  if (!validation.isValid || !validation.metadata) {
    return {
      configured: true,
      enabled: true,
      runtimeReady: false,
      providerType: config.providerType,
      providerLabel: config.providerLabel,
      error: validation.error || 'Identity provider runtime metadata validation failed.',
    };
  }

  return {
    configured: true,
    enabled: true,
    runtimeReady: true,
    providerType: config.providerType,
    providerLabel: config.providerLabel,
  };
}
