import { NextResponse } from 'next/server';
import { getPushConfig } from '@/lib/notification-providers';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const config = await getPushConfig();
        if (config.enabled && config.provider === 'web-push' && config.vapidPublicKey) {
            return NextResponse.json({
                enabled: true,
                publicKey: config.vapidPublicKey,
                // Backward-compatible alias for older clients.
                key: config.vapidPublicKey,
            });
        }

        return NextResponse.json(
            {
                error: 'Push notifications are not configured on this server.',
                code: 'PUSH_VAPID_NOT_CONFIGURED',
                action: 'Push is not configured by your administrator.',
                retryable: false,
            },
            { status: 503 }
        );
    } catch (error) {
        logger.error('Error fetching VAPID key', { component: 'vapid-public-key', error });
        return NextResponse.json(
            {
                error: 'Push configuration is temporarily unavailable.',
                code: 'PUSH_PROVIDER_UNAVAILABLE',
                action: 'Try again shortly.',
                retryable: true,
            },
            { status: 503 }
        );
    }
}
