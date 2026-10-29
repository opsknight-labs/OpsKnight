'use server';

import { logAudit } from '@/lib/audit';
import OAuth2Server from '@node-oauth/oauth2-server';
import { z } from 'zod/v3';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import prisma from '@/lib/prisma';
import { getCurrentUser, getUserPermissions } from '@/lib/rbac';
import {
  getMcpConfigurationStatus,
  loadMcpRuntime,
  mcpIssuer,
  mcpResource,
} from '@/lib/mcp/auth/config';
import { mcpOAuthServer } from '@/lib/mcp/auth/oauth-model';
import { isIP } from 'node:net';
import { McpBoundaryError, requireMcp } from '@/lib/mcp/core/errors';
import type { Prisma } from '@prisma/client';
import { DEFAULT_ASSISTANT_SCOPES, effectiveMcpClientScopes } from '@/lib/mcp/auth/client-policy';
import { supportedMcpScopes } from '@/lib/mcp/auth/scopes';
import { mcpSessionDates } from '@/lib/mcp/auth/session-lifetime';

const settingsPath = '/settings/integrations/mcp';
const supportedScopes = supportedMcpScopes;
function parseScopes(value: string) {
  const supported = supportedScopes();
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))];
  requireMcp(
    scopes.every(scope => supported.has(scope) && scope !== 'admin:manage'),
    'MCP_INVALID_SCOPE'
  );
  return scopes;
}
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

