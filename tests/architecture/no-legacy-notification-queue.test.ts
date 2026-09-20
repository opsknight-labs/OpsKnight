import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('notification queue architecture', () => {
  it('has no production imports of the removed in-memory queue API', () => {
    const result = spawnSync(
      'rg',
      [
        '-n',
        'queueNotification|queueBulkNotifications|getQueueStats|forceFlush|notification-queue',
        'src',
        '--glob',
        '!**/*.test.*',
      ],
      { encoding: 'utf8' }
    );
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe('');
  });

  it('does not expose the legacy personal-delivery feature flag', () => {
    const result = spawnSync('rg', ['-n', 'NOTIFICATION_CONTROL_PLANE_PERSONAL', 'src'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe('');
  });
});
