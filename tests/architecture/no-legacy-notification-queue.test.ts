import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function productionSourceMatches(pattern: RegExp): string[] {
  const matches: string[] = [];
  const visit = (directory: string) => {
    // Test-owned paths are rooted under this checkout's src directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        if (pattern.test(readFileSync(path, 'utf8'))) matches.push(path);
      }
    }
  };
  visit(join(process.cwd(), 'src'));
  return matches;
}

describe('notification queue architecture', () => {
  it('has no production imports of the removed in-memory queue API', () => {
    expect(
      productionSourceMatches(
        /queueNotification|queueBulkNotifications|getQueueStats|forceFlush|notification-queue/
      )
    ).toEqual([]);
  });

  it('does not expose the legacy personal-delivery feature flag', () => {
    expect(productionSourceMatches(/NOTIFICATION_CONTROL_PLANE_PERSONAL/)).toEqual([]);
  });
});
