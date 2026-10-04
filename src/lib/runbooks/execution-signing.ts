import 'server-only';
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { decrypt, encrypt } from '@/lib/encryption';
import { canonicalEnvelope } from '../../../agent/src/envelope';

let parsedKeyCache: { fingerprint: string; privateKey: KeyObject } | undefined;

export class RunbookSigningRotationError extends Error {}

export async function getExecutionSigningKey() {
  const existing = await prisma.runbookExecutionSigningKey.findUnique({ where: { id: 'default' } });
  if (existing?.state === 'ACTIVE') return existing;
  const active = await prisma.runbookExecutionSigningKey.findFirst({ where: { state: 'ACTIVE' } });
  if (active) return active;
  if (existing) throw new Error('No active Runbook signing identity.');
  const keys = generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const privateKeyEncrypted = await encrypt(
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  );
  try {
    return await prisma.runbookExecutionSigningKey.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default', publicKey, privateKeyEncrypted },
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'P2002') throw error;
    return prisma.runbookExecutionSigningKey.findUniqueOrThrow({ where: { id: 'default' } });
  }
}

export async function signExecutionEnvelope<T extends object>(payload: T) {
  const key = await getExecutionSigningKey();
  // Re-read the row so key replacement/rewrapping invalidates immediately. Include the
  // encryption configuration so retiring a required key cannot be masked by this cache.
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        key.id,
        key.publicKey,
        key.privateKeyEncrypted,
        process.env.ENCRYPTION_KEYS,
        process.env.ENCRYPTION_KEY,
        process.env.NODE_ENV,
      ])
    )
    .digest('hex');
  let privateKey =
    parsedKeyCache?.fingerprint === fingerprint ? parsedKeyCache.privateKey : undefined;
  if (!privateKey) {
    parsedKeyCache = undefined;
    privateKey = createPrivateKey(await decrypt(key.privateKeyEncrypted));
    parsedKeyCache = { fingerprint, privateKey };
  }
  return {
    ...payload,
    signingKeyId: key.id,
    signature: sign(
      null,
      Buffer.from(canonicalEnvelope({ ...payload, signingKeyId: key.id })),
      privateKey
    ).toString('base64'),
  };
}

export async function stageExecutionSigningKey(actorId: string) {
  const keys = generateKeyPairSync('ed25519');
  const privateKeyEncrypted = await encrypt(
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  );
  await getExecutionSigningKey();
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('runbook-signing-rotation'))`;
    if (await tx.runbookExecutionSigningKey.findFirst({ where: { state: 'NEXT' } }))
      throw new RunbookSigningRotationError('A next signing identity already exists.');
    if ((await tx.runbookExecutionSigningKey.count({ where: { state: { not: 'RETIRED' } } })) >= 8)
      throw new RunbookSigningRotationError(
        'Retire an older identity before staging another; Agents support at most eight pins.'
      );
    const next = await tx.runbookExecutionSigningKey.create({
      data: {
        id: crypto.randomUUID(),
        state: 'NEXT',
        publicKey: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
        privateKeyEncrypted,
      },
    });
    await logAudit(
      { action: 'runbook.signing.staged', entityType: 'SYSTEM_CONFIG', entityId: next.id, actorId },
      tx
    );
    return { id: next.id, publicKey: next.publicKey };
  });
}

export async function activateExecutionSigningKey(keyId: string, actorId?: string) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('runbook-signing-rotation'))`;
    const next = await tx.runbookExecutionSigningKey.findFirst({
      where: { id: keyId, state: 'NEXT' },
    });
    if (!next)
      throw new RunbookSigningRotationError('Signing identity must be NEXT before activation.');
    const active = await tx.runbookExecutionSigningKey.findFirstOrThrow({
      where: { state: 'ACTIVE' },
      select: { id: true },
    });
    const agents = await tx.runbookAgent.findMany({
      where: { status: { notIn: ['REVOKED', 'ENROLLING'] } },
      select: { trustedSigningKeys: true },
    });
    if (
      agents.some(
        agent =>
          !Array.isArray(agent.trustedSigningKeys) ||
          !agent.trustedSigningKeys.includes(keyId) ||
          !agent.trustedSigningKeys.includes(active.id)
      )
    )
      throw new RunbookSigningRotationError(
        'Every enrolled Agent, including offline Agents, must acknowledge the NEXT trusted key.'
      );
    await tx.runbookExecutionSigningKey.updateMany({
      where: { state: 'ACTIVE' },
      data: { state: 'RETIRING', retiredAt: new Date(Date.now() + 86400000) },
    });
    await tx.runbookExecutionSigningKey.update({
      where: { id: keyId },
      data: { state: 'ACTIVE', activatedAt: new Date() },
    });
    if (actorId)
      await logAudit(
        {
          action: 'runbook.signing.activate',
          entityType: 'SYSTEM_CONFIG',
          entityId: keyId,
          actorId,
        },
        tx
      );
  });
}

export async function retireExecutionSigningKey(keyId: string, actorId?: string) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('runbook-signing-rotation'))`;
    const changed = await tx.runbookExecutionSigningKey.updateMany({
      where: { id: keyId, state: 'RETIRING', retiredAt: { lte: new Date() } },
      data: { state: 'RETIRED', retiredAt: new Date() },
    });
    if (changed.count !== 1)
      throw new RunbookSigningRotationError(
        'Signing identity retirement requires RETIRING state and a completed 24-hour grace period.'
      );
    if (actorId)
      await logAudit(
        { action: 'runbook.signing.retire', entityType: 'SYSTEM_CONFIG', entityId: keyId, actorId },
        tx
      );
  });
}
