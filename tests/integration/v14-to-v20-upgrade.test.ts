import { execFileSync } from 'child_process';
import crypto, { scryptSync } from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { afterAll, describe, expect, it, vi } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  describe.skip('v1.4.0 -> v2.0.0 database upgrade integration', () => {
    it('skips because DATABASE_URL is not set', () => {});
  });
} else {
  describe('v1.4.0 -> v2.0.0 database upgrade integration', () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const scratchRoot = path.join(repoRoot, 'node_modules', '.cache', 'opsknight-v14-upgrade');
    const databaseName = `upgrade_v14_${process.pid}_${Date.now()}`.toLowerCase();
    const isolatedDatabaseUrl = withDatabase(databaseUrl, databaseName);
    const OLD_NEXTAUTH_SECRET = 'retained-v14-nextauth-secret-for-upgrade-integration';
    const NEW_API_KEY_SECRET = 'new-independent-v20-api-key-secret-for-upgrade-integration';
    const OLD_ENCRYPTION_KEY = 'a3'.repeat(32);
    const NEW_ENCRYPTION_KEY = 'b4'.repeat(32);

    const USER_ID = 'upgrade-v14-user';
    const USER_EMAIL = 'upgrade-v14-user@example.com';
    const SERVICE_ID = 'upgrade-v14-service';
    const POLICY_ID = 'upgrade-v14-policy';
    const ESCALATION_RULE_ID = 'upgrade-v14-rule-0';
    const INCIDENT_ID = 'upgrade-v14-incident';
    const API_KEY_ID = 'upgrade-v14-api-key';
    const STATUS_PAGE_ID = 'upgrade-v14-status-page';
    const STATUS_TOKEN_ID = 'upgrade-v14-status-token';
    const SLACK_INTEGRATION_ID = 'upgrade-v14-slack-integration';
    const API_TOKEN = `ok_${'A'.repeat(43)}`;
    const STATUS_TOKEN = `ok_${'B'.repeat(43)}`;
    const INTEGRATION_SECRET = 'xoxb-v14-encrypted-bot-token';

    afterAll(async () => {
      await dropDatabase(databaseUrl, databaseName);
      fs.rmSync(scratchRoot, { recursive: true, force: true });
    });

    it(
      'preserves v1.4 data and lazily migrates legacy API/status token hashes and v2 secrets',
      async ctx => {
        const originalEnv = snapshotEnv([
          'DATABASE_URL',
          'NODE_ENV',
          'NEXTAUTH_SECRET',
          'API_KEY_SECRET',
          'ENCRYPTION_KEY',
          'ENCRYPTION_KEYS',
        ]);
        let appPrisma: PrismaClient | undefined;

        try {
          extractPrismaFromTag('v1.4.0', scratchRoot, repoRoot);
          try {
            await createDatabase(databaseUrl, databaseName);
          } catch (error) {
            if (isDatabaseUnavailable(error)) {
              ctx.skip(
                'DATABASE_URL is set, but PostgreSQL is not reachable; skipping v1.4 upgrade integration.'
              );
            }
            throw error;
          }
          runPrismaMigrate(
            path.join(scratchRoot, 'prisma', 'schema.prisma'),
            isolatedDatabaseUrl,
            repoRoot
          );
          await seedV14Data(isolatedDatabaseUrl, {
            OLD_NEXTAUTH_SECRET,
            OLD_ENCRYPTION_KEY,
            USER_ID,
            USER_EMAIL,
            SERVICE_ID,
            POLICY_ID,
            ESCALATION_RULE_ID,
            INCIDENT_ID,
            API_KEY_ID,
            STATUS_PAGE_ID,
            STATUS_TOKEN_ID,
            SLACK_INTEGRATION_ID,
            API_TOKEN,
            STATUS_TOKEN,
            INTEGRATION_SECRET,
          });

          runPrismaMigrate(
            path.join(repoRoot, 'prisma', 'schema.prisma'),
            isolatedDatabaseUrl,
            repoRoot
          );

          process.env.DATABASE_URL = isolatedDatabaseUrl;
          setProcessEnv('NODE_ENV', 'test');
          process.env.NEXTAUTH_SECRET = OLD_NEXTAUTH_SECRET;
          process.env.API_KEY_SECRET = NEW_API_KEY_SECRET;
          process.env.ENCRYPTION_KEYS = `k2:${NEW_ENCRYPTION_KEY},k1:${OLD_ENCRYPTION_KEY}`;
          delete process.env.ENCRYPTION_KEY;
          vi.resetModules();

          const [{ authenticateApiKey }, { authorizeStatusApiRequest }, apiKeys, encryption, prismaModule] =
            await Promise.all([
              import('@/lib/api-auth'),
              import('@/lib/status-api-auth'),
              import('@/lib/api-keys'),
              import('@/lib/encryption'),
              import('@/lib/prisma'),
            ]);
          appPrisma = prismaModule.default;

          const expectedApiHash = apiKeys.hashTokenV2(API_TOKEN);
          const expectedStatusHash = apiKeys.hashTokenV2(STATUS_TOKEN);
          const seededApiKey = await appPrisma.apiKey.findUniqueOrThrow({
            where: { id: API_KEY_ID },
            select: { id: true, tokenHash: true },
          });
          expect(await apiKeys.hashLegacyScryptTokenCandidates(API_TOKEN)).toContain(
            seededApiKey.tokenHash
          );

          const firstApiAuth = await authenticateApiKey(bearerRequest(API_TOKEN));
          expect(firstApiAuth?.id).toBe(API_KEY_ID);
          await expectApiKeyHash(appPrisma, API_KEY_ID, expectedApiHash);

          const secondApiAuth = await authenticateApiKey(bearerRequest(API_TOKEN));
          expect(secondApiAuth?.id).toBe(API_KEY_ID);
          expect(await authenticateApiKey(bearerRequest(`ok_${'C'.repeat(43)}`))).toBeNull();

          const firstStatusAuth = await authorizeStatusApiRequest(
            bearerRequest(STATUS_TOKEN),
            STATUS_PAGE_ID,
            { requireToken: true, rateLimitEnabled: false }
          );
          expect(firstStatusAuth).toMatchObject({ allowed: true, tokenId: STATUS_TOKEN_ID });
          await expectStatusTokenHash(appPrisma, STATUS_TOKEN_ID, expectedStatusHash);

          const secondStatusAuth = await authorizeStatusApiRequest(
            bearerRequest(STATUS_TOKEN),
            STATUS_PAGE_ID,
            { requireToken: true, rateLimitEnabled: false }
          );
          expect(secondStatusAuth).toMatchObject({ allowed: true, tokenId: STATUS_TOKEN_ID });
          await expect(
            authorizeStatusApiRequest(bearerRequest(`ok_${'D'.repeat(43)}`), STATUS_PAGE_ID, {
              requireToken: true,
              rateLimitEnabled: false,
            })
          ).resolves.toMatchObject({ allowed: false, status: 401 });

          const seededSlack = await appPrisma.slackIntegration.findUniqueOrThrow({
            where: { id: SLACK_INTEGRATION_ID },
          });
          expect(seededSlack.botToken.startsWith('v2:')).toBe(true);
          await expect(encryption.decrypt(seededSlack.botToken)).resolves.toBe(INTEGRATION_SECRET);

          delete process.env.ENCRYPTION_KEYS;
          process.env.ENCRYPTION_KEY = OLD_ENCRYPTION_KEY;
          await expect(encryption.decrypt(seededSlack.botToken)).resolves.toBe(INTEGRATION_SECRET);

          process.env.ENCRYPTION_KEYS = `k2:${NEW_ENCRYPTION_KEY},k1:${OLD_ENCRYPTION_KEY}`;
          delete process.env.ENCRYPTION_KEY;
          const reencrypted = await encryption.encrypt(INTEGRATION_SECRET);
          expect(reencrypted.startsWith('v3:k2:')).toBe(true);
          await appPrisma.slackIntegration.update({
            where: { id: SLACK_INTEGRATION_ID },
            data: { botToken: reencrypted },
          });
          await expect(encryption.decrypt(reencrypted)).resolves.toBe(INTEGRATION_SECRET);

          const user = await appPrisma.user.findUniqueOrThrow({
            where: { id: USER_ID },
            include: { apiKeys: true, devices: true, tokens: true, slackIntegrations: true },
          });
          expect(user).toMatchObject({ email: USER_EMAIL, status: 'ACTIVE', role: 'ADMIN' });
          expect(user.devices).toHaveLength(1);
          expect(user.tokens).toHaveLength(1);
          expect(user.apiKeys[0]).toMatchObject({ id: API_KEY_ID, tokenHash: expectedApiHash });
          expect(user.slackIntegrations[0]).toMatchObject({ id: SLACK_INTEGRATION_ID });

          const service = await appPrisma.service.findUniqueOrThrow({
            where: { id: SERVICE_ID },
            include: {
              incidents: true,
              slackIntegration: true,
              statusPageServices: { include: { statusPage: { include: { apiTokens: true } } } },
              policy: { include: { steps: { include: { targetUser: true } } } },
            },
          });
          expect(service).toMatchObject({
            id: SERVICE_ID,
            name: 'v1.4 Upgrade Service',
            escalationPolicyId: POLICY_ID,
          });
          expect(service.policy?.steps[0]).toMatchObject({
            id: ESCALATION_RULE_ID,
            targetUserId: USER_ID,
            stepOrder: 0,
          });
          expect(service.policy?.steps[0]?.targetUser?.email).toBe(USER_EMAIL);
          expect(service.incidents[0]).toMatchObject({ id: INCIDENT_ID, title: 'v1.4 seeded incident' });
          expect(service.slackIntegration?.botToken.startsWith('v3:k2:')).toBe(true);
          expect(service.statusPageServices[0]?.statusPage.apiTokens[0]).toMatchObject({
            id: STATUS_TOKEN_ID,
            tokenHash: expectedStatusHash,
          });

          const incident = await appPrisma.incident.findUniqueOrThrow({
            where: { id: INCIDENT_ID },
            include: { service: true },
          });
          expect(incident.service.id).toBe(SERVICE_ID);
        } finally {
          if (appPrisma) await appPrisma.$disconnect();
          restoreEnv(originalEnv);
          vi.resetModules();
        }
      },
      180_000
    );
  });
}

