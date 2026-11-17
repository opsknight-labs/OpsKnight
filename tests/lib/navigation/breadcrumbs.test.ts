import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_ROUTE_PATTERNS,
  buildBreadcrumbs,
  currentEntityHref,
} from '@/lib/navigation/breadcrumbs';

const APP_DIR = path.resolve(__dirname, '../../../src/app/(app)');

function collectPagePatterns(dir: string, prefix = ''): string[] {
  const found: string[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks the repo's own src/app tree
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'page.tsx') found.push(prefix || '/');
    if (entry.isDirectory()) {
      const segment = entry.name.startsWith('(') ? '' : `/${entry.name}`;
      found.push(...collectPagePatterns(path.join(dir, entry.name), prefix + segment));
    }
  }
  return found;
}

const IDS = {
  svc: 'cmwj77ata00aga6tx2et76uhb',
  inc: 'cmwj77xsy000ml1fp9puthce4',
};

describe('breadcrumbs', () => {
  it('lists every (app) page so crumbs never link to a missing route', () => {
    expect([...APP_ROUTE_PATTERNS].sort()).toEqual(collectPagePatterns(APP_DIR).sort());
  });

  it('is empty on the home page', () => {
    expect(buildBreadcrumbs('/')).toEqual([]);
  });

  it('uses readable section and page labels', () => {
    expect(buildBreadcrumbs('/settings/integrations').map(c => c.label)).toEqual([
      'Settings',
      'Integrations',
    ]);
    expect(buildBreadcrumbs('/policies').map(c => c.label)).toEqual(['Escalation Policies']);
    expect(buildBreadcrumbs('/settings/api-keys').map(c => c.label)).toEqual([
      'Settings',
      'API Keys',
    ]);
  });

  it('treats static routes as pages, not ids, even when a dynamic sibling exists', () => {
    const crumbs = buildBreadcrumbs('/incidents/templates');
    expect(crumbs.map(c => [c.label, c.isEntity])).toEqual([
      ['Incidents', false],
      ['Templates', false],
    ]);
  });

  it('names entities from the registry and falls back to a short id', () => {
    const fallback = buildBreadcrumbs(`/services/${IDS.svc}/settings`);
    expect(fallback.map(c => c.label)).toEqual(['Services', 'Service cmwj77at', 'Settings']);
    expect(fallback[1]).toMatchObject({ isEntity: true, isLink: true, segment: IDS.svc });

    const named = buildBreadcrumbs(
      `/services/${IDS.svc}/settings`,
      new Map([[`/services/${IDS.svc}`, 'Checkout API']])
    );
    expect(named.map(c => c.label)).toEqual(['Services', 'Checkout API', 'Settings']);
  });

  it('links only to crumbs that are real pages and never to the current page', () => {
    const crumbs = buildBreadcrumbs('/settings/integrations/mcp/approvals/abc123');
    expect(crumbs.map(c => [c.label, c.isLink, c.isCurrent])).toEqual([
      ['Settings', true, false],
      ['Integrations', true, false],
      ['MCP', true, false],
      ['Approvals', false, false],
      ['Approval abc123', false, true],
    ]);
  });

  it('reports the current entity path only on entity pages', () => {
    expect(currentEntityHref(`/incidents/${IDS.inc}`)).toBe(`/incidents/${IDS.inc}`);
    expect(currentEntityHref(`/services/${IDS.svc}/settings`)).toBeNull();
    expect(currentEntityHref('/incidents/create')).toBeNull();
  });

  it('labels unknown segments readably', () => {
    expect(buildBreadcrumbs('/some-new-page').map(c => c.label)).toEqual(['Some New Page']);
  });
});
