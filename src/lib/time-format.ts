/**
 * Time formatting utilities
 * 
 * These are pure functions that don't depend on Prisma or database,
 * so they can be safely used in client components.
 */

/**
 * Format time in minutes to a human-readable string
 */
export function formatTimeMinutes(minutes: number): string {
    if (minutes < 1) {
        return '< 1 min';
    } else if (minutes < 60) {
        return `${Math.round(minutes)} min`;
    } else if (minutes < 1440) {
        const hours = Math.floor(minutes / 60);
        const mins = Math.round(minutes % 60);
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    } else {
        const days = Math.floor(minutes / 1440);
        const remainingMinutes = minutes % 1440;
        const hours = Math.floor(remainingMinutes / 60);
        const mins = Math.round(remainingMinutes % 60);
        
        if (hours === 0 && mins === 0) {
            return `${days}d`;
        } else if (mins === 0) {
            return `${days}d ${hours}h`;
        } else {
            return `${days}d ${hours}h ${mins}m`;
        }
    }
}

/**
 * Format time in milliseconds to a human-readable string
 */
export function formatTimeMinutesMs(ms: number | null): string {
    if (ms === null) return '--';
    const minutes = ms / 1000 / 60;
    return formatTimeMinutes(minutes);
}



