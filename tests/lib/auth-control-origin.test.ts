import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { assertAuthenticationOrigin } from '@/lib/auth-control/origin';

describe('authentication control CSRF origin boundary', () => {
  beforeEach(() => {
    vi.stubEnv('NEXTAUTH_URL', 'https://recovery.example.test');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://recovery.example.test');
    vi.mocked(prisma.systemSettings.findUnique).mockResolvedValue({
      appUrl: 'https://recovery.example.test',
    } as never);
  });
  afterEach(() => vi.unstubAllEnvs());
  it('accepts deliberate same-origin browser requests', async () => {
    await expect(
      assertAuthenticationOrigin(
        new Request('https://recovery.example.test/api/auth/control', {
          headers: { Origin: 'https://recovery.example.test', 'Sec-Fetch-Site': 'same-origin' },
        })
      )
    ).resolves.toBeUndefined();
  });
  it.each([
    undefined,
    'https://attacker.example.test',
    'http://recovery.example.test',
    'https://recovery.example.test.attacker.example.test',
    'https://recovery.example.test:444',
  ])('rejects missing or foreign origin %s', async origin => {
    await expect(
      assertAuthenticationOrigin(
        new Request('https://recovery.example.test/api/auth/control', {
          headers: origin ? { Origin: origin } : {},
        })
      )
    ).rejects.toThrow('origin rejected');
  });
  it('rejects contradictory cross-site metadata even with a claimed origin', async () => {
    await expect(
      assertAuthenticationOrigin(
        new Request('https://recovery.example.test/api/auth/control', {
          headers: { Origin: 'https://recovery.example.test', 'Sec-Fetch-Site': 'cross-site' },
        })
      )
    ).rejects.toThrow('Cross-site');
  });
  it('fails closed on conflicting deployment and database origins', async () => {
    vi.mocked(prisma.systemSettings.findUnique).mockResolvedValue({
      appUrl: 'https://different.example.test',
    } as never);
    await expect(
      assertAuthenticationOrigin(
        new Request('https://recovery.example.test/api/auth/control', {
          headers: { Origin: 'https://recovery.example.test' },
        })
      )
    ).rejects.toThrow('conflicting canonical');
  });
});
