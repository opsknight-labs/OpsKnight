import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma CLI 7 no longer reads .env files. Preserve the Prisma 5 lookup (project root, then
// prisma/) without overriding variables that are already set in the environment.
for (const file of ['.env', path.join('prisma', '.env')]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'ts-node --project tsconfig.seed.json prisma/seed.ts',
  },
  // Schema management (migrate, db execute, introspection) always uses DATABASE_URL, exactly as
  // the Prisma 5 schema did. docker-entrypoint.sh promotes DIRECT_DATABASE_URL into
  // DATABASE_URL first so migrations never run through a transaction pooler such as PgBouncer.
  // `prisma generate` needs no connection, so an unset URL is allowed here.
  datasource: {
    url: process.env.DATABASE_URL ?? '',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
