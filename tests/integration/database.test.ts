import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { testPrisma, resetDatabase, createTestUser, createTestTeam } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('Database Integration', () => {
  // This test requires a running PostgreSQL database at DATABASE_URL in .env.test
  // If it's not available, these tests will fail, which is correct for integration tests.

  beforeAll(async () => {
    // We might want to run migrations here, but usually it's better to do it once before the suite
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('should create and retrieve a user', async () => {
    const user = await createTestUser({ email: 'db-test@example.com', name: 'DB Test' });

    const retrieved = await testPrisma.user.findUnique({
      where: { id: user.id },
    });

    expect(retrieved).toBeDefined();
    expect(retrieved?.email).toBe('db-test@example.com');
  });

  it('should handle team and service relationships', async () => {
    const user = await createTestUser();
    const team = await createTestTeam('Test Team', {
      members: {
        create: {
          userId: user.id,
          role: 'OWNER',
        },
      },
    });

    const retrievedTeam = await testPrisma.team.findUnique({
      where: { id: team.id },
      include: { members: true },
    });

    expect(retrievedTeam?.members).toHaveLength(1);
    expect(retrievedTeam?.members[0].userId).toBe(user.id);
  });

  it('should enforce unique constraints', async () => {
    await createTestUser({ email: 'unique@example.com' });

    await expect(createTestUser({ email: 'unique@example.com' })).rejects.toThrow();
  });
});
