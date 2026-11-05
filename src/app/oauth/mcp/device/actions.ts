'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { getClientIp } from '@/lib/client-ip';
import { getCurrentUser } from '@/lib/rbac';
import { checkRateLimit } from '@/lib/rate-limit';
import { isAppRole } from '@/lib/authorization';
import { digestMcpSecret, loadMcpRuntime, mcpOrigin, mcpResource } from '@/lib/mcp/auth/config';
import { supersededUnusedMcpGrantsWhere } from '@/lib/mcp/auth/consent';
import { isMcpViewScope } from '@/lib/mcp/auth/consent-offer';
import {
  mcpDeviceClientCeiling,
  mcpDeviceEntryLocked,
  mcpUserCodeDigest,
  normalizeMcpUserCode,
  recordMcpDeviceWrongCode,
} from '@/lib/mcp/auth/device-flow';
import { partitionScopesForRole } from '@/lib/mcp/auth/role-scopes';
import { mcpSessionDates } from '@/lib/mcp/auth/session-lifetime';
import { McpBoundaryError, requireMcp } from '@/lib/mcp/core/errors';
import { mcpPolicyInForce } from '@/lib/mcp/core/kill-switch';

const DEVICE_PAGE = '/oauth/mcp/device';

/**
 * Server actions already refuse a foreign Origin; this pins it to the configured public origin
 * too, so a misconfigured proxy host can never let another site submit a device approval.
 */
async function assertSameOrigin() {
  await loadMcpRuntime();
  const origin = (await headers()).get('origin');
  requireMcp(origin === new URL(mcpOrigin()).origin, 'MCP_INVALID_ORIGIN', 403);
}

/** Who is entering codes: the signed-in person, and their network address when it is known. */
async function lockKeys(userId: string) {
  const ip = getClientIp(await headers());
  return [
    `mcp:device:wrong:user:${userId}`,
    ...(ip === '0.0.0.0' ? [] : [`mcp:device:wrong:peer:${digestMcpSecret(`device-peer:${ip}`)}`]),
  ];
}

async function devicePolicy() {
  const policy = await prisma.mcpPolicy.findUnique({ where: { id: 'default' } });
  requireMcp(mcpPolicyInForce(policy) && policy?.deviceFlowEnabled, 'MCP_DEVICE_FLOW_DISABLED');
  return policy;
}

/**
 * Step one: the person types (or confirms the prefilled) code. A matching live code is claimed by
 * this person and the consent screen opens; anything else counts as a wrong code, and five wrong
 * codes pause entry for this person and network address.
 */
export async function confirmMcpDeviceCode(form: FormData) {
  let target: string;
  try {
    await assertSameOrigin();
    const user = await getCurrentUser();
    requireMcp(user.status === 'ACTIVE', 'MCP_INACTIVE_PRINCIPAL', 403);
    await devicePolicy();
    requireMcp(
      (await checkRateLimit(`mcp:device:verify:${user.id}`, 20, 60000)).allowed,
      'MCP_RATE_LIMITED',
      429
    );
    const keys = await lockKeys(user.id);
    requireMcp(!(await mcpDeviceEntryLocked(keys)), 'MCP_DEVICE_CODE_LOCKED', 429);
    const raw = form.get('user_code');
    const normalized = typeof raw === 'string' ? normalizeMcpUserCode(raw) : null;
    const now = new Date();
    const row = normalized
      ? await prisma.mcpDeviceAuthorization.findUnique({
          where: { userCodeHash: mcpUserCodeDigest(normalized) },
          select: { id: true, status: true, userId: true, expiresAt: true },
        })
      : null;
    // A code someone else already entered is treated as unknown: it reveals nothing.
    if (!row || (row.userId !== null && row.userId !== user.id)) {
      await recordMcpDeviceWrongCode(keys);
      throw new McpBoundaryError('MCP_DEVICE_CODE_INVALID');
    }
    requireMcp(row.status === 'PENDING' && row.expiresAt > now, 'MCP_DEVICE_CODE_EXPIRED');
    const claimed = await prisma.mcpDeviceAuthorization.updateMany({
      where: {
        id: row.id,
        status: 'PENDING',
        expiresAt: { gt: now },
        OR: [{ userId: null }, { userId: user.id }],
      },
      data: { userId: user.id, attempts: { increment: 1 } },
    });
    requireMcp(claimed.count === 1, 'MCP_DEVICE_CODE_EXPIRED');
    target = `${DEVICE_PAGE}?id=${encodeURIComponent(row.id)}`;
  } catch (error) {
    if (!(error instanceof McpBoundaryError)) throw error;
    // The typed code is never echoed back in the address.
    target = `${DEVICE_PAGE}?error=${encodeURIComponent(error.code)}`;
  }
  return redirect(target);
}

/**
 * Step two: approve or deny, with exactly the checks of the browser consent. The offer is
 * recomputed from the stored request, the client ceiling and the person's current role; the
 * submitted form only chooses among it. Approval creates the grant; the device collects its
 * tokens once on its next poll.
 */
