import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appLayout = readFileSync('src/app/(app)/layout.tsx', 'utf8');
const statusBar = readFileSync('src/components/layout/StatusBar.tsx', 'utf8');
const sidebar = readFileSync('src/components/Sidebar.tsx', 'utf8');
const mobileLayout = readFileSync('src/app/(mobile)/m/layout.tsx', 'utf8');
const kioskLayout = readFileSync('src/app/(kiosk)/layout.tsx', 'utf8');
const statsRoute = readFileSync('src/app/api/status-bar/route.ts', 'utf8');
const baseCss = readFileSync('src/styles/foundation/base.css', 'utf8');
const occurrences = (source: string, needle: string) => source.split(needle).length - 1;

describe('desktop status bar contract', () => {
  it('renders StatusBar exactly once in the (app) layout, from server data', () => {
    expect(occurrences(appLayout, '<StatusBar')).toBe(1);
    expect(appLayout).toContain('getStatusBarData(requestContext.actor)');
    expect(appLayout).toContain('Promise.all([getAccessSnapshot(), statusBarPromise])');
  });

  it('keeps opsknight.com and the version in the sidebar only, never in the bar', () => {
    expect(sidebar).not.toContain('lg:hidden"');
    expect(sidebar).toContain('releases/tag/${APP_VERSION}');
    expect(sidebar).toMatch(
      /!isDesktopCollapsed && \(\s*<div className="flex items-center justify-between mt-2/
    );
    expect(statusBar).not.toContain('opsknight.com');
    expect(statusBar).not.toContain('releaseNotesHref');
  });

  it('starts at the sidebar edge, follows its collapse, and leaves the sidebar full height', () => {
    expect(statusBar).toMatch(/status-bar [^"]*fixed bottom-0 right-0/);
    expect(statusBar).not.toContain('inset-x-0');
    expect(baseCss).toMatch(
      /\.status-bar \{\s*left: var\(--sidebar-width, 240px\);\s*transition: left var\(--transition-base\);/
    );
    expect(baseCss).toMatch(
      /\.app-shell:has\(\.sidebar-collapsed\) \.status-bar,[^{]*\{\s*left: var\(--sidebar-width-collapsed, 64px\);/
    );
    expect(baseCss).not.toMatch(/\.sidebar:not\(\.sidebar-mobile\) \{[^}]*status-bar-height/);
  });

  it('is not rendered by the mobile or kiosk layouts', () => {
    expect(mobileLayout).not.toContain('StatusBar');
    expect(kioskLayout).not.toContain('StatusBar');
  });

  it('reuses the single realtime stream and its own cached endpoint', () => {
    expect(statusBar).not.toContain('new EventSource');
    expect(statusBar).toContain('useOptionalRealtime');
    expect(statusBar).toContain("fetch('/api/status-bar')");
    expect(statsRoute).toContain(
      "'Cache-Control': 'private, max-age=10, stale-while-revalidate=30'"
    );
  });

  it('is desktop-only and reserves its height for the scroll area', () => {
    expect(statusBar).toMatch(/hidden h-7 [^"]*lg:flex/);
    expect(baseCss).toContain('--status-bar-height: 1.75rem');
    expect(baseCss).toContain(
      'height: calc(100dvh - var(--header-height, 56px) - var(--status-bar-height, 0px));'
    );
  });
});
