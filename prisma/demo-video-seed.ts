import 'dotenv/config';
import {
  PrismaClient,
  type Role,
  type IncidentUrgency,
  type IncidentStatus,
  type ServiceStatus,
  type EscalationTargetType,
  type ActionItemStatus,
  type ActionItemPriority,
  type NotificationChannel,
  type NotificationStatus,
  type AuditEntityType,
  type IncidentEventType,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

export async function runDemoVideoSeed() {
  const databaseUrl =
    process.env.DOCS_DATABASE_URL ||
    'postgresql://opsknight_docs:opsknight_docs@127.0.0.1:15432/opsknight_docs?schema=public';

  process.env.DOCS_DATABASE_URL = databaseUrl;
  process.env.DATABASE_URL = databaseUrl;
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  try {
    console.log('[demo-video-seed] Connecting to database...');
    const now = Date.now();
    const commonPasswordHash = await bcrypt.hash('Docs-only-harbor-482!', 10);

    // 1. Users
    console.log('[demo-video-seed] Upserting users...');
    const usersData = [
      {
        email: 'maya.patel@opsknight.com',
        name: 'Maya Patel',
        role: 'ADMIN' as Role,
        department: 'Reliability Engineering',
        jobTitle: 'Lead Site Reliability Engineer',
        timeZone: 'America/New_York',
      },
      {
        email: 'maya.chen@opsknight.com',
        name: 'Maya Chen',
        role: 'ADMIN' as Role,
        department: 'Infrastructure',
        jobTitle: 'Director of Reliability',
        timeZone: 'America/New_York',
      },
      {
        email: 'daniel.kim@opsknight.com',
        name: 'Daniel Kim',
        role: 'RESPONDER' as Role,
        department: 'Payments Platform',
        jobTitle: 'Staff Software Engineer',
        timeZone: 'America/New_York',
      },
      {
        email: 'priya.shah@opsknight.com',
        name: 'Priya Shah',
        role: 'RESPONDER' as Role,
        department: 'Payments Platform',
        jobTitle: 'Senior Infrastructure Engineer',
        timeZone: 'America/New_York',
      },
      {
        email: 'alex.rivera@opsknight.com',
        name: 'Alex Rivera',
        role: 'RESPONDER' as Role,
        department: 'Cloud Platform',
        jobTitle: 'Principal Platform Engineer',
        timeZone: 'America/New_York',
      },
      {
        email: 'jordan.lee@opsknight.com',
        name: 'Jordan Lee',
        role: 'USER' as Role,
        department: 'Technical Operations',
        jobTitle: 'Operations Manager',
        timeZone: 'America/New_York',
      },
    ];

    const users = await Promise.all(
      usersData.map(u =>
        prisma.user.upsert({
          where: { email: u.email },
          update: {
            name: u.name,
            role: u.role,
            status: 'ACTIVE',
            department: u.department,
            jobTitle: u.jobTitle,
            timeZone: u.timeZone,
            passwordHash: commonPasswordHash,
            emailNotificationsEnabled: true,
          },
          create: {
            email: u.email,
            name: u.name,
            role: u.role,
            status: 'ACTIVE',
            department: u.department,
            jobTitle: u.jobTitle,
            timeZone: u.timeZone,
            passwordHash: commonPasswordHash,
            emailNotificationsEnabled: true,
          },
        })
      )
    );

    const [adminMaya, adminChen, responderDaniel, responderPriya, responderAlex, userJordan] = users;

    // 2. Teams
    console.log('[demo-video-seed] Upserting teams...');
    const paymentsTeam = await prisma.team.upsert({
      where: { name: 'Payments Platform' },
      update: {
        description: 'End-to-end checkout, payment gateway orchestration, and billing durability',
        teamLeadId: adminMaya.id,
      },
      create: {
        name: 'Payments Platform',
        description: 'End-to-end checkout, payment gateway orchestration, and billing durability',
        teamLeadId: adminMaya.id,
      },
    });

    const infraTeam = await prisma.team.upsert({
      where: { name: 'Cloud Infrastructure' },
      update: {
        description: 'Global Kubernetes clusters, edge gateways, networking, and runtime core',
        teamLeadId: responderAlex.id,
      },
      create: {
        name: 'Cloud Infrastructure',
        description: 'Global Kubernetes clusters, edge gateways, networking, and runtime core',
        teamLeadId: responderAlex.id,
      },
    });

    const securityTeam = await prisma.team.upsert({
      where: { name: 'Security Operations' },
      update: {
        description: 'Identity protection, threat detection, audit enforcement, and compliance',
        teamLeadId: adminChen.id,
      },
      create: {
        name: 'Security Operations',
        description: 'Identity protection, threat detection, audit enforcement, and compliance',
        teamLeadId: adminChen.id,
      },
    });

    // Team Members
    const teamMemberships = [
      { userId: adminMaya.id, teamId: paymentsTeam.id, role: 'OWNER' as const },
      { userId: responderDaniel.id, teamId: paymentsTeam.id, role: 'MEMBER' as const },
      { userId: responderPriya.id, teamId: paymentsTeam.id, role: 'MEMBER' as const },
      { userId: responderAlex.id, teamId: infraTeam.id, role: 'OWNER' as const },
      { userId: adminChen.id, teamId: securityTeam.id, role: 'OWNER' as const },
      { userId: userJordan.id, teamId: paymentsTeam.id, role: 'MEMBER' as const },
    ];

    for (const tm of teamMemberships) {
      await prisma.teamMember.upsert({
        where: { userId_teamId: { userId: tm.userId, teamId: tm.teamId } },
        update: { role: tm.role },
        create: { userId: tm.userId, teamId: tm.teamId, role: tm.role },
      });
    }

    // 3. Schedules
    console.log('[demo-video-seed] Upserting on-call schedules...');
    const paymentsSchedule = await prisma.onCallSchedule.upsert({
      where: { name: 'Payments Primary On-Call' },
      update: {
        timeZone: 'America/New_York',
      },
      create: {
        name: 'Payments Primary On-Call',
        timeZone: 'America/New_York',
      },
    });

    const secondarySchedule = await prisma.onCallSchedule.upsert({
      where: { name: 'Payments Secondary On-Call' },
      update: {
        timeZone: 'America/New_York',
      },
      create: {
        name: 'Payments Secondary On-Call',
        timeZone: 'America/New_York',
      },
    });

    // Layers & Layer Users
    const scheduleLayer = await prisma.onCallLayer.upsert({
      where: { id: 'payments-primary-layer-1' },
      update: {
        name: 'Weekly Primary Rotation',
        rotationLengthHours: 168,
        shiftLengthHours: 168,
        start: new Date(now - 14 * 86_400_000),
      },
      create: {
        id: 'payments-primary-layer-1',
        scheduleId: paymentsSchedule.id,
        name: 'Weekly Primary Rotation',
        rotationLengthHours: 168,
        shiftLengthHours: 168,
        start: new Date(now - 14 * 86_400_000),
      },
    });

    await prisma.onCallLayerUser.deleteMany({ where: { layerId: scheduleLayer.id } });
    await prisma.onCallLayerUser.createMany({
      data: [
        { layerId: scheduleLayer.id, userId: adminMaya.id, position: 0 },
        { layerId: scheduleLayer.id, userId: responderDaniel.id, position: 1 },
        { layerId: scheduleLayer.id, userId: responderPriya.id, position: 2 },
      ],
    });

    // 4. Escalation Policy: "Payments Critical"
    console.log('[demo-video-seed] Upserting escalation policies...');
    const paymentsCriticalPolicy = await prisma.escalationPolicy.upsert({
      where: { name: 'Payments Critical' },
      update: {
        description: 'Immediate automated routing for P1/P2 payment and checkout disruptions',
      },
      create: {
        name: 'Payments Critical',
        description: 'Immediate automated routing for P1/P2 payment and checkout disruptions',
      },
    });

    // Step 1: 0m -> Current On-Call Schedule
    await prisma.escalationRule.upsert({
      where: { policyId_stepOrder: { policyId: paymentsCriticalPolicy.id, stepOrder: 0 } },
      update: {
        targetType: 'SCHEDULE' as EscalationTargetType,
        targetScheduleId: paymentsSchedule.id,
        targetUserId: null,
        targetTeamId: null,
        delayMinutes: 0,
        notificationChannels: ['PUSH', 'EMAIL', 'SLACK'],
      },
      create: {
        policyId: paymentsCriticalPolicy.id,
        stepOrder: 0,
        targetType: 'SCHEDULE' as EscalationTargetType,
        targetScheduleId: paymentsSchedule.id,
        delayMinutes: 0,
        notificationChannels: ['PUSH', 'EMAIL', 'SLACK'],
      },
    });

    // Step 2: 5m -> Payments Platform Team
    await prisma.escalationRule.upsert({
      where: { policyId_stepOrder: { policyId: paymentsCriticalPolicy.id, stepOrder: 1 } },
      update: {
        targetType: 'TEAM' as EscalationTargetType,
        targetScheduleId: null,
        targetUserId: null,
        targetTeamId: paymentsTeam.id,
        delayMinutes: 5,
        notificationChannels: ['EMAIL', 'SLACK'],
      },
      create: {
        policyId: paymentsCriticalPolicy.id,
        stepOrder: 1,
        targetType: 'TEAM' as EscalationTargetType,
        targetTeamId: paymentsTeam.id,
        delayMinutes: 5,
        notificationChannels: ['EMAIL', 'SLACK'],
      },
    });

    // Step 3: 15m -> Secondary schedule
    await prisma.escalationRule.upsert({
      where: { policyId_stepOrder: { policyId: paymentsCriticalPolicy.id, stepOrder: 2 } },
      update: {
        targetType: 'SCHEDULE' as EscalationTargetType,
        targetScheduleId: secondarySchedule.id,
        targetUserId: null,
        targetTeamId: null,
        delayMinutes: 15,
        notificationChannels: ['EMAIL', 'VOICE'],
      },
      create: {
        policyId: paymentsCriticalPolicy.id,
        stepOrder: 2,
        targetType: 'SCHEDULE' as EscalationTargetType,
        targetScheduleId: secondarySchedule.id,
        delayMinutes: 15,
        notificationChannels: ['EMAIL', 'VOICE'],
      },
    });

    // 5. Services
    console.log('[demo-video-seed] Upserting services...');
    const checkoutService = await prisma.service.upsert({
      where: { name: 'Checkout API' },
      update: {
        description: 'Core customer payment authorization, tokenization, and checkout flow',
        teamId: paymentsTeam.id,
        escalationPolicyId: paymentsCriticalPolicy.id,
        status: 'OPERATIONAL' as ServiceStatus,
        region: 'Global',
        slaTier: 'Tier 1',
      },
      create: {
        name: 'Checkout API',
        description: 'Core customer payment authorization, tokenization, and checkout flow',
        teamId: paymentsTeam.id,
        escalationPolicyId: paymentsCriticalPolicy.id,
        status: 'OPERATIONAL' as ServiceStatus,
        region: 'Global',
        slaTier: 'Tier 1',
      },
    });

    const otherServicesData = [
      {
        name: 'Auth Gateway',
        description: 'OAuth2 session management, token issuance, and federated SSO ingress',
        teamId: securityTeam.id,
        escalationPolicyId: paymentsCriticalPolicy.id,
        status: 'OPERATIONAL' as ServiceStatus,
        region: 'Global',
        slaTier: 'Tier 1',
      },
      {
        name: 'Billing Ingestion',
        description: 'High-throughput subscription recurring billing and usage metering',
        teamId: paymentsTeam.id,
        escalationPolicyId: paymentsCriticalPolicy.id,
        status: 'OPERATIONAL' as ServiceStatus,
        region: 'US & EU',
        slaTier: 'Tier 1',
      },
      {
        name: 'Order Processing',
        description: 'Post-authorization order confirmation, inventory reservation, and webhooks',
        teamId: paymentsTeam.id,
        escalationPolicyId: paymentsCriticalPolicy.id,
        status: 'OPERATIONAL' as ServiceStatus,
        region: 'US East',
        slaTier: 'Tier 2',
      },
      {
        name: 'Customer Webhook Service',
        description: 'Idempotent webhook dispatch engine with backoff retries and DLQ',
        teamId: infraTeam.id,
        escalationPolicyId: paymentsCriticalPolicy.id,
        status: 'OPERATIONAL' as ServiceStatus,
        region: 'Global',
        slaTier: 'Tier 2',
      },
    ];

    const additionalServices = await Promise.all(
      otherServicesData.map(s =>
        prisma.service.upsert({
          where: { name: s.name },
          update: s,
          create: s,
        })
      )
    );

    // 6. Featured Incident: "Checkout API: elevated authorization failures"
    console.log('[demo-video-seed] Recreating featured incident...');
    const incidentCreatedAt = new Date(now - 42 * 60_000);
    const incidentAckedAt = new Date(now - 39 * 60_000);
    const incidentResolvedAt = new Date(now - 6 * 60_000);

    const demoIncidentIds = [
      'incident-checkout-auth-failures',
      'incident-billing-backlog',
      'incident-auth-token-errors',
      'incident-webhook-retry-spike',
    ];

    await prisma.notification.deleteMany({ where: { incidentId: { in: demoIncidentIds } } });
    await prisma.incidentEvent.deleteMany({ where: { incidentId: { in: demoIncidentIds } } });
    await prisma.incidentNote.deleteMany({ where: { incidentId: { in: demoIncidentIds } } });
    await prisma.actionItem.deleteMany({ where: { incidentId: { in: demoIncidentIds } } });
    await prisma.postmortem.deleteMany({ where: { incidentId: { in: demoIncidentIds } } });
    await prisma.statusPageAnnouncement.deleteMany({ where: { incidentId: { in: demoIncidentIds } } });
    await prisma.incident.deleteMany({ where: { id: { in: demoIncidentIds } } });

    const featuredIncident = await prisma.incident.create({
      data: {
        id: 'incident-checkout-auth-failures',
        title: 'Checkout API: elevated authorization failures',
        description:
          'Automated Datadog probe detected elevated HTTP 504 and payment gateway timeouts exceeding SLO thresholds (> 4.8% error rate, p99 latency > 2.8s).',
        priority: 'P1',
        urgency: 'HIGH' as IncidentUrgency,
        status: 'RESOLVED' as IncidentStatus,
        serviceId: checkoutService.id,
        assigneeId: adminMaya.id,
        teamId: null,
        slaAckTargetMs: 900_000,
        slaResolveTargetMs: 3_600_000,
        slaTargetSource: 'service',
        slaTargetCapturedAt: incidentCreatedAt,
        createdAt: incidentCreatedAt,
        acknowledgedAt: incidentAckedAt,
        resolvedAt: incidentResolvedAt,
      },
    });

    // Incident Timeline Events (Triggered -> Assigned -> Acknowledged -> Updates -> Resolved)
    const timelineEvents: Array<{
      id: string;
      type: IncidentEventType;
      message: string;
      createdAt: Date;
    }> = [
      {
        id: 'event-feat-triggered',
        type: 'STATUS_CHANGE',
        message: 'Incident triggered: Datadog alert [P1-CRITICAL] Checkout API authorization error rate > 4.8%',
        createdAt: incidentCreatedAt,
      },
      {
        id: 'event-feat-assigned',
        type: 'ASSIGNMENT',
        message: 'Escalation policy "Payments Critical" routed incident to primary on-call: Maya Patel',
        createdAt: new Date(incidentCreatedAt.getTime() + 15_000),
      },
      {
        id: 'event-feat-ack',
        type: 'ACKNOWLEDGED',
        message: 'Maya Patel acknowledged incident and initialized investigation war room',
        createdAt: incidentAckedAt,
      },
      {
        id: 'event-feat-comment-1',
        type: 'COMMENT',
        message:
          'Investigation update: Identified TCP connection pool saturation with primary acquiring bank gateway. Applying circuit breaker shedding.',
        createdAt: new Date(incidentAckedAt.getTime() + 12 * 60_000),
      },
      {
        id: 'event-feat-comment-2',
        type: 'COMMENT',
        message:
          'Mitigation applied: Traffic shifted 40% to secondary payment processor rail. Connection pool size doubled to 600 concurrent sockets.',
        createdAt: new Date(incidentAckedAt.getTime() + 24 * 60_000),
      },
      {
        id: 'event-feat-resolved',
        type: 'MANUAL_RESOLVED',
        message:
          'Resolution confirmed: Payment provider connection saturation cleared. Authorization error rate normalized to 0.01%, p99 latency < 210ms.',
        createdAt: incidentResolvedAt,
      },
    ];

    for (const evt of timelineEvents) {
      await prisma.incidentEvent.upsert({
        where: { id: evt.id },
        update: { incidentId: featuredIncident.id, type: evt.type, message: evt.message, createdAt: evt.createdAt },
        create: { id: evt.id, incidentId: featuredIncident.id, type: evt.type, message: evt.message, createdAt: evt.createdAt },
      });
    }

    // Incident Notes
    await prisma.incidentNote.upsert({
      where: { id: 'note-feat-1' },
      update: {
        incidentId: featuredIncident.id,
        userId: adminMaya.id,
        content:
          'Primary connection saturation confirmed. Upstream gateway socket limits hit cap of 200 during sudden flash promotion traffic burst.',
      },
      create: {
        id: 'note-feat-1',
        incidentId: featuredIncident.id,
        userId: adminMaya.id,
        content:
          'Primary connection saturation confirmed. Upstream gateway socket limits hit cap of 200 during sudden flash promotion traffic burst.',
      },
    });

    await prisma.incidentNote.upsert({
      where: { id: 'note-feat-2' },
      update: {
        incidentId: featuredIncident.id,
        userId: responderDaniel.id,
        content:
          'Resolution: Payment provider connection saturation cleared after upstream connection pool resize and secondary rail auto-failover verified.',
      },
      create: {
        id: 'note-feat-2',
        incidentId: featuredIncident.id,
        userId: responderDaniel.id,
        content:
          'Resolution: Payment provider connection saturation cleared after upstream connection pool resize and secondary rail auto-failover verified.',
      },
    });

    // 7. Postmortem for Featured Incident
    console.log('[demo-video-seed] Upserting postmortem...');
    const postmortem = await prisma.postmortem.upsert({
      where: { incidentId: featuredIncident.id },
      update: {
        title: 'Postmortem: Checkout API Authorization Latency & Failure Spike',
        summary:
          'On Oct 3, 2026, the Checkout API experienced elevated authorization failures and latency exceeding SLO targets for 36 minutes due to connection pool saturation with the upstream payment acquirer during an unexpected traffic surge.',
        rootCause:
          'The upstream payment acquirer TCP connection pool had a maximum cap of 200 concurrent sockets, which was exhausted when incoming transactions spiked 2.5x normal baseline.',
        resolution:
          'Traffic shedding was activated immediately, shifting 40% of authorization volume to the secondary payment processor. Upstream connection pool capacity was dynamically resized to 600 connections.',
        lessons:
          '1. Dynamic connection pooling with circuit breaking prevents cascading socket exhaustion under surge conditions.\n2. Multi-rail payment failover should trigger automatically when p95 latency exceeds 2 seconds.\n3. Synthetic monitoring probes caught the failure pattern 4 minutes ahead of customer support escalations.',
        status: 'PUBLISHED',
        isPublic: true,
        publishedAt: new Date(incidentResolvedAt.getTime() + 15 * 60_000),
      },
      create: {
        incidentId: featuredIncident.id,
        title: 'Postmortem: Checkout API Authorization Latency & Failure Spike',
        summary:
          'On Oct 3, 2026, the Checkout API experienced elevated authorization failures and latency exceeding SLO targets for 36 minutes due to connection pool saturation with the upstream payment acquirer during an unexpected traffic surge.',
        rootCause:
          'The upstream payment acquirer TCP connection pool had a maximum cap of 200 concurrent sockets, which was exhausted when incoming transactions spiked 2.5x normal baseline.',
        resolution:
          'Traffic shedding was activated immediately, shifting 40% of authorization volume to the secondary payment processor. Upstream connection pool capacity was dynamically resized to 600 connections.',
        lessons:
          '1. Dynamic connection pooling with circuit breaking prevents cascading socket exhaustion under surge conditions.\n2. Multi-rail payment failover should trigger automatically when p95 latency exceeds 2 seconds.\n3. Synthetic monitoring probes caught the failure pattern 4 minutes ahead of customer support escalations.',
        status: 'PUBLISHED',
        isPublic: true,
        publishedAt: new Date(incidentResolvedAt.getTime() + 15 * 60_000),
      },
    });

    // 8. Action Items linked to Postmortem
    console.log('[demo-video-seed] Upserting action items...');
    const actionItemsData = [
      {
        id: 'action-pool-expansion',
        title: 'Increase acquiring bank gateway max pool connections to 600 sockets',
        description: 'Deploy Terraform update for connection pool configuration across all payment worker nodes.',
        status: 'COMPLETED' as ActionItemStatus,
        priority: 'HIGH' as ActionItemPriority,
        ownerId: adminMaya.id,
        days: 7,
      },
      {
        id: 'action-circuit-breaker',
        title: 'Implement automated multi-rail payment fallback circuit breaker',
        description: 'Add Envoy adaptive concurrency limiting and automated routing to secondary acquiring processor.',
        status: 'IN_PROGRESS' as ActionItemStatus,
        priority: 'HIGH' as ActionItemPriority,
        ownerId: responderDaniel.id,
        days: 14,
      },
      {
        id: 'action-failover-drill',
        title: 'Conduct quarterly payment partner failover stress drill',
        description: 'Simulate upstream socket saturation and verify zero-downtime traffic deflection under synthetic load.',
        status: 'OPEN' as ActionItemStatus,
        priority: 'MEDIUM' as ActionItemPriority,
        ownerId: responderAlex.id,
        days: 30,
      },
      {
        id: 'action-idempotency',
        title: 'Update customer checkout error handling with retry idempotency headers',
        description: 'Ensure client web & mobile apps provide safe automatic retries for transient HTTP 504 timeouts.',
        status: 'OPEN' as ActionItemStatus,
        priority: 'LOW' as ActionItemPriority,
        ownerId: responderPriya.id,
        days: 45,
      },
    ];

    for (const item of actionItemsData) {
      await prisma.actionItem.upsert({
        where: { id: item.id },
        update: {
          title: item.title,
          description: item.description,
          ownerId: item.ownerId,
          status: item.status,
          priority: item.priority,
          dueDate: new Date(now + item.days * 86_400_000),
          completedAt: item.status === 'COMPLETED' ? new Date(now - 86_400_000) : null,
        },
        create: {
          id: item.id,
          postmortemId: postmortem.id,
          incidentId: featuredIncident.id,
          title: item.title,
          description: item.description,
          ownerId: item.ownerId,
          status: item.status,
          priority: item.priority,
          source: 'POSTMORTEM',
          dueDate: new Date(now + item.days * 86_400_000),
          completedAt: item.status === 'COMPLETED' ? new Date(now - 86_400_000) : null,
        },
      });
    }

    // 9. Status Page: "Northstar Systems Status" (slug: "northstar-systems")
    console.log('[demo-video-seed] Upserting status page...');
    const statusPage = await prisma.statusPage.upsert({
      where: { slug: 'northstar-systems' },
      update: {
        name: 'Northstar Systems Status',
        organizationName: 'Northstar Systems',
        contactEmail: 'status@northstar.example',
        enabled: true,
        showServices: true,
        showIncidents: true,
        showMetrics: true,
        showSubscribe: true,
        showUptimeHistory: true,
        showIncidentHistoryDetails: true,
        customDomain: 'status.northstar.example',
      },
      create: {
        slug: 'northstar-systems',
        name: 'Northstar Systems Status',
        organizationName: 'Northstar Systems',
        contactEmail: 'status@northstar.example',
        enabled: true,
        showServices: true,
        showIncidents: true,
        showMetrics: true,
        showSubscribe: true,
        showUptimeHistory: true,
        showIncidentHistoryDetails: true,
        customDomain: 'status.northstar.example',
      },
    });

    // Map services to status page
    const allServices = [checkoutService, ...additionalServices];
    for (const [order, svc] of allServices.entries()) {
      await prisma.statusPageService.upsert({
        where: {
          statusPageId_serviceId: {
            statusPageId: statusPage.id,
            serviceId: svc.id,
          },
        },
        update: { order, showOnPage: true },
        create: {
          statusPageId: statusPage.id,
          serviceId: svc.id,
          order,
          showOnPage: true,
        },
      });
    }

    // Status Page Announcement
    await prisma.statusPageAnnouncement.deleteMany({ where: { statusPageId: statusPage.id } });
    await prisma.statusPageAnnouncement.create({
      data: {
        statusPageId: statusPage.id,
        title: 'Upcoming Maintenance: Payment Acquirer Upstream Gateway Upgrade',
        message:
          'Our primary upstream banking partner will perform planned infrastructure upgrades on Sunday, Oct 12 between 02:00 and 03:00 UTC. Secondary payment rails will absorb all transactions with zero customer disruption expected.',
        startDate: new Date(now - 2 * 86_400_000),
        endDate: new Date(now + 9 * 86_400_000),
        isActive: true,
      },
    });

    // 10. Additional Active / Recent Incidents for realism
    console.log('[demo-video-seed] Upserting additional operational incidents...');
    const extraIncidents = [
      {
        id: 'incident-billing-backlog',
        title: 'Billing Ingestion: Kafka consumer lag exceeding 50k messages',
        priority: 'P2',
        urgency: 'HIGH' as IncidentUrgency,
        status: 'ACKNOWLEDGED' as IncidentStatus,
        serviceId: additionalServices[1].id, // Billing Ingestion
        teamId: null,
        assigneeId: responderDaniel.id,
        createdAt: new Date(now - 18 * 60_000),
        acknowledgedAt: new Date(now - 14 * 60_000),
      },
      {
        id: 'incident-auth-token-errors',
        title: 'Auth Gateway: elevated OAuth token validation rate on region eu-central-1',
        priority: 'P2',
        urgency: 'MEDIUM' as IncidentUrgency,
        status: 'RESOLVED' as IncidentStatus,
        serviceId: additionalServices[0].id, // Auth Gateway
        teamId: null,
        assigneeId: adminChen.id,
        createdAt: new Date(now - 120 * 60_000),
        acknowledgedAt: new Date(now - 116 * 60_000),
        resolvedAt: new Date(now - 84 * 60_000),
      },
      {
        id: 'incident-webhook-retry-spike',
        title: 'Customer Webhook Service: transient retry exhaustion on third-party endpoints',
        priority: 'P3',
        urgency: 'LOW' as IncidentUrgency,
        status: 'RESOLVED' as IncidentStatus,
        serviceId: additionalServices[3].id, // Customer Webhook Service
        teamId: null,
        assigneeId: responderAlex.id,
        createdAt: new Date(now - 340 * 60_000),
        acknowledgedAt: new Date(now - 330 * 60_000),
        resolvedAt: new Date(now - 310 * 60_000),
      },
    ];

    for (const inc of extraIncidents) {
      await prisma.incident.create({
        data: {
          ...inc,
          slaAckTargetMs: 600_000,
          slaResolveTargetMs: 7_200_000,
          slaTargetSource: 'service',
          slaTargetCapturedAt: inc.createdAt,
        },
      });
    }

    // 11. Notification History Records
    console.log('[demo-video-seed] Upserting notification delivery records...');
    const notificationFixtures = [
      {
        id: 'notif-1-push',
        channel: 'PUSH' as NotificationChannel,
        status: 'DELIVERED' as NotificationStatus,
        recipientDisplay: 'Maya Patel (iOS Push / Safari)',
        userId: adminMaya.id,
        incidentId: featuredIncident.id,
        createdAt: new Date(incidentCreatedAt.getTime() + 4_000),
        sentAt: new Date(incidentCreatedAt.getTime() + 5_000),
        deliveredAt: new Date(incidentCreatedAt.getTime() + 6_000),
      },
      {
        id: 'notif-2-email',
        channel: 'EMAIL' as NotificationChannel,
        status: 'DELIVERED' as NotificationStatus,
        recipientDisplay: 'maya.patel@opsknight.com',
        userId: adminMaya.id,
        incidentId: featuredIncident.id,
        createdAt: new Date(incidentCreatedAt.getTime() + 5_000),
        sentAt: new Date(incidentCreatedAt.getTime() + 7_000),
        deliveredAt: new Date(incidentCreatedAt.getTime() + 9_000),
      },
      {
        id: 'notif-3-slack',
        channel: 'SLACK' as NotificationChannel,
        status: 'DELIVERED' as NotificationStatus,
        recipientDisplay: '#payments-critical-alerts',
        userId: adminMaya.id,
        incidentId: featuredIncident.id,
        createdAt: new Date(incidentCreatedAt.getTime() + 6_000),
        sentAt: new Date(incidentCreatedAt.getTime() + 7_000),
        deliveredAt: new Date(incidentCreatedAt.getTime() + 8_000),
      },
      {
        id: 'notif-4-sms',
        channel: 'SMS' as NotificationChannel,
        status: 'DELIVERED' as NotificationStatus,
        recipientDisplay: '+1 (555) 019-4821',
        userId: responderDaniel.id,
        incidentId: featuredIncident.id,
        createdAt: new Date(incidentCreatedAt.getTime() + 10_000),
        sentAt: new Date(incidentCreatedAt.getTime() + 12_000),
        deliveredAt: new Date(incidentCreatedAt.getTime() + 15_000),
      },
      {
        id: 'notif-5-voice',
        channel: 'VOICE' as NotificationChannel,
        status: 'DELIVERED' as NotificationStatus,
        recipientDisplay: '+1 (555) 019-9432',
        userId: responderAlex.id,
        incidentId: featuredIncident.id,
        createdAt: new Date(incidentCreatedAt.getTime() + 15_000),
        sentAt: new Date(incidentCreatedAt.getTime() + 18_000),
        deliveredAt: new Date(incidentCreatedAt.getTime() + 24_000),
      },
      {
        id: 'notif-6-whatsapp',
        channel: 'WHATSAPP' as NotificationChannel,
        status: 'DELIVERED' as NotificationStatus,
        recipientDisplay: '+1 (555) 018-3829 (WhatsApp Verified)',
        userId: responderPriya.id,
        incidentId: featuredIncident.id,
        createdAt: new Date(incidentCreatedAt.getTime() + 20_000),
        sentAt: new Date(incidentCreatedAt.getTime() + 22_000),
        deliveredAt: new Date(incidentCreatedAt.getTime() + 25_000),
      },
    ];

    for (const notif of notificationFixtures) {
      await prisma.notification.upsert({
        where: { id: notif.id },
        update: notif,
        create: notif,
      });
    }

    // 12. Dashboards (Executive & SRE)
    console.log('[demo-video-seed] Upserting operational dashboards...');
    const execDashboard = await prisma.dashboard.upsert({
      where: { id: 'docs-dashboard-executive' },
      update: {
        name: 'Production Reliability Overview',
        description: 'Executive view of incident volume, response performance, and service health.',
        visibility: 'PUBLIC' as const,
        userId: adminMaya.id,
        layout: { columns: 4, rowHeight: 150 },
      },
      create: {
        id: 'docs-dashboard-executive',
        name: 'Production Reliability Overview',
        description: 'Executive view of incident volume, response performance, and service health.',
        visibility: 'PUBLIC' as const,
        userId: adminMaya.id,
        layout: { columns: 4, rowHeight: 150 },
      },
    });

    await prisma.dashboardWidget.deleteMany({ where: { dashboardId: execDashboard.id } });
    await prisma.dashboardWidget.createMany({
      data: [
        {
          id: 'exec-w-total-incidents',
          dashboardId: execDashboard.id,
          widgetDefinitionId: 'total-incidents',
          widgetType: 'metric',
          metricKey: 'totalIncidents',
          title: 'Total Incidents (30d)',
          position: { x: 0, y: 0, w: 1, h: 1 },
          config: {},
        },
        {
          id: 'exec-w-active-incidents',
          dashboardId: execDashboard.id,
          widgetDefinitionId: 'active-incidents',
          widgetType: 'metric',
          metricKey: 'activeIncidents',
          title: 'Active Incidents',
          position: { x: 1, y: 0, w: 1, h: 1 },
          config: {},
        },
        {
          id: 'exec-w-mttr',
          dashboardId: execDashboard.id,
          widgetDefinitionId: 'mttr',
          widgetType: 'metric',
          metricKey: 'mttr',
          title: 'Mean Time to Resolve (MTTR)',
          position: { x: 2, y: 0, w: 1, h: 1 },
          config: {},
        },
        {
          id: 'exec-w-ack-compliance',
          dashboardId: execDashboard.id,
          widgetDefinitionId: 'ack-compliance',
          widgetType: 'gauge',
          metricKey: 'ackCompliance',
          title: 'Acknowledgment SLA (99.4%)',
          position: { x: 3, y: 0, w: 1, h: 1 },
          config: {},
        },
        {
          id: 'exec-w-trend',
          dashboardId: execDashboard.id,
          widgetDefinitionId: 'incident-trend',
          widgetType: 'chart',
          metricKey: 'trendSeries',
          title: '30-Day Incident Volume & Severity Trend',
          position: { x: 0, y: 1, w: 4, h: 2 },
          config: { chartType: 'count' },
        },
        {
          id: 'exec-w-services',
          dashboardId: execDashboard.id,
          widgetDefinitionId: 'service-health',
          widgetType: 'table',
          metricKey: 'serviceMetrics',
          title: 'Tier-1 Service Health & Availability',
          position: { x: 0, y: 3, w: 2, h: 2 },
          config: {},
        },
        {
          id: 'exec-w-insights',
          dashboardId: execDashboard.id,
          widgetDefinitionId: 'smart-insights',
          widgetType: 'insights',
          metricKey: 'insights',
          title: 'Reliability & Drift Insights',
          position: { x: 2, y: 3, w: 2, h: 2 },
          config: {},
        },
      ],
    });

    // 13. Audit Trail Records
    console.log('[demo-video-seed] Upserting audit log records...');
    const auditRecords = [
      {
        id: 'audit-demo-1',
        action: 'SERVICE_UPDATED',
        entityType: 'SERVICE' as AuditEntityType,
        entityId: checkoutService.id,
        details: { name: 'Checkout API', field: 'escalationPolicy', value: 'Payments Critical' },
        actorId: adminMaya.id,
        actorEmail: adminMaya.email,
        actorName: adminMaya.name,
        createdAt: new Date(now - 15 * 60_000),
      },
      {
        id: 'audit-demo-2',
        action: 'SCHEDULE_ROTATION_UPDATED',
        entityType: 'SCHEDULE' as AuditEntityType,
        entityId: paymentsSchedule.id,
        details: { name: 'Payments Primary On-Call', rotation: 'Weekly', shiftLength: 168 },
        actorId: adminMaya.id,
        actorEmail: adminMaya.email,
        actorName: adminMaya.name,
        createdAt: new Date(now - 30 * 60_000),
      },
      {
        id: 'audit-demo-3',
        action: 'STATUS_PAGE_PUBLISHED',
        entityType: 'STATUS_PAGE' as AuditEntityType,
        entityId: statusPage.id,
        details: { slug: statusPage.slug, servicesCount: allServices.length },
        actorId: adminChen.id,
        actorEmail: adminChen.email,
        actorName: adminChen.name,
        createdAt: new Date(now - 60 * 60_000),
      },
      {
        id: 'audit-demo-4',
        action: 'POLICY_STEP_CONFIGURED',
        entityType: 'ESCALATION_POLICY' as AuditEntityType,
        entityId: paymentsCriticalPolicy.id,
        details: { policy: 'Payments Critical', step: 2, delayMinutes: 15 },
        actorId: adminMaya.id,
        actorEmail: adminMaya.email,
        actorName: adminMaya.name,
        createdAt: new Date(now - 120 * 60_000),
      },
    ];

    for (const record of auditRecords) {
      await prisma.auditLog.upsert({
        where: { id: record.id },
        update: record,
        create: record,
      });
    }

    console.log('[demo-video-seed] Seed completed successfully!');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runDemoVideoSeed()
    .then(() => {
      console.log('Demo seed execution finished.');
      process.exit(0);
    })
    .catch(err => {
      console.error('Demo seed error:', err);
      process.exit(1);
    });
}
