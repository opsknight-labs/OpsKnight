'use server';

import { logAudit } from '@/lib/audit';
import OAuth2Server from '@node-oauth/oauth2-server';
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { getCurrentUser, getUserPermissions } from '@/lib/rbac';
import { mcpIssuer, mcpResource } from '@/lib/mcp/auth/config';
import { mcpOAuthServer } from '@/lib/mcp/auth/oauth-model';
import { MCP_CATALOG, isMcpExecutable } from '@/lib/mcp/catalog';
import { requireMcp } from '@/lib/mcp/core/errors';
import type { Prisma } from '@prisma/client';

const settingsPath = '/settings/integrations/mcp';
async function admin() {
  const permissions = await getUserPermissions();
  requireMcp(permissions.capabilities.includes('admin.manage'), 'MCP_ADMIN_REQUIRED', 403);
  const user = await getCurrentUser();
  return { ...permissions, tokenVersion: user.tokenVersion };
}

async function assertCurrentAdmin(
  tx: Prisma.TransactionClient,
  actor: { id: string; tokenVersion: number }
) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
  const user = await tx.user.findUnique({
    where: { id: actor.id },
    select: { role: true, status: true, tokenVersion: true },
  });
  requireMcp(
    user?.role === 'ADMIN' && user.status === 'ACTIVE' && user.tokenVersion === actor.tokenVersion,
    'MCP_ADMIN_REQUIRED',
    403
  );
}

export async function updateMcpPolicy(form: FormData) {
  const actor = await admin();
  const input = z
    .object({
      enabled: z.boolean(),
      writesEnabled: z.boolean(),
      maxInFlight: z.coerce.number().int().min(1).max(16),
      maxOperations: z.coerce.number().int().min(1).max(16),
      requestsPerMinute: z.coerce.number().int().min(1).max(600),
    })
    .strict()
    .parse({
      enabled: form.get('enabled') === 'on',
      writesEnabled: form.get('writesEnabled') === 'on',
      maxInFlight: form.get('maxInFlight'),
      maxOperations: form.get('maxOperations'),
      requestsPerMinute: form.get('requestsPerMinute'),
    });
  await prisma.$transaction(async tx => {
    await assertCurrentAdmin(tx, actor);
    await tx.mcpPolicy.upsert({ where: { id: 'default' }, create: input, update: input });
    await logAudit(
      {
        source: 'UI',
        action: 'mcp.policy.updated',
        entityType: 'SYSTEM_CONFIG',
        actorId: actor.id,
        details: input,
      },
      tx
    );
  });
  revalidatePath(settingsPath);
}

export async function registerMcpClient(form: FormData) {
  const actor = await admin();
  const input = z
    .object({
      name: z.string().trim().min(1).max(100),
      redirectUri: z.string().url().max(2048),
      scopes: z.string().max(2048),
    })
    .strict()
    .parse({
      name: form.get('name'),
      redirectUri: form.get('redirectUri'),
      scopes: form.get('scopes'),
    });
  const url = new URL(input.redirectUri);
  requireMcp(
    !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))),
    'MCP_INVALID_REDIRECT'
  );
  const supported = new Set(
    MCP_CATALOG.filter(isMcpExecutable).flatMap(operation => operation.requiredScopes)
  );
  const scopes = [...new Set(input.scopes.split(/\s+/).filter(Boolean))];
  requireMcp(
    scopes.length && scopes.every(scope => supported.has(scope) && scope !== 'admin:manage'),
    'MCP_INVALID_SCOPE'
  );
  await prisma.$transaction(async tx => {
    await assertCurrentAdmin(tx, actor);
    const client = await tx.mcpClient.create({
      data: { name: input.name, redirectUris: [url.href], scopes },
    });
    await logAudit(
      {
        source: 'UI',
        action: 'mcp.client.created',
        entityType: 'SYSTEM_CONFIG',
        entityId: client.id,
        actorId: actor.id,
      },
      tx
    );
  });
  revalidatePath(settingsPath);
}

