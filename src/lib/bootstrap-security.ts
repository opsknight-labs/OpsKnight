import { createHash, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const BOOTSTRAP_CONFIG_KEY = 'auth.bootstrap.authorization';
export const BOOTSTRAP_TTL_MS = 30 * 60 * 1000;
const BOOTSTRAP_ISSUE_ATTEMPTS = 4;

export type BootstrapAuthorizationState = {
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  generation: number;
};

export type BootstrapAuthorizationStatus = {
  active: boolean;
  expiresAt: Date | null;
  generation: number | null;
};

export type IssuedBootstrapAuthorization = {
  code: string;
  expiresAt: Date;
  generation: number;
};

export function hashBootstrapCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function parseBootstrapState(value: unknown): BootstrapAuthorizationState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.tokenHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.tokenHash) ||
    typeof record.expiresAt !== 'string' ||
    (record.usedAt !== null && typeof record.usedAt !== 'string') ||
    typeof record.generation !== 'number' ||
    !Number.isInteger(record.generation)
  ) {
    return null;
  }
  const expiresAt = new Date(record.expiresAt);
  if (!Number.isFinite(expiresAt.getTime())) return null;
  return {
    tokenHash: record.tokenHash,
    expiresAt: record.expiresAt,
    usedAt: record.usedAt as string | null,
    generation: record.generation,
  };
}

function isBootstrapWriteConflict(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'P2002' || error.code === 'P2034')
  );
}

export async function getBootstrapAuthorizationStatus(): Promise<BootstrapAuthorizationStatus> {
  const row = await prisma.systemConfig.findUnique({
    where: { key: BOOTSTRAP_CONFIG_KEY },
    select: { value: true },
  });
  const state = parseBootstrapState(row?.value);
  if (!state || state.usedAt || new Date(state.expiresAt) <= new Date()) {
    return { active: false, expiresAt: null, generation: state?.generation ?? null };
  }
  return {
    active: true,
    expiresAt: new Date(state.expiresAt),
    generation: state.generation,
  };
}

/**
 * Issue the first-admin bootstrap capability. The raw capability is returned
 * only to the explicit CLI caller; only its SHA-256 digest is stored.
 * Application/server logs never receive the plaintext capability.
 *
 * A live capability is never silently rotated: concurrent CLI callers race
 * under SERIALIZABLE isolation and exactly one issuer wins. The others fail
 * closed so no operator is handed a secret that was immediately superseded.
 */
export async function issueBootstrapAuthorization(): Promise<IssuedBootstrapAuthorization> {
  let result: IssuedBootstrapAuthorization | null = null;

  for (let attempt = 1; attempt <= BOOTSTRAP_ISSUE_ATTEMPTS; attempt += 1) {
    try {
      result = await prisma.$transaction(
        async tx => {
          if ((await tx.user.count()) > 0) {
            throw new Error('SYSTEM_ALREADY_INITIALIZED');
          }

          const now = new Date();
          const existingRow = await tx.systemConfig.findUnique({
            where: { key: BOOTSTRAP_CONFIG_KEY },
            select: { value: true },
          });
          const existing = parseBootstrapState(existingRow?.value);
          if (existing && !existing.usedAt && new Date(existing.expiresAt) > now) {
            throw new Error('BOOTSTRAP_AUTHORIZATION_ALREADY_ACTIVE');
          }

          const code = randomBytes(24).toString('base64url');
          const expiresAt = new Date(now.getTime() + BOOTSTRAP_TTL_MS);
          const nextState: BootstrapAuthorizationState = {
            tokenHash: hashBootstrapCode(code),
            expiresAt: expiresAt.toISOString(),
            usedAt: null,
            generation: (existing?.generation ?? 0) + 1,
          };

          if (existingRow) {
            await tx.systemConfig.update({
              where: { key: BOOTSTRAP_CONFIG_KEY },
              data: { value: nextState, updatedBy: null },
            });
          } else {
            await tx.systemConfig.create({
              data: { key: BOOTSTRAP_CONFIG_KEY, value: nextState },
            });
          }

          return { code, expiresAt, generation: nextState.generation };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      break;
    } catch (error) {
      if (isBootstrapWriteConflict(error) && attempt < BOOTSTRAP_ISSUE_ATTEMPTS) continue;
      throw error;
    }
  }

  if (!result) throw new Error('Unable to establish bootstrap authorization safely');

  logger.warn('auth.bootstrap.authorization_issued', {
    component: 'bootstrap-security',
    generation: result.generation,
    expiresAt: result.expiresAt.toISOString(),
    delivery: 'explicit-cli-only',
  });
  return result;
}

/**
 * Compatibility/status helper for setup rendering. It deliberately does not
 * create a secret: issuance must be an explicit operator CLI action.
 */
export async function ensureBootstrapAuthorization(): Promise<{ expiresAt: Date }> {
  const status = await getBootstrapAuthorizationStatus();
  if (!status.active || !status.expiresAt) {
    throw new Error('BOOTSTRAP_AUTHORIZATION_NOT_ISSUED');
  }
  return { expiresAt: status.expiresAt };
}
