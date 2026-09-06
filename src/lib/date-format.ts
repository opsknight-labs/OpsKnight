/**
 * Format date consistently for SSR/Client to avoid hydration mismatches
 * @deprecated Use formatDateTime from '@/lib/timezone' instead for timezone support
 */
export function formatDate(date: Date | string, format: 'date' | 'datetime' | 'time' = 'datetime'): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    
    if (!d || isNaN(d.getTime())) {
        return 'Invalid Date';
    }

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');

    switch (format) {
        case 'date':
            return `${year}-${month}-${day}`;
        case 'time':
            return `${hours}:${minutes}:${seconds}`;
        case 'datetime':
        default:
            return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
}

/**
 * Format date in a user-friendly way (SSR-safe, consistent between server and client)
 * Format: DD/MM/YYYY, HH:MM:SS
 * @deprecated Use formatDateTime from '@/lib/timezone' with timezone parameter instead
 */
export function formatDateFriendly(date: Date | string, format: 'date' | 'datetime' = 'datetime', timeZone?: string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    
    if (!d || isNaN(d.getTime())) {
        return 'Invalid Date';
    }

    // If timezone is provided, use Intl.DateTimeFormat for proper conversion
    if (timeZone) {
        try {
            if (format === 'date') {
            return new Intl.DateTimeFormat('en-GB', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                timeZone
            }).format(d);
        }
            return new Intl.DateTimeFormat('en-GB', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                timeZone
            }).format(d);
        } catch {
            // Fallback to UTC if timezone is invalid
        }
    }

    // Use UTC methods to ensure consistent output between server and client (legacy behavior)
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const minutes = String(d.getUTCMinutes()).padStart(2, '0');
    const seconds = String(d.getUTCSeconds()).padStart(2, '0');

    if (format === 'date') {
        return `${day}/${month}/${year}`;
    }

    return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
}

/**
 * Format time in HH:MM format (SSR-safe, consistent between server and client)
 * Uses 24-hour format without AM/PM to avoid locale differences
 */
export function formatTime(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    
    if (!d || isNaN(d.getTime())) {
        return 'Invalid Time';
    }

    // Use local time but format consistently (24-hour format) to avoid hydration mismatches
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');

    return `${hours}:${minutes}`;
}

/**
 * Format date in short format like "Jan 15" (SSR-safe, consistent between server and client)
 */
export function formatDateShort(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    
    if (!d || isNaN(d.getTime())) {
        return 'Invalid Date';
    }

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    // Use local time but format consistently to avoid hydration mismatches
    const month = months[d.getMonth()];
    const day = d.getDate();

    return `${month} ${day}`;
}

/**
 * Format date for grouping like "January 15, 2024" (SSR-safe, consistent between server and client)
 */
export function formatDateGroup(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    
    if (!d || isNaN(d.getTime())) {
        return 'Invalid Date';
    }

    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    // Use local time but format consistently to avoid hydration mismatches
    const month = months[d.getMonth()];
    const day = d.getDate();
    const year = d.getFullYear();

    return `${month} ${day}, ${year}`;
}

