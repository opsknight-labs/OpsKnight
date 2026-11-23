import { createPrismaClient } from '../../src/lib/db/create-client';

const db = createPrismaClient();

/**
 * The sign-in throttle (`auth:credentials:*`, 10 per 15 minutes per account) is stored in
 * Postgres and shared by Chromium, Firefox and WebKit in one CI job, so WebKit's sign-ins were
 * blocked once the other browsers had used the window. Only those keys are cleared: the MCP
 * request quotas some specs exercise stay intact. Same approach as mobile-pwa.spec.ts.
 */
export async function clearSignInThrottle() {
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 'auth:credentials:' } } });
}
