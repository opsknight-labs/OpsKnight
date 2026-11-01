import 'server-only';
import { z } from 'zod/v3';
import { isIP } from 'node:net';
import type { McpClient, McpPolicy, PrismaClient } from '@prisma/client';
import { McpBoundaryError } from '../core/errors';
import { CIMD_MAX_BYTES, fetchPinnedMetadata, type CimdResponse } from './cimd-transport';
import { rejectDuplicateJsonKeys } from '../protocol/input';
import { logger } from '@/lib/logger';
import { redirectUriAllowed, urlForLog } from './redirect-uri';

const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Client IDs that are URLs select the metadata-document path; anything else is a registered id. */
export function isCimdClientId(clientId: string) {
  return /^https?:\/\//i.test(clientId);
}

/** Strict canonical form: HTTPS, DNS name, default port, a path, no credentials/query/fragment. */
export function parseCimdClientId(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new McpBoundaryError('invalid_client');
  }
  const canonical =
    url.protocol === 'https:' &&
    url.href === raw &&
    !url.username &&
    !url.password &&
    !url.port &&
    !url.search &&
    !url.hash &&
    url.pathname.length > 1 &&
    !url.pathname.split('/').some(segment => segment === '.' || segment === '..') &&
    url.hostname.includes('.') &&
    !isIP(url.hostname.replace(/^\[|\]$/g, '')) &&
    url.hostname === url.hostname.toLowerCase() &&
    raw.length <= 256;
  if (!canonical) {
    logger.warn('mcp.cimd.client_id_rejected', {
      clientId: urlForLog(raw),
      reason: 'not_canonical_https_url',
    });
    throw new McpBoundaryError('invalid_client');
  }
  return url;
}
function redirectUri(value: string) {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname)))
    );
  } catch {
    return false;
  }
}

const metadataSchema = z
  .object({
    client_id: z.string(),
    client_name: z.string().max(200).optional(),
    redirect_uris: z.array(z.string().max(2048).refine(redirectUri)).min(1).max(5),
    token_endpoint_auth_method: z.string().min(1).max(64).optional(),
    token_endpoint_auth_methods_supported: z
      .array(z.string().min(1).max(64))
      .min(1)
      .max(8)
      .refine(methods => new Set(methods).size === methods.length)
      .optional(),
    jwks_uri: z.string().url().max(2048).optional(),
    // Claude's published document also lists the JWT-bearer extension grant. It is only a statement
    // about the client; this server issues authorization-code and refresh tokens and nothing else,
    // so tolerating it grants no capability. Other grant types stay rejected.
    grant_types: z
      .array(z.enum(['authorization_code', 'refresh_token', JWT_BEARER_GRANT]))
      .min(1)
      .max(3)
      .refine(types => types.includes('authorization_code') && new Set(types).size === types.length)
      .optional(),
    response_types: z.array(z.literal('code')).length(1).optional(),
  })
  .passthrough()
  .superRefine((document, ctx) => {
    // Never treat a signed-auth preference as permission to downgrade a private-only client.
    const methods = document.token_endpoint_auth_methods_supported ?? [
      document.token_endpoint_auth_method ?? 'none',
    ];
    if (!methods.includes('none'))
      ctx.addIssue({ code: 'custom', message: 'Public-client authentication must be supported.' });
    // Public key URLs are informational in this public-client flow, never fetched or persisted.
    if (document.jwks_uri) {
      try {
        const keyUrl = new URL(document.jwks_uri);
        const clientUrl = new URL(document.client_id);
        if (
          keyUrl.protocol !== 'https:' ||
          keyUrl.origin !== clientUrl.origin ||
          keyUrl.username ||
          keyUrl.password ||
          keyUrl.search ||
          keyUrl.hash
        )
          ctx.addIssue({ code: 'custom', message: 'Invalid public key URL.' });
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid public key URL.' });
      }
    }
    if (['client_secret', 'client_secret_expires_at', 'jwks'].some(k => k in document))
      ctx.addIssue({ code: 'custom', message: 'Secret-bearing client metadata is unsupported.' });
  });

type Policy = Pick<McpPolicy, 'cimdEnabled' | 'cimdAllowedHosts' | 'cimdScopes'>;
type Database = Pick<PrismaClient, 'mcpClient'>;

