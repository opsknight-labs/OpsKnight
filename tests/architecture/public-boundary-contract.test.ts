import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('public boundary contract', () => {
  it('limits generic event ingestion to Events API integrations', () => {
    const route = readFileSync('src/app/api/events/route.ts', 'utf8');

    expect(route).toContain("integration.type !== 'EVENTS_API_V2'");
  });

  it('does not let public status-page rendering create configuration', () => {
    const page = readFileSync('src/app/(public)/status/page.tsx', 'utf8');

    expect(page).toContain('Status page is not configured.');
    expect(page).not.toContain('const newStatusPage = await prisma.statusPage.create');
  });

  it('revokes a removed member’s existing sessions in the same transaction', () => {
    const actions = readFileSync('src/app/(app)/teams/actions.ts', 'utf8');

    expect(actions).toContain('data: { tokenVersion: { increment: 1 } }');
  });

  it('uses the shared visibility policy for rendered and API status outputs', () => {
    const html = readFileSync('src/app/(public)/status/page.tsx', 'utf8');
    const statusApi = readFileSync('src/app/api/status/route.ts', 'utf8');
    const historyApi = readFileSync('src/app/api/status/history/route.ts', 'utf8');
    const rss = readFileSync('src/app/api/status/rss/route.ts', 'utf8');

    for (const source of [html, statusApi, historyApi, rss]) {
      expect(source).toContain('publicStatusVisibility');
    }
    expect(html).toContain('visibility.showIncidents');
    expect(html).toContain('visibility.showMetrics');
    expect(html).toContain('visibility.showUptime');
  });

  it('revalidates every long-lived stream against the shared authorization scope', () => {
    for (const file of [
      'src/app/api/events/stream/route.ts',
      'src/app/api/realtime/stream/route.ts',
      'src/app/api/widgets/stream/route.ts',
    ]) {
      const stream = readFileSync(file, 'utf8');
      expect(stream).toContain('resolveStreamAuthorization');
      expect(stream).toContain('hasSameStreamAuthorizationScope');
      expect(stream).toContain("type: 'authorization_revoked'");
    }
  });
});
