import dotenv from 'dotenv';
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || undefined, override: false });
import { PrismaClient } from '@prisma/client';
import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { API_SCOPES } from '../../src/lib/authorization';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `[FATAL] Missing mandatory environment variable: ${name}. Configure it in .env or shell environment.`
    );
  }
  return value.trim();
}

const DATABASE_URL = requireEnv('DATABASE_URL');
const API_KEY_SECRET = requireEnv('API_KEY_SECRET');

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } },
});

function hashToken(token: string): string {
  return createHmac('sha256', API_KEY_SECRET).update(`opsknight:api-key:v2:${token}`).digest('hex');
}

async function main() {
  const admin =
    (await prisma.user.findFirst({ where: { email: 'cert-admin@opsknight.local' } })) ||
    (await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } }));
  if (!admin) throw new Error('Admin user not found');

  const allScopes = Object.values(API_SCOPES);
  const pool: string[] = [];

  for (let i = 1; i <= 30; i++) {
    const raw = randomBytes(24).toString('base64url');
    const token = `ok_admin_pool_${i}_${raw}`;
    const prefix = token.slice(0, 15);
    const tokenHash = hashToken(token);

    await prisma.apiKey.create({
      data: {
        name: `Cert Pool Token #${i}`,
        prefix,
        tokenHash,
        scopes: allScopes,
        userId: admin.id,
      },
    });
    pool.push(token);
  }

  const outPath = path.resolve('tests/certification/key-pool.json');
  fs.writeFileSync(outPath, JSON.stringify({ count: pool.length, tokens: pool }, null, 2));
  console.log(`Successfully minted and saved ${pool.length} tokens to ${outPath}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
