import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const runIntegration = Boolean(process.env.VITEST_USE_REAL_DB);
const describeIntegration =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

import { resetDatabase, testPrisma } from '../helpers/test-db';

let issueBootstrapAuthorization: typeof import('@/lib/bootstrap-security').issueBootstrapAuthorization;
let getBootstrapAuthorizationStatus: typeof import('@/lib/bootstrap-security').getBootstrapAuthorizationStatus;
let parseBootstrapState: typeof import('@/lib/bootstrap-security').parseBootstrapState;
let hashBootstrapCode: typeof import('@/lib/bootstrap-security').hashBootstrapCode;
let BOOTSTRAP_CONFIG_KEY: typeof import('@/lib/bootstrap-security').BOOTSTRAP_CONFIG_KEY;

describeIntegration('Bootstrap authorization integration', () => {
  beforeAll(async () => {
    if (!runIntegration) return;
    vi.unmock('@/lib/prisma');
    vi.resetModules();
    ({
      issueBootstrapAuthorization,
      getBootstrapAuthorizationStatus,
      parseBootstrapState,
      hashBootstrapCode,
      BOOTSTRAP_CONFIG_KEY,
    } = await import('@/lib/bootstrap-security'));
  });

  beforeEach(async () => {
    if (!runIntegration) return;
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('allows exactly one of 20 concurrent explicit issuers to create the live capability', async () => {
    if (!runIntegration) return;

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => issueBootstrapAuthorization())
    );
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof issueBootstrapAuthorization>>> =>
        result.status === 'fulfilled'
    );
    const rejected = results.filter(result => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(19);

    const rows = await testPrisma.systemConfig.findMany({
      where: { key: BOOTSTRAP_CONFIG_KEY },
      select: { value: true },
    });
    expect(rows).toHaveLength(1);

    const state = parseBootstrapState(rows[0]?.value);
    expect(state).not.toBeNull();
    expect(state?.usedAt).toBeNull();
    expect(state?.generation).toBe(1);
    expect(state?.tokenHash).toBe(hashBootstrapCode(fulfilled[0].value.code));
    expect(new Date(state!.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const status = await getBootstrapAuthorizationStatus();
    expect(status.active).toBe(true);
    expect(status.generation).toBe(1);
  });

  it('does not rotate an already-live capability', async () => {
    if (!runIntegration) return;

    const issued = await issueBootstrapAuthorization();
    await expect(issueBootstrapAuthorization()).rejects.toThrow(
      'BOOTSTRAP_AUTHORIZATION_ALREADY_ACTIVE'
    );

    const row = await testPrisma.systemConfig.findUnique({
      where: { key: BOOTSTRAP_CONFIG_KEY },
      select: { value: true },
    });
    const state = parseBootstrapState(row?.value);
    expect(state?.tokenHash).toBe(hashBootstrapCode(issued.code));
  });
});
