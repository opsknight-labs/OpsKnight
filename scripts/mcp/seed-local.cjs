'use strict';
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
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
})()
  .catch(() => {
    process.stderr.write('Local MCP browser fixture failed; use a fresh isolated database.\n');
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
