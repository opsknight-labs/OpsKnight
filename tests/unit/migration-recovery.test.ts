// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';

// Mock child_process
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}));

// Create mock Prisma object
const mockPrisma = {
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  $disconnect: vi.fn(),
};

// Mock PrismaClient constructor - use function syntax for Vitest 4.x
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MockPrismaClient = vi.fn().mockImplementation(function (this: any) {
  Object.assign(this, mockPrisma);
  return this;
});

// Mock @prisma/client
vi.mock('@prisma/client', () => ({
  PrismaClient: MockPrismaClient,
}));

describe('Auto Recovery Migration System', () => {
  let autoRecoverMigrations: () => Promise<boolean>;

  beforeEach(async () => {
    vi.clearAllMocks();
    console.log = vi.fn();
    console.error = vi.fn();

    // Reset process.exit mock
    // @ts-expect-error - Mocking process.exit for testing
    process.exit = vi.fn();

    // Re-import the module for each test to ensure fresh state
    vi.resetModules();
    const recoveryModule = await import('../../scripts/auto-recover-migrations');
    autoRecoverMigrations = recoveryModule.autoRecoverMigrations;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should detect failed migrations and attempt recovery', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        migration_name: '20250630_add_escalation_policy_enum',
        started_at: new Date(),
        finished_at: null,
        logs: null,
      },
    ]);

    mockPrisma.$queryRaw.mockResolvedValueOnce([{ enumlabel: 'ESCALATION_POLICY' }]);

    const result = await autoRecoverMigrations();

    expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(execFileSync).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['migrate', 'resolve', '--applied']),
      expect.anything()
    );
    expect(result).toBe(true);
  });

  it('should apply enum value if missing', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        migration_name: '20250630_add_escalation_policy_enum',
        started_at: new Date(),
        finished_at: null,
        logs: null,
      },
    ]);

    mockPrisma.$queryRaw.mockResolvedValueOnce([]);

    const result = await autoRecoverMigrations();

    expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    expect(execFileSync).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['migrate', 'resolve', '--applied']),
      expect.anything()
    );
    expect(result).toBe(true);
  });

  it('recovers the known Jira duplicate precondition and applies the forward repair', async () => {
    const migrationName = '20260910174500_guard_jira_mapping_workspace';
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        migration_name: migrationName,
        started_at: new Date(),
        finished_at: null,
        logs:
          'Database error: Cannot enforce one Jira issue per action item: duplicate Jira links exist. Review and unlink duplicates before applying this migration.',
      },
    ]);

    const result = await autoRecoverMigrations();

    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'resolve', '--applied', migrationName],
      expect.anything()
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      expect.anything()
    );
    expect(result).toBe(true);
  });

  it('recovers the Jira unique-index build race from an older rolling replica', async () => {
    const migrationName = '20260910174500_guard_jira_mapping_workspace';
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        migration_name: migrationName,
        started_at: new Date(),
        finished_at: null,
        logs:
          'ERROR: could not create unique index "ExternalIssueLink_jira_actionItemId_unique" DETAIL: Key (actionItemId)=(ai_123) is duplicated.',
      },
    ]);

    const result = await autoRecoverMigrations();

    expect(execFileSync).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'resolve', '--applied', migrationName],
      expect.anything()
    );
    expect(execFileSync).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      expect.anything()
    );
    expect(result).toBe(true);
  });

  it('does not auto-resolve an unrelated failure in the Jira migration', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        migration_name: '20260910174500_guard_jira_mapping_workspace',
        started_at: new Date(),
        finished_at: null,
        logs: 'Database error: permission denied for relation ExternalIssueLink',
      },
    ]);

    const result = await autoRecoverMigrations();

    expect(execFileSync).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it('should deploy pending migrations if healthy', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);

    const result = await autoRecoverMigrations();

    expect(execFileSync).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });
});
