import { beforeEach, describe, expect, it, vi } from 'vitest';

const transaction = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  })
);

vi.mock('@/lib/prisma', () => ({ default: { $transaction: transaction } }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', tokenVersion: 1 }),
  getUserPermissions: vi.fn().mockResolvedValue({ id: 'user-1', capabilities: [] }),
}));
vi.mock('@/lib/mcp/auth/config', () => ({
  loadMcpRuntime: vi.fn(),
  getMcpConfigurationStatus: vi.fn(),
  mcpIssuer: vi.fn(),
  mcpResource: vi.fn(),
}));

import { decideMcpConsent } from '@/app/(app)/settings/integrations/mcp/actions';

function form() {
  const data = new FormData();
  data.set('id', 'consent-1');
  data.set('decision', 'allow');
  data.append('scope', 'incidents:read');
  return data;
}

const conflict = () => Object.assign(new Error('write conflict'), { code: 'P2034' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('decideMcpConsent serialization conflicts', () => {
  it('retries a serialization conflict and completes the consent', async () => {
    transaction
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce('https://assistant.example/callback?code=abc');

    await expect(decideMcpConsent(form())).rejects.toThrow(
      'REDIRECT https://assistant.example/callback?code=abc'
    );
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('shows the busy page instead of the global error when the conflict never clears', async () => {
    transaction.mockRejectedValue(conflict());

    await expect(decideMcpConsent(form())).rejects.toThrow(
      'REDIRECT /oauth/mcp/consent/result?code=temporarily_unavailable'
    );
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry or hide an unrelated failure', async () => {
    transaction.mockRejectedValue(new Error('database exploded'));

    await expect(decideMcpConsent(form())).rejects.toThrow('database exploded');
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
