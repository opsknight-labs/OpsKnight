import { expect, it } from 'vitest';
import { intelligenceListenerUrl } from '@/lib/intelligence/jobs/wake-listener';

it('requires a session route behind a transaction pooler and removes Prisma-only URL options', () => {
  expect(
    intelligenceListenerUrl({ PGBOUNCER_ENABLED: 'true', DATABASE_URL: 'postgresql://db/app' })
  ).toBeUndefined();
  expect(
    intelligenceListenerUrl({ DATABASE_URL: 'postgresql://db/app?pgbouncer=true' })
  ).toBeUndefined();
  expect(
    intelligenceListenerUrl({
      DIRECT_DATABASE_URL:
        'postgresql://direct/app?schema=public&connection_limit=2&sslmode=require',
      PGBOUNCER_ENABLED: 'true',
      DATABASE_URL: 'postgresql://pool/app',
    })
  ).toBe('postgresql://direct/app?sslmode=require');
});