/** An empty allowlist trusts any public HTTPS host; a non-empty one restricts to exact hosts. */
export function isCimdHostAllowed(policy: Policy, host: string) {
  return (
    policy.cimdEnabled &&
    (policy.cimdAllowedHosts.length === 0 || policy.cimdAllowedHosts.includes(host.toLowerCase()))
  );
}

export function parseCimdDocument(clientId: string, response: CimdResponse) {
  // Administrators otherwise only see "invalid_client"; record why, without any document values.
  const reject = (reason: string): never => {
    logger.warn('mcp.cimd.document_rejected', { clientId, reason });
    throw new McpBoundaryError('invalid_client');
  };
  if (response.status !== 200) reject(`http_status_${response.status}`);
  if (!/^application\/json\s*(;|$)/i.test(response.contentType)) reject('content_type_not_json');
  if (Buffer.byteLength(response.body) > CIMD_MAX_BYTES) reject('document_too_large');
  let json: unknown;
  try {
    rejectDuplicateJsonKeys(response.body);
    json = JSON.parse(response.body);
  } catch {
    return reject('invalid_json');
  }
  const parsed = metadataSchema.safeParse(json);
  if (!parsed.success)
    // Field path and issue code only: Zod messages can echo the document's own values.
    return reject(
      `schema:${[
        ...new Set(
          parsed.error.issues.map(issue => `${issue.path.join('.') || 'document'}/${issue.code}`)
        ),
      ].join(',')}`
    );
  if (parsed.data.client_id !== clientId) reject('client_id_mismatch');
  return { ...parsed.data, token_endpoint_auth_method: 'none' as const };
}

/**
 * Resolves a metadata-document client for one authorization request. The document is fetched
 * on demand, never trusted beyond redirect URIs and a display name, and the scope ceiling is the
 * administrator's policy — the document cannot request more than the policy allows.
 */
export async function resolveCimdClient(
  db: Database,
  policy: Policy,
  clientId: string,
  requestedRedirectUri: string,
  fetchDocument: (url: URL) => Promise<CimdResponse> = fetchPinnedMetadata
): Promise<McpClient> {
  const url = parseCimdClientId(clientId);
  // Administrators otherwise only see "invalid_client"; say which check failed.
  const deny = (reason: string, extra: Record<string, unknown> = {}): never => {
    logger.warn('mcp.cimd.client_denied', { clientId, reason, ...extra });
    throw new McpBoundaryError('invalid_client');
  };
  if (!policy.cimdEnabled) deny('automatic_connections_off');
  if (!isCimdHostAllowed(policy, url.hostname))
    deny('host_not_in_allowlist', { host: url.hostname });
  if (policy.cimdScopes.length === 0) deny('no_scopes_allowed_for_automatic_connections');
  const existing = await db.mcpClient.findUnique({ where: { id: clientId } });
  if (existing?.revokedAt) deny('client_revoked');
  if (existing && existing.metadataUrl !== clientId) deny('client_id_taken_by_other_registration');
  let fetched: CimdResponse;
  try {
    fetched = await fetchDocument(url);
  } catch (error) {
    // The transport rejects before any response exists (non-200, timeout, oversized body, TLS,
    // blocked address), so these never reach the parser. Record why and keep the same error.
    logger.warn('mcp.cimd.fetch_failed', {
      clientId,
      reason: error instanceof McpBoundaryError ? error.code : 'unexpected_error',
    });
    throw error;
  }
  const document = parseCimdDocument(clientId, fetched);
  if (!redirectUriAllowed(document.redirect_uris, requestedRedirectUri))
    deny('redirect_uri_not_in_document', {
      requestedRedirectUri: urlForLog(requestedRedirectUri),
      documentRedirectUris: document.redirect_uris.map(urlForLog),
    });
  const name =
    (document.client_name ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, 100) || url.hostname;
  const data = {
    name,
    redirectUris: document.redirect_uris,
    scopes: [...policy.cimdScopes],
    metadataUrl: clientId,
    metadataFetchedAt: new Date(),
  };
  return db.mcpClient.upsert({
    where: { id: clientId },
    create: { id: clientId, ...data },
    update: data,
  });
}
