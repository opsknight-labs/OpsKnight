import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Jira release-hardening contracts', () => {
  it('requires a fresh token when the Jira origin changes', () => {
    const settings = readFileSync('src/app/(app)/settings/integrations/jira/actions.ts', 'utf8');
    expect(settings).toContain('originChanged && !hasFreshApiToken');
    expect(settings).toContain('Re-enter the Jira API token when changing the Jira site origin.');
  });

  it('has no different-status bypass in webhook stale-event ordering', () => {
    const sync = readFileSync('src/lib/jira-sync.ts', 'utf8');
    expect(sync).toContain('link.lastSyncedAt < eventTime');
    expect(sync).not.toContain('eventTime.getTime() + 300_000');
  });
});