export async function decideMcpDeviceConsent(form: FormData) {
  let location: string;
  try {
    await assertSameOrigin();
    const actor = await getCurrentUser();
    const input = z
      .object({
        id: z.string().min(1).max(128),
        decision: z.enum(['allow', 'deny']),
        scopes: z
          .array(
            z
              .string()
              .max(128)
              .regex(/^[a-z][a-z0-9:_-]*$/)
          )
          .max(256),
        viewOnly: z.boolean(),
      })
      .strict()
      .safeParse({
        id: form.get('id'),
        decision: form.get('decision'),
        scopes: form.getAll('scope').map(String),
        viewOnly: form.get('viewOnly') === 'on',
      });
    requireMcp(input.success, 'invalid_request');
    const { data } = input;
    location = await prisma.$transaction(
      async tx => {
        const now = new Date();
        const pending = await tx.mcpDeviceAuthorization.findUnique({ where: { id: data.id } });
        requireMcp(
          pending &&
            pending.userId === actor.id &&
            pending.status === 'PENDING' &&
            pending.expiresAt > now,
          'MCP_DEVICE_CODE_EXPIRED'
        );
        // Bind the decision to the current client and policy, not the page as it was rendered.
        await tx.$queryRaw`SELECT id FROM "McpClient" WHERE id = ${pending.clientId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "McpPolicy" WHERE id = 'default' FOR SHARE`;
        const policy = await tx.mcpPolicy.findUnique({ where: { id: 'default' } });
        requireMcp(
          mcpPolicyInForce(policy) && policy?.deviceFlowEnabled,
          'MCP_DEVICE_FLOW_DISABLED'
        );
        const client = await tx.mcpClient.findUnique({ where: { id: pending.clientId } });
        const ceiling = mcpDeviceClientCeiling(client, policy);
        requireMcp(
          client && ceiling && pending.scopes.every(scope => ceiling.includes(scope)),
          'invalid_client'
        );
        const user = await tx.user.findUnique({
          where: { id: actor.id },
          select: { status: true, tokenVersion: true, mcpRevocationVersion: true, role: true },
        });
        requireMcp(
          user?.status === 'ACTIVE' &&
            user.tokenVersion === actor.tokenVersion &&
            isAppRole(user.role),
          'MCP_INACTIVE_PRINCIPAL',
          403
        );
        const { offered: roleOffered } = partitionScopesForRole(pending.scopes, user.role);
        const offered = policy?.requireReadOnlyConnections
          ? roleOffered.filter(isMcpViewScope)
          : roleOffered;
        const chosen = new Set(data.scopes);
        const selected = offered.filter(
          scope => chosen.has(scope) && (!data.viewOnly || isMcpViewScope(scope))
        );
        if (data.decision === 'deny') {
          const denied = await tx.mcpDeviceAuthorization.updateMany({
            where: { id: pending.id, status: 'PENDING' },
            data: { status: 'DENIED', decidedAt: now },
          });
          requireMcp(denied.count === 1, 'MCP_CONSENT_REPLAY');
          await logAudit(
            {
              source: 'UI',
              action: 'mcp.device.denied',
              entityType: 'SYSTEM_CONFIG',
              entityId: pending.id,
              actorId: actor.id,
              details: { clientId: client.id },
            },
            tx
          );
          return `${DEVICE_PAGE}?done=denied`;
        }
        requireMcp(
          data.scopes.every(scope => offered.includes(scope)),
          'invalid_scope'
        );
        requireMcp(selected.length > 0, 'MCP_CONSENT_NO_SCOPES');
        if (client.dynamicRegistration && !client.firstAuthorizedAt)
          await tx.mcpClient.update({
            where: { id: client.id },
            data: { firstAuthorizedAt: now },
          });
        const superseded = await tx.mcpGrant.findMany({
          where: supersededUnusedMcpGrantsWhere(actor.id, client),
          select: { id: true },
        });
        const grant = await tx.mcpGrant.create({
          data: {
            userId: actor.id,
            userTokenVersion: user.tokenVersion,
            userRevocationVersion: user.mcpRevocationVersion,
            clientId: client.id,
            scopes: selected,
            resource: mcpResource(),
            ...mcpSessionDates(now, policy?.sessionIdleDays),
          },
        });
        const approved = await tx.mcpDeviceAuthorization.updateMany({
          where: { id: pending.id, status: 'PENDING' },
          data: {
            status: 'APPROVED',
            grantId: grant.id,
            approvedScopes: selected,
            decidedAt: now,
          },
        });
        requireMcp(approved.count === 1, 'MCP_CONSENT_REPLAY');
        await logAudit(
          {
            source: 'UI',
            action: 'mcp.device.approved',
            entityType: 'SYSTEM_CONFIG',
            entityId: grant.id,
            actorId: actor.id,
            details: {
              scopes: selected,
              clientId: client.id,
              deviceAuthorizationId: pending.id,
              selectedScopeCount: selected.length,
              offeredScopeCount: offered.length,
              viewOnly: data.viewOnly,
              role: user.role,
            },
          },
          tx
        );
        if (superseded.length) {
          const ids = superseded.map(item => item.id);
          await tx.mcpGrant.updateMany({
            where: { id: { in: ids }, revokedAt: null },
            data: { revokedAt: now },
          });
          await logAudit(
            {
              source: 'UI',
              action: 'mcp.grant.superseded',
              entityType: 'SYSTEM_CONFIG',
              entityId: grant.id,
              actorId: actor.id,
              details: { clientId: client.id, supersededGrantIds: ids },
            },
            tx
          );
        }
        return `${DEVICE_PAGE}?done=approved`;
      },
      { isolationLevel: 'Serializable', timeout: 5000 }
    );
  } catch (error) {
    if (!(error instanceof McpBoundaryError)) throw error;
    location = `/oauth/mcp/consent/result?code=${encodeURIComponent(error.code)}`;
  }
  return redirect(location);
}
