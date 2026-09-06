import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendSlackMessageToChannel, sendSlackNotification } from '@/lib/slack';
import * as retryModule from '@/lib/retry';

// Mock dependencies
const slackPrisma = vi.hoisted(() => ({
    findService: vi.fn().mockResolvedValue(null),
    findIntegration: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/prisma', () => ({
    default: {
        service: { findUnique: slackPrisma.findService },
        slackIntegration: { findFirst: slackPrisma.findIntegration },
    },
}));

vi.mock('@/lib/env-validation', () => ({
    getBaseUrl: () => 'https://test.example.com',
}));

vi.mock('@/lib/encryption', () => ({
    decrypt: (token: string) => token,
}));

vi.mock('@/lib/logger', () => ({
    logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    },
}));

// Mock retry module at the top level
vi.mock('@/lib/retry', () => ({
    retryFetch: vi.fn(),
    isRetryableHttpError: vi.fn(),
}));

describe('Slack Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('sendSlackNotification - Webhook Mode', () => {
        it('should send webhook notification successfully', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => 'ok',
            });

            vi.spyOn(retryModule, 'retryFetch').mockImplementation(mockFetch);

            const incident = {
                id: 'inc-123',
                title: 'Database Outage',
                status: 'TRIGGERED',
                urgency: 'HIGH',
                serviceName: 'API Service',
                assigneeName: 'John Doe',
            };

            const result = await sendSlackNotification(
                'triggered',
                incident,
                undefined,
                'https://hooks.slack.com/test'
            );

            expect(result.success).toBe(true);
            // Verify the mock was called
            expect(mockFetch).toHaveBeenCalled();
        });

        it('should return error when no webhook URL configured', async () => {
            const incident = {
                id: 'inc-123',
                title: 'Test Incident',
                status: 'TRIGGERED',
                urgency: 'HIGH',
                serviceName: 'Test Service',
            };

            const result = await sendSlackNotification('triggered', incident);

            expect(result.success).toBe(false);
            expect(result.error).toContain('No Slack webhook URL configured');
        });

        it('should handle 5xx webhook failure gracefully', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                text: async () => 'Internal Server Error',
            });

            vi.spyOn(retryModule, 'retryFetch').mockImplementation(mockFetch);

            const incident = {
                id: 'inc-456',
                title: 'Network Issue',
                status: 'TRIGGERED',
                urgency: 'MEDIUM',
                serviceName: 'Network Service',
            };

            const result = await sendSlackNotification(
                'triggered',
                incident,
                undefined,
                'https://hooks.slack.com/test'
            );

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should handle 4xx client errors', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                text: async () => 'Bad Request',
            });

            vi.spyOn(retryModule, 'retryFetch').mockImplementation(mockFetch);

            const incident = {
                id: 'inc-400',
                title: 'Test',
                status: 'TRIGGERED',
                urgency: 'LOW',
                serviceName: 'Test Service',
            };

            const result = await sendSlackNotification(
                'triggered',
                incident,
                undefined,
                'https://hooks.slack.com/test'
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Bad Request');
        });

        it('classifies Slack free-workspace message caps as terminal provider errors', async () => {
            vi.spyOn(retryModule, 'retryFetch').mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => 'message_limit_exceeded',
            } as unknown as Response);

            const result = await sendSlackNotification(
                'triggered',
                {
                    id: 'inc-limit',
                    title: 'Capacity exhausted',
                    status: 'OPEN',
                    urgency: 'HIGH',
                    serviceName: 'API',
                },
                undefined,
                'https://hooks.slack.com/test'
            );

            expect(result).toMatchObject({
                success: false,
                error: 'message_limit_exceeded',
                errorCode: 'message_limit_exceeded',
                statusCode: 200,
            });
        });

        it('should include custom message in notification payload', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => 'ok',
            });

            vi.spyOn(retryModule, 'retryFetch').mockImplementation(mockFetch);

            const incident = {
                id: 'inc-789',
                title: 'Deployment Failed',
                status: 'TRIGGERED',
                urgency: 'HIGH',
                serviceName: 'CI/CD',
            };

            const customMessage = 'Build #123 failed on production';

            await sendSlackNotification(
                'triggered',
                incident,
                customMessage,
                'https://hooks.slack.com/test'
            );

            const callArgs = mockFetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);

            // Check that blocks include custom message
            const hasCustomMessage = body.attachments[0].blocks.some(
                (block: any) => block.text?.text?.includes(customMessage) // eslint-disable-line @typescript-eslint/no-explicit-any
            );
            expect(hasCustomMessage).toBe(true);
        });

        it('should send acknowledged event with correct status color', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => 'ok',
            });

            vi.spyOn(retryModule, 'retryFetch').mockImplementation(mockFetch);

            const incident = {
                id: 'inc-ack',
                title: 'Database Issue',
                status: 'ACKNOWLEDGED',
                urgency: 'HIGH',
                serviceName: 'Database',
            };

            await sendSlackNotification(
                'acknowledged',
                incident,
                undefined,
                'https://hooks.slack.com/test'
            );

            const callArgs = mockFetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);

            // Acknowledged should have amber/warning color
            expect(body.attachments[0].color).toBe('#f9a825');
        });

        it('should send resolved event with success color', async () => {
            const mockFetch = vi.fn().mockResolvedValue({
                ok: true,
                status: 200,
                text: async () => 'ok',
            });

            vi.spyOn(retryModule, 'retryFetch').mockImplementation(mockFetch);

            const incident = {
                id: 'inc-resolved',
                title: 'Network Restored',
                status: 'RESOLVED',
                urgency: 'MEDIUM',
                serviceName: 'Network',
            };

            await sendSlackNotification(
                'resolved',
                incident,
                undefined,
                'https://hooks.slack.com/test'
            );

            const callArgs = mockFetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);

            // Resolved should have green color
            expect(body.attachments[0].color).toBe('#388e3c');
        });
    });

    describe('sendSlackMessageToChannel - Channel Mode', () => {
        it('does not fall back to a webhook when the channel credential is unavailable', async () => {
            const result = await sendSlackMessageToChannel(
                'C123',
                {
                    id: 'inc-123',
                    title: 'Database Outage',
                    status: 'OPEN',
                    urgency: 'HIGH',
                    serviceName: 'API',
                },
                'triggered'
            );

            expect(result).toMatchObject({
                success: false,
                errorCode: 'SLACK_BOT_TOKEN_MISSING',
            });
            expect(retryModule.retryFetch).not.toHaveBeenCalled();
        });
    });
});
