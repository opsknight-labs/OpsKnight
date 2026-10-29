import { randomBytes } from 'node:crypto';
import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { etagHeaders, parseIfMatch } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { IntegrationCredentialRotateV2Schema } from '@/lib/api-v2/validation';
import { AppError } from '@/lib/errors';
import { decryptStoredSecret, encrypt } from '@/lib/encryption';
import { logV2Audit } from '@/lib/api-v2/audit';
import prisma from '@/lib/prisma';
import { integrationKeyFingerprint } from '@/lib/integrations/credentials';

const paramsSchema = z.object({ id: z.string().min(1) });
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INTEGRATION_READ,
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    const row = await prisma.integration.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        serviceId: true,
        revision: true,
        key: true,
        previousKeyExpiresAt: true,
        signatureSecret: true,
        previousSignatureSecretExpiresAt: true,
        updatedAt: true,
        service: { select: { teamId: true } },
      },
    });
    if (!row) throw new AppError({ code: 'INTEGRATION_NOT_FOUND' });
    const { enforceV2Authorization } = await import('@/lib/api-v2');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INTEGRATION_READ, {
      type: 'service',
      teamId: row.service.teamId,
    });
    return {
      data: {
        id: row.id,
        revision: row.revision,
        routingKeyConfigured: Boolean(row.key),
        signingSecretConfigured: Boolean(row.signatureSecret),
        previousRoutingKeyValidUntil: row.previousKeyExpiresAt,
        previousSignatureSecretValidUntil: row.previousSignatureSecretExpiresAt,
        updatedAt: row.updatedAt,
      },
      headers: { ...etagHeaders(row.revision), 'Cache-Control': 'no-store' },
    };
  },
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INTEGRATION_CREDENTIALS_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema: IntegrationCredentialRotateV2Schema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyPayload: ({ body, req }) => ({ body, ifMatch: req.headers.get('if-match') }),
  persistIdempotencyResult: result => {
    if (result instanceof Response || !result.data || typeof result.data !== 'object')
      throw new Error('Expected rotation result');
    return { ...result, data: { ...(result.data as object), secret: null } };
  },
  replayAuthGuard: async ({ params, actor, tx }) => {
    const row = await tx!.integration.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    const admin = await tx!.user.findFirst({
      where: { id: actor.id, role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!row || !admin) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  },
  handler: async ({ params, actor, apiKey, body, req, tx }) => {
    const expected = parseIfMatch(req);
    const current = await tx!.integration.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        serviceId: true,
        revision: true,
        key: true,
        keyFingerprint: true,
        signatureSecret: true,
        service: { select: { teamId: true } },
      },
    });
    if (!current) throw new AppError({ code: 'INTEGRATION_NOT_FOUND' });
    if (current.revision !== expected) throw new AppError({ code: 'PRECONDITION_FAILED' });
    const admin = await tx!.user.findFirst({
      where: { id: actor.id, role: 'ADMIN', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!admin) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
    const overlapUntil =
      body.overlapSeconds > 0 ? new Date(Date.now() + body.overlapSeconds * 1000) : null;
    const secret =
      body.credential === 'routing-key'
        ? randomBytes(32).toString('base64url')
        : randomBytes(32).toString('hex');
    const previousRoutingKey =
      body.credential === 'routing-key' && body.overlapSeconds > 0
        ? await encrypt(await decryptStoredSecret(current.key))
        : null;
    const previousSignatureSecret =
      body.credential === 'signature-secret' && body.overlapSeconds > 0 && current.signatureSecret
        ? await encrypt(await decryptStoredSecret(current.signatureSecret))
        : null;
    const updated = await tx!.integration.update({
      where: { id: params.id },
      data:
        body.credential === 'routing-key'
          ? {
              key: await encrypt(secret),
              keyFingerprint: integrationKeyFingerprint(secret),
              previousKey: previousRoutingKey,
              previousKeyFingerprint:
                body.overlapSeconds > 0
                  ? integrationKeyFingerprint(await decryptStoredSecret(current.key))
                  : null,
              previousKeyExpiresAt: overlapUntil && current.key ? overlapUntil : null,
            }
          : {
              signatureSecret: await encrypt(secret),
              previousSignatureSecret,
              previousSignatureSecretExpiresAt:
                overlapUntil && current.signatureSecret ? overlapUntil : null,
            },
      select: { revision: true, updatedAt: true },
    });
    await logV2Audit({
      action: 'integration.secret_rotated',
      entityType: 'SERVICE',
      entityId: current.serviceId,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: {
        integrationId: params.id,
        credential: body.credential,
        overlapSeconds: body.overlapSeconds,
        previousCredentialValidUntil: overlapUntil?.toISOString() ?? null,
      },
      tx,
    });
    return {
      data: {
        id: params.id,
        credential: body.credential,
        secret,
        revision: updated.revision,
        updatedAt: updated.updatedAt,
      },
      headers: { ...etagHeaders(updated.revision), 'Cache-Control': 'no-store' },
    };
  },
});
