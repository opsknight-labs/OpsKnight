import { PrismaClient } from '@prisma/client';
import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATABASE_URL = 'postgresql://opsknight:bf5efc57520313b61b4950d1ebf4f355@127.0.0.1:55490/opsknight?sslmode=disable';
const API_KEY_SECRET = 'd63f3fab7ed1d4bd07d921fac8ec8104b29f34e2587d62ccca2f6093a4f8934f';

const prisma = new PrismaClient({
  datasources: { db: { url: DATABASE_URL } }
});

function hashToken(token: string): string {
  return createHmac('sha256', API_KEY_SECRET)
    .update(`opsknight:api-key:v2:${token}`)
    .digest('hex');
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) throw new Error('Admin user not found');

  const pool: string[] = [];

  for (let i = 1; i <= 30; i++) {
    const raw = randomBytes(24).toString('base64url');
    const token = `ok_ltd_pool_${i}_${raw}`;
    const prefix = token.slice(0, 15);
    const tokenHash = hashToken(token);

    await prisma.apiKey.create({
      data: {
        name: `Cert Limited Pool Token #${i}`,
        prefix,
        tokenHash,
        scopes: ['incidents:read'],
        userId: admin.id
      }
    });
    pool.push(token);
  }

  const outPath = path.resolve('tests/certification/limited-pool.json');
  fs.writeFileSync(outPath, JSON.stringify({ count: pool.length, tokens: pool }, null, 2));
  console.log(`Successfully minted and saved ${pool.length} limited tokens to ${outPath}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
