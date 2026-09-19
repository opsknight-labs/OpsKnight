import crypto from 'crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, testPrisma } from '../helpers/test-db';
import { encryptWithKey, decryptWithKey, decrypt } from '@/lib/encryption';
import { startEncryptionRun } from '@/lib/encryption/worker';
import { executeMigrationRun } from '@/lib/encryption/migration';
import { runFullVerification } from '@/lib/encryption/verification';
import { evaluateKeyRetirementReadiness } from '@/lib/encryption/retirement';
import { ENCRYPTION_TARGETS, computeRegistryFingerprint } from '@/lib/encryption/registry';
import { decryptProviderConfig } from '@/lib/encrypted-provider-config';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const KEY_1 = '1111111111111111111111111111111111111111111111111111111111111111';
const KEY_2 = '2222222222222222222222222222222222222222222222222222222222222222';

describeIfRealDB('encryption migration integration (real PostgreSQL)', () => {
  const originalEnvKeys = process.env.ENCRYPTION_KEYS;
  let testUser: { id: string };

  beforeEach(async () => {
    // Overlapping keyring: k2 is active, k1 is legacy/fallback
    process.env.ENCRYPTION_KEYS = `k2:${KEY_2},k1:${KEY_1}`;
    await resetDatabase();

    // Create admin user to satisfy NOT NULL constraints and foreign keys on config tables
    testUser = await testPrisma.user.create({
      data: {
        id: 'test-admin-user',
        name: 'Test Admin',
        email: 'admin-migration-test@example.com',
        role: 'ADMIN',
      },
    });
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
        updatedBy: testUser.id,
      },
    });

    const run = await startEncryptionRun(testPrisma, {
      mode: 'PREVIEW',
      runSynchronously: true,
    });

    expect(run.status).toBe('COMPLETED');
    expect(run.mode).toBe('PREVIEW');
    // In PREVIEW, migratedRecords is 0 because no records are modified
    expect(run.migratedRecords).toBe(0);
    expect(run.processedRecords).toBeGreaterThanOrEqual(1);

    // Verify database row was NOT modified
    const oidcRow = await testPrisma.oidcConfig.findUnique({
      where: { id: 'oidc-preview-test' },
    });
    expect(oidcRow?.clientSecret).toBe(k1Secret);

    // Verify preview persisted format breakdown in inspectionStats
    const oidcState = await testPrisma.encryptionMigrationTargetState.findFirstOrThrow({
      where: { runId: run.id, targetId: 'oidc.client-secret' },
    });
    const stats = oidcState.inspectionStats as Record<string, number>;
    expect(stats).toBeDefined();
    expect(stats.oldKeyV3).toBe(1);
    expect(stats.currentV3).toBe(0);
    expect(stats.plaintext).toBe(0);
    expect(stats.unreadable).toBe(0);
  });

  it('MIGRATE mode re-encrypts old-key and legacy values to active key using CAS', async () => {
    const k1Secret = await encryptWithKey('slack-bot-token-secret', KEY_1, 'k1');

    await testPrisma.slackIntegration.create({
      data: {
        id: 'slack-int-migrate-test',
        workspaceId: 'T12345678',
        botToken: k1Secret,
        scopes: ['chat:write'],
        installedBy: testUser.id,
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
        updatedBy: testUser.id,
      },
    });

    const run = await testPrisma.encryptionMigrationRun.create({
      data: {
        mode: 'MIGRATE',
        status: 'PENDING',
        registryFingerprint: computeRegistryFingerprint(ENCRYPTION_TARGETS),
        activeKeyId: 'k2',
        initiatedById: testUser.id,
      },
    });

    // Execute migration run with race interceptor:
    // Concurrently mutate the row in the DB while migration is in-flight, before CAS update executes
    await executeMigrationRun({
      runId: run.id,
      prisma: testPrisma,
      _beforeCasUpdate: async (targetId, recordId) => {
        if (targetId === 'jira.api-token' && recordId === 'default') {
          await testPrisma.jiraConfig.update({
            where: { id: 'default' },
            data: {
              apiTokenEncrypted: await encryptWithKey('concurrently-modified-token', KEY_2, 'k2'),
            },
          });
        }
      },
    });

    const completedRun = await testPrisma.encryptionMigrationRun.findUniqueOrThrow({
      where: { id: run.id },
    });

    expect(completedRun.status).toBe('COMPLETED');
    expect(completedRun.conflictRecords).toBe(1);

    // Verify the concurrent modification was preserved and NOT overwritten by the migration CAS
    const currentJira = await testPrisma.jiraConfig.findUniqueOrThrow({
      where: { id: 'default' },
    });
    const decrypted = await decryptWithKey(currentJira.apiTokenEncrypted, KEY_2);
    expect(decrypted).toBe('concurrently-modified-token');
  });

  it('VERIFY mode and evaluateKeyRetirementReadiness confirm DATABASE_READY_FOR_RETIREMENT when 0 references remain', async () => {
    // 1. Seed OidcConfig with k1
    const k1Secret = await encryptWithKey('initial-oidc-secret', KEY_1, 'k1');
    await testPrisma.oidcConfig.create({
      data: {
        id: 'oidc-verify-flow',
        issuer: 'https://issuer.example.com',
        clientId: 'client-test',
        clientSecret: k1Secret,
        updatedBy: testUser.id,
      },
    });

    // Seed NotificationProvider with nested VAPID key history using k1
    await testPrisma.notificationProvider.create({
      data: {
        id: 'np-webpush-verify',
        provider: 'web-push',
        enabled: true,
        config: {
          vapidPrivateKey: 'enc:' + (await encryptWithKey('primary-vapid-key', KEY_1, 'k1')),
          vapidKeyHistory: [
            {
              keyId: 'v1',
              privateKey: 'enc:' + (await encryptWithKey('history-vapid-key', KEY_1, 'k1')),
            },
          ],
        },
      },
    });

    // 2. Verify run before migration detects k1 references
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

  it('post-migration key removal: all records decrypt after k1 is removed from environment', async () => {
    // Seed representative records with k1
    const k1Oidc = await encryptWithKey('oidc-removal-secret', KEY_1, 'k1');
    await testPrisma.oidcConfig.create({
      data: {
        id: 'oidc-removal-test',
        issuer: 'https://issuer.example.com',
        clientId: 'client-removal',
        clientSecret: k1Oidc,
        updatedBy: testUser.id,
      },
    });

    const k1Slack = await encryptWithKey('xoxb-removal-token', KEY_1, 'k1');
    await testPrisma.slackIntegration.create({
      data: {
        id: 'slack-removal-test',
        workspaceId: 'T_REMOVAL',
        botToken: k1Slack,
        scopes: ['chat:write'],
        installedBy: testUser.id,
      },
    });

    await testPrisma.notificationProvider.create({
      data: {
        id: 'np-webpush-removal',
        provider: 'web-push',
        enabled: true,
        config: {
          vapidPrivateKey: 'enc:' + (await encryptWithKey('active-vapid-key', KEY_1, 'k1')),
          vapidKeyHistory: [
            {
              keyId: 'hist-1',
              privateKey: 'enc:' + (await encryptWithKey('retired-vapid-key', KEY_1, 'k1')),
            },
          ],
        },
      },
    });

    // Run Migration
    const migrateRun = await startEncryptionRun(testPrisma, {
      mode: 'MIGRATE',
      runSynchronously: true,
    });
    expect(migrateRun.status).toBe('COMPLETED');

    // Run Verification
    await runFullVerification(testPrisma);
    const report = await evaluateKeyRetirementReadiness(testPrisma);
    const k1Assessment = report.assessments.find(a => a.keyId === 'k1');
    expect(k1Assessment?.status).toBe('DATABASE_READY_FOR_RETIREMENT');

    // Remove k1 from environment (simulate operator retiring k1)
    process.env.ENCRYPTION_KEYS = `k2:${KEY_2}`;

    // Verify all records successfully decrypt using ONLY k2 in the environment
    const updatedOidc = await testPrisma.oidcConfig.findUniqueOrThrow({
      where: { id: 'oidc-removal-test' },
    });
    const decryptedOidc = await decrypt(updatedOidc.clientSecret);
    expect(decryptedOidc).toBe('oidc-removal-secret');

    const updatedSlack = await testPrisma.slackIntegration.findUniqueOrThrow({
      where: { id: 'slack-removal-test' },
    });
    const decryptedSlack = await decrypt(updatedSlack.botToken);
    expect(decryptedSlack).toBe('xoxb-removal-token');

    const updatedNp = await testPrisma.notificationProvider.findUniqueOrThrow({
      where: { id: 'np-webpush-removal' },
    });
    const decryptedConfig = await decryptProviderConfig(
      updatedNp.provider,
      updatedNp.config as Record<string, unknown>
    );
    expect(decryptedConfig.vapidPrivateKey).toBe('active-vapid-key');
    const history = decryptedConfig.vapidKeyHistory as Array<{ privateKey: string }>;
    expect(history[0].privateKey).toBe('retired-vapid-key');
  });

  it('handles duplicate key material (env k1 == SystemSettings.encryptionKey) for legacy v1/v2 without false AMBIGUOUS', async () => {
    // 1. Configure SystemSettings with the exact same key as k1
    await testPrisma.systemSettings.upsert({
      where: { id: 'default' },
      update: { encryptionKey: KEY_1 },
      create: { id: 'default', encryptionKey: KEY_1 },
    });

    // 2. Generate legacy v1 AES-256-CBC ciphertext using KEY_1
    const iv1 = crypto.randomBytes(16);
    const cipher1 = crypto.createCipheriv('aes-256-cbc', Buffer.from(KEY_1, 'hex'), iv1);
    let encrypted1 = cipher1.update('legacy-v1-oidc-secret', 'utf8', 'hex');
    encrypted1 += cipher1.final('hex');
    const legacyV1Secret = `${iv1.toString('hex')}:${encrypted1}`;

    await testPrisma.oidcConfig.create({
      data: {
        id: 'oidc-duplicate-key-test',
        issuer: 'https://issuer.example.com',
        clientId: 'client-dup',
        clientSecret: legacyV1Secret,
        updatedBy: testUser.id,
      },
    });

    // 3. Generate legacy v2 envelope ciphertext using KEY_1
    const dek = crypto.randomBytes(32);
    const dekIv = crypto.randomBytes(16);
    const dekCipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(KEY_1, 'hex'), dekIv);
    let encryptedDek = dekCipher.update(dek.toString('hex'), 'utf8', 'hex');
    encryptedDek += dekCipher.final('hex');

    const payloadIv = crypto.randomBytes(16);
    const payloadCipher = crypto.createCipheriv('aes-256-cbc', dek, payloadIv);
    let encryptedPayload = payloadCipher.update('legacy-v2-slack-secret', 'utf8', 'hex');
    encryptedPayload += payloadCipher.final('hex');
    const legacyV2Secret = `v2:${dekIv.toString('hex')}:${encryptedDek}:${payloadIv.toString('hex')}:${encryptedPayload}`;

    await testPrisma.slackIntegration.create({
      data: {
        id: 'slack-duplicate-key-test',
        workspaceId: 'T-DUP-KEY',
        botToken: legacyV2Secret,
        scopes: ['chat:write'],
        installedBy: testUser.id,
      },
    });

    // 4. PREVIEW: Verifies legacy v1 & v2 are detected as LEGACY_V1 and LEGACY_V2, NOT AMBIGUOUS
    const previewRun = await startEncryptionRun(testPrisma, {
      mode: 'PREVIEW',
      runSynchronously: true,
    });
    expect(previewRun.status).toBe('COMPLETED');
    expect(previewRun.errorRecords).toBe(0);

    const oidcState = await testPrisma.encryptionMigrationTargetState.findFirst({
      where: { runId: previewRun.id, targetId: 'oidc.client-secret' },
    });
    expect(oidcState?.errorCount).toBe(0);
    const oidcStats = oidcState?.inspectionStats as Record<string, number>;
    expect(oidcStats?.legacyV1).toBe(1);

    const slackState = await testPrisma.encryptionMigrationTargetState.findFirst({
      where: { runId: previewRun.id, targetId: 'slack.bot-token' },
    });
    expect(slackState?.errorCount).toBe(0);
    const slackStats = slackState?.inspectionStats as Record<string, number>;
    expect(slackStats?.legacyV2).toBe(1);

    // 5. MIGRATE: Successfully migrates records to v3:k2
    const migrateRun = await startEncryptionRun(testPrisma, {
      mode: 'MIGRATE',
      runSynchronously: true,
    });
    expect(migrateRun.status).toBe('COMPLETED');
    expect(migrateRun.errorRecords).toBe(0);

    const migratedOidc = await testPrisma.oidcConfig.findUniqueOrThrow({
      where: { id: 'oidc-duplicate-key-test' },
    });
    expect(migratedOidc.clientSecret.startsWith('v3:k2:')).toBe(true);

    const migratedSlack = await testPrisma.slackIntegration.findUniqueOrThrow({
      where: { id: 'slack-duplicate-key-test' },
    });
    expect(migratedSlack.botToken.startsWith('v3:k2:')).toBe(true);

    // 6. VERIFY: Verifies 0 references remain to retired keys
    await runFullVerification(testPrisma);
    const report = await evaluateKeyRetirementReadiness(testPrisma);

    const k1Assessment = report.assessments.find(a => a.keyId === 'k1');
    expect(k1Assessment?.status).toBe('DATABASE_READY_FOR_RETIREMENT');
    expect(k1Assessment?.remainingReferences).toBe(0);

    const dbKeyAssessment = report.assessments.find(a => a.keyId === 'database_legacy');
    expect(dbKeyAssessment?.status).toBe('DATABASE_READY_FOR_RETIREMENT');
    expect(dbKeyAssessment?.remainingReferences).toBe(0);

    expect(report.allEligibleRetiredFromDatabase).toBe(true);

    // Also verify run-level safeForDatabaseKeyRetirement matches the authoritative calculator
    const verifyRun = await testPrisma.encryptionMigrationRun.findFirst({
      where: { mode: 'VERIFY', status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
    });
    expect(verifyRun?.safeForDatabaseKeyRetirement).toContain('k1');
    expect(verifyRun?.safeForDatabaseKeyRetirement).toContain('database_legacy');
  });
});
