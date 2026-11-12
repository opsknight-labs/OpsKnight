import {
  createLocalJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
} from 'jose';
import type { McpPolicy, Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { isAppRole } from '@/lib/authorization';
import { safeOutboundFetch } from '@/lib/network-security';
import { getOidcConfig } from '@/lib/oidc-config';
import { getValidatedOidcRuntimeMetadata } from '@/lib/oidc-validation';
import { getOidcProviderPolicy } from '@/lib/oidc/provider-policy';
import { McpBoundaryError } from '../core/errors';
import { mcpPolicyInForce } from '../core/kill-switch';
import { digestMcpSecret, mcpIssuer, mcpResource } from './config';
import { effectiveMcpClientScopes } from './client-policy';
import { buildMcpConsentOffer } from './consent-offer';
import { createMcpOAuthModel } from './oauth-model';
import { mcpSessionDates } from './session-lifetime';

/**
 * Enterprise-managed authorization (MCP extension, protocol revision 2026-07-28): the
 * organization's identity provider issues an Identity Assertion JWT Authorization Grant (ID-JAG,
 * draft-ietf-oauth-identity-assertion-authz-grant-06) and the assistant exchanges it here with the
 * RFC 7523 JWT bearer grant, with no consent screen. Active only while the administrator turned
 * it on and single sign-on is configured; the IdP is the SSO provider OpsKnight already trusts.
 */
export const MCP_JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const MCP_ID_JAG_PROFILE = 'urn:ietf:params:oauth:grant-profile:id-jag';
export const MCP_ID_JAG_TYP = 'oauth-id-jag+jwt';
/** Grants created from an ID-JAG, so administrators can tell them from consented connections. */
export const MCP_IDP_GRANT_KIND = 'IDP';
const ACCESS_TOKEN_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 60;
/** An ID-JAG is a short-lived, one-time grant; an older one is refused whatever its exp says. */
const MAX_ASSERTION_AGE = '10m';
const JWKS_TTL_MS = 300_000;
/** A key id the cached set lacks refetches the set at most this often (IdP key rotation). */
const JWKS_REFETCH_MS = 30_000;
const MAX_JWKS_BYTES = 1_048_576;

/** The IdP that may issue grants, or null when enterprise-managed authorization is not active. */
export async function mcpEnterpriseGrantIssuer(
  policy: { enabled: boolean; enterpriseManagedAuthEnabled?: boolean } | null
) {
  if (!policy?.enterpriseManagedAuthEnabled || !mcpPolicyInForce(policy)) return null;
  return getOidcConfig();
}

let jwksCache: { uri: string; keys: JSONWebKeySet; fetchedAt: number } | undefined;
export function resetMcpEnterpriseJwksCacheForTests() {
  jwksCache = undefined;
}

async function loadJwks(uri: string, kid: string | undefined) {
  const now = Date.now();
  const cached = jwksCache?.uri === uri ? jwksCache : undefined;
  const known = cached && (!kid || cached.keys.keys.some(key => key.kid === kid));
  if (cached && known && now - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  if (cached && !known && now - cached.fetchedAt < JWKS_REFETCH_MS) return cached.keys;
  // The same outbound guard as SSO discovery: public addresses only, no redirects, bounded.
  const response = await safeOutboundFetch(uri, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`jwks_status_${response.status}`);
  const text = await response.text();
  if (text.length > MAX_JWKS_BYTES) throw new Error('jwks_too_large');
  const parsed = JSON.parse(text) as { keys?: unknown };
  if (!Array.isArray(parsed.keys)) throw new Error('jwks_malformed');
  const keys = { keys: parsed.keys as JSONWebKeySet['keys'] };
  jwksCache = { uri, keys, fetchedAt: now };
  return keys;
}

/**
 * Refusal: the client learns only the OAuth error code (RFC 6749 §5.2); the specific reason is
 * logged here for the administrator.
 */
function refuse(code: string, reason: string, details: Record<string, unknown> = {}): never {
  logger.warn('mcp.token.id_jag_refused', { reason, error: code, ...details });
  throw new McpBoundaryError(code, code === 'invalid_client' ? 401 : 400);
}

const claimsSchema = z.object({
  sub: z.string().min(1).max(255),
  client_id: z.string().min(1).max(2048),
  jti: z.string().min(1).max(255),
  exp: z.number(),
  aud: z.union([z.string(), z.array(z.string()).length(1)]),
  scope: z.string().max(2048).optional(),
  resource: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
});

export type McpEnterpriseGrantInput = {
  assertion: string;
  clientId: string;
  /** The token request's optional scope parameter (RFC 7521 §4.1). */
  scope?: string;
};

/** Stateless checks: signature, header and claims. Returns the verified claims. */
async function verifyAssertion(input: McpEnterpriseGrantInput, policy: McpPolicy | null) {
  const config = await mcpEnterpriseGrantIssuer(policy);
  if (!config) refuse('unsupported_grant_type', 'not_enabled');
  const metadata = await getValidatedOidcRuntimeMetadata(config.issuer, {
    tokenEndpointAuthMethod: config.tokenEndpointAuthMethod,
  });
  if (!metadata.isValid || !metadata.metadata || metadata.metadata.issuer !== config.issuer)
    refuse('invalid_grant', 'idp_metadata_unavailable');
  let kid: string | undefined;
  try {
    kid = decodeProtectedHeader(input.assertion).kid;
  } catch {
    refuse('invalid_grant', 'malformed');
  }
  let keys: JSONWebKeySet;
  try {
    keys = await loadJwks(metadata.metadata.jwksUri, kid);
  } catch (error) {
    refuse('invalid_grant', 'jwks_unavailable', {
      detail: error instanceof Error ? error.message : 'unknown',
    });
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(input.assertion, createLocalJWKSet(keys), {
      // Only the algorithms OpsKnight accepts from this IdP for ID tokens; never "none" or HMAC.
      algorithms: [
        ...getOidcProviderPolicy(config.issuer, config.providerType).acceptedIdTokenAlgorithms,
      ],
      typ: MCP_ID_JAG_TYP,
      issuer: config.issuer,
      audience: mcpIssuer(),
      clockTolerance: CLOCK_SKEW_SECONDS,
      maxTokenAge: MAX_ASSERTION_AGE,
      requiredClaims: ['iss', 'sub', 'aud', 'client_id', 'jti', 'exp', 'iat'],
    }));
  } catch (error) {
    const unverified = (() => {
      try {
        return decodeJwt(input.assertion);
      } catch {
        return null;
      }
    })();
    refuse('invalid_grant', 'verification_failed', {
      detail:
        error instanceof Error ? ((error as { code?: string }).code ?? error.name) : 'unknown',
      // Unverified and attacker-chosen: logged short, only to tell a misconfigured IdP apart.
      iss: typeof unverified?.iss === 'string' ? unverified.iss.slice(0, 200) : undefined,
    });
  }
  const parsed = claimsSchema.safeParse(payload);
  if (!parsed.success) refuse('invalid_grant', 'claims_malformed');
  const claims = parsed.data;
  // draft-06 §4.4.1: an array audience must hold exactly one element, this server's issuer.
  // Proof of possession (cnf) and rich authorization requests are not supported, so a grant that
  // depends on them is refused rather than half-honoured.
  if ('cnf' in payload) refuse('invalid_grant', 'cnf_unsupported');
  if ('authorization_details' in payload)
    refuse('invalid_grant', 'authorization_details_unsupported');
  const resources = claims.resource === undefined ? [] : [claims.resource].flat();
  if (resources.some(resource => resource !== mcpResource()))
    refuse('invalid_grant', 'resource_mismatch');
  if (claims.client_id !== input.clientId) refuse('invalid_grant', 'client_mismatch');
  return { claims, issuer: config.issuer };
}

/**
 * Exchanges a verified ID-JAG for an access token. Run in a serializable transaction: the jti is
 * recorded in the same transaction that issues the token, so of two exchanges of one grant at
 * most one commits. Per draft-06 §4.4.4 no refresh token is returned; the assistant presents a
 * fresh ID-JAG from the IdP when the access token expires, so the IdP stays in control.
 */
export async function exchangeMcpEnterpriseGrant(
  input: McpEnterpriseGrantInput,
  policy: McpPolicy | null
) {
  const { claims, issuer } = await verifyAssertion(input, policy);
  return async (tx: Prisma.TransactionClient) => {
    const now = new Date();
    // One-time use: the shared keyed-row store, kept until the assertion could no longer verify.
    const used = await tx.$executeRaw`INSERT INTO "RateLimit" ("key", "count", "expiresAt")
      VALUES (${`mcp:id-jag:${digestMcpSecret(`${issuer}\n${claims.jti}`)}`}, 1,
        ${new Date((claims.exp + CLOCK_SKEW_SECONDS) * 1000)})
      ON CONFLICT ("key") DO NOTHING`;
    if (used !== 1) refuse('invalid_grant', 'replayed');
    const model = createMcpOAuthModel(tx, () => {});
    const oauthClient = await model.getClient(input.clientId, '');
    const client = await tx.mcpClient.findUnique({ where: { id: input.clientId } });
    const ceiling = client && effectiveMcpClientScopes(client, policy);
    if (!oauthClient || !client || !ceiling?.length) refuse('invalid_client', 'client_unknown');
    // Only an existing link to this IdP identifies the person: no account is created or linked.
    const identity = await tx.oidcIdentity.findUnique({
      where: { issuer_subject: { issuer, subject: claims.sub } },
      select: {
        user: {
          select: {
            id: true,
            status: true,
            role: true,
            tokenVersion: true,
            mcpRevocationVersion: true,
          },
        },
      },
    });
    const user = identity?.user;
    if (!user || user.status !== 'ACTIVE' || !isAppRole(user.role))
      refuse('invalid_grant', 'subject_not_active', { clientId: client.id });
    // Granted = requested ∩ what the IdP granted ∩ the assistant's ceiling ∩ the person's role.
    const split = (value?: string) => value?.split(' ').filter(Boolean);
    const fromIdp = split(claims.scope);
    const requested = split(input.scope);
    const base = fromIdp ?? requested ?? [];
    const candidates = base.filter(
      scope => ceiling.includes(scope) && (!requested || requested.includes(scope))
    );
    const scopes = buildMcpConsentOffer({
      scopes: candidates,
      explicitlyRequested: [],
      role: user.role,
      readOnly: policy?.requireReadOnlyConnections,
    }).offered;
    if (!scopes.length) refuse('invalid_scope', 'no_grantable_scope', { clientId: client.id });
    // One live IdP connection per person and assistant, updated with what the IdP grants now.
    const existing = await tx.mcpGrant.findFirst({
      where: {
        userId: user.id,
        clientId: client.id,
        kind: MCP_IDP_GRANT_KIND,
        revokedAt: null,
        expiresAt: { gt: now },
        resource: mcpResource(),
        userRevocationVersion: user.mcpRevocationVersion,
      },
      select: { id: true },
    });
    const grant = existing
      ? await tx.mcpGrant.update({ where: { id: existing.id }, data: { scopes } })
      : await tx.mcpGrant.create({
          data: {
            kind: MCP_IDP_GRANT_KIND,
            userId: user.id,
            userTokenVersion: user.tokenVersion,
            userRevocationVersion: user.mcpRevocationVersion,
            clientId: client.id,
            scopes,
            resource: mcpResource(),
            ...mcpSessionDates(now, policy?.sessionIdleDays),
          },
        });
    if (client.dynamicRegistration && !client.firstAuthorizedAt)
      await tx.mcpClient.update({ where: { id: client.id }, data: { firstAuthorizedAt: now } });
    if (!existing)
      await logAudit(
        {
          source: 'AUTH',
          action: 'mcp.grant.idp_granted',
          entityType: 'SYSTEM_CONFIG',
          entityId: grant.id,
          actorId: user.id,
          details: { clientId: client.id, clientName: client.name, scopes, issuer },
        },
        tx
      );
    const owner = { id: user.id, grantId: grant.id };
    const accessToken = await model.generateAccessToken!(oauthClient, owner, scopes);
    // The store needs a refresh hash; this one is never returned, so it can never be used.
    const unusedRefresh = await model.generateRefreshToken!(oauthClient, owner, scopes);
    const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_SECONDS * 1000);
    const saved = await model.saveToken(
      {
        accessToken,
        refreshToken: unusedRefresh,
        accessTokenExpiresAt: expiresAt,
        refreshTokenExpiresAt: expiresAt,
        scope: scopes,
        client: oauthClient,
        user: owner,
      },
      oauthClient,
      owner
    );
    if (!saved) refuse('invalid_grant', 'save_failed');
    const granted: string[] = Array.isArray(saved.scope) ? saved.scope : scopes;
    return {
      access_token: accessToken,
      token_type: 'Bearer' as const,
      expires_in: ACCESS_TOKEN_SECONDS,
      scope: granted.join(' '),
    };
  };
}
