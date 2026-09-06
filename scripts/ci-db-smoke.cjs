/**
 * DB Smoke Test (CI)
 *
 * Runs after `prisma migrate deploy` to catch schema/runtime drift early.
 * Keeps scope intentionally small and fast.
 *
 * Usage:
 *   node scripts/ci-db-smoke.cjs
 *
 * Requires:
 *   DATABASE_URL env var set
 */

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function ensureReportsDir() {
  const dir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJUnit({ ok, durationMs, message, details }) {
  const reportsDir = ensureReportsDir();
  const outPath = path.join(reportsDir, 'ci-db-smoke.xml');
  const tests = 1;
  const failures = ok ? 0 : 1;
  const timeSec = (durationMs / 1000).toFixed(3);

  const systemOut = details ? `      <system-out>${escapeXml(details)}</system-out>` : '';
  const failureBlock = ok
    ? ''
    : `      <failure message="${escapeXml(message || 'DB smoke test failed')}">${escapeXml(
        details || ''
      )}</failure>`;

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${tests}" failures="${failures}" errors="0" skipped="0">`,
    `  <testsuite name="ci-db-smoke" tests="${tests}" failures="${failures}" errors="0" skipped="0" time="${timeSec}">`,
    `    <testcase name="ci-db-smoke" time="${timeSec}">`,
    failureBlock,
    systemOut,
    '    </testcase>',
    '  </testsuite>',
    '</testsuites>',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  fs.writeFileSync(outPath, xml, 'utf8');
}

async function main() {
  requireEnv('DATABASE_URL');

  const prisma = new PrismaClient();
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `ci-smoke-${runId}@example.com`.toLowerCase();
  const startedAt = Date.now();

  try {
    // 1) Basic connectivity
    await prisma.$queryRaw`SELECT 1`;

    // 2) Create a user (minimal required fields)
    const user = await prisma.user.create({
      data: {
        name: 'CI Smoke',
        email,
        status: 'ACTIVE',
        role: 'USER',
      },
      select: { id: true, email: true },
    });

    // 3) Create + read a UserToken (hashed token only)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await prisma.userToken.create({
      data: {
        identifier: user.email,
        type: 'PASSWORD_RESET',
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        metadata: { smoke: true },
      },
    });

    const tokenRow = await prisma.userToken.findFirst({
      where: {
        tokenHash,
        type: 'PASSWORD_RESET',
        usedAt: null,
      },
      select: { tokenHash: true, identifier: true },
    });

    if (!tokenRow) {
      throw new Error('Smoke test failed: userToken row not readable after create');
    }

    // 4) Mark token used (one-time semantics)
    await prisma.userToken.update({
      where: { tokenHash },
      data: { usedAt: new Date() },
    });

    // 5) Cleanup
    await prisma.userToken.deleteMany({ where: { identifier: user.email } });
    await prisma.user.delete({ where: { id: user.id } });

    writeJUnit({
      ok: true,
      durationMs: Date.now() - startedAt,
      message: 'OK',
      details: `[ci-db-smoke] OK (user=${user.id})`,
    });
    console.log('[ci-db-smoke] OK');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[ci-db-smoke] FAILED');
  console.error(err);
  try {
    writeJUnit({
      ok: false,
      durationMs: 0,
      message: err instanceof Error ? err.message : 'Unknown error',
      details: err instanceof Error ? err.stack : String(err),
    });
  } catch {}
  process.exit(1);
});

