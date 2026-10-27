'use strict';
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { createHash } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL ?? '');
if (
  url.pathname !== '/opsknight_mcp_browser_test' ||
  !['localhost', '127.0.0.1'].includes(url.hostname)
)
  throw new Error('Only the dedicated local MCP browser database may be seeded');
const db = new PrismaClient();
(async () => {
  const origin = process.env.MCP_E2E_BASE_URL ?? 'http://localhost:3042';
  if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
    throw new Error('Local browser origin required');
  if (await db.user.count()) throw new Error('Browser fixture requires a fresh empty database');
  await db.systemSettings.create({ data: { id: 'default', appUrl: origin } });
  await db.authenticationPolicy.create({
    data: { id: 'default', mode: 'PASSWORD_ONLY', legacySnapshot: {} },
  });
  await db.user.create({
    data: {
      id: 'mcp-browser-admin',
      email: 'mcp-admin@example.test',
      name: 'MCP browser admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: await bcrypt.hash('Local-only MCP browser fixture passphrase 2026', 12),
    },
  });
  await db.user.create({
    data: {
      id: 'mcp-browser-reviewer',
      email: 'mcp-reviewer@example.test',
      name: 'MCP browser reviewer',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: await bcrypt.hash('Local-only MCP browser fixture passphrase 2026', 12),
    },
  });
  const definition = {
    steps: [
      {
        key: 'wait',
        name: 'Wait briefly',
        type: 'WAIT',
        riskClass: 'READ_ONLY',
        requiresApproval: true,
        config: { durationSeconds: 1 },
      },
    ],
  };
  const sorted = value =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, sorted(v)])
          )
        : value;
  const runbook = await db.runbook.create({
    data: {
      id: 'cmcpbrowserrunbook000000001',
      name: 'Local reviewed runbook',
      slug: 'local-reviewed-runbook',
      createdById: 'mcp-browser-admin',
    },
  });
  const version = await db.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'PUBLISHED',
      definition,
      checksum: createHash('sha256')
        .update(JSON.stringify(sorted(definition)))
        .digest('hex'),
      publishedById: 'mcp-browser-admin',
      publishedAt: new Date(),
    },
  });
  await db.runbook.update({ where: { id: runbook.id }, data: { publishedVersionId: version.id } });
})()
  .catch(() => {
    process.stderr.write('Local MCP browser fixture failed; use a fresh isolated database.\n');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
