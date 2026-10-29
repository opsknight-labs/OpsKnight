import OAuth2Server from '@node-oauth/oauth2-server';
import { randomBytes } from 'node:crypto';
import type { Prisma, McpClient } from '@prisma/client';
import { digestMcpSecret, mcpResource } from './config';
import { requireMcp } from '../core/errors';
import { effectiveMcpClientScopes } from './client-policy';

type Database = Prisma.TransactionClient;
type Model = OAuth2Server.AuthorizationCodeModel & OAuth2Server.RefreshTokenModel;

export function createMcpOAuthModel(db: Database, onReuse: (grantId: string) => void): Model {
  // A metadata client is only as trusted as the current policy: its host must still be listed and
  // its scopes can never exceed the current ceiling, whatever copy was stored at registration.
  const effectiveScopes = async (client: McpClient) => {
    if (!client.metadataUrl && !client.dynamicRegistration) return client.scopes;
    const policy = await db.mcpPolicy.findUnique({ where: { id: 'default' } });
    return effectiveMcpClientScopes(client, policy);
  };
  const getClient = async (id: string) => {
    const client = await db.mcpClient.findUnique({ where: { id } });
    if (!client || client.revokedAt) return false;
    const scopes = await effectiveScopes(client);
    if (!scopes) return false;
    return {
      id,
      redirectUris: client.redirectUris,
      grants: ['authorization_code', 'refresh_token'],
      scopes,
    };
  };
  const validateGrant = async (id: string) => {
    const grant = await db.mcpGrant.findUnique({ where: { id }, include: { client: true } });
    requireMcp(
      grant &&
        !grant.revokedAt &&
        !grant.client.revokedAt &&
        grant.expiresAt > new Date() &&
        grant.resource === mcpResource(),
      'invalid_grant',
      401
    );
    const user = await db.user.findUnique({
      where: { id: grant.userId },
      select: { status: true, tokenVersion: true },
    });
    requireMcp(
      user?.status === 'ACTIVE' && user.tokenVersion === grant.userTokenVersion,
      'invalid_grant',
      401
    );
    return grant;
  };
  const secret = async () => randomBytes(32).toString('base64url');
  return {
    getClient,
    generateAccessToken: secret,
    generateRefreshToken: secret,
    generateAuthorizationCode: secret,
    getAccessToken: async () => false, // Resource verification uses the authoritative grant resolver.
    validateScope: async (user, client, scope) => {
      const grant = await validateGrant(String(user.grantId));
      const ceiling = await effectiveScopes(grant.client);
      return scope?.length &&
        ceiling &&
        scope.every(item => grant.scopes.includes(item) && ceiling.includes(item))
        ? scope
        : false;
    },
    saveAuthorizationCode: async (code, client, user) => {
      const grant = await validateGrant(String(user.grantId));
      requireMcp(
        grant.clientId === client.id && code.codeChallengeMethod === 'S256' && code.codeChallenge,
        'invalid_grant'
      );
      await db.mcpAuthorizationCode.create({
        data: {
          hash: digestMcpSecret(code.authorizationCode),
          grantId: grant.id,
          redirectUri: code.redirectUri,
          challenge: code.codeChallenge,
          expiresAt: code.expiresAt,
        },
      });
      return { ...code, client, user };
    },
    getAuthorizationCode: async authorizationCode => {
      const code = await db.mcpAuthorizationCode.findUnique({
        where: { hash: digestMcpSecret(authorizationCode) },
      });
      if (!code) return false;
      if (code.consumedAt) {
        onReuse(code.grantId);
        return false;
      }
      const grant = await validateGrant(code.grantId);
      const client = await getClient(grant.clientId);
      if (!client) return false;
      return {
        authorizationCode,
        client,
        user: { id: grant.userId, grantId: grant.id },
        scope: grant.scopes,
        expiresAt: code.expiresAt,
        redirectUri: code.redirectUri,
        codeChallenge: code.challenge,
        codeChallengeMethod: 'S256',
      };
    },
    revokeAuthorizationCode: async code => {
      const result = await db.mcpAuthorizationCode.updateMany({
        where: { hash: digestMcpSecret(code.authorizationCode), consumedAt: null },
        data: { consumedAt: new Date() },
      });
      return result.count === 1;
    },
    saveToken: async (token, client, user) => {
      const grant = await validateGrant(String(user.grantId));
      requireMcp(
        grant.clientId === client.id &&
          token.refreshToken &&
          token.accessTokenExpiresAt &&
          token.refreshTokenExpiresAt,
        'invalid_grant'
      );
      const requested: string[] = token.scope ?? grant.scopes;
      const ceiling = await effectiveScopes(grant.client);
      requireMcp(ceiling, 'invalid_grant');
      // A refresh after the policy ceiling was lowered yields only what is still permitted.
      const scopes = requested.filter(
        scope => grant.scopes.includes(scope) && ceiling.includes(scope)
      );
      requireMcp(scopes.length, 'invalid_scope');
      await db.mcpToken.create({
        data: {
          grantId: grant.id,
          accessHash: digestMcpSecret(token.accessToken),
          refreshHash: digestMcpSecret(token.refreshToken),
          scopes,
          accessExpiresAt: token.accessTokenExpiresAt,
          refreshExpiresAt: token.refreshTokenExpiresAt,
        },
      });
      return { ...token, scope: scopes, accessToken: String(token.accessToken), client, user };
    },
    getRefreshToken: async refreshToken => {
      const token = await db.mcpToken.findUnique({
        where: { refreshHash: digestMcpSecret(refreshToken) },
      });
      if (!token) return false;
      if (token.rotatedAt) {
        onReuse(token.grantId);
        return false;
      }
      const grant = await validateGrant(token.grantId);
      const client = await getClient(grant.clientId);
      if (!client) return false;
      return {
        refreshToken,
        refreshTokenExpiresAt: token.refreshExpiresAt,
        scope: token.scopes,
        client,
        user: { id: grant.userId, grantId: grant.id },
      };
    },
    revokeToken: async token => {
      const result = await db.mcpToken.updateMany({
        where: { refreshHash: digestMcpSecret(token.refreshToken), rotatedAt: null },
        data: { rotatedAt: new Date() },
      });
      return result.count === 1;
    },
  };
}

export function mcpOAuthServer(db: Database, onReuse: (id: string) => void) {
  return new OAuth2Server({
    model: createMcpOAuthModel(db, onReuse),
    accessTokenLifetime: 300,
    refreshTokenLifetime: 86400,
  });
}
