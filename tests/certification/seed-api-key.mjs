// Seeds an ADMIN user and API key into the certification database and prints the token.
// Usage: DATABASE_URL=postgresql://opsknight:certification-only@127.0.0.1:55432/opsknight \
//        API_KEY_SECRET=... node seed-api-key.mjs
import { createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { PrismaClient } = require('@prisma/client');

const secret = process.env.API_KEY_SECRET;
if (!secret) throw new Error('API_KEY_SECRET is required (must match the application).');

const prisma = new PrismaClient();
const token = `ok_test_${randomBytes(32).toString('base64url')}`;
const user = await prisma.user.create({
  data: {
    email: `cert-admin-${Date.now()}@example.com`,
    name: 'Certification Admin',
    passwordHash: 'not-a-login',
    role: 'ADMIN',
    status: 'ACTIVE',
  },
});
await prisma.apiKey.create({
  data: {
    name: 'k6 certification',
    prefix: token.slice(0, 12),
    tokenHash: createHmac('sha256', secret).update(`opsknight:api-key:v2:${token}`).digest('hex'),
    scopes: ['admin:manage'],
    userId: user.id,
  },
});
console.log(token);
await prisma.$disconnect();