export async function revokeMcpAccess(form: FormData) {
  const actor = await getCurrentUser();
  const input = z
    .object({ id: z.string().min(1).max(128), kind: z.enum(['grant', 'client']) })
    .strict()
    .parse({ id: form.get('id'), kind: form.get('kind') });
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
    const current = await tx.user.findUnique({
      where: { id: actor.id },
      select: { role: true, status: true, tokenVersion: true },
    });
    requireMcp(
      current?.status === 'ACTIVE' && current.tokenVersion === actor.tokenVersion,
      'MCP_INACTIVE_PRINCIPAL',
      403
    );
    if (input.kind === 'client') {
      requireMcp(current.role === 'ADMIN', 'MCP_ADMIN_REQUIRED', 403);
      await tx.mcpClient.update({ where: { id: input.id }, data: { revokedAt: new Date() } });
    } else {
      const grant = await tx.mcpGrant.findUnique({ where: { id: input.id } });
      requireMcp(
        grant && (grant.userId === actor.id || current.role === 'ADMIN'),
        'MCP_INVALID_GRANT',
        403
      );
      await tx.mcpGrant.update({ where: { id: input.id }, data: { revokedAt: new Date() } });
    }
    await logAudit(
      {
        source: 'UI',
        action: `mcp.${input.kind}.revoked`,
        entityType: 'SYSTEM_CONFIG',
        entityId: input.id,
        actorId: actor.id,
      },
      tx
    );
  });
  revalidatePath(settingsPath);
}

export async function decideMcpConsent(form: FormData) {
  const actor = await getCurrentUser();
  const input = z
    .object({ id: z.string().min(1).max(128), decision: z.enum(['allow', 'deny']) })
    .strict()
    .parse({ id: form.get('id'), decision: form.get('decision') });
  const location = await prisma.$transaction(
    async tx => {
      const policy = await tx.mcpPolicy.findUnique({ where: { id: 'default' } });
      requireMcp(policy?.enabled, 'MCP_DISABLED', 503);
      const pending = await tx.mcpConsentRequest.findUnique({ where: { id: input.id } });
      requireMcp(
        pending &&
          pending.userId === actor.id &&
          !pending.consumedAt &&
          pending.expiresAt > new Date(),
        'MCP_CONSENT_EXPIRED'
      );
      const client = await tx.mcpClient.findUnique({ where: { id: pending.clientId } });
      requireMcp(
        client && !client.revokedAt && client.redirectUris.includes(pending.redirectUri),
        'invalid_client'
      );
      const consumed = await tx.mcpConsentRequest.updateMany({
        where: { id: pending.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      requireMcp(consumed.count === 1, 'MCP_CONSENT_REPLAY');
      const user = await tx.user.findUnique({
        where: { id: actor.id },
        select: { status: true, tokenVersion: true },
      });
      requireMcp(
        user?.status === 'ACTIVE' && user.tokenVersion === actor.tokenVersion,
        'MCP_INACTIVE_PRINCIPAL',
        403
      );
      const target = new URL(pending.redirectUri);
      target.searchParams.set('state', pending.state);
      target.searchParams.set('iss', mcpIssuer());
      if (input.decision === 'deny') {
        target.searchParams.set('error', 'access_denied');
        return target.href;
      }
      const grant = await tx.mcpGrant.create({
        data: {
          userId: actor.id,
          userTokenVersion: user.tokenVersion,
          clientId: client.id,
          scopes: pending.scopes,
          resource: mcpResource(),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      const response = new OAuth2Server.Response();
      await mcpOAuthServer(tx, () => {}).authorize(
        new OAuth2Server.Request({
          method: 'GET',
          headers: {},
          body: {},
          query: {
            client_id: client.id,
            redirect_uri: pending.redirectUri,
            response_type: 'code',
            state: pending.state,
            scope: pending.scopes.join(' '),
            code_challenge: pending.challenge,
            code_challenge_method: 'S256',
          },
        }),
        response,
        {
          allowEmptyState: false,
          requirePKCE: true,
          authorizationCodeLifetime: 60,
          authenticateHandler: { handle: async () => ({ id: actor.id, grantId: grant.id }) },
        }
      );
      requireMcp(response.headers?.location, 'MCP_AUTHORIZATION_FAILED');
      const authorized = new URL(response.headers.location);
      requireMcp(authorized.searchParams.has('code'), 'MCP_AUTHORIZATION_FAILED');
      authorized.searchParams.set('iss', mcpIssuer());
      await logAudit(
        {
          source: 'UI',
          action: 'mcp.grant.consented',
          entityType: 'SYSTEM_CONFIG',
          entityId: grant.id,
          actorId: actor.id,
          details: { scopes: grant.scopes, clientId: client.id },
        },
        tx
      );
      return authorized.href;
    },
    { isolationLevel: 'Serializable', timeout: 5000 }
  );
  redirect(location);
}
