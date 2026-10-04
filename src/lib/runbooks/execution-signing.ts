import 'server-only';
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import prisma from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/encryption';
import { canonicalEnvelope } from '../../../agent/src/envelope';

export async function getExecutionSigningKey() {
  const existing = await prisma.runbookExecutionSigningKey.findUnique({ where: { id: 'default' } });
  if (existing) return existing;
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
  const privateKey = createPrivateKey(await decrypt(key.privateKeyEncrypted));
  return {
    ...payload,
    signature: sign(null, Buffer.from(canonicalEnvelope(payload)), privateKey).toString('base64'),
  };
}
