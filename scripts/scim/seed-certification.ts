import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const url = process.env.DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('/enterprise_scim_test'))
  throw new Error('SCIM certification requires the isolated enterprise_scim_test database.');
const email = process.env.SCIM_E2E_ADMIN_EMAIL;
const password = process.env.SCIM_E2E_ADMIN_PASSWORD;
if (!email || !password || password.length < 20)
  throw new Error(
    'Supply disposable SCIM_E2E_ADMIN_EMAIL and a test password of at least 20 characters.'
  );
const db = new PrismaClient();
async function main() {
  const passwordHash = await bcrypt.hash(password!, 12);
  const user = await db.user.upsert({
    where: { email },
    create: {
      email: email!,
      name: 'SCIM certifier',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash,
    },
    update: { role: 'ADMIN', status: 'ACTIVE', passwordHash },
  });
  await db.authenticationPolicy.upsert({
    where: { id: 'default' },
    create: { mode: 'PASSWORD_ONLY', legacySnapshot: {} },
    update: { mode: 'PASSWORD_ONLY' },
  });
  await db.team.upsert({
    where: { name: 'SCIM browser operational' },
    create: {
      name: 'SCIM browser operational',
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
    update: {},
  });
  console.log('Isolated SCIM browser fixture ready.');
}
main().finally(() => db.$disconnect());
