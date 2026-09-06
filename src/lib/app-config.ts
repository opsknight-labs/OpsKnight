import prisma from '@/lib/prisma';
import { getBaseUrl } from '@/lib/env-validation';
import { cache } from 'react';

/**
 * Get the application's public URL
 * Priority:
 * 1. Database configuration (SystemSettings)
 * 2. NEXT_PUBLIC_APP_URL environment variable
 * 3. NEXTAUTH_URL environment variable
 * 4. Localhost fallback
 */
export const getAppUrl = cache(async (): Promise<string> => {
    try {
        // Try getting from database first
        const settings = await prisma.systemSettings.findUnique({
            where: { id: 'default' }
        });

        if (settings?.appUrl) {
            // Ensure no trailing slash
            return settings.appUrl.replace(/\/$/, '');
        }
    } catch (_error) {
        // Database might not be available during build or basic commands
        // This is expected during initial setup
    }

    // Fallback to environment variables
    // We use the existing logic but wrapped to ensure we return something usable
    try {
        return getBaseUrl();
    } catch (_e) {
        // If getBaseUrl throws (e.g. strict mode), fallback to NEXTAUTH_URL or localhost
        return process.env.NEXTAUTH_URL?.replace(/\/$/, '') || 'http://localhost:3000';
    }
});
