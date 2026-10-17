import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('public boundary contract', () => {
  it('limits generic event ingestion to Events API integrations', () => {
    const route = readFileSync('src/app/api/events/route.ts', 'utf8');

    expect(route).toContain("integration.type !== 'EVENTS_API_V2'");
  });

  it('does not let public status-page rendering create configuration', () => {
    const page = readFileSync('src/app/(public)/status/page.tsx', 'utf8');

    // Public rendering only ever reports an unconfigured address; it never provisions one.
    expect(page).toContain('Status page not configured');
    expect(page).toContain('No status page has been published at this address.');
    expect(page).not.toContain('const newStatusPage = await prisma.statusPage.create');
  });

  it('revokes a removed member’s existing sessions in the same transaction', () => {
    const actions = readFileSync('src/app/(app)/teams/actions.ts', 'utf8');
    const command = readFileSync('src/lib/teams/membership-commands.ts', 'utf8');

    expect(actions).toContain('removeTeamMembership(memberId)');
    expect(command).toContain('data: { tokenVersion: { increment: 1 } }');
    expect(command).toContain("isolationLevel: 'Serializable'");
  });

  it('uses the shared visibility policy for rendered and API status outputs', () => {
    const htmlEntry = readFileSync('src/app/(public)/status/page.tsx', 'utf8');
    const html = readFileSync('src/lib/status-pages/snapshot.ts', 'utf8');
    const statusApi = readFileSync('src/app/api/status/handler.ts', 'utf8');
    const historyApi = readFileSync('src/app/api/status/history/handler.ts', 'utf8');
    const rss = readFileSync('src/app/api/status/rss/route.ts', 'utf8');

    expect(html).toContain('publicStatusVisibility');
    expect(historyApi).toContain('publicStatusVisibility');
    for (const source of [statusApi, rss]) {
      expect(source).toContain('getStatusPageSnapshotByRoute');
    }
    expect(htmlEntry).toContain('getStatusPageSnapshotByRoute');
    expect(htmlEntry).not.toContain("@/lib/prisma");
    expect(html).toContain('visibility.showIncidents');
    expect(html).toContain('visibility.showUptime');
    expect(html).toContain('visibility.showServices');
  });

  it('requires edge revalidation for every cacheable public status response', () => {
    const sources = [
      readFileSync('src/middleware.ts', 'utf8'),
      readFileSync('src/app/api/status/handler.ts', 'utf8'),
      readFileSync('src/app/api/status/history/handler.ts', 'utf8'),
      readFileSync('src/app/api/status/rss/route.ts', 'utf8'),
    ];
    for (const source of sources) {
      expect(source).toContain('PUBLIC_STATUS_CACHE_CONTROL');
      expect(source).toContain('PRIVATE_STATUS_CACHE_CONTROL');
    }
    expect(readFileSync('src/lib/status-pages/cache-policy.ts', 'utf8')).not.toContain(
      'stale-if-error'
    );
  });

  it('revalidates every long-lived stream against the shared authorization scope', () => {
    const streams = [
      readFileSync('src/app/api/events/stream/route.ts', 'utf8'),
      readFileSync('src/app/api/realtime/stream/route.ts', 'utf8'),
      readFileSync('src/app/api/widgets/stream/route.ts', 'utf8'),
    ];
    for (const stream of streams) {
      expect(stream).toContain('resolveStreamAuthorization');
      expect(stream).toContain('hasSameStreamAuthorizationScope');
      expect(stream).toContain("type: 'authorization_revoked'");
    }
  });
});