function withDatabase(rawUrl: string, databaseName: string) {
  const url = new URL(rawUrl);
  url.pathname = `/${databaseName}`;
  url.searchParams.set('schema', 'public');
  return url.toString();
}

function snapshotEnv(names: string[]) {
  return Object.fromEntries(names.map(name => [name, process.env[name]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function setProcessEnv(name: string, value: string) {
  (process.env as Record<string, string | undefined>)[name] = value;
}

function isDatabaseUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Can't reach database server") ||
    message.includes('ECONNREFUSED') ||
    message.includes('Connection refused')
  );
}

async function createDatabase(rawUrl: string, databaseName: string) {
  const prisma = new PrismaClient({
    datasources: { db: { url: withDatabase(rawUrl, 'postgres') } },
  });
  try {
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await prisma.$disconnect();
  }
}

async function dropDatabase(rawUrl: string, databaseName: string) {
  if (!rawUrl) return;
  const prisma = new PrismaClient({
    datasources: { db: { url: withDatabase(rawUrl, 'postgres') } },
  });
  try {
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
  } catch {
    // Best-effort cleanup only.
  } finally {
    await prisma.$disconnect();
  }
}

function ensureTagAvailable(tag: string, repoRoot: string) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${tag}^{commit}`], {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch {
    // CI checkouts are shallow and tagless; fetch only the baseline release tag.
    execFileSync(
      'git',
      ['fetch', '--no-tags', '--depth=1', 'origin', `refs/tags/${tag}:refs/tags/${tag}`],
      { cwd: repoRoot, stdio: 'pipe' }
    );
  }
}

function extractPrismaFromTag(tag: string, scratchRoot: string, repoRoot: string) {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
  ensureTagAvailable(tag, repoRoot);
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', tag, 'prisma'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  for (const file of files) {
    const content = execFileSync('git', ['show', `${tag}:${file}`], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    const destination = path.join(scratchRoot, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
}

function runPrismaMigrate(schemaPath: string, url: string, repoRoot: string) {
  execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', schemaPath], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' },
    stdio: 'pipe',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function bearerRequest(token: string) {
  return new Request('https://opsknight.test/api', {
    headers: { authorization: `Bearer ${token}` },
  }) as unknown as NextRequest;
}

async function expectApiKeyHash(prisma: PrismaClient, id: string, tokenHash: string) {
  const row = await prisma.apiKey.findUniqueOrThrow({ where: { id }, select: { tokenHash: true } });
  expect(row.tokenHash).toBe(tokenHash);
}

async function expectStatusTokenHash(prisma: PrismaClient, id: string, tokenHash: string) {
  const row = await prisma.statusPageApiToken.findUniqueOrThrow({
    where: { id },
    select: { tokenHash: true },
  });
  expect(row.tokenHash).toBe(tokenHash);
}

function encryptV14WithKey(text: string, keyHex: string): string {
  const algorithm = 'aes-256-cbc';
  const dek = crypto.randomBytes(32);
  const dekHex = dek.toString('hex');

  const payloadIv = crypto.randomBytes(16);
  const payloadCipher = crypto.createCipheriv(algorithm, dek, payloadIv);
  let encryptedPayload = payloadCipher.update(text, 'utf8', 'hex');
  encryptedPayload += payloadCipher.final('hex');

  const masterKey = Buffer.from(keyHex, 'hex');
  const dekIv = crypto.randomBytes(16);
  const dekCipher = crypto.createCipheriv(algorithm, masterKey, dekIv);
  let encryptedDek = dekCipher.update(dekHex, 'utf8', 'hex');
  encryptedDek += dekCipher.final('hex');

  return `v2:${dekIv.toString('hex')}:${encryptedDek}:${payloadIv.toString('hex')}:${encryptedPayload}`;
}

async function seedV14Data(
  url: string,
  data: {
    OLD_NEXTAUTH_SECRET: string;
    OLD_ENCRYPTION_KEY: string;
    USER_ID: string;
    USER_EMAIL: string;
    SERVICE_ID: string;
    POLICY_ID: string;
    ESCALATION_RULE_ID: string;
    INCIDENT_ID: string;
    API_KEY_ID: string;
    STATUS_PAGE_ID: string;
    STATUS_TOKEN_ID: string;
    SLACK_INTEGRATION_ID: string;
    API_TOKEN: string;
    STATUS_TOKEN: string;
    INTEGRATION_SECRET: string;
  }
) {
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const apiTokenHash = scryptSync(data.API_TOKEN, data.OLD_NEXTAUTH_SECRET, 32).toString('hex');
  const statusTokenHash = scryptSync(data.STATUS_TOKEN, data.OLD_NEXTAUTH_SECRET, 32).toString('hex');
  const encryptedIntegrationSecret = encryptV14WithKey(data.INTEGRATION_SECRET, data.OLD_ENCRYPTION_KEY);

  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(
        `
          INSERT INTO "User" (
            id, name, email, "emailVerified", "tokenVersion", role, status, "passwordHash",
            "timeZone", "emailNotificationsEnabled", "smsNotificationsEnabled",
            "pushNotificationsEnabled", "whatsappNotificationsEnabled", "createdAt", "updatedAt"
          )
          VALUES (
            $1, 'v1.4 Upgrade User', $2, NOW(), 3, 'ADMIN'::"Role", 'ACTIVE'::"UserStatus",
            'v14-password-hash', 'UTC', true, false, true, false, NOW(), NOW()
          )
        `,
        data.USER_ID,
        data.USER_EMAIL
      );

      await tx.$executeRawUnsafe(
        `
          INSERT INTO "UserDevice" (
            id, "userId", "deviceId", token, platform, "userAgent", "lastUsed", "createdAt", "updatedAt"
          )
          VALUES (
            'upgrade-v14-device', $1, 'upgrade-v14-browser', 'fcm-v14-device-token', 'web',
            'OpsKnight v1.4 browser session', NOW(), NOW(), NOW()
          )
        `,
        data.USER_ID
      );

      await tx.$executeRawUnsafe(
        `
          INSERT INTO "UserToken" (id, type, identifier, "tokenHash", "expiresAt", "usedAt", "createdAt", metadata)
          VALUES (
            'upgrade-v14-user-token', 'PASSWORD_RESET'::"UserTokenType", $1,
            'upgrade-v14-user-token-sha256', NOW() + INTERVAL '1 day', NULL, NOW(),
            '{"source":"v1.4-upgrade-test"}'::jsonb
          )
        `,
        data.USER_EMAIL
      );

      await tx.$executeRawUnsafe(
        `
          INSERT INTO "EscalationPolicy" (id, name, description, "createdAt", "updatedAt")
          VALUES ($1, 'v1.4 Upgrade Policy', 'Seeded with the v1.4 escalation shape', NOW(), NOW())
        `,
        data.POLICY_ID
      );

      await tx.$executeRawUnsafe(
        `
          INSERT INTO "EscalationRule" (
            id, "policyId", "delayMinutes", "stepOrder", "targetType", "targetUserId",
            "notificationChannels", "notifyOnlyTeamLead"
          )
          VALUES (
            $1, $2, 0, 0, 'USER'::"EscalationTargetType", $3,
            ARRAY['EMAIL']::"NotificationChannel"[], false
          )
        `,
        data.ESCALATION_RULE_ID,
        data.POLICY_ID,
        data.USER_ID
      );

      await tx.$executeRawUnsafe(
        `
          INSERT INTO "SlackIntegration" (
            id, "workspaceId", "workspaceName", "botToken", "signingSecret", "installedBy",
            scopes, enabled, "createdAt", "updatedAt"
          )
          VALUES (
            $1, 'T-V14-UPGRADE', 'v1.4 Workspace', $2, NULL, $3,
            ARRAY['chat:write','channels:read'], true, NOW(), NOW()
          )
        `,
        data.SLACK_INTEGRATION_ID,
        encryptedIntegrationSecret,
        data.USER_ID
      );

      await tx.$executeRawUnsafe(
        `
          INSERT INTO "Service" (
            id, name, description, region, "slaTier", status, "targetAckMinutes",
            "targetResolveMinutes", "escalationPolicyId", "slackIntegrationId",
            "serviceNotificationChannels", "createdAt", "updatedAt"
          )
          VALUES (
            $1, 'v1.4 Upgrade Service', 'Service written with the v1.4 schema',
            'us-east-1', 'Gold', 'OPERATIONAL'::"ServiceStatus", 15, 120, $2, $3,
            ARRAY['EMAIL']::"NotificationChannel"[], NOW(), NOW()
          )
        `,
        data.SERVICE_ID,
        data.POLICY_ID,
        data.SLACK_INTEGRATION_ID
      );

      await tx.$executeRawUnsafe(
        `
          INSERT INTO "Incident" (
            id, title, description, status, urgency, visibility, priority, "dedupKey",
            "serviceId", "assigneeId", "currentEscalationStep", "nextEscalationAt",
            "escalationStatus", "createdAt", "updatedAt"
          )
          VALUES (
            $1, 'v1.4 seeded incident', 'Incident linked to the v1.4 service',
            'OPEN'::"IncidentStatus", 'HIGH'::"IncidentUrgency", 'PUBLIC'::"IncidentVisibility",
            'P1', 'v14-dedup-key', $2, $3, 0, NOW() + INTERVAL '5 minutes',
            'ESCALATING', NOW(), NOW()
          )
        `,
        data.INCIDENT_ID,
        data.SERVICE_ID,
        data.USER_ID
      );

      await tx.$executeRawUnsafe(
        `
          INSERT INTO "ApiKey" (id, name, prefix, "tokenHash", scopes, "userId", "createdAt", "lastUsedAt", "revokedAt")
          VALUES (
            $1, 'v1.4 legacy API key', $2, $3, ARRAY['incidents:read','incidents:write'], $4,
            NOW(), NULL, NULL
          )
        `,
        data.API_KEY_ID,
        data.API_TOKEN.slice(0, 8),
        apiTokenHash,
        data.USER_ID
      );

      await tx.$executeRawUnsafe(
        `
          INSERT INTO "StatusPage" (
            id, name, "organizationName", enabled, "showServices", "showIncidents",
            "statusApiRequireToken", "statusApiRateLimitEnabled", "createdAt", "updatedAt"
          )
          VALUES (
            $1, 'v1.4 Upgrade Status Page', 'OpsKnight Upgrade Test', true, true, true,
            true, false, NOW(), NOW()
          )
        `,
        data.STATUS_PAGE_ID
      );

      await tx.$executeRawUnsafe(
        `
          INSERT INTO "StatusPageService" (id, "statusPageId", "serviceId", "displayName", "showOnPage", "order", "createdAt")
          VALUES ('upgrade-v14-status-service', $1, $2, 'Public Upgrade Service', true, 0, NOW())
        `,
        data.STATUS_PAGE_ID,
        data.SERVICE_ID
      );

      await tx.$executeRawUnsafe(
        `
          INSERT INTO "StatusPageApiToken" (
            id, "statusPageId", name, prefix, "tokenHash", "createdAt", "lastUsedAt", "revokedAt"
          )
          VALUES ($1, $2, 'v1.4 status token', $3, $4, NOW(), NULL, NULL)
        `,
        data.STATUS_TOKEN_ID,
        data.STATUS_PAGE_ID,
        data.STATUS_TOKEN.slice(0, 8),
        statusTokenHash
      );
    });
  } finally {
    await prisma.$disconnect();
  }
}
