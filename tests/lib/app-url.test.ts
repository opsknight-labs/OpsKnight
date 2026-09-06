import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { getAppUrl, getAppUrlSync } from '@/lib/app-url';

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    systemSettings: {
      findUnique: vi.fn(),
    },
  },
}));

const ORIGINAL_ENV = { ...process.env };

describe('App URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns normalized appUrl from database when valid', async () => {
    vi.mocked(prisma.systemSettings.findUnique).mockResolvedValue({
      appUrl: 'https://db.example.com/',
    } as any);

    const result = await getAppUrl();

    expect(result).toBe('https://db.example.com');
  });

  it('falls back to env when database value is invalid', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.systemSettings.findUnique).mockResolvedValue({ appUrl: 'undefined' } as any);
    process.env.NEXT_PUBLIC_APP_URL = 'https://env.example.com/';

    const result = await getAppUrl();

    expect(result).toBe('https://env.example.com');
  });

  it('falls back to NEXTAUTH_URL when NEXT_PUBLIC_APP_URL is missing or invalid', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.systemSettings.findUnique).mockResolvedValue({ appUrl: null } as any);
    process.env.NEXT_PUBLIC_APP_URL = 'undefined';
    process.env.NEXTAUTH_URL = 'https://auth.example.com/';

    const result = await getAppUrl();

    expect(result).toBe('https://auth.example.com');
  });

  it('getAppUrlSync returns NEXTAUTH_URL when NEXT_PUBLIC_APP_URL is invalid', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'undefined';
    process.env.NEXTAUTH_URL = 'https://auth.example.com/';

    expect(getAppUrlSync()).toBe('https://auth.example.com');
  });
});
