import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import hkdf from '@panva/hkdf';
import { Prisma, PrismaClient } from '@prisma/client';
import { EncryptJWT } from 'jose';
import { hashTokenV2 } from '@/lib/api-keys';
import { encrypt } from '@/lib/encryption';
import { encryptProviderConfig } from '@/lib/encrypted-provider-config';
import { getNextAuthSecretSync } from '@/lib/secret-manager';
import { publishStatusPageSnapshot } from '@/lib/status-pages/snapshot';
import { buildEscalationPolicyFixtures } from '../fixtures/escalation-policies';
import { buildBaselineIncidentFixtures } from '../fixtures/incidents';
import {
  buildStatusPageFixture,
  DEFAULT_EMULATOR_ENDPOINTS,
  LoadProviderEmulatorEndpoints,
} from '../fixtures/notification-providers';
import { buildScheduleFixtures } from '../fixtures/schedules';
import { buildServiceFixtures } from '../fixtures/services';
import {
  buildTeamFixtures,
  buildUserFixtures,
  SCALE_PROFILES,
  ScaleProfileName,
} from '../fixtures/users';

export interface LoadSeedManifest {
  generatedAt: string;
  scaleProfile: ScaleProfileName;
  baseUrl: string;
  contractIntegrationKey: string;
  contractServiceId: string;
  capacityIntegrationKeys: string[];
  capacityServiceIds: string[];
  allServiceIds: string[];
  apiKeys: string[];
  adminApiKey: string;
  sessionCookies: Array<{
    userId: string;
    email: string;
    role: string;
    cookieHeader: string;
  }>;
  statusPage: {
    id: string;
    slug: string;
    subscriberCount: number;
  };
  scheduleIds: string[];
  escalationPolicyIds: string[];
  teamIds: string[];
  userIds: string[];
  baselineIncidentIds: string[];
  emulatorEndpoints: LoadProviderEmulatorEndpoints;
}

async function mintLoadTestSessionCookie(params: {
  userId: string;
  email: string;
  name: string;
  role: string;
  secret: string;
  sessionId: string;
  expiresAtSeconds: number;
  secureCookie: boolean;
}): Promise<string> {
  const encryptionSecret = await hkdf(
    'sha256',
    params.secret,
    '',
    'NextAuth.js Generated Encryption Key',
    32
  );

  const token = await new EncryptJWT({
    sub: params.userId,
    id: params.userId,
    email: params.email,
    name: params.name,
    role: params.role,
    tokenVersion: 0,
    jti: params.sessionId,
    sessionExpiresAt: params.expiresAtSeconds,
  })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(params.expiresAtSeconds)
    .setJti(params.sessionId)
    .encrypt(encryptionSecret);

  const cookieName = params.secureCookie
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token';
  return `${cookieName}=${token}`;
}

function parseCliArgs(argv: string[]): {
  scale: ScaleProfileName;
  manifestPath: string;
  baseUrl: string;
} {
  let scale: ScaleProfileName = (process.env.LOAD_SCALE_PROFILE as ScaleProfileName) || 'medium';
  let manifestPath =
    process.env.LOAD_SEED_MANIFEST ||
    path.resolve(process.cwd(), 'artifacts/load-certification/seed-manifest.json');
  let baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3000';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--scale' && argv[i + 1]) {
      scale = argv[++i] as ScaleProfileName;
    } else if (arg.startsWith('--scale=')) {
      scale = arg.split('=')[1] as ScaleProfileName;
    } else if (arg === '--manifest' && argv[i + 1]) {
      manifestPath = path.resolve(argv[++i]);
    } else if (arg.startsWith('--manifest=')) {
      manifestPath = path.resolve(arg.split('=')[1]);
    } else if (arg === '--base-url' && argv[i + 1]) {
      baseUrl = argv[++i];
    } else if (arg.startsWith('--base-url=')) {
      baseUrl = arg.split('=')[1];
    }
  }

  if (!SCALE_PROFILES[scale]) {
    scale = 'medium';
  }

  return { scale, manifestPath, baseUrl };
}

function assertSafeSeedDatabase(): void {
  if (
    process.env.OPSKNIGHT_ALLOW_LOAD_DB_SEED === 'true' ||
    process.env.OPSKNIGHT_ALLOW_LOAD_DB_OVERWRITE === 'true'
  ) {
    return;
  }
  const dbUrl = process.env.DATABASE_URL || '';
  const isLikelyTestDb =
    dbUrl.includes('test') ||
    dbUrl.includes('load') ||
    dbUrl.includes('scratch') ||
    dbUrl.includes('ci') ||
    dbUrl.includes('staging');
  if (!isLikelyTestDb) {
    throw new Error(
      `Refusing to seed load fixtures: DATABASE_URL does not match test patterns and OPSKNIGHT_ALLOW_LOAD_DB_SEED is not 'true'. Target: ${dbUrl.replace(/:[^:@]+@/, ':***@')}`
    );
  }
}

