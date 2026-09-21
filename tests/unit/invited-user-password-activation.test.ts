import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

const mockPrisma = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  userToken: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  systemSettings: {
    findUnique: vi.fn(),
  },
  notificationProvider: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  $transaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: mockPrisma,
}));

vi.mock('@/lib/auth-abuse', () => ({
  consumeAuthRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  authPrivacyDigest: vi.fn().mockResolvedValue('hash'),
}));

vi.mock('@/lib/app-url', () => ({
  getAppUrl: vi.fn().mockResolvedValue('https://opssentinal.com'),
  getAppUrlSync: vi.fn().mockReturnValue('https://opssentinal.com'),
}));

vi.mock('@/lib/audit', () => ({
  emitAuditEvent: vi.fn().mockResolvedValue(undefined),
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/session-security-projection', () => ({
  invalidateSessionSecurityProjection: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ 'x-forwarded-for': '127.0.0.1' })),
}));

import { completePasswordReset } from '@/lib/password-reset';
import { issueUserInviteToken, buildInviteUrl } from '@/lib/invitations';
import { setPassword } from '@/app/set-password/actions';

describe('Invited User Password Activation and Recovery Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async callback => callback(mockPrisma));
  });

  describe('issueUserInviteToken', () => {
    it('generates an invite link pointing to set-password on the canonical appUrl', async () => {
      mockPrisma.user.update.mockResolvedValue({ invitationGeneration: 2 });
      mockPrisma.userToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.userToken.create.mockResolvedValue({ id: 'token-id' });

      const result = await issueUserInviteToken('user-1', 'invited@example.com');

      expect(result.token).toBeDefined();
      expect(result.inviteUrl).toContain('https://opssentinal.com/set-password#token=');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1', status: 'INVITED' },
        data: expect.objectContaining({
          invitationGeneration: { increment: 1 },
        }),
        select: { invitationGeneration: true },
      });
      expect(mockPrisma.userToken.updateMany).toHaveBeenCalledWith({
        where: {
          OR: [{ userId: 'user-1' }, { identifier: 'invited@example.com' }],
          type: { in: ['INVITE', 'PASSWORD_RESET'] },
          usedAt: null,
          revokedAt: null,
        },
        data: expect.objectContaining({
          revokedAt: expect.any(Date),
        }),
      });
      expect(mockPrisma.userToken.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          identifier: 'invited@example.com',
          userId: 'user-1',
          generation: 2,
          type: 'INVITE',
        }),
      });
    });
  });

  describe('completePasswordReset with INVITED user', () => {
    it('activates invited user and updates status to ACTIVE when setting password via recovery link', async () => {
      const rawToken = 'test-recovery-token-for-invited-user-123456';
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      mockPrisma.userToken.findFirst.mockResolvedValue({
        id: 'token-rec-1',
        userId: 'user-invited-id',
        identifier: 'invited@example.com',
        type: 'PASSWORD_RESET',
      });

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'user-invited-id',
        email: 'invited@example.com',
        name: 'Invited User',
        status: 'INVITED',
        phoneNumber: null,
        smsNotificationsEnabled: false,
      });

      mockPrisma.userToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

      const result = await completePasswordReset(rawToken, 'SecurePassphrase123!', '127.0.0.1');

      expect(result.success).toBe(true);

      // Verifies user is updated to ACTIVE with invitedAt: null
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-invited-id', status: 'INVITED' },
        data: expect.objectContaining({
          status: 'ACTIVE',
          invitedAt: null,
          tokenVersion: { increment: 1 },
        }),
      });

      // Verifies pending invite tokens are revoked
      expect(mockPrisma.userToken.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          type: 'INVITE',
        }),
        data: expect.objectContaining({
          revokedAt: expect.any(Date),
        }),
      });
    });

    it('rejects password completion when user is DISABLED', async () => {
      const rawToken = 'test-token-disabled-user-1234567890123';

      mockPrisma.userToken.findFirst.mockResolvedValue({
        id: 'token-rec-2',
        userId: 'disabled-user-id',
        identifier: 'disabled@example.com',
        type: 'PASSWORD_RESET',
      });

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'disabled-user-id',
        email: 'disabled@example.com',
        name: 'Disabled User',
        status: 'DISABLED',
      });

      const result = await completePasswordReset(rawToken, 'SecurePassphrase123!', '127.0.0.1');
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_TOKEN');
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('rejects INVITE tokens when the target account has already become ACTIVE', async () => {
      const rawToken = 'test-token-invite-already-active-12345';

      mockPrisma.userToken.findFirst.mockResolvedValue({
        id: 'token-rec-3',
        userId: 'active-user-id',
        identifier: 'active@example.com',
        type: 'INVITE',
      });

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'active-user-id',
        email: 'active@example.com',
        name: 'Active User',
        status: 'ACTIVE',
      });

      const result = await completePasswordReset(rawToken, 'SecurePassphrase123!', '127.0.0.1');
      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_TOKEN');
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('setPassword server action', () => {
    it('activates invited user and returns { success: true, email } without redirect exception', async () => {
      const rawToken = 'test-action-invite-token-12345678901234567890';

      mockPrisma.userToken.findFirst.mockResolvedValue({
        id: 'token-action-1',
        userId: 'invited-action-user-id',
        identifier: 'invited-action@example.com',
        generation: 1,
        type: 'INVITE',
      });

      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'invited-action-user-id',
        email: 'invited-action@example.com',
        name: 'Invited Action User',
        status: 'INVITED',
        invitationGeneration: 1,
      });

      mockPrisma.userToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

      const formData = new FormData();
      formData.append('token', rawToken);
      formData.append('password', 'SecurePassphrase123!');
      formData.append('confirmPassword', 'SecurePassphrase123!');

      const result = await setPassword({ error: null }, formData);

      expect(result.success).toBe(true);
      expect(result.email).toBe('invited-action@example.com');
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'invited-action-user-id',
          status: 'INVITED',
          invitationGeneration: 1,
        },
        data: expect.objectContaining({
          status: 'ACTIVE',
          invitedAt: null,
          tokenVersion: { increment: 1 },
        }),
      });
    });

    it('returns validation error if passwords do not match', async () => {
      const formData = new FormData();
      formData.append('token', 'test-action-invite-token-12345678901234567890');
      formData.append('password', 'SecurePassphrase123!');
      formData.append('confirmPassword', 'DifferentPassword123!');

      const result = await setPassword({ error: null }, formData);
      expect(result.error).toBe('Passwords do not match.');
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });
  });
});