/** One-click first-run setup: read-only assistant access with automatic connections. */
export async function enableMcpQuickSetup() {
  const actor = await admin();
  await loadMcpRuntime();
  requireMcp(
    !(await getMcpConfigurationStatus({ force: true })).issues.length,
    'MCP_CONFIGURATION_INVALID'
  );
  const scopes = DEFAULT_ASSISTANT_SCOPES.filter(scope => supportedScopes().has(scope));
  requireMcp(scopes.length > 0, 'MCP_INVALID_SCOPE');
  const policy = {
    enabled: true,
    dcrEnabled: true,
    dcrScopes: scopes,
    cimdEnabled: true,
    cimdAllowedHosts: [] as string[],
    cimdScopes: scopes,
  };
  await prisma.$transaction(async tx => {
    await assertCurrentAdmin(tx, actor);
    // Never overwrite an existing configuration: this is only the first-run shortcut.
    const existing = await tx.mcpPolicy.findUnique({ where: { id: 'default' } });
    requireMcp(!existing?.enabled, 'MCP_ALREADY_CONFIGURED');
    await tx.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
    await logAudit(
      {
        source: 'UI',
        action: 'mcp.policy.updated',
        entityType: 'SYSTEM_CONFIG',
        actorId: actor.id,
        details: { ...policy, quickSetup: true },
      },
      tx
    );
  });
  revalidatePath(settingsPath);
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
      sensitiveReadsEnabled: z.boolean(),
      cimdAllowedHosts: z.string().max(4096),
      dcrEnabled: z.boolean(),
      dcrScopes: z.string().max(2048),
      sessionIdleDays: z.coerce.number().int().min(1).max(90),
    })
    .strict()
    .parse({
      enabled: form.get('enabled') === 'on',
      writesEnabled: form.get('writesEnabled') === 'on',
      maxInFlight: form.get('maxInFlight'),
      maxOperations: form.get('maxOperations'),
      requestsPerMinute: form.get('requestsPerMinute'),
      sensitiveReadsEnabled: form.get('sensitiveReadsEnabled') === 'on',
      cimdAllowedHosts: String(form.get('cimdAllowedHosts') ?? ''),
      dcrEnabled: form.get('dcrEnabled') === 'on',
      // Scope checkboxes submit one value each; a plain text field submits a space-separated list.
      dcrScopes: form.getAll('dcrScopes').map(String).join(' '),
      sessionIdleDays: form.get('sessionIdleDays') ?? 30,
    });
  const cimdAllowedHosts = [
    ...new Set(
      input.cimdAllowedHosts
        .split(/\s+/)
        .map(host => host.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  // Exact DNS names only; no IP literals, wildcards, ports or paths.
  requireMcp(
    cimdAllowedHosts.length <= 20 &&
      cimdAllowedHosts.every(host => {
        const labels = host.split('.');
        return (
          labels.length >= 2 &&
          host.length <= 253 &&
          !isIP(host) &&
          labels.every(label => /^[a-z0-9-]{1,63}$/.test(label) && !/^-|-$/.test(label)) &&
          /^[a-z]{2,63}$/.test(labels[labels.length - 1])
        );
      }),
    'MCP_INVALID_CIMD_HOST'
  );
  // Refuse to switch MCP on when its bootstrap configuration would fail at request time.
  requireMcp(
    !input.enabled || !(await getMcpConfigurationStatus({ force: true })).issues.length,
    'MCP_CONFIGURATION_INVALID'
  );
  const dcrScopes = parseScopes(input.dcrScopes);
  requireMcp(!input.dcrEnabled || dcrScopes.length > 0, 'MCP_DCR_REQUIRES_SCOPES');
  // "Automatic connections" is one switch: assistants may register themselves (DCR) or identify with
  // a metadata document (CIMD) under the same scope ceiling. An optional host list narrows CIMD.
  const cimdEnabled = input.dcrEnabled;
  const cimdScopes = dcrScopes;
  const policy = {
    enabled: input.enabled,
    writesEnabled: input.writesEnabled,
    sensitiveReadsEnabled: input.sensitiveReadsEnabled,
    maxInFlight: input.maxInFlight,
    maxOperations: input.maxOperations,
    requestsPerMinute: input.requestsPerMinute,
    cimdEnabled,
    cimdAllowedHosts,
    cimdScopes,
    dcrEnabled: input.dcrEnabled,
    dcrScopes,
    sessionIdleDays: input.sessionIdleDays,
  };
  await prisma.$transaction(async tx => {
    await assertCurrentAdmin(tx, actor);
    await tx.mcpPolicy.upsert({ where: { id: 'default' }, create: policy, update: policy });
    await logAudit(
      {
        source: 'UI',
        action: 'mcp.policy.updated',
        entityType: 'SYSTEM_CONFIG',
        actorId: actor.id,
        details: policy,
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
  const scopes = parseScopes(input.scopes);
  requireMcp(scopes.length, 'MCP_INVALID_SCOPE');
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

/** Revokes every active MCP grant at once, e.g. after a suspected credential exposure. */
export async function revokeAllMcpConnections(form: FormData) {
  const actor = await admin();
  // Next.js adds reserved action metadata; every business field is validated.
  const entries = Array.from(form.entries()).filter(([key]) => !key.startsWith('$ACTION_'));
  const input = z
    .object({ confirm: z.literal('on') })
    .strict()
    .safeParse(Object.fromEntries(entries));
  // Object.fromEntries collapses duplicate keys, so require exactly one entry too.
  requireMcp(input.success && entries.length === 1, 'MCP_CONFIRMATION_REQUIRED');
  await prisma.$transaction(async tx => {
    await assertCurrentAdmin(tx, actor);
    const revoked = await tx.mcpGrant.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await logAudit(
      {
        source: 'UI',
        action: 'mcp.grants.revoked_all',
        entityType: 'SYSTEM_CONFIG',
        actorId: actor.id,
        details: { revokedGrants: revoked.count },
      },
      tx
    );
  });
  revalidatePath(settingsPath);
}

export async function decideMcpConsent(form: FormData) {
  await loadMcpRuntime();
  const actor = await getCurrentUser();
  const input = z
    .object({ id: z.string().min(1).max(128), decision: z.enum(['allow', 'deny']) })
    .strict()
    .parse({ id: form.get('id'), decision: form.get('decision') });
  let location: string;
  try {
    location = await prisma.$transaction(
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
        // Bind consent to the current registration policy, not a stale pending form.
        await tx.$queryRaw`SELECT id FROM "McpClient" WHERE id = ${client.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "McpPolicy" WHERE id = 'default' FOR SHARE`;
        const currentClient = await tx.mcpClient.findUniqueOrThrow({ where: { id: client.id } });
        const currentPolicy = await tx.mcpPolicy.findUnique({ where: { id: 'default' } });
        const ceiling = effectiveMcpClientScopes(currentClient, currentPolicy);
        requireMcp(
          ceiling && pending.scopes.every(scope => ceiling.includes(scope)),
          'invalid_scope'
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
        if (currentClient.dynamicRegistration && !currentClient.firstAuthorizedAt)
          await tx.mcpClient.update({
            where: { id: client.id },
            data: { firstAuthorizedAt: new Date() },
          });
        const grant = await tx.mcpGrant.create({
          data: {
            userId: actor.id,
            userTokenVersion: user.tokenVersion,
            clientId: client.id,
            scopes: pending.scopes,
            resource: mcpResource(),
            ...mcpSessionDates(new Date(), currentPolicy?.sessionIdleDays),
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
  } catch (error) {
    // Show what happened and what to do, not the generic settings error.
    if (error instanceof McpBoundaryError)
      redirect(`/oauth/mcp/consent/result?code=${encodeURIComponent(error.code)}`);
    throw error;
  }
  redirect(location);
}
