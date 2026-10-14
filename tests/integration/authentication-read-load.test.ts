// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import prisma from '@/lib/prisma';
import { getAuthOptions } from '@/lib/auth';
import { getAuthenticationPolicy } from '@/lib/authentication-policy';
import { getOidcConfig } from '@/lib/oidc-config';
import { customJwtDecode } from '@/lib/auth-jwt-encoder';
vi.mock('@/lib/oidc-validation', () => ({
  getValidatedOidcRuntimeMetadata: vi.fn(async (issuer: string) => ({
    isValid: true,
    metadata: {
      issuer,
      authorizationEndpoint: `${issuer}/authorize`,
      tokenEndpoint: `${issuer}/token`,
      jwksUri: `${issuer}/jwks`,
    },
  })),
}));
const suite = process.env.SSO_CERT_AUTH_LOAD === '1' ? describe : describe.skip;
suite('isolated authentication database-read concurrency certification', () => {
  it('measures authoritative policy/provider/session reads with a bounded PostgreSQL pool', async () => {
    if (new URL(process.env.DATABASE_URL!).pathname !== '/enterprise_sso_upgrade_test')
      throw new Error('Upgrade fixture only.');
    const policy = await getAuthenticationPolicy();
    const config = await getOidcConfig();
    const existing = await customJwtDecode({
      token: process.env.SSO_UPGRADE_EXISTING_JWT!,
      secret: process.env.NEXTAUTH_SECRET!,
    });
    const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: 'upgrade-admin' } });
    const token = {
      ...existing!,
      tokenVersion: currentUser.tokenVersion,
      oidcConfigVersion: config!.configVersion,
      issuedUnderPolicyVersion: policy.version,
      authenticationPolicyVersion: policy.version,
      lastActivityAt: Date.now(),
      oidcAuthenticatedAt: Date.now(),
    };
    const results = [];
    let peakConnections = 0;
    let errors = 0;
    for (const profile of ['policy-provider', 'protected-session']) {
      for (const concurrency of [1, 10, 25, 50]) {
        const samples: number[] = [];
        let next = 0;
        const operations = 200;
        const start = performance.now();
        const cpuStart = process.cpuUsage();
        await Promise.all(
          Array.from({ length: concurrency }, async () => {
            while (next++ < operations) {
              const before = performance.now();
              try {
                const options = await getAuthOptions();
                if (profile === 'protected-session') {
                  const session = await options.callbacks!.jwt!({
                    token: { ...token },
                    user: undefined as never,
                    account: null,
                  });
                  if (session.sub !== 'upgrade-admin' || session.error)
                    throw new Error('Protected session failed.');
                } else {
                  if (!(await getAuthenticationPolicy()).mode)
                    throw new Error('Policy unavailable.');
                }
              } catch {
                errors++;
              }
              samples.push(performance.now() - before);
            }
          })
        );
        const durationMs = performance.now() - start;
        const cpu = process.cpuUsage(cpuStart);
        const pool = await prisma.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT COUNT(*)::bigint AS count FROM pg_stat_activity WHERE application_name = 'sso-auth-certification'`;
        peakConnections = Math.max(peakConnections, Number(pool[0].count));
        samples.sort((a, b) => a - b);
        const percentile = (percent: number) =>
          samples[Math.min(samples.length - 1, Math.ceil(samples.length * percent) - 1)];
        results.push({
          profile,
          concurrency,
          operations,
          succeeded: operations - errors,
          durationMs,
          operationsPerSecond: (operations * 1000) / durationMs,
          p50Ms: percentile(0.5),
          p95Ms: percentile(0.95),
          p99Ms: percentile(0.99),
          cpuMs: (cpu.user + cpu.system) / 1000,
          poolConnections: Number(pool[0].count),
        });
      }
    }
    expect(errors).toBe(0);
    expect(peakConnections).toBeLessThanOrEqual(5);
    mkdirSync('plans/certification', { recursive: true });
    const sources = [
      'src/lib/auth.ts',
      'src/lib/authentication-policy.ts',
      'src/lib/oidc-config.ts',
      'src/lib/oidc/registration.ts',
    ];
    const sourceHashes = Object.fromEntries(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed source inventory declared above, never user-supplied paths.
      sources.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')])
    );
    writeFileSync(
      'plans/certification/enterprise-sso-2.1-authentication-load.json',
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          node: process.version,
          platform: process.platform,
          poolLimit: 5,
          peakObservedConnections: peakConnections,
          errors,
          sourceHashes,
          results,
          scope:
            'Local warmed application callbacks and PostgreSQL reads. Provider metadata is an injected fixture. Does not measure external OAuth, bcrypt login, HTTP/TLS, production capacity or tail latency under production workload.',
        },
        null,
        2
      ) + '\n'
    );
  }, 120000);
});
