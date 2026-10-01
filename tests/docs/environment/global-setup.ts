import { PrismaClient, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createHmac } from 'node:crypto';
import { DOCS_ADMIN, DOCS_API_KEY, DOCS_FIXTURES, DOCS_RESPONDER, DOCS_VIEWER } from '../fixtures/constants';

export default async function globalSetup() {
  const databaseUrl = process.env.DOCS_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl || !/opsknight_docs/.test(databaseUrl)) {
    throw new Error('Documentation journeys require an isolated database URL containing "opsknight_docs".');
  }
  process.env.DATABASE_URL = databaseUrl;
  const prisma = new PrismaClient();
  try {
    const legacyEmails = [
      ['docs-admin@example.test', DOCS_ADMIN.email],
      ['docs-responder@example.test', DOCS_RESPONDER.email],
      ['docs-viewer@example.test', DOCS_VIEWER.email],
    ] as const;
    for (const [legacyEmail, email] of legacyEmails) {
      await prisma.user.updateMany({ where: { email: legacyEmail }, data: { email } });
    }
    await prisma.team.updateMany({ where: { name: 'Platform' }, data: { name: DOCS_FIXTURES.team } });
    await prisma.service.updateMany({ where: { name: 'Checkout' }, data: { name: DOCS_FIXTURES.service } });
    await prisma.onCallSchedule.updateMany({ where: { name: 'Platform Primary' }, data: { name: DOCS_FIXTURES.schedule } });
    await prisma.escalationPolicy.updateMany({ where: { name: 'Platform Escalation' }, data: { name: DOCS_FIXTURES.policy } });
    await prisma.statusPage.updateMany({ where: { name: 'Acme Status' }, data: { name: DOCS_FIXTURES.statusPage, slug: 'northstar-systems', organizationName: 'Northstar Systems' } });
    await prisma.incident.updateMany({ where: { title: 'Checkout latency is above threshold' }, data: { title: DOCS_FIXTURES.incident } });
    await prisma.incident.deleteMany({ where: { title: 'Payments API synthetic contract incident' } });
    const userFixtures: Array<{ fixture: typeof DOCS_ADMIN | typeof DOCS_RESPONDER | typeof DOCS_VIEWER; role: Role }> = [
      { fixture: DOCS_ADMIN, role: 'ADMIN' },
      { fixture: DOCS_RESPONDER, role: 'RESPONDER' },
      { fixture: DOCS_VIEWER, role: 'USER' },
    ];
    const users = await Promise.all(userFixtures.map(async ({ fixture, role }) => prisma.user.upsert({
      where: { email: fixture.email },
      update: { name: fixture.name, role, status: 'ACTIVE', passwordHash: await bcrypt.hash(fixture.password, 10) },
      create: { email: fixture.email, name: fixture.name, role, status: 'ACTIVE', passwordHash: await bcrypt.hash(fixture.password, 10) },
    })));
    const [admin, responder, viewer] = users;
    const fixturePasswordHash = await bcrypt.hash('Docs-only-enterprise-795!', 10);
    const additionalUsers = await Promise.all([
      { email: 'elena.rodriguez@opsknight.com', name: 'Elena Rodriguez', role: 'RESPONDER' as Role, department: 'Infrastructure', jobTitle: 'Senior Site Reliability Engineer' },
      { email: 'marcus.johnson@opsknight.com', name: 'Marcus Johnson', role: 'RESPONDER' as Role, department: 'Data Platform', jobTitle: 'Staff Platform Engineer' },
      { email: 'aisha.patel@opsknight.com', name: 'Aisha Patel', role: 'RESPONDER' as Role, department: 'Security', jobTitle: 'Security Operations Lead' },
      { email: 'noah.williams@opsknight.com', name: 'Noah Williams', role: 'USER' as Role, department: 'Customer Experience', jobTitle: 'Support Operations Manager' },
      { email: 'sophie.laurent@opsknight.com', name: 'Sophie Laurent', role: 'ADMIN' as Role, department: 'Engineering', jobTitle: 'Director of Reliability' },
    ].map(person => prisma.user.upsert({
      where: { email: person.email },
      update: { ...person, status: 'ACTIVE', passwordHash: fixturePasswordHash, timeZone: 'America/New_York', emailNotificationsEnabled: true },
      create: { ...person, status: 'ACTIVE', passwordHash: fixturePasswordHash, timeZone: 'America/New_York', emailNotificationsEnabled: true },
    })));
    const apiKeySecret = process.env.API_KEY_SECRET || process.env.NEXTAUTH_SECRET || 'docs-runtime-only-nextauth-secret';
    const tokenHash = createHmac('sha256', apiKeySecret)
      .update(`opsknight:api-key:v2:${DOCS_API_KEY}`)
      .digest('hex');
    await prisma.apiKey.upsert({
      where: { id: 'docs-api-contract-key' },
      update: { tokenHash, userId: admin.id, revokedAt: null, expiresAt: null },
      create: {
        id: 'docs-api-contract-key',
        name: 'Documentation contract verification',
        prefix: DOCS_API_KEY.slice(0, 12),
        tokenHash,
        scopes: ['incidents:read', 'incidents:write', 'events:write'],
        userId: admin.id,
      },
    });
    const team = await prisma.team.upsert({
      where: { name: DOCS_FIXTURES.team },
      update: { description: 'Reliability ownership for customer checkout services', teamLeadId: responder.id },
      create: { name: DOCS_FIXTURES.team, description: 'Reliability ownership for customer checkout services', teamLeadId: responder.id },
    });
    await Promise.all(users.map(user => prisma.teamMember.upsert({
      where: { userId_teamId: { userId: user.id, teamId: team.id } },
      update: { role: user.id === admin.id ? 'OWNER' : 'MEMBER' },
      create: { userId: user.id, teamId: team.id, role: user.id === admin.id ? 'OWNER' : 'MEMBER' },
    })));
    const teamFixtures = [
      { name: 'Platform Infrastructure', description: 'Cloud foundations, edge networking, and shared runtime services', lead: additionalUsers[0] },
      { name: 'Data Reliability', description: 'Streaming, analytics, and customer reporting platforms', lead: additionalUsers[1] },
      { name: 'Security Operations', description: 'Identity, access, threat detection, and compliance response', lead: additionalUsers[2] },
    ];
    const additionalTeams = await Promise.all(teamFixtures.map(item => prisma.team.upsert({
      where: { name: item.name },
      update: { description: item.description, teamLeadId: item.lead.id },
      create: { name: item.name, description: item.description, teamLeadId: item.lead.id },
    })));
    const teamOwnerPairs = [
      { team: additionalTeams[0], owner: additionalUsers[0] },
      { team: additionalTeams[1], owner: additionalUsers[1] },
      { team: additionalTeams[2], owner: additionalUsers[2] },
    ];
    for (const { team: ownedTeam, owner } of teamOwnerPairs) {
      const members = [owner, additionalUsers[4], admin];
      await Promise.all(members.map(member => prisma.teamMember.upsert({
        where: { userId_teamId: { userId: member.id, teamId: ownedTeam.id } },
        update: { role: member.id === owner.id ? 'OWNER' : 'MEMBER' },
        create: { userId: member.id, teamId: ownedTeam.id, role: member.id === owner.id ? 'OWNER' : 'MEMBER' },
      })));
    }
    const policy = await prisma.escalationPolicy.upsert({
      where: { name: DOCS_FIXTURES.policy },
      update: { description: 'Primary and backup response for critical commerce incidents' },
      create: { name: DOCS_FIXTURES.policy, description: 'Primary and backup response for critical commerce incidents' },
    });
    await prisma.escalationRule.upsert({
      where: { policyId_stepOrder: { policyId: policy.id, stepOrder: 0 } },
      update: { targetType: 'USER', targetUserId: responder.id, delayMinutes: 0, notificationChannels: ['EMAIL'] },
      create: { policyId: policy.id, stepOrder: 0, targetType: 'USER', targetUserId: responder.id, delayMinutes: 0, notificationChannels: ['EMAIL'] },
    });
    const additionalPolicies = await Promise.all([
      { name: 'Platform Production Escalation', description: '24×7 response for shared production infrastructure', userId: additionalUsers[0].id, teamId: additionalTeams[0].id },
      { name: 'Data Pipeline Escalation', description: 'Streaming and analytics incident response with engineering backup', userId: additionalUsers[1].id, teamId: additionalTeams[1].id },
      { name: 'Security Incident Escalation', description: 'Immediate security operations response and leadership notification', userId: additionalUsers[2].id, teamId: additionalTeams[2].id },
    ].map(async item => {
      const createdPolicy = await prisma.escalationPolicy.upsert({
        where: { name: item.name },
        update: { description: item.description },
        create: { name: item.name, description: item.description },
      });
      await prisma.escalationRule.upsert({
        where: { policyId_stepOrder: { policyId: createdPolicy.id, stepOrder: 0 } },
        update: { targetType: 'USER', targetUserId: item.userId, targetTeamId: null, delayMinutes: 0, notificationChannels: ['EMAIL', 'PUSH'] },
        create: { policyId: createdPolicy.id, stepOrder: 0, targetType: 'USER', targetUserId: item.userId, delayMinutes: 0, notificationChannels: ['EMAIL', 'PUSH'] },
      });
      await prisma.escalationRule.upsert({
        where: { policyId_stepOrder: { policyId: createdPolicy.id, stepOrder: 1 } },
        update: { targetType: 'TEAM', targetUserId: null, targetTeamId: item.teamId, delayMinutes: 10, notificationChannels: ['EMAIL'] },
        create: { policyId: createdPolicy.id, stepOrder: 1, targetType: 'TEAM', targetTeamId: item.teamId, delayMinutes: 10, notificationChannels: ['EMAIL'] },
      });
      return createdPolicy;
    }));
    const service = await prisma.service.upsert({
      where: { name: DOCS_FIXTURES.service },
      update: { teamId: team.id, escalationPolicyId: policy.id },
      create: { name: DOCS_FIXTURES.service, description: 'Customer checkout and payment orchestration API', teamId: team.id, escalationPolicyId: policy.id },
    });
    const serviceFixtures = [
      { name: 'Edge Gateway', description: 'Global API ingress, traffic policy, and rate limiting', region: 'Global', slaTier: 'Tier 1', team: additionalTeams[0], policy: additionalPolicies[0] },
      { name: 'Identity Platform', description: 'Authentication, session, and enterprise identity services', region: 'Global', slaTier: 'Tier 1', team: additionalTeams[2], policy: additionalPolicies[2] },
      { name: 'Event Streaming', description: 'Customer event ingestion and durable stream processing', region: 'US & EU', slaTier: 'Tier 1', team: additionalTeams[1], policy: additionalPolicies[1] },
      { name: 'Analytics Warehouse', description: 'Operational analytics and executive reporting workloads', region: 'US East', slaTier: 'Tier 2', team: additionalTeams[1], policy: additionalPolicies[1] },
      { name: 'Customer Notifications', description: 'Transactional email, SMS, push, and voice delivery', region: 'Global', slaTier: 'Tier 2', team, policy },
    ];
    const additionalServices = await Promise.all(serviceFixtures.map(item => prisma.service.upsert({
      where: { name: item.name },
      update: { description: item.description, region: item.region, slaTier: item.slaTier, teamId: item.team.id, escalationPolicyId: item.policy.id },
      create: { name: item.name, description: item.description, region: item.region, slaTier: item.slaTier, teamId: item.team.id, escalationPolicyId: item.policy.id, targetAckMinutes: item.slaTier === 'Tier 1' ? 5 : 15, targetResolveMinutes: item.slaTier === 'Tier 1' ? 60 : 180 },
    })));
    const schedule = await prisma.onCallSchedule.upsert({
      where: { name: DOCS_FIXTURES.schedule },
      update: { timeZone: 'UTC' },
      create: { name: DOCS_FIXTURES.schedule, timeZone: 'UTC' },
    });
    const layer = await prisma.onCallLayer.findFirst({ where: { scheduleId: schedule.id, name: 'Primary' } }) ??
      await prisma.onCallLayer.create({ data: { scheduleId: schedule.id, name: 'Primary', start: new Date('2026-01-01T00:00:00Z'), rotationLengthHours: 168 } });
    await prisma.onCallLayerUser.upsert({
      where: { layerId_userId: { layerId: layer.id, userId: responder.id } },
      update: { position: 0 },
      create: { layerId: layer.id, userId: responder.id, position: 0 },
    });
    const scheduleFixtures = [
      { name: 'Platform Global Primary', timeZone: 'America/New_York', userIds: [additionalUsers[0].id, responder.id] },
      { name: 'Data Services Follow-the-Sun', timeZone: 'Europe/London', userIds: [additionalUsers[1].id, additionalUsers[0].id] },
      { name: 'Security Operations 24×7', timeZone: 'UTC', userIds: [additionalUsers[2].id, additionalUsers[4].id] },
    ];
    for (const item of scheduleFixtures) {
      const extraSchedule = await prisma.onCallSchedule.upsert({ where: { name: item.name }, update: { timeZone: item.timeZone }, create: { name: item.name, timeZone: item.timeZone } });
      const extraLayer = await prisma.onCallLayer.findFirst({ where: { scheduleId: extraSchedule.id, name: 'Primary Rotation' } }) ??
        await prisma.onCallLayer.create({ data: { scheduleId: extraSchedule.id, name: 'Primary Rotation', start: new Date('2026-01-01T00:00:00Z'), rotationLengthHours: 168, shiftLengthHours: 12 } });
      await Promise.all(item.userIds.map((userId, position) => prisma.onCallLayerUser.upsert({
        where: { layerId_userId: { layerId: extraLayer.id, userId } },
        update: { position },
        create: { layerId: extraLayer.id, userId, position },
      })));
    }
    await prisma.statusPage.deleteMany({ where: { name: 'Northstar Data Services Status' } });
    const primaryStatusPage = await prisma.statusPage.upsert({
      where: { name: DOCS_FIXTURES.statusPage },
      update: { enabled: true, slug: 'northstar-systems', organizationName: 'Northstar Systems', contactEmail: 'reliability@opsknight.com' },
      create: { name: DOCS_FIXTURES.statusPage, enabled: true, slug: 'northstar-systems', organizationName: 'Northstar Systems' },
    });
    for (const [order, mappedService] of [service, ...additionalServices].entries()) {
      await prisma.statusPageService.upsert({
        where: { statusPageId_serviceId: { statusPageId: primaryStatusPage.id, serviceId: mappedService.id } },
        update: { order, showOnPage: true },
        create: { statusPageId: primaryStatusPage.id, serviceId: mappedService.id, order, showOnPage: true },
      });
    }
    const existing = await prisma.incident.findFirst({ where: { title: DOCS_FIXTURES.incident, serviceId: service.id } });
    const resetIncident = { title: DOCS_FIXTURES.incident, description: 'Elevated checkout latency is affecting payment completion in multiple regions.', urgency: 'HIGH' as const, status: 'OPEN' as const, acknowledgedAt: null, resolvedAt: null, slaAckTargetMs: 900_000, slaResolveTargetMs: 7_200_000, slaTargetSource: 'service' };
    if (existing) await prisma.incident.update({ where: { id: existing.id }, data: resetIncident });
    else await prisma.incident.create({ data: { ...resetIncident, serviceId: service.id, teamId: team.id } });
    const now = Date.now();
    const incidentFixtures = [
      { title: 'Elevated error rate at the edge gateway', description: 'HTTP 5xx responses increased for European traffic.', service: additionalServices[0], team: additionalTeams[0], urgency: 'HIGH' as const, status: 'ACKNOWLEDGED' as const, minutesAgo: 24, priority: 'P1' },
      { title: 'Event processing backlog in EU region', description: 'Consumer lag is delaying analytics updates.', service: additionalServices[2], team: additionalTeams[1], urgency: 'MEDIUM' as const, status: 'OPEN' as const, minutesAgo: 43, priority: 'P2' },
      { title: 'Identity token refresh latency', description: 'A subset of enterprise sessions are refreshing slowly.', service: additionalServices[1], team: additionalTeams[2], urgency: 'MEDIUM' as const, status: 'ACKNOWLEDGED' as const, minutesAgo: 68, priority: 'P2' },
      { title: 'Delayed transactional email delivery', description: 'Provider throttling affected password reset emails.', service: additionalServices[4], team, urgency: 'LOW' as const, status: 'RESOLVED' as const, minutesAgo: 190, priority: 'P3' },
      { title: 'Analytics dashboard freshness degraded', description: 'Executive reporting data exceeded the freshness target.', service: additionalServices[3], team: additionalTeams[1], urgency: 'LOW' as const, status: 'RESOLVED' as const, minutesAgo: 420, priority: 'P3' },
    ];
    for (const item of incidentFixtures) {
      const createdAt = new Date(now - item.minutesAgo * 60_000);
      const incidentData = {
        description: item.description,
        serviceId: item.service.id,
        teamId: item.team.id,
        assigneeId: null,
        urgency: item.urgency,
        status: item.status,
        priority: item.priority,
        createdAt,
        acknowledgedAt: item.status === 'OPEN' ? null : new Date(createdAt.getTime() + 6 * 60_000),
        resolvedAt: item.status === 'RESOLVED' ? new Date(createdAt.getTime() + 55 * 60_000) : null,
        slaPausedMs: BigInt(0),
        slaAckTargetMs: 600_000,
        slaResolveTargetMs: 7_200_000,
        slaTargetSource: 'service',
      };
      const existingFixture = await prisma.incident.findFirst({ where: { title: item.title } });
      if (existingFixture) await prisma.incident.update({ where: { id: existingFixture.id }, data: incidentData });
      else await prisma.incident.create({ data: { title: item.title, ...incidentData } });
    }

    const seededIncidents = await prisma.incident.findMany({
      where: { title: { in: [DOCS_FIXTURES.incident, ...incidentFixtures.map(item => item.title)] } },
      select: { id: true, title: true, createdAt: true },
    });
    const incidentByTitle = new Map(seededIncidents.map(item => [item.title, item]));
    const resolvedEmailIncident = incidentByTitle.get('Delayed transactional email delivery');
    if (!resolvedEmailIncident) throw new Error('Documentation incident fixture was not created');

    const postmortem = await prisma.postmortem.upsert({
      where: { incidentId: resolvedEmailIncident.id },
      update: {
        title: 'Transactional email delivery degradation review',
        summary: 'Provider throttling delayed password reset messages for customers in two regions.',
        rootCause: 'A provider account limit was lower than the production burst rate.',
        resolution: 'Traffic was shifted and provider capacity was increased.',
        lessons: 'Provider admission capacity must be part of release readiness checks.',
        status: 'PUBLISHED',
        createdById: admin.id,
      },
      create: {
        incidentId: resolvedEmailIncident.id,
        title: 'Transactional email delivery degradation review',
        summary: 'Provider throttling delayed password reset messages for customers in two regions.',
        rootCause: 'A provider account limit was lower than the production burst rate.',
        resolution: 'Traffic was shifted and provider capacity was increased.',
        lessons: 'Provider admission capacity must be part of release readiness checks.',
        status: 'PUBLISHED',
        createdById: admin.id,
      },
    });
    const actionItemFixtures = [
      { id: 'docs-action-provider-capacity', title: 'Add provider capacity checks to release readiness', description: 'Alert before transactional delivery approaches the contracted provider rate.', ownerId: additionalUsers[0].id, status: 'IN_PROGRESS' as const, priority: 'HIGH' as const, days: 7 },
      { id: 'docs-action-failover-drill', title: 'Run quarterly notification-provider failover drill', description: 'Exercise regional traffic shift and record recovery time.', ownerId: responder.id, status: 'OPEN' as const, priority: 'HIGH' as const, days: 14 },
      { id: 'docs-action-dashboard', title: 'Publish delivery saturation dashboard', description: 'Break down provider admission, retry age, and permanent failures.', ownerId: additionalUsers[1].id, status: 'OPEN' as const, priority: 'MEDIUM' as const, days: 21 },
      { id: 'docs-action-runbook', title: 'Update customer communications runbook', description: 'Add templates for delayed authentication email delivery.', ownerId: additionalUsers[3].id, status: 'COMPLETED' as const, priority: 'LOW' as const, days: -2 },
    ];
    for (const item of actionItemFixtures) {
      await prisma.actionItem.upsert({
        where: { id: item.id },
        update: { title: item.title, description: item.description, ownerId: item.ownerId, status: item.status, priority: item.priority, dueDate: new Date(now + item.days * 86_400_000), completedAt: item.status === 'COMPLETED' ? new Date(now - 86_400_000) : null },
        create: { id: item.id, postmortemId: postmortem.id, incidentId: resolvedEmailIncident.id, title: item.title, description: item.description, ownerId: item.ownerId, status: item.status, priority: item.priority, source: 'POSTMORTEM', dueDate: new Date(now + item.days * 86_400_000), completedAt: item.status === 'COMPLETED' ? new Date(now - 86_400_000) : null },
      });
    }

    const eventTemplates = [
      { suffix: 'triggered', type: 'STATUS_CHANGE' as const, message: 'Incident triggered by production monitoring' },
      { suffix: 'assigned', type: 'ASSIGNMENT' as const, message: 'Assigned to the primary Commerce Reliability responder' },
      { suffix: 'acknowledged', type: 'ACKNOWLEDGED' as const, message: 'Incident acknowledged after initial triage' },
    ];
    for (const [incidentIndex, incident] of seededIncidents.entries()) {
      for (const [eventIndex, event] of eventTemplates.entries()) {
        await prisma.incidentEvent.upsert({
          where: { id: `docs-event-${incidentIndex}-${event.suffix}` },
          update: { incidentId: incident.id, message: event.message, type: event.type, createdAt: new Date(incident.createdAt.getTime() + eventIndex * 180_000) },
          create: { id: `docs-event-${incidentIndex}-${event.suffix}`, incidentId: incident.id, message: event.message, type: event.type, createdAt: new Date(incident.createdAt.getTime() + eventIndex * 180_000) },
        });
      }
    }

    const auditFixtures = [
      { id: 'docs-audit-service', action: 'SERVICE_UPDATED', entityType: 'SERVICE' as const, entityId: service.id, details: { name: DOCS_FIXTURES.service, field: 'escalationPolicy' } },
      { id: 'docs-audit-schedule', action: 'SCHEDULE_UPDATED', entityType: 'SCHEDULE' as const, entityId: schedule.id, details: { name: DOCS_FIXTURES.schedule, field: 'rotation' } },
      { id: 'docs-audit-status-page', action: 'STATUS_PAGE_UPDATED', entityType: 'STATUS_PAGE' as const, entityId: primaryStatusPage.id, details: { name: DOCS_FIXTURES.statusPage, field: 'services' } },
      { id: 'docs-audit-api-key', action: 'API_KEY_CREATED', entityType: 'API_KEY' as const, entityId: 'docs-api-contract-key', details: { name: 'Documentation contract verification' } },
    ];
    for (const [index, item] of auditFixtures.entries()) {
      await prisma.auditLog.upsert({
        where: { id: item.id },
        update: { ...item, actorId: admin.id, actorEmail: admin.email, actorName: admin.name, createdAt: new Date(now - index * 900_000) },
        create: { ...item, actorId: admin.id, actorEmail: admin.email, actorName: admin.name, createdAt: new Date(now - index * 900_000) },
      });
    }
    void viewer;
  } finally {
    await prisma.$disconnect();
  }
}
