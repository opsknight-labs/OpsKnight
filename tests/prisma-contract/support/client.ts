/* eslint-disable security/detect-object-injection -- keys are fixed scenario names, array indices or test-owned object keys, never external input */
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '@/lib/db/create-client';

/**
 * The only stage-specific file in the contract suite: how a PrismaClient is built
 * from an OpsKnight DATABASE_URL. Test bodies and goldens never change per stage.
 */
const clients = new Set<PrismaClient>();

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Run: eval "$(tests/prisma-contract/infra/up.sh)"`);
  }
  return value;
}

export function withParams(url: string, params: Record<string, string | undefined>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) parsed.searchParams.delete(key);
    else parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

export function createContractClient(url: string): PrismaClient {
  const client: PrismaClient = createPrismaClient({ url });
  clients.add(client);
  return client;
}

export async function disconnectContractClients(): Promise<void> {
  await Promise.allSettled([...clients].map(client => client.$disconnect()));
  clients.clear();
}
