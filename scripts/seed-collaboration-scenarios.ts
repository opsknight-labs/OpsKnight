/**
 * Seed collaboration scenarios for local UI testing and verification.
 * Run with: npx ts-node --project tsconfig.script.json scripts/seed-collaboration-scenarios.ts
 */

import 'dotenv/config';
import { PrismaClient, IncidentUrgency, IncidentStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding collaboration test scenarios...');

  // 1. Ensure a user exists to serve as actor / participant
  let adminUser = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
  });
  if (!adminUser) {
    adminUser = await prisma.user.create({
      data: {
        email: 'admin@opsknight.local',
        name: 'Demo Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
  }

  let responderUser = await prisma.user.findFirst({
    where: { email: 'responder@opsknight.local' },
  });
  if (!responderUser) {
    responderUser = await prisma.user.create({
      data: {
        email: 'responder@opsknight.local',
        name: 'Alice Responder',
        role: 'RESPONDER',
        status: 'ACTIVE',
      },
    });
  }

  // 2. ChatOps Config
  await prisma.chatOpsConfig.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      enabled: true,
      autoCreateOnUrgency: ['HIGH'],
      autoCreateOnPriority: ['P1', 'P2'],
      channelPrefix: 'inc',
      archiveOnResolve: true,
    },
    update: {
      enabled: true,
    },
  });

  // 3. Slack Integration
  const slackIntegration = await prisma.slackIntegration.upsert({
    where: { workspaceId: 'T_DEMO_WORKSPACE' },
    create: {
      workspaceId: 'T_DEMO_WORKSPACE',
      workspaceName: 'Acme Corp Slack',
      botToken: 'xoxb-demo-token',
      signingSecret: 'demo-secret',
      scopes: ['channels:manage', 'groups:write', 'chat:write'],
      installedBy: adminUser.id,
      enabled: true,
    },
    update: {
      installedBy: adminUser.id,
      enabled: true,
    },
  });

  // 4. Teams Config & Installation
  await prisma.microsoftTeamsConfig.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      clientId: 'teams-client-id-demo',
      clientSecret: 'teams-client-secret-demo',
      tenantId: 'tenant-demo-123',
      enabled: true,
      interactiveEnabled: true,
      warRoomsEnabled: true,
    },
    update: {
      enabled: true,
      interactiveEnabled: true,
      warRoomsEnabled: true,
    },
  });

  const teamsInstallation = await prisma.microsoftTeamsInstallation.upsert({
    where: {
      tenantId_teamId: {
        tenantId: 'tenant-demo-123',
        teamId: 'team-demo-456',
      },
    },
    create: {
      tenantId: 'tenant-demo-123',
      teamId: 'team-demo-456',
      teamName: 'Core Infrastructure Responders',
      channelId: 'channel-general-demo',
      enabled: true,
    },
    update: {
      enabled: true,
      teamName: 'Core Infrastructure Responders',
    },
  });

  // 5. Teams for assignment
  let testTeam = await prisma.team.findFirst();
  if (!testTeam) {
    testTeam = await prisma.team.create({
      data: {
        name: 'SRE Team',
      },
    });
  }

  // 6. Services for each scenario
  // Service A: No integrations (clean)
  const serviceNoIntegrations = await prisma.service.upsert({
    where: { name: 'Isolated Legacy Service' },
    create: {
      name: 'Isolated Legacy Service',
      status: 'OPERATIONAL',
      teamId: testTeam.id,
    },
    update: {
      slackIntegrationId: null,
    },
  });

  // Service B: Slack only
  const serviceSlackOnly = await prisma.service.upsert({
    where: { name: 'Payments Billing Engine' },
    create: {
      name: 'Payments Billing Engine',
      status: 'DEGRADED',
      teamId: testTeam.id,
      slackIntegrationId: slackIntegration.id,
    },
    update: {
      slackIntegrationId: slackIntegration.id,
    },
  });

  // Service C: Teams only
  const serviceTeamsOnly = await prisma.service.upsert({
    where: { name: 'Authentication & OIDC Gateway' },
    create: {
      name: 'Authentication & OIDC Gateway',
      status: 'MAJOR_OUTAGE',
      teamId: testTeam.id,
    },
    update: {
      slackIntegrationId: null,
    },
  });

  const teamsDestOnly = await prisma.microsoftTeamsDestination.upsert({
    where: {
      serviceId_tenantId_teamId_channelId: {
        serviceId: serviceTeamsOnly.id,
        tenantId: 'tenant-demo-123',
        teamId: 'team-demo-456',
        channelId: 'channel-teams-only',
      },
    },
    create: {
      serviceId: serviceTeamsOnly.id,
      tenantId: 'tenant-demo-123',
      teamId: 'team-demo-456',
      channelId: 'channel-teams-only',
      channelName: 'auth-incidents',
      teamName: 'Core Infrastructure Responders',
      installationId: teamsInstallation.id,
      enabled: true,
      interactiveEnabled: true,
      warRoomEnabled: true,
      warRoomAutoCreate: true,
    },
    update: {
      enabled: true,
      warRoomEnabled: true,
    },
  });

  // Service D: Both Slack & Teams
  const serviceBoth = await prisma.service.upsert({
    where: { name: 'Order Checkout & Cart API' },
    create: {
      name: 'Order Checkout & Cart API',
      status: 'MAJOR_OUTAGE',
      teamId: testTeam.id,
      slackIntegrationId: slackIntegration.id,
    },
    update: {
      slackIntegrationId: slackIntegration.id,
    },
  });

  await prisma.microsoftTeamsDestination.upsert({
    where: {
      serviceId_tenantId_teamId_channelId: {
        serviceId: serviceBoth.id,
        tenantId: 'tenant-demo-123',
        teamId: 'team-demo-456',
        channelId: 'channel-both-demo',
      },
    },
    create: {
      serviceId: serviceBoth.id,
      tenantId: 'tenant-demo-123',
      teamId: 'team-demo-456',
      channelId: 'channel-both-demo',
      channelName: 'checkout-war-rooms',
      teamName: 'Core Infrastructure Responders',
      installationId: teamsInstallation.id,
      enabled: true,
      interactiveEnabled: true,
      warRoomEnabled: true,
      warRoomAutoCreate: true,
    },
    update: {
      enabled: true,
      warRoomEnabled: true,
    },
  });

  // 7. Create or update the 8 test incidents
  const scenarios = [
    {
      ref: 'scen-1-none',
      title: 'Scenario 1: No Integrations Configured (Zero War Room UI)',
      serviceId: serviceNoIntegrations.id,
      status: IncidentStatus.OPEN,
      urgency: IncidentUrgency.LOW,
      setupRooms: async (incidentId: string) => {
        await prisma.incidentWarRoom.deleteMany({ where: { incidentId } });
      },
    },
    {
      ref: 'scen-2-slack-uncreated',
      title: 'Scenario 2: Slack Enabled (No War Room Created Yet)',
      serviceId: serviceSlackOnly.id,
      status: IncidentStatus.OPEN,
      urgency: IncidentUrgency.MEDIUM,
      setupRooms: async (incidentId: string) => {
        await prisma.incidentWarRoom.deleteMany({ where: { incidentId } });
      },
    },
    {
      ref: 'scen-3-slack-active',
      title: 'Scenario 3: Slack Active War Room (4 synced responders)',
      serviceId: serviceSlackOnly.id,
      status: IncidentStatus.OPEN,
      urgency: IncidentUrgency.HIGH,
      setupRooms: async (incidentId: string) => {
        await prisma.incidentWarRoom.deleteMany({ where: { incidentId } });
        const room = await prisma.incidentWarRoom.create({
          data: {
            incidentId,
            provider: 'SLACK',
            generation: 1,
            state: 'READY',
            health: 'HEALTHY',
            providerChannelId: 'C_SLACK_WAR_ROOM_01',
            providerChannelName: 'inc-payments-billing-01',
            providerChannelUrl: 'https://slack.com/app_redirect?channel=C_SLACK_WAR_ROOM_01',
            readyAt: new Date(),
          },
        });
        await prisma.warRoomParticipant.createMany({
          data: [
            {
              warRoomId: room.id,
              userId: adminUser!.id,
              source: 'ASSIGNEE',
              state: 'PRESENT',
            },
            {
              warRoomId: room.id,
              userId: responderUser!.id,
              source: 'MANUAL',
              state: 'PRESENT',
            },
          ],
        });
      },
    },
    {
      ref: 'scen-4-teams-active',
      title: 'Scenario 4: Teams Active War Room (Healthy, Standard Channel)',
      serviceId: serviceTeamsOnly.id,
      status: IncidentStatus.OPEN,
      urgency: IncidentUrgency.HIGH,
      setupRooms: async (incidentId: string) => {
        await prisma.incidentWarRoom.deleteMany({ where: { incidentId } });
        const room = await prisma.incidentWarRoom.create({
          data: {
            incidentId,
            provider: 'MICROSOFT_TEAMS',
            generation: 1,
            state: 'READY',
            health: 'HEALTHY',
            destinationId: teamsDestOnly.id,
            providerTenantId: 'tenant-demo-123',
            providerContainerId: 'team-demo-456',
            providerChannelId: '19:teams-active-channel@thread.tacv2',
            providerChannelName: 'inc-auth-gateway-war-room',
            providerChannelUrl:
              'https://teams.microsoft.com/l/channel/19:teams-active-channel@thread.tacv2/inc-auth-gateway-war-room',
            membershipType: 'STANDARD',
            readyAt: new Date(),
          },
        });
        await prisma.warRoomParticipant.createMany({
          data: [
            {
              warRoomId: room.id,
              userId: adminUser!.id,
              source: 'ASSIGNEE',
              state: 'PRESENT',
            },
            {
              warRoomId: room.id,
              userId: responderUser!.id,
              source: 'ESCALATION',
              state: 'PRESENT',
            },
          ],
        });
      },
    },
    {
      ref: 'scen-5-both-active',
      title: 'Scenario 5: Both Slack & Teams Active (Dual Collaboration)',
      serviceId: serviceBoth.id,
      status: IncidentStatus.OPEN,
      urgency: IncidentUrgency.HIGH,
      setupRooms: async (incidentId: string) => {
        await prisma.incidentWarRoom.deleteMany({ where: { incidentId } });
        // Slack room
        const slackRoom = await prisma.incidentWarRoom.create({
          data: {
            incidentId,
            provider: 'SLACK',
            generation: 1,
            state: 'READY',
            health: 'HEALTHY',
            providerChannelId: 'C_CHECKOUT_SLACK',
            providerChannelName: 'inc-checkout-slack-room',
            providerChannelUrl: 'https://slack.com/app_redirect?channel=C_CHECKOUT_SLACK',
            readyAt: new Date(),
          },
        });
        // Teams room
        const teamsRoom = await prisma.incidentWarRoom.create({
          data: {
            incidentId,
            provider: 'MICROSOFT_TEAMS',
            generation: 1,
            state: 'READY',
            health: 'HEALTHY',
            providerTenantId: 'tenant-demo-123',
            providerContainerId: 'team-demo-456',
            providerChannelId: '19:teams-checkout-channel@thread.tacv2',
            providerChannelName: 'inc-checkout-teams-room',
            providerChannelUrl:
              'https://teams.microsoft.com/l/channel/19:teams-checkout-channel@thread.tacv2/inc-checkout-teams-room',
            membershipType: 'STANDARD',
            readyAt: new Date(),
          },
        });
        await prisma.warRoomParticipant.createMany({
          data: [
            {
              warRoomId: slackRoom.id,
              userId: adminUser!.id,
              source: 'ASSIGNEE',
              state: 'PRESENT',
            },
            {
              warRoomId: teamsRoom.id,
              userId: adminUser!.id,
              source: 'ASSIGNEE',
              state: 'PRESENT',
            },
          ],
        });
      },
    },
    {
      ref: 'scen-6-provisioning',
      title: 'Scenario 6: Room Provisioning In Progress (Shows "Creating…")',
      serviceId: serviceBoth.id,
      status: IncidentStatus.OPEN,
      urgency: IncidentUrgency.HIGH,
      setupRooms: async (incidentId: string) => {
        await prisma.incidentWarRoom.deleteMany({ where: { incidentId } });
        await prisma.incidentWarRoom.create({
          data: {
            incidentId,
            provider: 'MICROSOFT_TEAMS',
            generation: 1,
            state: 'PROVISIONING',
            health: 'HEALTHY',
            providerTenantId: 'tenant-demo-123',
            providerContainerId: 'team-demo-456',
            plannedExternalName: 'inc-checkout-provisioning',
            provisioningStartedAt: new Date(),
          },
        });
      },
    },
    {
      ref: 'scen-7-attention-required',
      title: 'Scenario 7: Attention Required (Health Degraded & Permission Error)',
      serviceId: serviceTeamsOnly.id,
      status: IncidentStatus.OPEN,
      urgency: IncidentUrgency.HIGH,
      setupRooms: async (incidentId: string) => {
        await prisma.incidentWarRoom.deleteMany({ where: { incidentId } });
        const room = await prisma.incidentWarRoom.create({
          data: {
            incidentId,
            provider: 'MICROSOFT_TEAMS',
            generation: 1,
            state: 'READY',
            health: 'PERMISSION_ERROR',
            lastErrorCode: 'MISSING_CHANNEL_WRITE_PERMISSION',
            lastError: 'Bot lacks ChannelMember.ReadWrite.Group permission to sync responders.',
            providerTenantId: 'tenant-demo-123',
            providerContainerId: 'team-demo-456',
            providerChannelId: '19:teams-degraded@thread.tacv2',
            providerChannelName: 'inc-degraded-channel',
            providerChannelUrl:
              'https://teams.microsoft.com/l/channel/19:teams-degraded@thread.tacv2/inc-degraded-channel',
            readyAt: new Date(),
          },
        });
        await prisma.warRoomParticipant.createMany({
          data: [
            { warRoomId: room.id, userId: adminUser!.id, source: 'ASSIGNEE', state: 'PRESENT' },
            {
              warRoomId: room.id,
              userId: responderUser!.id,
              source: 'MANUAL',
              state: 'SKIPPED',
              lastError: 'Identity link required',
            },
          ],
        });
      },
    },
    {
      ref: 'scen-8-historical-disabled',
      title: 'Scenario 8: Historical Rooms Preserved (Integration Now Disabled)',
      serviceId: serviceNoIntegrations.id,
      status: IncidentStatus.RESOLVED,
      urgency: IncidentUrgency.HIGH,
      setupRooms: async (incidentId: string) => {
        await prisma.incidentWarRoom.deleteMany({ where: { incidentId } });
        await prisma.incidentWarRoom.create({
          data: {
            incidentId,
            provider: 'MICROSOFT_TEAMS',
            generation: 1,
            state: 'CLOSED',
            health: 'HEALTHY',
            providerTenantId: 'tenant-demo-123',
            providerContainerId: 'team-demo-456',
            providerChannelId: '19:teams-closed@thread.tacv2',
            providerChannelName: 'inc-closed-teams-room',
            providerChannelUrl:
              'https://teams.microsoft.com/l/channel/19:teams-closed@thread.tacv2/inc-closed-teams-room',
            readyAt: new Date(Date.now() - 3600_000 * 24),
            closedAt: new Date(Date.now() - 3600_000 * 12),
          },
        });
        await prisma.incidentWarRoom.create({
          data: {
            incidentId,
            provider: 'SLACK',
            generation: 1,
            state: 'ARCHIVED',
            health: 'HEALTHY',
            providerChannelId: 'C_ARCHIVED_SLACK',
            providerChannelName: 'inc-archived-slack-room',
            providerChannelUrl: 'https://slack.com/app_redirect?channel=C_ARCHIVED_SLACK',
            readyAt: new Date(Date.now() - 3600_000 * 48),
            closedAt: new Date(Date.now() - 3600_000 * 36),
            archivedAt: new Date(Date.now() - 3600_000 * 36),
          },
        });
      },
    },
  ];

  console.log('\nCreating/updating 8 test incidents:');
  for (const s of scenarios) {
    const existing = await prisma.incident.findFirst({
      where: { description: `REF:${s.ref}` },
    });

    let incident;
    if (existing) {
      incident = await prisma.incident.update({
        where: { id: existing.id },
        data: {
          title: s.title,
          serviceId: s.serviceId,
          status: s.status,
          urgency: s.urgency,
        },
      });
    } else {
      incident = await prisma.incident.create({
        data: {
          title: s.title,
          description: `REF:${s.ref}`,
          serviceId: s.serviceId,
          status: s.status,
          urgency: s.urgency,
          assigneeId: adminUser.id,
          teamId: null,
        },
      });
    }

    await s.setupRooms(incident.id);
    console.log(`  [${s.ref}] /incidents/${incident.id} -> ${s.title}`);
  }

  console.log('\n✅ Collaboration scenarios seeded successfully!');
}

main()
  .catch(err => {
    console.error('Error seeding collaboration scenarios:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
