import { NextResponse } from 'next/server';
import { getPushConfig } from '@/lib/notification-providers';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        // 1. Try DB Configuration
        const config = await getPushConfig();
        if (config.provider === 'web-push' && config.vapidPublicKey) {
            return NextResponse.json({ key: config.vapidPublicKey });
        }

        // 2. Fallback to Environment Variable
        if (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
            return NextResponse.json({ key: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY });
        }

        return NextResponse.json({ error: 'VAPID Public Key not configured' }, { status: 404 });
    } catch (error) {
        logger.error('Error fetching VAPID key', { component: 'vapid-public-key', error });
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
