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
});
