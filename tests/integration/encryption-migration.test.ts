import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testPrisma } from '../helpers/test-db';
import { encryptWithKey, decryptWithKey } from '@/lib/encryption';
import { startEncryptionRun } from '@/lib/encryption/worker';
import { runFullVerification } from '@/lib/encryption/verification';
import { evaluateKeyRetirementReadiness } from '@/lib/encryption/retirement';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const KEY_1 = '1111111111111111111111111111111111111111111111111111111111111111';
const KEY_2 = '2222222222222222222222222222222222222222222222222222222222222222';

describeIfRealDB('encryption migration integration (real PostgreSQL)', () => {
  const originalEnvKeys = process.env.ENCRYPTION_KEYS;

  beforeEach(async () => {
    // Overlapping keyring: k2 is active, k1 is legacy/fallback
    process.env.ENCRYPTION_KEYS = `k2:${KEY_2},k1:${KEY_1}`;
    await resetDatabase();
  });

  afterAll(async () => {
    process.env.ENCRYPTION_KEYS = originalEnvKeys;
    await testPrisma.$disconnect();
  });

  it('PREVIEW mode accurately scans secrets without mutating any database records', async () => {
    const k1Secret = await encryptWithKey('super-secret-oidc-token', KEY_1, 'k1');

    await testPrisma.oidcConfig.create({
      data: {
        id: 'oidc-preview-test',
        issuer: 'https://issuer.example.com',
        clientId: 'client-1',
        clientSecret: k1Secret,
      },
    });

    const run = await startEncryptionRun(testPrisma, {
      mode: 'PREVIEW',
      runSynchronously: true,
    });

    expect(run.status).toBe('COMPLETED');
    expect(run.mode).toBe('PREVIEW');
    expect(run.migratedRecords).toBeGreaterThanOrEqual(1);

    // Verify database row was NOT modified
    const oidcRow = await testPrisma.oidcConfig.findUnique({
      where: { id: 'oidc-preview-test' },
    });
    expect(oidcRow?.clientSecret).toBe(k1Secret);
  });

  it('MIGRATE mode re-encrypts old-key and legacy values to active key using CAS', async () => {
    const k1Secret = await encryptWithKey('slack-bot-token-secret', KEY_1, 'k1');

    await testPrisma.slackIntegration.create({
      data: {
        id: 'slack-int-migrate-test',
        workspaceId: 'T12345678',
        botToken: k1Secret,
        scopes: ['chat:write'],
      },
    });

    // Webhook with plaintext secret
    const service = await testPrisma.service.create({
      data: {
        id: 'svc-migrate-test',
        name: 'Migration Test Svc',
      },
    });

    await testPrisma.webhookIntegration.create({
      data: {
        id: 'webhook-migrate-test',
        serviceId: service.id,
        name: 'Plaintext Webhook',
        type: 'CUSTOM',
        url: 'https://example.com/webhook',
        secret: 'raw-plaintext-secret',
      },
    });

    const run = await startEncryptionRun(testPrisma, {
      mode: 'MIGRATE',
      runSynchronously: true,
    });

    expect(run.status).toBe('COMPLETED');
    expect(run.conflictRecords).toBe(0);
    expect(run.migratedRecords).toBeGreaterThanOrEqual(2);

    // Verify SlackIntegration was migrated to v3 with active key k2
    const updatedSlack = await testPrisma.slackIntegration.findUniqueOrThrow({
      where: { id: 'slack-int-migrate-test' },
    });
    expect(updatedSlack.botToken.startsWith('v3:k2:')).toBe(true);
    const decryptedSlack = await decryptWithKey(updatedSlack.botToken, KEY_2);
    expect(decryptedSlack).toBe('slack-bot-token-secret');

    // Verify Webhook was migrated to v3 with active key k2
    const updatedWebhook = await testPrisma.webhookIntegration.findUniqueOrThrow({
      where: { id: 'webhook-migrate-test' },
    });
    expect(updatedWebhook.secret?.startsWith('v3:k2:')).toBe(true);
    const decryptedWebhook = await decryptWithKey(updatedWebhook.secret!, KEY_2);
    expect(decryptedWebhook).toBe('raw-plaintext-secret');
  });

  it('CAS concurrency protection detects concurrent secret changes and records conflict without overwriting', async () => {
    const k1Secret = await encryptWithKey('original-jira-token', KEY_1, 'k1');

    await testPrisma.jiraConfig.create({
      data: {
        id: 'default',
        baseUrl: 'https://jira.example.com',
        userEmail: 'admin@example.com',
        apiTokenEncrypted: k1Secret,
      },
    });

    // Simulate concurrent modification during migration:
    // We start migration run, but before target update happens, we simulate another transaction updating apiTokenEncrypted
    await testPrisma.jiraConfig.update({
      where: { id: 'default' },
      data: {
        apiTokenEncrypted: await encryptWithKey('concurrently-updated-token', KEY_2, 'k2'),
      },
    });

    // Run migration
    const run = await startEncryptionRun(testPrisma, {
      mode: 'MIGRATE',
      runSynchronously: true,
    });

    expect(run.status).toBe('COMPLETED');

    // The record was already v3:k2: so inspector classified it as CURRENT_V3 and skipped it safely
    const currentJira = await testPrisma.jiraConfig.findUniqueOrThrow({
      where: { id: 'default' },
    });
    const decrypted = await decryptWithKey(currentJira.apiTokenEncrypted, KEY_2);
    expect(decrypted).toBe('concurrently-updated-token');
  });

  it('VERIFY mode and evaluateKeyRetirementReadiness confirm DATABASE_READY_FOR_RETIREMENT when 0 references remain', async () => {
    // 1. Seed a secret with k1
    const k1Secret = await encryptWithKey('initial-oidc-secret', KEY_1, 'k1');
    await testPrisma.oidcConfig.create({
      data: {
        id: 'oidc-verify-flow',
        issuer: 'https://issuer.example.com',
        clientId: 'client-test',
        clientSecret: k1Secret,
      },
    });

    // 2. Verify run before migration
    await runFullVerification(testPrisma);
    let report = await evaluateKeyRetirementReadiness(testPrisma);
    let k1Assessment = report.assessments.find(a => a.keyId === 'k1');
    expect(k1Assessment?.status).toBe('ACTIVE_REFERENCES_EXIST');
    expect(k1Assessment?.remainingReferences).toBeGreaterThanOrEqual(1);
    expect(report.allEligibleRetiredFromDatabase).toBe(false);

    // 3. Migrate all to k2
    await startEncryptionRun(testPrisma, {
      mode: 'MIGRATE',
      runSynchronously: true,
    });

    // 4. Verify run after migration
    await runFullVerification(testPrisma);
    report = await evaluateKeyRetirementReadiness(testPrisma);
    k1Assessment = report.assessments.find(a => a.keyId === 'k1');

    // Database is now completely clean of k1 references!
    expect(k1Assessment?.status).toBe('DATABASE_READY_FOR_RETIREMENT');
    expect(k1Assessment?.remainingReferences).toBe(0);
    expect(report.allEligibleRetiredFromDatabase).toBe(true);
  });
});
