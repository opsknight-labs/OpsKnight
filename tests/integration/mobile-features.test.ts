import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import {
  testPrisma,
  resetDatabase,
  createTestUser,
  createTestTeam,
  createTestService,
  createTestIncident,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('Mobile Features Integration Tests', () => {
  beforeAll(async () => {
    process.env.VITEST_USE_REAL_DB = '1';
    await resetDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  describe('Mobile Search Queries', () => {
    it('should filter teams by name (case insensitive)', async () => {
      // Setup
      await createTestTeam('Customer Support');
      await createTestTeam('DevOps Engineering');

      // Simulation of /m/teams?q=cust query
      const query = 'cust';
      const results = await testPrisma.team.findMany({
        where: {
          name: { contains: query, mode: 'insensitive' },
        },
        orderBy: { name: 'asc' },
      });

      expect(results).toHaveLength(1);
      expect(results[0].name).toMatch(/^Customer Support/);
    });

    it('should filter users by name or email', async () => {
      // Setup
      await createTestUser({ name: 'Alice', email: 'alice@test.com' });
      await createTestUser({ name: 'Bob', email: 'bob@test.com' });
      await createTestUser({ name: 'Charlie', email: 'charlie@example.com' });

      // Search by Name "Ali"
      const nameResults = await testPrisma.user.findMany({
        where: {
          OR: [
            { name: { contains: 'Ali', mode: 'insensitive' } },
            { email: { contains: 'Ali', mode: 'insensitive' } },
          ],
        },
      });
      expect(nameResults).toHaveLength(1);
      expect(nameResults[0].name).toBe('Alice');

      // Search by Email "example"
      const emailResults = await testPrisma.user.findMany({
        where: {
          OR: [
            { name: { contains: 'example', mode: 'insensitive' } },
            { email: { contains: 'example', mode: 'insensitive' } },
          ],
        },
      });
      expect(emailResults).toHaveLength(1);
      expect(emailResults[0].email).toBe('charlie@example.com');
    });

    it('should filter services by name', async () => {
      await createTestService('Payment API', null);
      await createTestService('Frontend App', null);

      const results = await testPrisma.service.findMany({
        where: {
          name: { contains: 'API', mode: 'insensitive' },
        },
      });

      expect(results).toHaveLength(1);
      expect(results[0].name).toMatch(/^Payment API/);
    });
  });

  describe('On-Call Widget Logic', () => {
    it('should find active shift for user', async () => {
      const user = await createTestUser({ email: 'oncall@test.com' });
      const schedule = await testPrisma.onCallSchedule.create({
        data: {
          name: 'Primary On-Call',
          timeZone: 'UTC',
        },
      });

      // Create active shift
      const now = new Date();
      const start = new Date(now.getTime() - 3600000); // 1 hour ago
      const end = new Date(now.getTime() + 3600000); // 1 hour from now

      await testPrisma.onCallShift.create({
        data: {
          scheduleId: schedule.id,
          userId: user.id,
          start,
          end,
        },
      });

      // Simulation of Dashboard widget query
      const activeShift = await testPrisma.onCallShift.findFirst({
        where: {
          userId: user.id,
          start: { lte: now },
          end: { gte: now },
        },
        include: { schedule: true },
      });

      expect(activeShift).not.toBeNull();
      expect(activeShift?.schedule.name).toBe('Primary On-Call');
    });

    it('should not find future shift', async () => {
      const user = await createTestUser({ email: 'future@test.com' });
      const schedule = await testPrisma.onCallSchedule.create({
        data: { name: 'Future Schedule', timeZone: 'UTC' },
      });

      const now = new Date();
      const start = new Date(now.getTime() + 3600000); // 1 hour future
      const end = new Date(now.getTime() + 7200000);

      await testPrisma.onCallShift.create({
        data: {
          scheduleId: schedule.id,
          userId: user.id,
          start,
          end,
        },
      });

      const activeShift = await testPrisma.onCallShift.findFirst({
        where: {
          userId: user.id,
          start: { lte: now },
          end: { gte: now },
        },
      });

      expect(activeShift).toBeNull();
    });
  });

  describe('Mobile Incidents Pagination & Counts', () => {
    it('should correctly count open incidents for service', async () => {
      const service = await createTestService('Critical Service', null);

      // Create 1 OPEN, 1 RESOLVED
      await createTestIncident('Incident 1', service.id); // Default OPEN
      const resolved = await createTestIncident('Incident 2', service.id);
      await testPrisma.incident.update({
        where: { id: resolved.id },
        data: { status: 'RESOLVED' },
      });

      // Query used in Mobile Services Page
      const serviceWithCounts = await testPrisma.service.findUnique({
        where: { id: service.id },
        include: {
          _count: {
            select: {
              incidents: {
                where: { status: { in: ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED'] } },
              },
            },
          },
        },
      });

      expect(serviceWithCounts?._count.incidents).toBe(1);
    });
  });

  describe('Mobile Incidents Pagination', () => {
    it('should fetch first page correctly', async () => {
      const service = await createTestService('Paged Service', null);

      // Create 25 incidents
      const data = Array.from({ length: 25 }).map((_, i) => ({
        title: `Incident ${i}`,
        serviceId: service.id,
        status: 'OPEN' as const,
        urgency: 'HIGH' as const,
      }));

      await testPrisma.incident.createMany({ data });

      // Query Page 1 (Take 20)
      const page1 = await testPrisma.incident.findMany({
        where: { serviceId: service.id },
        take: 20,
        orderBy: { createdAt: 'desc' },
      });

      expect(page1).toHaveLength(20);

      // Query Page 2 (Skip 20, Take 20)
      const page2 = await testPrisma.incident.findMany({
        where: { serviceId: service.id },
        skip: 20,
        take: 20,
        orderBy: { createdAt: 'desc' },
      });

      expect(page2).toHaveLength(5);
    });
  });

  describe('Mobile Incident Actions Logic', () => {
    it('should set acknowledgedAt when status changes to ACKNOWLEDGED', async () => {
      const service = await createTestService('Action Service', null);
      const incident = await createTestIncident('Test Ack', service.id);

      expect(incident.acknowledgedAt).toBeNull();

      // Simulate Action: Update Status
      const updated = await testPrisma.incident.update({
        where: { id: incident.id },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: new Date(),
          events: {
            create: { message: 'Acknowledged via Mobile' },
          },
        },
      });

      expect(updated.status).toBe('ACKNOWLEDGED');
      expect(updated.acknowledgedAt).not.toBeNull();
    });

    it('should set resolvedAt and complete escalation when RESOLVED', async () => {
      const service = await createTestService('Resolve Service', null);
      const incident = await createTestIncident('Test Resolve', service.id);

      // Simulate Action: Resolve
      const updated = await testPrisma.incident.update({
        where: { id: incident.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          escalationStatus: 'COMPLETED',
          nextEscalationAt: null,
          events: {
            create: { message: 'Resolved via Mobile' },
          },
        },
      });

      expect(updated.status).toBe('RESOLVED');
      expect(updated.escalationStatus).toBe('COMPLETED');
      expect(updated.nextEscalationAt).toBeNull();
    });
  });
});
