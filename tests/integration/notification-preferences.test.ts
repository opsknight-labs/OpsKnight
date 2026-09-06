import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { updateNotificationPreferences } from '@/app/(app)/settings/actions';
import { testPrisma, resetDatabase, createTestUser } from '../helpers/test-db';

// Mock non-database dependencies
vi.mock('next-auth', () => ({
    getServerSession: vi.fn()
}));

vi.mock('@/lib/auth', () => ({
    getAuthOptions: vi.fn()
}));

vi.mock('next/cache', () => ({
    revalidatePath: vi.fn()
}));

vi.mock('@/lib/notification-providers', () => ({
    getEmailConfig: vi.fn(),
    getSMSConfig: vi.fn(),
    getPushConfig: vi.fn(),
    getWhatsAppConfig: vi.fn()
}));

import { getServerSession } from 'next-auth';
import { getEmailConfig, getSMSConfig, getPushConfig, getWhatsAppConfig } from '@/lib/notification-providers';

const describeIfRealDB = (process.env.VITEST_USE_REAL_DB === '1' || process.env.CI) ? describe : describe.skip;

describeIfRealDB('Notification Preferences Provider Validation (Real DB)', () => {
    let testUser: any;

    beforeAll(async () => {
        process.env.VITEST_USE_REAL_DB = '1';
    });

    beforeEach(async () => {
        vi.clearAllMocks();
        await resetDatabase();

        // Create a real user in the DB
        testUser = await createTestUser({
            email: 'test@example.com',
            name: 'Test User'
        });

        // Mock authenticated session
        (getServerSession as any).mockResolvedValue({
            user: { email: testUser.email, name: testUser.name },
            expires: 'never'
        });

        // Reset provider mocks to disabled by default
        (getEmailConfig as any).mockResolvedValue({ enabled: false });
        (getSMSConfig as any).mockResolvedValue({ enabled: false });
        (getPushConfig as any).mockResolvedValue({ enabled: false });
        (getWhatsAppConfig as any).mockResolvedValue({ enabled: false });
    });

    describe('Email Notifications', () => {
        it('should allow enabling email notifications when email provider is configured', async () => {
            (getEmailConfig as any).mockResolvedValue({ enabled: true });

            const formData = new FormData();
            formData.append('emailNotificationsEnabled', 'on');

            const result = await updateNotificationPreferences({}, formData);

            expect(result.success).toBe(true);

            // Verify in DB
            const updatedUser = await testPrisma.user.findUnique({ where: { id: testUser.id } });
            expect(updatedUser?.emailNotificationsEnabled).toBe(true);
        });

        it('should prevent enabling email notifications when email provider is not configured', async () => {
            (getEmailConfig as any).mockResolvedValue({ enabled: false });

            const formData = new FormData();
            formData.append('emailNotificationsEnabled', 'on');

            const result = await updateNotificationPreferences({}, formData);

            expect(result.success).toBeUndefined();
            expect(result.error).toContain('Email notifications cannot be enabled');

            // Should still be false in DB
            const userInDb = await testPrisma.user.findUnique({ where: { id: testUser.id } });
            expect(userInDb?.emailNotificationsEnabled).toBe(false);
        });
    });

    describe('SMS Notifications', () => {
        it('should allow enabling SMS notifications when SMS provider is configured', async () => {
            (getSMSConfig as any).mockResolvedValue({ enabled: true });

            const formData = new FormData();
            formData.append('smsNotificationsEnabled', 'on');
            formData.append('phoneNumber', '+1234567890');

            const result = await updateNotificationPreferences({}, formData);

            expect(result.success).toBe(true);

            const updatedUser = await testPrisma.user.findUnique({ where: { id: testUser.id } });
            expect(updatedUser?.smsNotificationsEnabled).toBe(true);
            expect(updatedUser?.phoneNumber).toBe('+1234567890');
        });

        it('should prevent enabling SMS notifications when SMS provider is not configured', async () => {
            (getSMSConfig as any).mockResolvedValue({ enabled: false });

            const formData = new FormData();
            formData.append('smsNotificationsEnabled', 'on');
            formData.append('phoneNumber', '+1234567890');

            const result = await updateNotificationPreferences({}, formData);

            expect(result.success).toBeUndefined();
            expect(result.error).toContain('SMS notifications cannot be enabled');
        });

        it('should validate phone number format when SMS is enabled', async () => {
            (getSMSConfig as any).mockResolvedValue({ enabled: true });

            const formData = new FormData();
            formData.append('smsNotificationsEnabled', 'on');
            formData.append('phoneNumber', '1234567890'); // Missing + prefix

            const result = await updateNotificationPreferences({}, formData);

            expect(result.success).toBeUndefined();
            expect(result.error).toContain('E.164 format');
        });
    });

    describe('Push Notifications', () => {
        it('should allow enabling push notifications when push provider is configured', async () => {
            (getPushConfig as any).mockResolvedValue({ enabled: true });

            const formData = new FormData();
            formData.append('pushNotificationsEnabled', 'on');

            const result = await updateNotificationPreferences({}, formData);

            expect(result.success).toBe(true);

            const updatedUser = await testPrisma.user.findUnique({ where: { id: testUser.id } });
            expect(updatedUser?.pushNotificationsEnabled).toBe(true);
        });

        it('should prevent enabling push notifications when push provider is not configured', async () => {
            (getPushConfig as any).mockResolvedValue({ enabled: false });

            const formData = new FormData();
            formData.append('pushNotificationsEnabled', 'on');

            const result = await updateNotificationPreferences({}, formData);

            expect(result.success).toBeUndefined();
            expect(result.error).toContain('Push notifications cannot be enabled');
        });
    });

    describe('WhatsApp Notifications', () => {
        it('should allow enabling WhatsApp notifications when WhatsApp provider is configured', async () => {
            (getWhatsAppConfig as any).mockResolvedValue({ enabled: true });

            const formData = new FormData();
            formData.append('whatsappNotificationsEnabled', 'on');
            formData.append('phoneNumberWhatsApp', '+1234567890');

            const result = await updateNotificationPreferences({}, formData);

            expect(result.success).toBe(true);

            const updatedUser = await testPrisma.user.findUnique({ where: { id: testUser.id } });
            expect(updatedUser?.whatsappNotificationsEnabled).toBe(true);
            expect(updatedUser?.phoneNumber).toBe('+1234567890');
        });

        it('should prevent enabling WhatsApp notifications when WhatsApp provider is not configured', async () => {
            (getWhatsAppConfig as any).mockResolvedValue({ enabled: false });

            const formData = new FormData();
            formData.append('whatsappNotificationsEnabled', 'on');
            formData.append('phoneNumberWhatsApp', '+1234567890');

            const result = await updateNotificationPreferences({}, formData);

            expect(result.success).toBeUndefined();
            expect(result.error).toContain('WhatsApp notifications cannot be enabled');
        });
    });

    describe('Multiple Providers', () => {
        it('should allow enabling multiple notifications when all providers are configured', async () => {
            (getEmailConfig as any).mockResolvedValue({ enabled: true });
            (getSMSConfig as any).mockResolvedValue({ enabled: true });

            const formData = new FormData();
            formData.append('emailNotificationsEnabled', 'on');
            formData.append('smsNotificationsEnabled', 'on');
            formData.append('phoneNumber', '+1234567890');

            const result = await updateNotificationPreferences({}, formData);

            expect(result.success).toBe(true);

            const updatedUser = await testPrisma.user.findUnique({ where: { id: testUser.id } });
            expect(updatedUser?.emailNotificationsEnabled).toBe(true);
            expect(updatedUser?.smsNotificationsEnabled).toBe(true);
        });

        it('should allow disabling all notifications regardless of provider status', async () => {
            // First enable one
            await testPrisma.user.update({
                where: { id: testUser.id },
                data: { emailNotificationsEnabled: true }
            });

            const formData = new FormData();
            // No checkboxes checked = all disabled

            const result = await updateNotificationPreferences({}, formData);

            expect(result.success).toBe(true);

            const updatedUser = await testPrisma.user.findUnique({ where: { id: testUser.id } });
            expect(updatedUser?.emailNotificationsEnabled).toBe(false);
            expect(updatedUser?.smsNotificationsEnabled).toBe(false);
            expect(updatedUser?.pushNotificationsEnabled).toBe(false);
            expect(updatedUser?.whatsappNotificationsEnabled).toBe(false);
        });
    });
});
