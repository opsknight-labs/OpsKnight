/**
 * Database error utilities
 */

/**
 * Extracts a human-readable database target from a connection URL
 * Safely masks credentials and sensitive information
 */
export function describeDatabaseTarget(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) {
    return null;
  }

  try {
    const url = new URL(databaseUrl);
    // Return host:port only, no credentials
    const port = url.port || '5432';
    return `${url.hostname}:${port}`;
  } catch {
    // If URL parsing fails, don't expose the raw string
    return null;
  }
}
