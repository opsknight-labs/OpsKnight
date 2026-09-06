import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

const INVALID_APP_URL_VALUES = new Set(['undefined', 'null']);

function normalizeAppUrl(value?: string | null): string | null {
    if (!value) {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    if (INVALID_APP_URL_VALUES.has(trimmed.toLowerCase())) {
        return null;
    }

    try {
        const url = new URL(trimmed);
        if (!['http:', 'https:'].includes(url.protocol)) {
            return null;
        }

        return trimmed.replace(/\/$/, '');
    } catch {
        return null;
    }
}

/**
 * Get the application base URL
 * Priority:
 * 1. Database configuration (SystemSettings.appUrl)
 * 2. Environment variable (NEXT_PUBLIC_APP_URL)
 * 3. Fallback to localhost (development only)
 */
export async function getAppUrl(): Promise<string> {
    try {
        // Try to get from database first
        const settings = await prisma.systemSettings.findUnique({
            where: { id: 'default' },
            select: { appUrl: true }
        });

        const normalizedFromDb = normalizeAppUrl(settings?.appUrl);
        if (normalizedFromDb) {
            return normalizedFromDb;
        }

        if (settings?.appUrl) {
            logger.warn('Invalid app URL found in database configuration', { appUrl: settings.appUrl });
        }
    } catch (error) {
        // If database query fails, log and continue to fallback
        logger.warn('Failed to fetch app URL from database', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }

    // Fallback to environment variable
    const normalizedFromEnv = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
    if (normalizedFromEnv) {
        return normalizedFromEnv;
    }

    const normalizedFromAuth = normalizeAppUrl(process.env.NEXTAUTH_URL);
    if (normalizedFromAuth) {
        return normalizedFromAuth;
    }

    // Final fallback for development
    const fallback = 'http://localhost:3000';

    if (process.env.NODE_ENV === 'production') {
        logger.warn('App URL not configured in database or environment. Using fallback which may cause issues with notifications and webhooks.');
    }

    return fallback;
}

/**
 * Get the application base URL synchronously (for client-side)
 * Only use this on the server side or when you can't use async
 */
export function getAppUrlSync(): string {
    const normalizedFromEnv = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL);
    if (normalizedFromEnv) {
        return normalizedFromEnv;
    }

    const normalizedFromAuth = normalizeAppUrl(process.env.NEXTAUTH_URL);
    if (normalizedFromAuth) {
        return normalizedFromAuth;
    }

    return 'http://localhost:3000';
}
