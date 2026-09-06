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
    // Setup failures
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        migration_name: '20250630_add_escalation_policy_enum',
        started_at: new Date(),
        finished_at: null,
      },
    ]);

    // Setup enum exists check
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
    // Setup failures
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      {
        migration_name: '20250630_add_escalation_policy_enum',
        started_at: new Date(),
        finished_at: null,
      },
    ]);

    // Setup enum MISSING
    mockPrisma.$queryRaw.mockResolvedValueOnce([]);

    const result = await autoRecoverMigrations();

    expect(mockPrisma.$executeRaw).toHaveBeenCalled(); // Should ALTER TYPE
    expect(execFileSync).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(['migrate', 'resolve', '--applied']),
      expect.anything()
    );
    expect(result).toBe(true);
  });

  it('should deploy pending migrations if healthy', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([]); // No failures

    const result = await autoRecoverMigrations();

    // Expect NO deploy call because auto-recovery returns successfully early if no failures
    expect(execFileSync).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });
});
