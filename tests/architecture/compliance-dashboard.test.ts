// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SETTINGS_NAV_ITEMS } from '@/components/settings/navConfig';

describe('compliance diagnostics navigation and language', () => {
  it('exposes the dashboard only as an administrator setting', () => {
    expect(SETTINGS_NAV_ITEMS).toContainEqual(
      expect.objectContaining({
        id: 'security-compliance',
        href: '/settings/security-compliance',
        requiresAdmin: true,
      })
    );
  });

  it('uses readiness counts and avoids compliance-score claims', () => {
    const page = readFileSync('src/app/(app)/settings/security-compliance/page.tsx', 'utf8');
    expect(page).toContain('Read-only readiness diagnostics');
    expect(page).toContain('not certification or legal conclusions');
    expect(page).not.toMatch(/\b(compliance score|\d+% compliant)\b/i);
  });

  it('searches and paginates the subject selector on the server', () => {
    const page = readFileSync('src/app/(app)/settings/security-compliance/page.tsx', 'utf8');
    expect(page).toContain('USER_SEARCH_PAGE_SIZE = 30');
    expect(page).toContain('contains: query');
    expect(page).toContain('skip: (page - 1) * USER_SEARCH_PAGE_SIZE');
    expect(page).not.toContain('take: 200');
  });
});
