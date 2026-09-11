import { createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const BOOTSTRAP_CONFIG_KEY = 'auth.bootstrap.authorization';
const BOOTSTRAP_TTL_MS = 30 * 60 * 1000;
const BOOTSTRAP_ISSUE_ATTEMPTS = 4;
const BOOTSTRAP_LOCK_SQL =
  "SELECT pg_advisory_xact_lock(hashtext('auth.bootstrap.authorization'))";

const prisma = new PrismaClient();

function hashBootstrapCode(code) {
  return createHash('sha256').update(code).digest('hex');
}

function parseBootstrapState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (
    typeof value.tokenHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.tokenHash) ||
    typeof value.expiresAt !== 'string' ||
    (value.usedAt !== null && typeof value.usedAt !== 'string') ||
    typeof value.generation !== 'number' ||
    !Number.isInteger(value.generation)
  ) {
    return null;
  }

  const expiresAt = new Date(value.expiresAt);
  if (!Number.isFinite(expiresAt.getTime())) return null;
  return {
    tokenHash: value.tokenHash,
    expiresAt: value.expiresAt,
    usedAt: value.usedAt,
    generation: value.generation,
  };
}

function isSerializationConflict(error) {
  return Boolean(error && typeof error === 'object' && error.code === 'P2034');
}

async function issueBootstrapAuthorization() {
  for (let attempt = 1; attempt <= BOOTSTRAP_ISSUE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async tx => {
        // This explicit database lock makes issuance single-winner across every
        // application/container replica without relying on process-local state.
        await tx.$queryRawUnsafe(BOOTSTRAP_LOCK_SQL);

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
        const nextState = {
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
      });
    } catch (error) {
      if (isSerializationConflict(error) && attempt < BOOTSTRAP_ISSUE_ATTEMPTS) continue;
      throw error;
    }
  }

  throw new Error('Unable to establish bootstrap authorization safely');
}

async function main() {
  const issued = await issueBootstrapAuthorization();
  process.stdout.write('\nOpsKnight first-admin setup capability\n');
  process.stdout.write('Treat this value like a password. It will not be shown again.\n\n');
  process.stdout.write(`${issued.code}\n\n`);
  process.stdout.write(`Expires: ${issued.expiresAt.toISOString()}\n`);
}

main()
  .catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'SYSTEM_ALREADY_INITIALIZED') {
      process.stderr.write('OpsKnight is already initialized; no bootstrap capability was issued.\n');
    } else if (message === 'BOOTSTRAP_AUTHORIZATION_ALREADY_ACTIVE') {
      process.stderr.write(
        'A live bootstrap capability already exists. Use it or wait for it to expire before issuing another.\n'
      );
    } else {
      process.stderr.write(`Unable to issue bootstrap capability: ${message}\n`);
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