export async function runLoadSeed(options?: {
  scale?: ScaleProfileName;
  manifestPath?: string;
  baseUrl?: string;
  endpoints?: LoadProviderEmulatorEndpoints;
}): Promise<LoadSeedManifest> {
  assertSafeSeedDatabase();
  const cli = parseCliArgs(process.argv.slice(2));
  const scaleName = options?.scale ?? cli.scale;
  const manifestPath = options?.manifestPath ?? cli.manifestPath;
  const baseUrl = options?.baseUrl ?? cli.baseUrl;
  const endpoints = options?.endpoints ?? DEFAULT_EMULATOR_ENDPOINTS;
  const scale = SCALE_PROFILES[scaleName];

  const prisma = new PrismaClient();
  try {
    const teams = buildTeamFixtures(scale);
    const users = buildUserFixtures(scale, endpoints.pushBaseUrl);
    const schedules = buildScheduleFixtures(scale, users);
    const policies = buildEscalationPolicyFixtures(scale, users, teams, schedules);
    const { services, integrations } = buildServiceFixtures(scale, {
      webhookBaseUrl: endpoints.webhookBaseUrl,
      slackWebhookBaseUrl: `${endpoints.webhookBaseUrl.replace(/\/$/, '')}/slack/services/T000LOAD/B000LOAD`,
    });
    const baselineIncidents = buildBaselineIncidentFixtures(scale, services, users);
    const statusPage = buildStatusPageFixture(scale, services, endpoints);

    // 1. Upsert Users
    await prisma.user.createMany({
      data: users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        timeZone: u.timeZone,
        emailNotificationsEnabled: u.emailNotificationsEnabled,
        smsNotificationsEnabled: u.smsNotificationsEnabled,
        pushNotificationsEnabled: u.pushNotificationsEnabled,
        whatsappNotificationsEnabled: u.whatsappNotificationsEnabled,
        phoneNumber: u.phoneNumber,
      })),
      skipDuplicates: true,
    });

    // 2. Upsert Teams
    await prisma.team.createMany({
      data: teams.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        teamLeadId: t.teamLeadId,
      })),
      skipDuplicates: true,
    });

    // 3. Upsert TeamMembers
    await prisma.teamMember.createMany({
      data: users.map(u => ({
        id: `lt-tm-${u.id}-${u.teamId}`,
        userId: u.id,
        teamId: u.teamId,
        role: u.teamRole,
        receiveTeamNotifications: true,
      })),
      skipDuplicates: true,
    });

    // 4. Upsert Web Push Subscriptions into UserDevice (encrypted v3 format)
    // Deterministic valid P-256 ECDH public key (65-byte uncompressed point in base64url)
    const deterministicP256dh =
      'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
    const deterministicAuth = 'UUxI4O8-FbRouAevSmBQ6g';

    const userDeviceRows = await Promise.all(
      users.map(async u => ({
        id: `lt-push-dev-${u.id}`,
        userId: u.id,
        deviceId: u.webPushDeviceId,
        platform: 'web',
        token: await encrypt(
          JSON.stringify({
            endpoint: u.webPushEndpoint,
            expirationTime: null,
            keys: {
              p256dh: deterministicP256dh,
              auth: deterministicAuth,
            },
          })
        ),
        userAgent: 'OpsKnight-LoadCert-WebPush/1.0',
      }))
    );
    await prisma.userDevice.createMany({
      data: userDeviceRows,
      skipDuplicates: true,
    });

    // 5. Upsert OnCallSchedules, Layers, LayerUsers, Overrides
    await prisma.onCallSchedule.createMany({
      data: schedules.map(s => ({
        id: s.id,
        name: s.name,
        timeZone: s.timeZone,
      })),
      skipDuplicates: true,
    });

    await prisma.onCallLayer.createMany({
      data: schedules.flatMap(s =>
        s.layers.map(l => ({
          id: l.id,
          scheduleId: s.id,
          name: l.name,
          start: l.start,
          rotationLengthHours: l.rotationLengthHours,
          shiftLengthHours: l.shiftLengthHours,
          priority: l.priority,
        }))
      ),
      skipDuplicates: true,
    });

    await prisma.onCallLayerUser.createMany({
      data: schedules.flatMap(s =>
        s.layers.flatMap(l =>
          l.userIds.map((userId, idx) => ({
            id: `${l.id}-u-${idx + 1}`,
            layerId: l.id,
            userId,
            position: idx,
          }))
        )
      ),
      skipDuplicates: true,
    });

    await prisma.onCallOverride.createMany({
      data: schedules.flatMap(s =>
        s.overrides.map(o => ({
          id: o.id,
          scheduleId: s.id,
          userId: o.userId,
          replacesUserId: o.replacesUserId,
          start: o.start,
          end: o.end,
        }))
      ),
      skipDuplicates: true,
    });

    // 6. Upsert Escalation Policies & Rules
    await prisma.escalationPolicy.createMany({
      data: policies.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
      })),
      skipDuplicates: true,
    });

    await prisma.escalationRule.createMany({
      data: policies.flatMap(p =>
        p.rules.map(rule => ({
          id: rule.id,
          policyId: p.id,
          stepOrder: rule.stepOrder,
          delayMinutes: rule.delayMinutes,
          targetType: rule.targetType,
          targetUserId: rule.targetUserId ?? null,
          targetScheduleId: rule.targetScheduleId ?? null,
          targetTeamId: rule.targetTeamId ?? null,
          notificationChannels: rule.notificationChannels,
          notifyOnlyTeamLead: rule.notifyOnlyTeamLead ?? false,
        }))
      ),
      skipDuplicates: true,
    });

    // 7. Upsert SlackIntegration & Services & Integrations & WebhookIntegrations
    const encryptedSlackBotToken = await encrypt('xoxb-load-cert-bot-token');
    await prisma.slackIntegration.upsert({
      where: { workspaceId: 'T_LOAD_CERT_01' },
      update: {
        workspaceName: 'OpsKnight Load Cert Workspace',
        botToken: encryptedSlackBotToken,
        enabled: true,
      },
      create: {
        id: 'lt-slack-int-001',
        workspaceId: 'T_LOAD_CERT_01',
        workspaceName: 'OpsKnight Load Cert Workspace',
        botToken: encryptedSlackBotToken,
        scopes: ['chat:write', 'channels:manage', 'commands'],
        enabled: true,
        installedBy: users[0]?.id ?? null,
      },
    });

    await prisma.service.createMany({
      data: services.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        region: s.region,
        slaTier: s.slaTier,
        teamId: s.teamId,
        escalationPolicyId: s.escalationPolicyId,
        slackWebhookUrl: s.slackWebhookUrl,
        slackChannel: s.slackChannel,
        slackIntegrationId: 'lt-slack-int-001',
        webhookUrl: s.webhookUrl,
        serviceNotificationChannels: s.serviceNotificationChannels,
        serviceNotifyOnTriggered: s.serviceNotifyOnTriggered,
        serviceNotifyOnAck: s.serviceNotifyOnAck,
        serviceNotifyOnResolved: s.serviceNotifyOnResolved,
      })),
      skipDuplicates: true,
    });

    await prisma.integration.createMany({
      data: integrations.map(int => ({
        id: int.id,
        name: int.name,
        type: int.type,
        key: int.key,
        enabled: int.enabled,
        serviceId: int.serviceId,
      })),
      skipDuplicates: true,
    });

    await prisma.webhookIntegration.createMany({
      data: services.map(s => ({
        id: `lt-wh-${s.id}`,
        serviceId: s.id,
        name: `Load Webhook ${s.id}`,
        type: 'GENERIC',
        url: s.webhookUrl,
        secret: `lt_webhook_secret_${s.id}`,
        channel: '#load-webhooks',
        enabled: true,
      })),
      skipDuplicates: true,
    });

    // 8. Configure Notification Providers (SMTP + Web Push)
    const smtpConfig = (await encryptProviderConfig('smtp', {
      host: endpoints.smtpHost,
      port: endpoints.smtpPort,
      secure: false,
      user: endpoints.smtpUser,
      password: endpoints.smtpPassword,
      fromEmail: endpoints.fromEmail,
    })) as Prisma.InputJsonValue;
    const existingSmtp = await prisma.notificationProvider.findUnique({
      where: { provider: 'smtp' },
    });
    if (existingSmtp && !existingSmtp.id.startsWith('lt-')) {
      throw new Error(
        `Refusing to overwrite existing non-test SMTP provider (${existingSmtp.id}). Dedicated test database required.`
      );
    }

    await prisma.notificationProvider.upsert({
      where: { provider: 'smtp' },
      update: { enabled: true, config: smtpConfig },
      create: {
        id: 'lt-np-smtp',
        provider: 'smtp',
        enabled: true,
        config: smtpConfig,
      },
    });

    const existingPush = await prisma.notificationProvider.findUnique({
      where: { provider: 'web-push' },
    });
    if (existingPush && !existingPush.id.startsWith('lt-')) {
      throw new Error(
        `Refusing to overwrite existing non-test web-push provider (${existingPush.id}). Dedicated test database required.`
      );
    }

    const pushConfig = (await encryptProviderConfig('web-push', {
      vapidSubject: `mailto:${endpoints.fromEmail}`,
      vapidPublicKey: endpoints.vapidPublicKey,
      vapidPrivateKey: endpoints.vapidPrivateKey,
    })) as Prisma.InputJsonValue;
    await prisma.notificationProvider.upsert({
      where: { provider: 'web-push' },
      update: { enabled: true, config: pushConfig },
      create: {
        id: 'lt-np-web-push',
        provider: 'web-push',
        enabled: true,
        config: pushConfig,
      },
    });

    // 9. Upsert StatusPage, StatusPageServices, StatusPageSubscriptions, StatusPageWebhooks
    await prisma.statusPage.upsert({
      where: { id: statusPage.id },
      update: {
        name: statusPage.name,
        slug: statusPage.slug,
        organizationName: statusPage.organizationName,
        enabled: true,
        isDefault: true,
        emailProvider: 'smtp',
      },
      create: {
        id: statusPage.id,
        name: statusPage.name,
        slug: statusPage.slug,
        organizationName: statusPage.organizationName,
        enabled: true,
        isDefault: true,
        emailProvider: 'smtp',
      },
    });

    await prisma.statusPageService.createMany({
      data: statusPage.serviceIds.map((serviceId, idx) => ({
        id: `lt-sps-${idx + 1}`,
        statusPageId: statusPage.id,
        serviceId,
        displayName: `Service ${idx + 1}`,
        showOnPage: true,
        order: idx,
      })),
      skipDuplicates: true,
    });

    await prisma.statusPageWebhook.upsert({
      where: { id: statusPage.webhookId },
      update: {
        url: statusPage.webhookUrl,
        secret: statusPage.webhookSecret,
        enabled: true,
      },
      create: {
        id: statusPage.webhookId,
        statusPageId: statusPage.id,
        url: statusPage.webhookUrl,
        secret: statusPage.webhookSecret,
        events: ['incident.created', 'incident.updated', 'incident.resolved', 'service.status_changed'],
        enabled: true,
      },
    });

    // Seed subscribers in batches of 1000
    const activeSubscriberLimit = Math.min(
      statusPage.subscriberCount,
      Number(process.env.LOAD_ACTIVE_SUBSCRIBERS ?? 20)
    );
    const subscriberBatchSize = 1000;
    for (let offset = 0; offset < statusPage.subscriberCount; offset += subscriberBatchSize) {
      const count = Math.min(subscriberBatchSize, statusPage.subscriberCount - offset);
      const batch = Array.from({ length: count }, (_, idx) => {
        const subNum = offset + idx + 1;
        const padded = String(subNum).padStart(5, '0');
        const isActive = subNum <= activeSubscriberLimit;
        return {
          id: `lt-sub-${padded}`,
          statusPageId: statusPage.id,
          email: `subscriber-${padded}@loadtest.opsknight.internal`,
          token: `lt_sub_tok_${padded}`,
          verified: isActive,
          state: isActive ? ('ACTIVE' as const) : ('PENDING' as const),
        };
      });
      await prisma.statusPageSubscription.createMany({
        data: batch,
        skipDuplicates: true,
      });
    }

    // 10. Seed API Keys for rotated REST API load testing
    const apiKeyCount = Math.min(users.length, Math.max(12, scale.apiKeys));
    const apiKeys: string[] = [];
    const apiKeyRows = [];
    const adminUsers = users.filter(u => u.role === 'ADMIN');
    const keyUsers = adminUsers.length > 0 ? adminUsers : users;
    for (let i = 0; i < apiKeyCount; i++) {
      const padded = String(i + 1).padStart(4, '0');
      const rawToken = `ok_load_cert_token_${padded}_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c`;
      apiKeys.push(rawToken);
      apiKeyRows.push({
        id: `lt-apikey-${padded}`,
        name: `Load Cert Key ${padded}`,
        prefix: rawToken.slice(0, 12),
        tokenHash: hashTokenV2(rawToken),
        scopes: ['incidents:read', 'incidents:write', 'services:read', 'events:write'],
        userId: keyUsers[i % keyUsers.length].id,
      });
    }
    await prisma.apiKey.createMany({
      data: apiKeyRows,
      skipDuplicates: true,
    });

    // 11. Seed pre-registered JWE Session Cookies + UserDevice rows for SSE & Browser routes
    const nextAuthSecret = getNextAuthSecretSync();
    const secureCookie = baseUrl.startsWith('https://');
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const expiresAtIso = new Date(expiresAtSeconds * 1000).toISOString();
    const sessionCount = Math.min(users.length, 60);
    const sessionCookies: LoadSeedManifest['sessionCookies'] = [];
    const sessionDeviceRows = [];

    for (let i = 0; i < sessionCount; i++) {
      const user = users[i];
      const padded = String(i + 1).padStart(4, '0');
      const sessionId = user.sessionJti;
      const digest = createHash('sha256').update(sessionId).digest('hex');

      sessionDeviceRows.push({
        id: `lt-sess-dev-${padded}`,
        userId: user.id,
        deviceId: `session:${sessionId}`,
        platform: 'session:STANDARD',
        token: JSON.stringify({
          v: 2,
          digest,
          expiresAt: expiresAtIso,
          userAgent: 'OpsKnight-LoadCert-SSE/1.0',
        }),
        userAgent: 'OpsKnight-LoadCert-SSE/1.0',
      });

      const cookieHeader = await mintLoadTestSessionCookie({
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        secret: nextAuthSecret,
        sessionId,
        secureCookie,
        expiresAtSeconds,
      });

      sessionCookies.push({
        userId: user.id,
        email: user.email,
        role: user.role,
        cookieHeader,
      });
    }

    await prisma.userDevice.createMany({
      data: sessionDeviceRows,
      skipDuplicates: true,
    });

    // 12. Seed Baseline Incidents
    await prisma.incident.createMany({
      data: baselineIncidents.map(inc => ({
        id: inc.id,
        title: inc.title,
        description: inc.description,
        serviceId: inc.serviceId,
        teamId: inc.teamId,
        assigneeId: inc.assigneeId,
        status: inc.status,
        urgency: inc.urgency,
        priority: inc.priority,
        visibility: inc.visibility,
        dedupKey: inc.dedupKey,
        escalationStatus: inc.escalationStatus,
        currentEscalationStep: inc.currentEscalationStep,
        nextEscalationAt: inc.nextEscalationAt,
        createdAt: inc.createdAt,
        acknowledgedAt: inc.acknowledgedAt,
        resolvedAt: inc.resolvedAt,
      })),
      skipDuplicates: true,
    });

    // 13. Publish initial StatusPageSnapshot so /api/status is immediately LIVE
    await publishStatusPageSnapshot(statusPage.id, { lockAttempts: 3, budgetMs: 15_000 });

    const contractIntegration =
      integrations.find(i => i.isContractKey) ?? integrations[0];
    const capacityIntegrations = integrations.filter(i => !i.isContractKey);

    const manifest: LoadSeedManifest = {
      generatedAt: new Date().toISOString(),
      scaleProfile: scaleName,
      baseUrl,
      contractIntegrationKey: contractIntegration.key,
      contractServiceId: contractIntegration.serviceId,
      capacityIntegrationKeys: capacityIntegrations.map(i => i.key),
      capacityServiceIds: Array.from(new Set(capacityIntegrations.map(i => i.serviceId))),
      allServiceIds: services.map(s => s.id),
      apiKeys,
      adminApiKey: apiKeys[0],
      sessionCookies,
      statusPage: {
        id: statusPage.id,
        slug: statusPage.slug,
        subscriberCount: statusPage.subscriberCount,
      },
      scheduleIds: schedules.map(s => s.id),
      escalationPolicyIds: policies.map(p => p.id),
      teamIds: teams.map(t => t.id),
      userIds: users.map(u => u.id),
      baselineIncidentIds: baselineIncidents.map(i => i.id),
      emulatorEndpoints: endpoints,
    };

    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    return manifest;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runLoadSeed()
    .then(manifest => {
      console.log(
        JSON.stringify({
          event: 'load_seed.completed',
          scaleProfile: manifest.scaleProfile,
          services: manifest.allServiceIds.length,
          capacityBuckets: manifest.capacityIntegrationKeys.length,
          apiKeys: manifest.apiKeys.length,
          sessionCookies: manifest.sessionCookies.length,
          subscribers: manifest.statusPage.subscriberCount,
          baselineIncidents: manifest.baselineIncidentIds.length,
        })
      );
    })
    .catch(err => {
      console.error('Load seed failed:', err);
      process.exit(1);
    });
}
