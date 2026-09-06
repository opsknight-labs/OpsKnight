import '@testing-library/jest-dom';
import { afterEach, afterAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

// Cleanup after each test
afterEach(() => {
  if (typeof document !== 'undefined') {
    cleanup();
  }
});

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter() {
    return {
      push: vi.fn(),
      replace: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
    };
  },
  usePathname() {
    return '/';
  },
  useSearchParams() {
    return new URLSearchParams();
  },
}));

// Next.js helper that enforces server-only imports can be mocked as a no-op in tests
vi.mock('server-only', () => ({}));

// Mock Prisma Client
const createMockModel = () => ({
  findMany: vi.fn().mockResolvedValue([]),
  findFirst: vi.fn().mockResolvedValue(null),
  findUnique: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue({}),
  update: vi.fn().mockResolvedValue({}),
  updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  delete: vi.fn().mockResolvedValue({}),
  deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  upsert: vi.fn().mockResolvedValue({}),
  count: vi.fn().mockResolvedValue(0),
});

const mockPrisma = {
  notification: createMockModel(),
  incident: createMockModel(),
  onCallLayerUser: createMockModel(),
  onCallLayer: createMockModel(),
  onCallOverride: createMockModel(),
  onCallShift: createMockModel(),
  onCallSchedule: createMockModel(),
  teamMember: createMockModel(),
  escalationRule: createMockModel(),
  escalationPolicy: createMockModel(),
  service: createMockModel(),
  team: createMockModel(),
  user: createMockModel(),
  oidcIdentity: createMockModel(),
  oidcConfig: createMockModel(),
  backgroundJob: createMockModel(),
  incidentEvent: createMockModel(),
  slackIntegration: createMockModel(),
  notificationProvider: createMockModel(),
  slackOAuthConfig: createMockModel(),
  apiKey: createMockModel(),
  userToken: createMockModel(),
  rateLimit: createMockModel(),
  account: createMockModel(),
  session: createMockModel(),

  auditLog: createMockModel(),
  inAppNotification: createMockModel(),
  systemSettings: createMockModel(),
  alert: createMockModel(),
  incidentNote: createMockModel(),
  incidentWatcher: createMockModel(),
  $transaction: vi
    .fn()
    .mockImplementation((cb: (tx: typeof mockPrisma) => unknown) => cb(mockPrisma)),
  $extends: vi.fn().mockReturnThis(),
  $executeRaw: vi.fn().mockResolvedValue(0),
  $queryRaw: vi.fn().mockResolvedValue([]),
};

// Default test mode: mock Prisma so unit tests don't require a DB.
// For DB-backed integration tests, run with VITEST_USE_REAL_DB=1 to skip Prisma mocking.
// Default test mode: mock Prisma so unit tests don't require a DB.
// For DB-backed integration tests, run with VITEST_USE_REAL_DB=1 to skip Prisma mocking.
// NOTE: vi.mock is hoisted, so we must check the env var inside the factory or use doMock (if supported).
// However, doMock might be too late for some imports.
// The reliable way with hoisting is to check inside.
vi.mock('../src/lib/prisma', async importOriginal => {
  if (process.env.VITEST_USE_REAL_DB) {
    return importOriginal();
  }
  return {
    __esModule: true,
    default: mockPrisma,
  };
});

vi.mock('@/lib/prisma', async importOriginal => {
  if (process.env.VITEST_USE_REAL_DB) {
    return importOriginal();
  }
  return {
    __esModule: true,
    default: mockPrisma,
  };
});

// Mock Twilio globally for dynamic requires
vi.mock('twilio', () => {
  const mockCreate = vi.fn().mockResolvedValue({ sid: 'mock-sid' });
  const mockClient = {
    messages: {
      create: mockCreate,
    },
  };
  const mockFunc = vi.fn(() => mockClient);
  return {
    default: mockFunc,
    __esModule: true,
  };
});

if (process.env.VITEST_USE_REAL_DB) {
  afterAll(async () => {
    try {
      // Dynamic import to avoid loading DB in unit tests
      const { testPrisma } = await import('./helpers/test-db');
      const { default: prisma } = await import('../src/lib/prisma');

      await testPrisma.$disconnect();
      if (typeof (prisma as any)?.$disconnect === 'function') {
        await (prisma as any).$disconnect();
      }
    } catch (e) {
      console.warn('[Setup] Failed to disconnect Prisma:', e);
    }
  });
}

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
