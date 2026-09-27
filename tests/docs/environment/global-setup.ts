import { PrismaClient, type Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DOCS_ADMIN, DOCS_FIXTURES, DOCS_RESPONDER, DOCS_VIEWER } from '../fixtures/constants';

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
    const service = await prisma.service.upsert({
      where: { name: DOCS_FIXTURES.service },
      update: { teamId: team.id, escalationPolicyId: policy.id },
      create: { name: DOCS_FIXTURES.service, description: 'Customer checkout and payment orchestration API', teamId: team.id, escalationPolicyId: policy.id },
    });
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
    await prisma.statusPage.upsert({
      where: { name: DOCS_FIXTURES.statusPage },
      update: { enabled: true, slug: 'acme-status' },
      create: { name: DOCS_FIXTURES.statusPage, enabled: true, slug: 'northstar-systems', organizationName: 'Northstar Systems' },
    });
    const existing = await prisma.incident.findFirst({ where: { title: DOCS_FIXTURES.incident, serviceId: service.id } });
    const resetIncident = { title: DOCS_FIXTURES.incident, description: 'Elevated checkout latency is affecting payment completion in multiple regions.', urgency: 'HIGH' as const, status: 'OPEN' as const, acknowledgedAt: null, resolvedAt: null, slaAckTargetMs: 900_000, slaResolveTargetMs: 7_200_000, slaTargetSource: 'service' };
    if (existing) await prisma.incident.update({ where: { id: existing.id }, data: resetIncident });
    else await prisma.incident.create({ data: { ...resetIncident, serviceId: service.id, teamId: team.id } });
    void viewer;
  } finally {
    await prisma.$disconnect();
  }
}
