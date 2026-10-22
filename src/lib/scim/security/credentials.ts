import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { runSerializableTransaction } from '@/lib/db-utils';
import { getControlActor, lockControlActor } from '@/lib/auth-control/actor';
import { consumeAuthRateLimit } from '@/lib/auth-abuse';
import { recordAuthFailure } from '../observability/metrics';
import { ScimFailure } from '../protocol/validation';

export const scopes = ['users:read', 'users:write', 'groups:read', 'groups:write'] as const;
export type ScimPrincipal = { connectorId: string; credentialId: string; scopes: string[] };
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
function matches(token: string, hash: string) {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

const admissionSecret = randomBytes(32);
const localAdmission = new Map<string, { count: number; until: number }>();
const invalidTokens = new Map<string, number>();
function negativeKey(authorization: string | null) {
  return createHmac('sha256', admissionSecret)
    .update((authorization ?? '').slice(0, 1024))
    .digest('hex');
}
function preauthenticate(authorization: string | null) {
  // Bounded process-local admission prevents repeated misses from touching PostgreSQL.
  // No raw bearer or reversible identifier is retained. Registry checks remain uncached.
  const key = createHmac('sha256', admissionSecret)
    .update((authorization ?? '').slice(0, 1024))
    .digest('hex');
  const now = Date.now();
  if (localAdmission.size >= 4096) {
    for (const [key, entry] of localAdmission) if (entry.until <= now) localAdmission.delete(key);
    // Evict history, never deny an unseen credential because unrelated keys filled the map.
    if (localAdmission.size >= 4096 && !localAdmission.has(key))
      localAdmission.delete(localAdmission.keys().next().value!);
  }
  const entry = localAdmission.get(key);
  if (entry && entry.until > now) {
    if (++entry.count > 1200)
      throw new ScimFailure(429, 'Credential admission limit exceeded. Retry in one minute.');
  } else localAdmission.set(key, { count: 1, until: now + 60000 });
}
function denied(connectorId: string, reason: string): null {
  recordAuthFailure(connectorId, reason);
  return null;
}

export async function authenticate(authorization: string | null): Promise<ScimPrincipal | null> {
  preauthenticate(authorization);
  const invalidKey = negativeKey(authorization);
  if ((invalidTokens.get(invalidKey) ?? 0) > Date.now())
    return denied('unknown', 'repeated_invalid');
  const match = /^Bearer ([^\s]{32,512})$/i.exec(authorization ?? '');
  if (!match) return denied('unknown', 'malformed');
  const token = match[1];
  // PostgreSQL is authoritative: outages must never enable another authentication lane.
  const credential = await prisma.scimCredential.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { connector: true },
  });
  if (credential) {
    if (
      !matches(token, credential.tokenHash) ||
      credential.revokedAt ||
      credential.expiresAt <= new Date() ||
      !credential.connector.enabled ||
      credential.connector.credentialAuthority !== 'REGISTRY'
    )
      return denied(credential.connectorId, 'inactive');
    if (!credential.lastUsedAt || credential.lastUsedAt.getTime() < Date.now() - 60000)
      await prisma.scimCredential.updateMany({
        where: {
          id: credential.id,
          OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(Date.now() - 60000) } }],
        },
        data: { lastUsedAt: new Date() },
      });
    return {
      connectorId: credential.connectorId,
      credentialId: credential.id,
      scopes: credential.scopes,
    };
  }
  const legacy = await prisma.scimConnector.findUnique({ where: { id: 'legacy' } });
  if (!legacy?.enabled || legacy.credentialAuthority !== 'LEGACY') {
    if (invalidTokens.size >= 4096) invalidTokens.delete(invalidTokens.keys().next().value!);
    invalidTokens.set(invalidKey, Date.now() + 5000);
    return denied('unknown', 'unknown_credential');
  }
  const record = await prisma.systemConfig.findUnique({ where: { key: 'scim_configuration' } });
  if (record) {
    const config = record.value as { enabled?: boolean; secretTokenHash?: string } | null;
    if (
      !config ||
      config.enabled !== true ||
      !config.secretTokenHash ||
      !matches(token, config.secretTokenHash)
    )
      return denied('legacy', 'invalid_database_token');
  } else {
    const env = process.env.SCIM_BEARER_TOKEN?.trim() ?? '';
    if (env.length < 32 || !matches(token, hashToken(env)))
      return denied('legacy', 'invalid_environment_token');
  }
  return { connectorId: 'legacy', credentialId: 'legacy', scopes: [...scopes] };
}
export async function authorize(request: Request, scope?: string) {
  const principal = await authenticate(request.headers.get('authorization'));
  if (!principal) throw new ScimFailure(401, 'Invalid, expired or revoked SCIM credential.');
  if (scope && !principal.scopes.includes(scope))
    throw new ScimFailure(403, `Credential requires ${scope} scope.`);
  const configured = Number(process.env.SCIM_CONNECTOR_REQUESTS_PER_MINUTE ?? 600);
  const requestsPerMinute = Number.isInteger(configured)
    ? Math.max(1, Math.min(configured, 1200))
    : 600;
  const limit = await consumeAuthRateLimit(
    'scim:connector',
    principal.connectorId,
    requestsPerMinute,
    60000
  );
  if (!limit.allowed)
    throw new ScimFailure(429, 'Connector request limit exceeded. Retry in one minute.');
  return principal;
}
/** Fence admission again inside the mutation transaction so revocation cannot race a write. */
export async function recheck(tx: Prisma.TransactionClient, principal: ScimPrincipal) {
  await tx.$queryRaw`SELECT id FROM "ScimConnector" WHERE id = ${principal.connectorId} FOR SHARE`;
  const connector = await tx.scimConnector.findUnique({ where: { id: principal.connectorId } });
  if (!connector?.enabled) throw new ScimFailure(401, 'Connector disabled.');
  if (principal.credentialId !== 'legacy') {
    await tx.$queryRaw`SELECT id FROM "ScimCredential" WHERE id = ${principal.credentialId} FOR SHARE`;
    const credential = await tx.scimCredential.findUnique({
      where: { id: principal.credentialId },
    });
    if (
      !credential ||
      credential.revokedAt ||
      credential.expiresAt <= new Date() ||
      connector.credentialAuthority !== 'REGISTRY'
    )
      throw new ScimFailure(401, 'Credential no longer active.');
  } else if (connector.credentialAuthority !== 'LEGACY')
    throw new ScimFailure(401, 'Legacy authentication retired.');
}
export async function createCredential(input: {
  connectorId: string;
  name: string;
  scopes: string[];
  lifetimeDays: number;
  overlapMinutes: number;
  acknowledgeLegacyCutover?: boolean;
}) {
  const actor = await getControlActor(true);
  if (actor.kind !== 'admin') throw new Error('Administrator sign-in required.');
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const credential = await runSerializableTransaction(async tx => {
    await lockControlActor(tx, actor);
    const connector = await tx.scimConnector.findUniqueOrThrow({
      where: { id: input.connectorId },
    });
    if (
      connector.id === 'legacy' &&
      connector.credentialAuthority === 'LEGACY' &&
      !input.acknowledgeLegacyCutover
    )
      throw new Error(
        'Administrator acknowledgement required for immediate retirement of the legacy token before creating a registry credential.'
      );
    const expiresAt = new Date(now.getTime() + input.lifetimeDays * 86400000);
    const overlapEnd = new Date(now.getTime() + input.overlapMinutes * 60000);
    await tx.scimCredential.updateMany({
      where: { connectorId: connector.id, revokedAt: null, expiresAt: { gt: overlapEnd } },
      data: { expiresAt: overlapEnd },
    });
    await tx.scimConnector.update({
      where: { id: connector.id },
      data: { credentialAuthority: 'REGISTRY' },
    });
    if (connector.id === 'legacy') {
      // Older replicas also see a disabled database record, fencing their env fallback.
      await tx.systemConfig.upsert({
        where: { key: 'scim_configuration' },
        create: {
          key: 'scim_configuration',
          value: { enabled: false, migratedToRegistry: true },
          updatedBy: actor.id,
        },
        update: { value: { enabled: false, migratedToRegistry: true }, updatedBy: actor.id },
      });
    }
    const generation =
      (await tx.scimCredential.count({ where: { connectorId: connector.id } })) + 1;
    const created = await tx.scimCredential.create({
      data: {
        connectorId: connector.id,
        name: input.name,
        tokenHash: hashToken(token),
        tokenHint: token.slice(-4),
        createdBy: actor.id,
        scopes: input.scopes,
        generation,
        expiresAt,
      },
    });
    await tx.scimEvent.create({
      data: {
        connectorId: connector.id,
        action: 'credential.created',
        resourceId: created.id,
        requestId: crypto.randomUUID(),
        details: { actorId: actor.id, generation, overlapMinutes: input.overlapMinutes },
      },
    });
    return created;
  });
  return {
    token,
    tokenHint: credential.tokenHint,
    id: credential.id,
    expiresAt: credential.expiresAt.toISOString(),
  };
}
export async function revokeCredential(id: string) {
  const actor = await getControlActor(true);
  if (actor.kind !== 'admin') throw new Error('Administrator sign-in required.');
  await runSerializableTransaction(async tx => {
    await lockControlActor(tx, actor);
    const credential = await tx.scimCredential.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await tx.scimEvent.create({
      data: {
        connectorId: credential.connectorId,
        action: 'credential.revoked',
        resourceId: id,
        requestId: crypto.randomUUID(),
        details: { actorId: actor.id },
      },
    });
  });
}
